//! 文档的增删改查（一篇文章 = 一个 `.md`）。

use std::path::Path;

use serde::Serialize;

use super::util::{
    commit, count_chars, fnv1a32, ms, now_secs, safe_name, title_to_file, unique_file, SAVE_LOCK,
};
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

#[derive(Debug, Serialize)]
pub struct SaveResult {
    pub file: String,
    pub commit: Option<String>,
    /// 这次写下去的正文摘要。前端存着它，下次保存时原样带回来当 `baseDigest`。
    pub digest: u32,
    /// 落盘后的字节数（外部改名后靠「摘要 + 大小」认回同一篇）
    pub size: u64,
}

/// 保存失败的两类：普通 IO 错误，和「磁盘上已经不是我看到的那一版了」。
///
/// 冲突**必须**能被前端认出来（它要弹对比框），所以不能只回一句字符串 ——
/// 分不出来就只能靠匹配文案，文案一改就断。序列化成 `{ code, message, disk, digest }`。
#[derive(Debug, Serialize)]
pub struct SaveError {
    /// `conflict`（外部改过）/ `deleted`（外部删了）/ `io`
    pub code: String,
    pub message: String,
    /// 冲突时磁盘上的那份正文，直接给前端做对比用
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk: Option<String>,
    /// 冲突时磁盘上那份的摘要
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<u32>,
}

impl SaveError {
    pub fn io(message: impl Into<String>) -> Self {
        Self { code: "io".into(), message: message.into(), disk: None, digest: None }
    }

    pub fn conflict(disk: String, digest: u32) -> Self {
        Self {
            code: "conflict".into(),
            message: "这篇文档在外部被改过了 —— 先对一眼，别把外面的改动盖掉".into(),
            disk: Some(disk),
            digest: Some(digest),
        }
    }

    fn deleted() -> Self {
        Self {
            code: "deleted".into(),
            message: "文件已经不在仓库里了（被外部删除或改名）".into(),
            disk: None,
            digest: None,
        }
    }
}

impl From<String> for SaveError {
    fn from(message: String) -> Self {
        SaveError::io(message)
    }
}

/// 磁盘上某个文件此刻的样子。
#[derive(Serialize)]
pub struct DocStamp {
    pub exists: bool,
    pub digest: u32,
    pub size: u64,
    /// 修改时间（毫秒），只用来显示「外面什么时候动过」
    pub modified: i64,
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
///
/// `base_digest` = 打开（或上一次保存）时磁盘内容的 FNV-1a 32。
/// 传 `Some` 就表示「我是照着这一版改的」：写之前先在**同一把锁**里读一遍磁盘，
/// 对不上就返回 `conflict`，一个字都不写 —— 否则用户在 VS Code / 同步盘里改的内容
/// 会被下一次自动保存静默覆盖，而且 git 里只留一条「更新《…》」，事后连找都找不回来。
pub fn save(
    dir: &Path,
    file: &str,
    title: &str,
    content: &str,
    base_digest: Option<u32>,
) -> Result<SaveResult, SaveError> {
    let name = safe_name(file)?;
    let old_path = dir.join(&name);
    // 读摘要和写文件必须在同一把锁里：中间被人插进一次写入就白校验了。
    let _guard = SAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    if let Some(expect) = base_digest {
        match std::fs::read(&old_path) {
            Ok(raw) => {
                let got = fnv1a32(&raw);
                if got != expect {
                    return Err(SaveError::conflict(
                        String::from_utf8_lossy(&raw).into_owned(),
                        got,
                    ));
                }
            }
            // 外部删掉/改名了：别再照着老文件名写一个新的空壳出来
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(SaveError::deleted());
            }
            Err(e) => return Err(SaveError::io(format!("读取 {name} 失败: {e}"))),
        }
    }

    std::fs::write(&old_path, content).map_err(|e| SaveError::io(format!("写入失败: {e}")))?;

    let mut current = name.clone();
    let wanted = title_to_file(title);
    if wanted != name {
        let target = unique_file(dir, &wanted);
        if target != name {
            std::fs::rename(&old_path, dir.join(&target))
                .map_err(|e| SaveError::io(format!("重命名失败: {e}")))?;
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
        digest: fnv1a32(content.as_bytes()),
        size: content.len() as u64,
    })
}

/// 磁盘上这个文件此刻的摘要。打开文档、窗口重新聚焦时各查一次。
pub fn stamp(dir: &Path, file: &str) -> Result<DocStamp, String> {
    let name = safe_name(file)?;
    let path = dir.join(&name);
    match std::fs::read(&path) {
        Ok(raw) => {
            let md = std::fs::metadata(&path).ok();
            Ok(DocStamp {
                exists: true,
                digest: fnv1a32(&raw),
                size: raw.len() as u64,
                modified: md.and_then(|m| m.modified().ok()).map(ms).unwrap_or(0),
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(DocStamp {
            exists: false,
            digest: 0,
            size: 0,
            modified: 0,
        }),
        Err(e) => Err(format!("读取 {name} 失败: {e}")),
    }
}

/// 外部改名之后找回那一篇：按摘要 + 大小在仓库里找。
///
/// 只读**大小对得上**的文件 —— 库里可能有几百万字的小说，别为了认一个改名
/// 把整个仓库读一遍。
pub fn find_by_digest(dir: &Path, digest: u32, size: u64) -> Result<Option<String>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("读取仓库失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) if n.ends_with(".md") => n.to_string(),
            _ => continue,
        };
        let md = match entry.metadata() {
            Ok(m) if m.len() == size => m,
            _ => continue,
        };
        if md.is_file() {
            if let Ok(raw) = std::fs::read(&path) {
                if fnv1a32(&raw) == digest {
                    return Ok(Some(name));
                }
            }
        }
    }
    Ok(None)
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

#[cfg(test)]
mod save_guard_tests {
    use super::*;
    use std::path::PathBuf;

    /// 每个用例一个独立目录：`save` 会碰 `commit` / `META_LOCK`，别让用例互相串
    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "quill-save-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, body: &str) {
        std::fs::write(dir.join(name), body).unwrap();
    }

    fn body_of(dir: &Path, name: &str) -> String {
        std::fs::read_to_string(dir.join(name)).unwrap()
    }

    /** 正常路径：带回来的摘要和磁盘一致，照写 */
    #[test]
    fn accepts_matching_base_digest() {
        let dir = scratch("ok");
        write(&dir, "a.md", "第一版");
        let d = fnv1a32("第一版".as_bytes());

        let res = save(&dir, "a.md", "a", "第二版", Some(d)).unwrap();
        assert_eq!(res.file, "a.md");
        assert_eq!(body_of(&dir, "a.md"), "第二版");
        assert_eq!(res.digest, fnv1a32("第二版".as_bytes()));
        assert_eq!(res.size, "第二版".len() as u64);
    }

    /** 不带基线 = 不管磁盘是什么都写（恢复、合并这类用户拍板过的路径） */
    #[test]
    fn writes_without_base_digest() {
        let dir = scratch("force");
        write(&dir, "a.md", "外面改过的");
        save(&dir, "a.md", "a", "我的版本", None).unwrap();
        assert_eq!(body_of(&dir, "a.md"), "我的版本");
    }

    /**
     * 外部改过：必须拒绝，**而且磁盘上一个字节都不能动**。
     * 这条是 issue 的验收标准第一条：按 Ctrl+S 出现冲突提示，磁盘内容未被覆盖。
     */
    #[test]
    fn rejects_when_disk_changed() {
        let dir = scratch("clash");
        write(&dir, "a.md", "我打开时的样子");
        let base = fnv1a32("我打开时的样子".as_bytes());
        write(&dir, "a.md", "外面改成了这样");

        let err = save(&dir, "a.md", "a", "我的新内容", Some(base)).unwrap_err();
        assert_eq!(err.code, "conflict");
        assert_eq!(err.disk.as_deref(), Some("外面改成了这样"));
        assert_eq!(err.digest, Some(fnv1a32("外面改成了这样".as_bytes())));
        // 关键：没被覆盖
        assert_eq!(body_of(&dir, "a.md"), "外面改成了这样");
    }

    /** 外部删掉：不许照着老名字造一个空壳出来 */
    #[test]
    fn reports_deleted_when_file_gone() {
        let dir = scratch("gone");
        let base = fnv1a32(b"whatever");
        let err = save(&dir, "a.md", "a", "我的内容", Some(base)).unwrap_err();
        assert_eq!(err.code, "deleted");
        assert!(!dir.join("a.md").exists(), "不该凭空造出新文件");
    }

    /** 外部改名：摘要 + 大小能认回同一篇 */
    #[test]
    fn finds_renamed_file_by_digest() {
        let dir = scratch("rename");
        let body = "# 标题\n\n正文";
        write(&dir, "新名字.md", body);
        // 大小接近但内容不同的干扰项
        write(&dir, "干扰.md", "完全不同但长度一样吗？不，随便写点什么就好");

        let hit = find_by_digest(&dir, fnv1a32(body.as_bytes()), body.len() as u64).unwrap();
        assert_eq!(hit.as_deref(), Some("新名字.md"));
        // 大小对不上就不该读它
        let miss = find_by_digest(&dir, fnv1a32(body.as_bytes()), 1).unwrap();
        assert_eq!(miss, None);
    }

    #[test]
    fn stamp_reports_missing_and_present() {
        let dir = scratch("stamp");
        let missing = stamp(&dir, "a.md").unwrap();
        assert!(!missing.exists);

        write(&dir, "a.md", "内容");
        let st = stamp(&dir, "a.md").unwrap();
        assert!(st.exists);
        assert_eq!(st.digest, fnv1a32("内容".as_bytes()));
        assert_eq!(st.size, "内容".len() as u64);
    }
}
