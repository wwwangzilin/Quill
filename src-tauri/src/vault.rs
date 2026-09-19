//! 文档仓库（vault）的读写。
//!
//! 存储形态刻意保持「一篇文章 = 一个纯 Markdown 文件」：
//! 没有私有数据库、没有专有格式，丢进任何编辑器都能读，
//! 丢给 git 就是干净的 diff。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::git;

/// 星标、标签等少量元数据，也跟着 git 走
const META_FILE: &str = ".quill-meta.json";
/// 每日写作字数（热力图用）
const STATS_FILE: &str = ".quill-stats.json";
/// 回收站
const TRASH_DIR: &str = ".trash";

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct VaultMeta {
    #[serde(default)]
    pub starred: Vec<String>,
    #[serde(default)]
    pub tags: HashMap<String, Vec<String>>,
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
    std::fs::write(dir.join(META_FILE), text).map_err(|e| format!("写元数据失败: {e}"))
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
    let mut meta = read_meta(dir);
    meta.starred.retain(|f| f != &name);
    if starred {
        meta.starred.push(name.clone());
    }
    write_meta(dir, &meta)?;
    let verb = if starred { "收藏" } else { "取消收藏" };
    commit(dir, &format!("{verb}《{}》", name.trim_end_matches(".md")));
    Ok(())
}

pub fn set_tags(dir: &Path, file: &str, tags: Vec<String>) -> Result<(), String> {
    let name = safe_name(file)?;
    let mut meta = read_meta(dir);
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
    write_meta(dir, &meta)?;
    commit(dir, &format!("标签《{}》", name.trim_end_matches(".md")));
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
    let file_name = format!("{}_{}", now_secs(), safe.trim());
    let bytes = decode_base64(data)?;
    std::fs::write(assets.join(&file_name), bytes).map_err(|e| format!("写入媒体失败: {e}"))?;

    commit(dir, &format!("插入媒体 {}", safe.trim()));
    Ok(format!("assets/{file_name}"))
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
