//! 每日写作字数（热力图用）。

use std::collections::HashMap;
use std::path::Path;

/// 每日写作字数（热力图用）
const STATS_FILE: &str = ".quill-stats.json";

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
