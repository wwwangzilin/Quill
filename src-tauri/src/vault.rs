//! 文档仓库（vault）的读写。
//!
//! 存储形态刻意保持「一篇文章 = 一个纯 Markdown 文件」：
//! 没有私有数据库、没有专有格式，丢进任何编辑器都能读，
//! 丢给 git 就是干净的 diff。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::git;

/// 星标、标签等少量元数据，也跟着 git 走
const META_FILE: &str = ".quill-meta.json";
/// 每日写作字数（热力图用）
const STATS_FILE: &str = ".quill-stats.json";
/// 回收站
const TRASH_DIR: &str = ".trash";

/// 一条批注。
///
/// 批注是「人对某段文字的评价」，属于元数据而不是正文，所以**绝不写进 .md**——
/// 它存在 .quill-meta.json 里，照样跟着 git 走、能推远程、换机器还在。
/// quote 存选中的原文片段：正文改过之后靠它在文档里重新定位。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub quote: String,
    pub note: String,
    pub created: i64,
    #[serde(default)]
    pub resolved: bool,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct VaultMeta {
    #[serde(default)]
    pub starred: Vec<String>,
    #[serde(default)]
    pub tags: HashMap<String, Vec<String>>,
    /// 文件名 → 该文档的批注
    #[serde(default)]
    pub comments: HashMap<String, Vec<Comment>>,
}

#[derive(Serialize)]
pub struct DocEntry {
    pub file: String,
    pub title: String,
    pub created: i64,
    pub updated: i64,
    pub size: u64,
    pub starred: bool,
    pub tags: Vec<String>,
    pub chars: u64,
}

#[derive(Serialize)]
pub struct SaveResult {
    pub file: String,
    pub commit: Option<String>,
}

#[derive(Serialize)]
pub struct VaultInfo {
    pub path: String,
    pub docs: usize,
    pub has_git: bool,
}

#[derive(Serialize)]
pub struct TrashEntry {
    /// 回收站里的实际文件名
    pub name: String,
    /// 原始文件名
    pub original: String,
    pub deleted: i64,
    pub size: u64,
}

fn ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn count_chars(s: &str) -> u64 {
    s.chars().filter(|c| !c.is_whitespace()).count() as u64
}

/// 防路径穿越：只允许仓库根下的普通文件名
fn safe_name(file: &str) -> Result<String, String> {
    if file.is_empty()
        || file.contains("..")
        || file.contains('/')
        || file.contains('\\')
        || file.starts_with('.')
    {
        return Err(format!("非法文件名: {file}"));
    }
    Ok(file.to_string())
}

fn trash_path(dir: &Path) -> PathBuf {
    dir.join(TRASH_DIR)
}

fn ensure_trash(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(trash_path(dir)).map_err(|e| format!("创建回收站失败: {e}"))
}

/// 标题 → 文件名（Windows 非法字符替换 + 长度收敛）
pub fn title_to_file(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => ' ',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let short: String = trimmed.chars().take(60).collect();
    if short.is_empty() {
        "未命名.md".to_string()
    } else {
        format!("{short}.md")
    }
}

fn unique_file(dir: &Path, base: &str) -> String {
    if !dir.join(base).exists() {
        return base.to_string();
    }
    let stem = base.trim_end_matches(".md");
    let mut n = 2;
    loop {
        let candidate = format!("{stem} {n}.md");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

pub fn read_meta(dir: &Path) -> VaultMeta {
    std::fs::read_to_string(dir.join(META_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_meta(dir: &Path, meta: &VaultMeta) -> Result<(), String> {
    let text = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    let path = dir.join(META_FILE);
    // 先写临时文件再改名：`fs::write` 是「截断 + 写」，写到一半被打断就只剩半个 JSON。
    // 临时文件留在同一目录（同盘才能 rename），写完之后立刻改走，窗口极短。
    let tmp = dir.join(".quill-meta.json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("写元数据失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("落盘元数据失败: {e}"))
}

/*
 * `.quill-meta.json` 里同时住着星标、标签、批注三类东西，而每个写入口都是
 * 「整体读出来 → 改一个字段 → 整体写回去」。两件事同时发生（一边打标签、
 * 一边写批注）就会互相覆盖：A 读完还没写，B 也读了一份旧的，B 先写、A 后写，
 * B 的改动就没了 —— 标签「打着打着就掉」就是这么来的。
 *
 * 所以所有写入口都必须在同一把锁里做完整的读-改-写，别再各写各的。
 */
static META_LOCK: Mutex<()> = Mutex::new(());

/// 在锁保护下改一次元数据。**所有**写入口都走这里。
fn edit_meta<T>(dir: &Path, f: impl FnOnce(&mut VaultMeta) -> T) -> Result<T, String> {
    // 前一个持锁者 panic 过也要能继续用，所以不吃 poison
    let _guard = META_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut meta = read_meta(dir);
    let out = f(&mut meta);
    write_meta(dir, &meta)?;
    Ok(out)
}

fn commit(dir: &Path, message: &str) -> Option<String> {
    if !git::has_repo(dir) {
        return None;
    }
    // 提交失败不该让保存本身失败：文件已经安全落盘了，
    // 下次保存会把它一起带进历史。
    git::commit_all(dir, message).ok().flatten()
}

pub fn list(dir: &Path) -> Result<Vec<DocEntry>, String> {
    let meta = read_meta(dir);
    let mut out = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| format!("读取仓库失败: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.ends_with(".md") {
            continue;
        }
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        out.push(DocEntry {
            title: name.trim_end_matches(".md").to_string(),
            starred: meta.starred.iter().any(|f| f == &name),
            tags: meta.tags.get(&name).cloned().unwrap_or_default(),
            chars: std::fs::read_to_string(&path)
                .map(|s| count_chars(&s))
                .unwrap_or(0),
            created: md.created().map(ms).unwrap_or(0),
            updated: md.modified().map(ms).unwrap_or(0),
            size: md.len(),
            file: name,
        });
    }
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(out)
}

pub fn read(dir: &Path, file: &str) -> Result<String, String> {
    let name = safe_name(file)?;
    std::fs::read_to_string(dir.join(&name)).map_err(|e| format!("读取 {name} 失败: {e}"))
}

pub fn create(dir: &Path, title: &str) -> Result<DocEntry, String> {
    let name = unique_file(dir, &title_to_file(title));
    let path = dir.join(&name);
    std::fs::write(&path, "").map_err(|e| format!("新建失败: {e}"))?;
    let md = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(DocEntry {
        title: name.trim_end_matches(".md").to_string(),
        starred: false,
        tags: Vec::new(),
        chars: 0,
        created: md.created().map(ms).unwrap_or(0),
        updated: md.modified().map(ms).unwrap_or(0),
        size: 0,
        file: name,
    })
}

/// 保存正文；标题变了就顺带重命名文件（git 会识别成 rename，历史不断）。
pub fn save(dir: &Path, file: &str, title: &str, content: &str) -> Result<SaveResult, String> {
    let name = safe_name(file)?;
    let old_path = dir.join(&name);
    std::fs::write(&old_path, content).map_err(|e| format!("写入失败: {e}"))?;

    let mut current = name.clone();
    let wanted = title_to_file(title);
    if wanted != name {
        let target = unique_file(dir, &wanted);
        if target != name {
            std::fs::rename(&old_path, dir.join(&target))
                .map_err(|e| format!("重命名失败: {e}"))?;
            let mut meta = read_meta(dir);
            let mut changed = false;
            if let Some(pos) = meta.starred.iter().position(|f| f == &name) {
                meta.starred[pos] = target.clone();
                changed = true;
            }
            if let Some(tags) = meta.tags.remove(&name) {
                meta.tags.insert(target.clone(), tags);
                changed = true;
            }
            if changed {
                let _ = write_meta(dir, &meta);
            }
            current = target;
        }
    }

    let commit = commit(dir, &format!("更新《{}》", title.trim()));
    Ok(SaveResult {
        file: current,
        commit,
    })
}

/// 批量导入：把一批 Markdown 原文写进仓库，全部写完只提交一次。
/// 标题取自文件名（去掉 .md），重名自动加序号 —— 和新建文档共用同一套命名规则。
/// Obsidian / Notion 导出的就是一堆 .md，所以「选个文件夹」就能整体搬进来。
pub fn import_many(dir: &Path, items: Vec<(String, String)>) -> Result<usize, String> {
    let mut written = 0usize;
    for (title, content) in items {
        let name = unique_file(dir, &title_to_file(&title));
        if std::fs::write(dir.join(&name), content).is_ok() {
            written += 1;
        }
    }
    if written > 0 {
        let _ = commit(dir, &format!("导入 {written} 篇文档"));
    }
    Ok(written)
}

/// 删除 = 移入 .trash（回收站），而不是真删
pub fn delete(dir: &Path, file: &str) -> Result<Option<String>, String> {
    let name = safe_name(file)?;
    let path = dir.join(&name);
    if path.exists() {
        ensure_trash(dir)?;
        let stamp = now_secs();
        let target = trash_path(dir).join(format!("{stamp}__{name}"));
        std::fs::rename(&path, &target).map_err(|e| format!("移入回收站失败: {e}"))?;
    }
    let mut meta = read_meta(dir);
    meta.starred.retain(|f| f != &name);
    meta.tags.remove(&name);
    let _ = write_meta(dir, &meta);
    Ok(commit(
        dir,
        &format!("移入回收站《{}》", name.trim_end_matches(".md")),
    ))
}

pub fn list_trash(dir: &Path) -> Result<Vec<TrashEntry>, String> {
    let tdir = trash_path(dir);
    if !tdir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&tdir)
        .map_err(|e| format!("读回收站失败: {e}"))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if !name.ends_with(".md") {
            continue;
        }
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let (stamp, original) = match name.split_once("__") {
            Some((s, o)) => (s.parse::<i64>().unwrap_or(0), o.to_string()),
            None => (0, name.clone()),
        };
        out.push(TrashEntry {
            name,
            original,
            deleted: stamp * 1000,
            size: md.len(),
        });
    }
    out.sort_by(|a, b| b.deleted.cmp(&a.deleted));
    Ok(out)
}

fn safe_trash_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(format!("非法回收站条目: {name}"));
    }
    Ok(())
}

pub fn restore_trash(dir: &Path, name: &str) -> Result<String, String> {
    safe_trash_name(name)?;
    let src = trash_path(dir).join(name);
    if !src.exists() {
        return Err("回收站里没有这个条目".into());
    }
    let original = name
        .split_once("__")
        .map(|(_, o)| o.to_string())
        .unwrap_or_else(|| name.to_string());
    let target = unique_file(dir, &original);
    std::fs::rename(&src, dir.join(&target)).map_err(|e| format!("恢复失败: {e}"))?;
    commit(
        dir,
        &format!("从回收站恢复《{}》", target.trim_end_matches(".md")),
    );
    Ok(target)
}

pub fn purge_trash(dir: &Path, name: &str) -> Result<Option<String>, String> {
    safe_trash_name(name)?;
    let p = trash_path(dir).join(name);
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| format!("删除失败: {e}"))?;
    }
    Ok(commit(dir, "彻底删除一个条目"))
}

pub fn empty_trash(dir: &Path) -> Result<Option<String>, String> {
    let tdir = trash_path(dir);
    if tdir.exists() {
        for entry in std::fs::read_dir(&tdir)
            .map_err(|e| format!("读回收站失败: {e}"))?
            .flatten()
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(commit(dir, "清空回收站"))
}

pub fn star(dir: &Path, file: &str, starred: bool) -> Result<(), String> {
    let name = safe_name(file)?;
    edit_meta(dir, |meta| {
        meta.starred.retain(|f| f != &name);
        if starred {
            meta.starred.push(name.clone());
        }
    })?;
    let verb = if starred { "收藏" } else { "取消收藏" };
    commit(dir, &format!("{verb}《{}》", name.trim_end_matches(".md")));
    Ok(())
}

pub fn set_tags(dir: &Path, file: &str, tags: Vec<String>) -> Result<(), String> {
    let name = safe_name(file)?;
    edit_meta(dir, |meta| {
        let cleaned: Vec<String> = tags
            .into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        if cleaned.is_empty() {
            meta.tags.remove(&name);
        } else {
            meta.tags.insert(name.clone(), cleaned);
        }
    })?;
    commit(dir, &format!("标签《{}》", name.trim_end_matches(".md")));
    Ok(())
}

/// 某篇文档的全部批注
pub fn comments_of(dir: &Path, file: &str) -> Vec<Comment> {
    let name = match safe_name(file) {
        Ok(n) => n,
        Err(_) => return Vec::new(),
    };
    read_meta(dir)
        .comments
        .get(&name)
        .cloned()
        .unwrap_or_default()
}

/// 整体覆盖某篇文档的批注（批注量小，不值得做增量接口）
pub fn set_comments(dir: &Path, file: &str, list: Vec<Comment>) -> Result<(), String> {
    let name = safe_name(file)?;
    edit_meta(dir, |meta| {
        if list.is_empty() {
            meta.comments.remove(&name);
        } else {
            meta.comments.insert(name.clone(), list);
        }
    })?;
    let _ = commit(dir, &format!("批注《{}》", name.trim_end_matches(".md")));
    Ok(())
}

pub fn all_tags(dir: &Path) -> Vec<String> {
    let meta = read_meta(dir);
    let mut out: Vec<String> = Vec::new();
    for tags in meta.tags.values() {
        for t in tags {
            if !out.contains(t) {
                out.push(t.clone());
            }
        }
    }
    out.sort();
    out
}

pub fn record_writing(dir: &Path, date: &str, chars: u64) -> Result<(), String> {
    if chars == 0 {
        return Ok(());
    }
    let path = dir.join(STATS_FILE);
    let mut map: HashMap<String, u64> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    *map.entry(date.to_string()).or_insert(0) += chars;
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("写统计失败: {e}"))
}

pub fn get_stats(dir: &Path) -> HashMap<String, u64> {
    std::fs::read_to_string(dir.join(STATS_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// base64 编码（同样是手写的，省一个依赖）。
///
/// 拖进来的 .txt 得先认出编码才知道是不是 GBK，而那是前端 TextDecoder 的强项
/// （原生带 gbk / big5），Rust 这边要么引 encoding_rs 要么自己写，不划算。
/// 所以这里只把字节原样端过去 —— 用 base64 而不是 JSON 数字数组：
/// 一个几百 KB 的 txt 走数组会膨胀成几 MB 的文本，白等一趟。
pub fn encode_base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = ((chunk[0] as u32) << 16) | ((b1 as u32) << 8) | b2 as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// base64 解码（手写，省一个依赖）
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, &c) in TABLE.iter().enumerate() {
        lookup[c as usize] = i as u8;
    }
    let clean: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits = 0u32;
    for b in clean {
        let v = lookup[b as usize];
        if v == 255 {
            return Err("媒体数据不是合法的 base64".into());
        }
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

/// 把媒体文件写进 assets/，返回相对路径（写进 Markdown 用的那种）
pub fn save_asset(dir: &Path, name: &str, data: &str) -> Result<String, String> {
    let assets = dir.join("assets");
    std::fs::create_dir_all(&assets).map_err(|e| format!("创建 assets 目录失败: {e}"))?;

    let safe: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    // 同一秒里连插两张图也得各自落一份，不能互相覆盖
    let mut file_name = format!("{}_{}", now_secs(), safe.trim());
    let mut n = 2;
    while assets.join(&file_name).exists() {
        file_name = format!("{}_{}-{}", now_secs(), safe.trim(), n);
        n += 1;
    }
    let bytes = decode_base64(data)?;
    std::fs::write(assets.join(&file_name), bytes).map_err(|e| format!("写入媒体失败: {e}"))?;

    commit(dir, &format!("插入媒体 {}", safe.trim()));
    Ok(format!("assets/{file_name}"))
}

/// 把一个外部文件复制进 assets/。拖拽进来的图片/视频走这条路 ——
/// 前端只给路径、不做 base64 编解码，几十上百 MB 的视频不会白白多占一份内存。
pub fn import_asset(dir: &Path, src: &Path) -> Result<String, String> {
    if !src.is_file() {
        return Err(format!("不是文件：{}", src.to_string_lossy()));
    }
    let assets = dir.join("assets");
    std::fs::create_dir_all(&assets).map_err(|e| format!("创建 assets 目录失败: {e}"))?;

    // 只认文件名本身，外部路径的目录部分一概丢掉（顺带把 ../ 这类越界挡在门外）
    let raw = src.file_name().and_then(|s| s.to_str()).unwrap_or("媒体");
    let safe: String = raw
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let mut file_name = format!("{}_{}", now_secs(), safe.trim());
    let mut n = 2;
    while assets.join(&file_name).exists() {
        file_name = format!("{}_{}-{}", now_secs(), safe.trim(), n);
        n += 1;
    }
    std::fs::copy(src, assets.join(&file_name)).map_err(|e| format!("复制媒体失败: {e}"))?;
    commit(dir, &format!("插入媒体 {}", safe.trim()));
    Ok(format!("assets/{file_name}"))
}

/* ============================ 跨文档全文搜索 ============================ */

/// 一条命中。
///
/// `nth` 是这一段的关键：它是关键词在这篇文档里第几次出现（0 基）。
/// 前端拿到之后会用编辑器**自己再扫一遍**，靠这个序号落到具体那一处 ——
/// 而不是把 Markdown 的行号硬换算成 ProseMirror 的位置：两边格式差太多
/// （`#`、`-`、`**` 这些标记在正文里根本不存在），换算必错。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub file: String,
    pub title: String,
    pub nth: usize,
    /// 1 基行号，给结果列表显示用
    pub line: usize,
    /// 命中那一行的片段（关键词前后各留一段）
    pub snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOut {
    pub hits: Vec<SearchHit>,
    /// 扫了几篇
    pub files: usize,
    /// 命中总数（可能多于返回条数）
    pub total: usize,
    pub truncated: bool,
}

/// 正文从第几行开始 —— 跳过开头 `---` 包起来的 frontmatter。
/// 那段不会出现在编辑器里，跟着一起数命中会让前端的序号对不齐。
fn body_from(lines: &[&str]) -> usize {
    if lines.first().map(|l| l.trim()) != Some("---") {
        return 0;
    }
    for (i, l) in lines.iter().enumerate().skip(1) {
        if l.trim() == "---" {
            return i + 1;
        }
    }
    0
}

/// 在字符数组里找全部出现位置。
/// 走字符而不是字节 —— 中文一个字三个字节，拿字节下标切片段会把字切碎。
fn find_all(hay: &[char], needle: &[char]) -> Vec<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i + needle.len() <= hay.len() {
        if hay[i..i + needle.len()] == *needle {
            out.push(i);
            i += needle.len();
        } else {
            i += 1;
        }
    }
    out
}

/// 命中那一行裁出来给人看：关键词前后各留一段，两头裁掉就打省略号
fn snippet_around(line: &str, at: usize, len: usize) -> String {
    const WINDOW: usize = 48;
    let chars: Vec<char> = line.chars().collect();
    let start = at.saturating_sub(WINDOW);
    let end = (at + len + WINDOW).min(chars.len());
    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    s.extend(chars[start..end].iter());
    if end < chars.len() {
        s.push('…');
    }
    s
}

/// 在仓库里所有 .md 里找一句话。
/// 文档只可能躺在根目录（safe_name 不许文件名带路径分隔符），所以不用递归。
pub fn search(dir: &Path, query: &str, limit: usize) -> Result<SearchOut, String> {
    let mut out = SearchOut {
        hits: Vec::new(),
        files: 0,
        total: 0,
        truncated: false,
    };
    let q = query.trim();
    if q.is_empty() {
        return Ok(out);
    }
    let needle: Vec<char> = q.to_lowercase().chars().collect();

    let entries = std::fs::read_dir(dir).map_err(|e| format!("读取仓库失败: {e}"))?;

    // 最近改过的排前面 —— 找东西的时候，刚写的那篇最可能是目标
    let mut docs: Vec<(PathBuf, String, SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) if n.ends_with(".md") => n.to_string(),
            _ => continue,
        };
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(UNIX_EPOCH);
        docs.push((path, name, modified));
    }
    docs.sort_by(|a, b| b.2.cmp(&a.2));

    for (path, name, _) in docs {
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        out.files += 1;

        let lines: Vec<&str> = text.lines().collect();
        let body = body_from(&lines);
        let title = name.trim_end_matches(".md").to_string();
        let mut nth = 0usize;

        for (i, raw) in lines.iter().enumerate().skip(body) {
            let lower: Vec<char> = raw.to_lowercase().chars().collect();
            for at in find_all(&lower, &needle) {
                out.total += 1;
                if out.hits.len() < limit {
                    out.hits.push(SearchHit {
                        file: name.clone(),
                        title: title.clone(),
                        nth,
                        line: i + 1,
                        snippet: snippet_around(raw, at, needle.len()),
                    });
                }
                nth += 1;
            }
        }
    }

    out.truncated = out.total > out.hits.len();
    Ok(out)
}

pub fn info(dir: &Path) -> VaultInfo {
    VaultInfo {
        path: dir.to_string_lossy().to_string(),
        docs: list(dir).map(|v| v.len()).unwrap_or(0),
        has_git: git::has_repo(dir),
    }
}

pub fn dir_of(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let base = app
        .path()
        .document_dir()
        .map_err(|e| format!("找不到系统文档目录: {e}"))?;
    Ok(base.join("Quill"))
}
