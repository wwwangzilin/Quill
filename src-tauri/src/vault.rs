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

/* ==================== 超大文档：按章读 ==================== */

/// 一章在文件里的位置。**字节**偏移 —— 前后端统一用字节，别混字符下标。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterMark {
    pub title: String,
    pub from: u64,
    pub to: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocOutline {
    pub marks: Vec<ChapterMark>,
    /// 整个文件的字节数
    pub bytes: u64,
}

/** 章名最长这么多**字节**（≈66 个汉字，够宽了） */
const MAX_HEAD_BYTES: usize = 200;

/** 章名后面常跟着的元信息 */
const META_KEYS: [&str; 8] = ["作者", "更新时间", "字数", "来源", "本章", "链接", "简介", "标签"];

/** 「第…章/节/回/卷/篇/部」 */
fn is_cn_head(s: &str) -> bool {
    let mut it = s.chars();
    if it.next() != Some('第') {
        return false;
    }
    let mut n = 0;
    for c in it {
        if c.is_ascii_digit() || "０１２３４５６７８９一二三四五六七八九十百千零两".contains(c) {
            n += 1;
            if n > 12 {
                return false;
            }
        } else {
            return "章节回卷篇話话部".contains(c);
        }
    }
    false
}

/** Chapter 1 / CHAPTER IV */
fn is_en_head(s: &str) -> bool {
    let low = s.to_ascii_lowercase();
    if !low.starts_with("chapter") {
        return false;
    }
    match low[7..].trim_start().chars().next() {
        Some(c) => c.is_ascii_digit() || "ivxlcdm".contains(c),
        None => false,
    }
}

/** 这一行如果是章名，返回干净的名字 */
fn head_of_line(line: &str) -> Option<String> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }
    let bare = t.trim_start_matches('#').trim_start();
    if !is_cn_head(bare) && !is_en_head(bare) {
        return None;
    }
    let mut cut = bare.len();
    for k in META_KEYS {
        if let Some(i) = bare.find(k) {
            let after = &bare[i + k.len()..];
            if (after.starts_with(':') || after.starts_with('：')) && i < cut {
                cut = i;
            }
        }
    }
    let out = bare[..cut].trim();
    if out.is_empty() {
        None
    } else {
        Some(out.to_string())
    }
}

/// 只扫章节边界，**不返回正文**。
///
/// 为什么不放在前端切：Tauri 的 IPC 会把返回值 JSON 化，700 万字（约 21MB）
/// 的字符串转义之后更大 —— 前端为了切一次章，得先把这一大坨搬过去。
/// 这里用 BufReader 流式扫一遍，只回几百个小对象；正文按需用 read_slice 取。
pub fn outline(dir: &Path, file: &str) -> Result<DocOutline, String> {
    let name = safe_name(file)?;
    let f = std::fs::File::open(dir.join(&name)).map_err(|e| format!("打开失败: {e}"))?;
    let mut r = std::io::BufReader::new(f);
    let mut buf: Vec<u8> = Vec::new();
    let mut at: u64 = 0;
    let mut marks: Vec<ChapterMark> = Vec::new();

    loop {
        buf.clear();
        let n = std::io::BufRead::read_until(&mut r, b'\n', &mut buf)
            .map_err(|e| format!("读取失败: {e}"))?;
        if n == 0 {
            break;
        }
        // 只对短行做判断：正文段落动辄几百字，先按长度切掉绝大多数
        if buf.len() <= MAX_HEAD_BYTES {
            if let Ok(line) = std::str::from_utf8(&buf) {
                if let Some(title) = head_of_line(line) {
                    marks.push(ChapterMark {
                        title,
                        from: at,
                        to: 0,
                    });
                }
            }
        }
        at += n as u64;
    }

    for i in 0..marks.len() {
        marks[i].to = if i + 1 < marks.len() {
            marks[i + 1].from
        } else {
            at
        };
    }
    if marks.is_empty() {
        marks.push(ChapterMark {
            title: String::new(),
            from: 0,
            to: at,
        });
    }
    Ok(DocOutline { marks, bytes: at })
}

/// 只读 `[from, to)` 这一段。按章取正文用，一次最多几十 KB。
///
/// 切到半个字也不报错：截到最后一个完整字符为止 —— 调用方拿它去取标题，
/// 不该因为边界差几个字节就整个失败。
pub fn read_slice(dir: &Path, file: &str, from: u64, to: u64) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let name = safe_name(file)?;
    let mut f = std::fs::File::open(dir.join(&name)).map_err(|e| format!("打开失败: {e}"))?;
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let from = from.min(len);
    let to = to.clamp(from, len);
    f.seek(SeekFrom::Start(from)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; (to - from) as usize];
    f.read_exact(&mut buf).map_err(|e| format!("读取失败: {e}"))?;
    Ok(String::from_utf8(buf).unwrap_or_else(|e| {
        let n = e.utf8_error().valid_up_to();
        String::from_utf8_lossy(&e.into_bytes()[..n]).into_owned()
    }))
}

/// FNV-1a 32 —— 手写的，只为「这一章还是不是原来那一章」这一个判断。
///
/// 不是密码学哈希。它防的是**坐标错位**（原书前面被人插了几行，摘出去时记的
/// from/to 就全偏了，照原样覆盖会写错地方），不是防恶意构造。
fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in bytes {
        h ^= *b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// 把 `[from, to)` 这一段换成新正文 —— 「摘出来改」改完之后合并回原书用。
///
/// **整篇读、整篇写**：先把文件读进来、拼接、再整体写回。
/// 700 万字的原稿约 21MB，读+写大约一秒 —— 按一次「合并」等一下就好，
/// 换来的是不必处理「文件变长变短、后面的数据要挪」这类麻烦，
/// 也不会留一个「写到一半被打断、只剩半篇」的窗口。
///
/// `expect_digest` 是**摘走时那一段**的 FNV-1a 32，用来确认它没被动过。
/// 传 0 表示不校验。
///
/// ⚠️ 别拿「区间长度」当校验：`to - from` 和摘走时的长度是**恒等**的，
/// 比了等于没比 —— 原书在别处被改过时它照样通过，然后写到错的位置上去。
/// （这条是单元测试逼出来的，第一版就是这么写的。）
pub fn write_slice(
    dir: &Path,
    file: &str,
    from: u64,
    to: u64,
    text: &str,
    expect_digest: u32,
) -> Result<u64, String> {
    let name = safe_name(file)?;
    let path = dir.join(&name);
    let raw = std::fs::read(&path).map_err(|e| format!("读取失败: {e}"))?;
    let n = raw.len() as u64;
    if from > to || to > n {
        return Err(format!("区间越界：{from}..{to}，文件只有 {n} 字节"));
    }
    if expect_digest != 0 {
        let got = fnv1a32(&raw[from as usize..to as usize]);
        if got != expect_digest {
            return Err(format!(
                "这一章已经变过了（认出 {got:08x}，摘出去时是 {expect_digest:08x}）—— 先对一眼再合并"
            ));
        }
    }
    let mut out = Vec::with_capacity(raw.len() + text.len());
    out.extend_from_slice(&raw[..from as usize]);
    out.extend_from_slice(text.as_bytes());
    out.extend_from_slice(&raw[to as usize..]);
    std::fs::write(&path, &out).map_err(|e| format!("写入失败: {e}"))?;
    let _ = commit(
        dir,
        &format!("合并《{}》的一章", name.trim_end_matches(".md")),
    );
    Ok(out.len() as u64)
}

#[cfg(test)]
mod slice_tests {
    use super::*;

    /**
     * 合并回写是**破坏性**操作（直接改主人那本书），所以单独钉一遍：
     * ①只动指定的那一段，前后都得原样在；
     * ②新内容更长时文件要跟着变长，不能把后面的章挤没；
     * ③长度对不上（说明那一段已经变过）时必须**拒绝**，不能硬盖。
     */
    #[test]
    fn write_slice_only_touches_that_range() {
        let dir = std::env::temp_dir().join(format!("quill-slice-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = "book.md";
        let body = "第一章 甲\n甲甲甲\n第二章 乙\n乙乙乙\n第三章 丙\n丙丙丙\n";
        std::fs::write(dir.join(file), body).unwrap();

        let o = outline(&dir, file).unwrap();
        let seg = o
            .marks
            .iter()
            .find(|m| m.title.contains("第二章"))
            .expect("切章没切出第二章");
        let seg_from = seg.from;
        let seg_to = seg.to;
        let digest = fnv1a32(&std::fs::read(dir.join(file)).unwrap()[seg_from as usize..seg_to as usize]);

        // 换成更长的一段：文件要变长，第一章和第三章一个都不能少
        let n = write_slice(
            &dir,
            file,
            seg_from,
            seg_to,
            "第二章 乙\n改过了改过了改过了\n",
            digest,
        )
        .unwrap();
        let after = std::fs::read_to_string(dir.join(file)).unwrap();
        assert!(after.contains("第一章 甲"), "第一章被弄丢了：{after}");
        assert!(after.contains("第三章 丙"), "第三章被挤掉了：{after}");
        assert!(after.contains("改过了改过了"), "新内容没写进去：{after}");
        assert!(!after.contains("乙乙乙"), "旧内容还留着：{after}");
        assert_eq!(n as usize, after.len(), "返回的长度和文件实际长度对不上");

        // 拿**过期的摘要**再合一次：这一段已经换过内容了，必须拒绝。
        // 这正是「原书在别处被改过、坐标已经偏了」的模型 ——
        // 光比区间长度是拦不住的（from/to 没变，长度就没变）。
        let err = write_slice(&dir, file, seg_from, seg_to, "乱写", digest).unwrap_err();
        assert!(err.contains("已经变过"), "校验失败时的提示不对：{err}");

        // 摘出去时的那一章原样还在时，应当放行
        let dir2 = std::env::temp_dir().join(format!("quill-slice-test2-{}", std::process::id()));
        std::fs::create_dir_all(&dir2).unwrap();
        std::fs::write(dir2.join(file), body).unwrap();
        let o2 = outline(&dir2, file).unwrap();
        let s2 = o2.marks.iter().find(|m| m.title.contains("第二章")).unwrap();
        let d2 = fnv1a32(&std::fs::read(dir2.join(file)).unwrap()[s2.from as usize..s2.to as usize]);
        assert!(write_slice(&dir2, file, s2.from, s2.to, "第二章 乙\n新的\n", d2).is_ok());

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&dir2).ok();
    }
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
