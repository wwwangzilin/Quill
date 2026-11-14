//! 文档的增删改查（一篇文章 = 一个 `.md`）。

use std::path::Path;

use serde::Serialize;

use super::util::{commit, count_chars, ms, now_secs, safe_name, title_to_file, unique_file};
use super::meta::{read_meta, write_meta};
use super::trash::{ensure_trash, trash_path};

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
