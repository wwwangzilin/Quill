//! 元数据（`.quill-meta.json`）：星标、标签、批注。
//!
//! 三类东西共用一个文件，所以所有写入口都走 `edit_meta` 这一把锁。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::util::{commit, safe_name};

/// 星标、标签等少量元数据，也跟着 git 走
const META_FILE: &str = ".quill-meta.json";

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
    /// 荧光笔颜色（yellow / green / blue / pink / purple）。老批注没有这个字段，
    /// 读出来是 None、写回去也不出现，所以不影响已有的 .quill-meta.json。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
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

pub fn read_meta(dir: &Path) -> VaultMeta {
    std::fs::read_to_string(dir.join(META_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(super) fn write_meta(dir: &Path, meta: &VaultMeta) -> Result<(), String> {
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
