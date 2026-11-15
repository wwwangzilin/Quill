//! 跨文档全文搜索。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

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

/* ============================ 知识库问答的检索 ============================ */

/// 送给模型的片段：命中的那一行 + 前后几行上下文，外加它所在的章节名。
///
/// 为什么不整篇喂：一篇几万字，十篇就爆窗口了；而且模型要的是「哪几句相关」，
/// 不是全文。这里只做关键词召回 + 按行扩窗，够用且不依赖向量库。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextChunk {
    pub file: String,
    pub title: String,
    /// 命中位置所在的章节标题（找不到就是空串）
    pub chapter: String,
    /// 1 基行号
    pub line: usize,
    pub text: String,
}

/// 检索一批上下文片段。
///
/// `budget` 是总字符上限：拼给模型的材料有预算，超了就按命中顺序截断 ——
/// 宁可少给几段，也别把请求撑爆。
pub fn context(
    dir: &Path,
    query: &str,
    limit: usize,
    budget: usize,
) -> Result<Vec<ContextChunk>, String> {
    let found = search(dir, query, limit)?;
    let mut out: Vec<ContextChunk> = Vec::new();
    let mut used = 0usize;

    for hit in found.hits {
        if used >= budget {
            break;
        }
        let path = dir.join(&hit.file);
        let raw = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let lines: Vec<&str> = raw.lines().collect();
        if lines.is_empty() {
            continue;
        }
        let at = hit.line.saturating_sub(1).min(lines.len() - 1);
        // 前后各留几行：只给命中那一行，模型看不出上下文在说什么
        let from = at.saturating_sub(8);
        let to = (at + 12).min(lines.len());
        let text = lines[from..to].join("\n");
        if text.trim().is_empty() {
            continue;
        }
        // 往上找最近的标题行，当作章节名
        let mut chapter = String::new();
        for l in lines[..=at].iter().rev() {
            let t = l.trim_start();
            if t.starts_with('#') {
                chapter = t.trim_start_matches('#').trim().to_string();
                break;
            }
        }
        let take = text.chars().count();
        if used + take > budget && !out.is_empty() {
            break;
        }
        used += take;
        out.push(ContextChunk {
            file: hit.file,
            title: hit.title,
            chapter,
            line: at + 1,
            text,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod context_tests {
    use super::*;

    /// 检索结果要带上「哪一段、哪一章」：模型靠它作答，前端靠它跳转
    #[test]
    fn context_finds_chapter_and_lines() {
        let dir = std::env::temp_dir().join(format!("quill-ctx-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("书.md"),
            "# 第一章\n开头\n量子纠缠在这里出现\n结尾\n# 第二章\n另一段\n",
        )
        .unwrap();
        std::fs::write(dir.join("别的.md"), "# 无关\n没有那个词\n").unwrap();

        let chunks = context(&dir, "量子纠缠", 8, 8000).unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].title, "书");
        assert_eq!(chunks[0].chapter, "第一章");
        // 扩窗要把命中的上下文带上，不能只给一行
        assert!(chunks[0].text.contains("开头"));
        assert!(chunks[0].text.contains("结尾"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 没有命中就是空数组 —— 前端据此说「知识库里没找到」
    #[test]
    fn context_empty_when_nothing_matches() {
        let dir = std::env::temp_dir().join(format!("quill-ctx2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), "# 标题\n正文\n").unwrap();
        assert!(context(&dir, "完全不存在的词", 8, 8000).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
