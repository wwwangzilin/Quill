//! 文档仓库（vault）的读写。
//!
//! 存储形态刻意保持「一篇文章 = 一个纯 Markdown 文件」：
//! 没有私有数据库、没有专有格式，丢进任何编辑器都能读，
//! 丢给 git 就是干净的 diff。

mod util;
mod meta;
mod docs;
mod trash;
mod chapters;
mod stats;
mod assets;
mod fulltext;

// 对外路径保持不变：外面仍然写 `vault::save`、`vault::DocEntry`……
pub use util::title_to_file;
pub use meta::{Comment, VaultMeta, all_tags, comments_of, read_meta, set_comments, set_tags, star};
pub use docs::{
    create, delete, find_by_digest, import_many, list, read, save, stamp, DocEntry,
    DocStamp, SaveError, SaveResult,
};
pub use trash::{TrashEntry, empty_trash, list_trash, purge_trash, restore_trash};
pub use chapters::{ChapterMark, DocOutline, outline, read_slice, write_slice};
pub use stats::{get_stats, record_writing};
pub use assets::{encode_base64, import_asset, save_asset};
pub use fulltext::{context, search, ContextChunk, SearchHit, SearchOut};

use std::path::{Path, PathBuf};
use serde::Serialize;
use crate::git;

#[derive(Serialize)]
pub struct VaultInfo {
    pub path: String,
    pub docs: usize,
    pub has_git: bool,
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
    // 开发 / 验收用：把仓库指到别处，别拿主人真实的文档库做实验
    // （冲突检测、备份恢复这类会写盘的功能，验收时都得有个能随便删的仓库）
    if let Some(custom) = std::env::var_os("QUILL_VAULT_DIR") {
        let path = PathBuf::from(custom);
        if !path.as_os_str().is_empty() {
            return Ok(path);
        }
    }
    let base = app
        .path()
        .document_dir()
        .map_err(|e| format!("找不到系统文档目录: {e}"))?;
    Ok(base.join("Quill"))
}

