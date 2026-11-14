//! 回收站：删除不是真删，先挪进 `.trash/`，可恢复。

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::util::{commit, unique_file};

/// 回收站
const TRASH_DIR: &str = ".trash";

#[derive(Serialize)]
pub struct TrashEntry {
    /// 回收站里的实际文件名
    pub name: String,
    /// 原始文件名
    pub original: String,
    pub deleted: i64,
    pub size: u64,
}

pub(super) fn trash_path(dir: &Path) -> PathBuf {
    dir.join(TRASH_DIR)
}

pub(super) fn ensure_trash(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(trash_path(dir)).map_err(|e| format!("创建回收站失败: {e}"))
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
