//! 仓库内通用的小工具：时间、文件名、提交。

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::git;

pub(super) fn ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub(super) fn count_chars(s: &str) -> u64 {
    s.chars().filter(|c| !c.is_whitespace()).count() as u64
}

/// 防路径穿越：只允许仓库根下的普通文件名
pub(super) fn safe_name(file: &str) -> Result<String, String> {
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

pub(super) fn unique_file(dir: &Path, base: &str) -> String {
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

pub(super) fn commit(dir: &Path, message: &str) -> Option<String> {
    if !git::has_repo(dir) {
        return None;
    }
    // 提交失败不该让保存本身失败：文件已经安全落盘了，
    // 下次保存会把它一起带进历史。
    git::commit_all(dir, message).ok().flatten()
}
