//! 自动备份与恢复。
//!
//! 为什么要有它：文档仓库自带 git，每次保存都提交 —— 但 `.git` 目录损坏、
//! 整个库目录被误删、磁盘满把文件写坏，这些情况下 git 历史**跟着一起没了**。
//! 这里的备份是「和仓库不同生共死」的第二份：整库（含 .git）打成 zip，
//! 放在仓库之外的一个目录里，按份数滚动清理。
//!
//! 设计上的几条硬规矩：
//! 1. 恢复**整库之前先给当前状态打一份快照** —— 恢复错了还回得去；
//! 2. 备份失败（没空间、目录不可写）**必须留下痕迹**，下次启动仍然看得到，
//!    不能只在 toast 里闪一下；
//! 3. 打 zip 时先写临时文件，写完再改名 —— 中断只会留下半个临时文件，
//!    不会出现「看起来有一份备份，其实解不开」。

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::vault;

const PREFS_FILE: &str = "backup.json";
/// 一份备份的扩展名 —— 列表里只认它，用户的杂物不会被当成备份
const EXT: &str = ".zip";

/* ------------------------------ 设置与状态 ------------------------------ */

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupPrefs {
    /// 关掉之后不再产生新备份；手动备份仍然可用
    pub enabled: bool,
    /// 备份目录；空串 = 用默认目录（文档目录下的 Quill Backups）
    pub dir: String,
    /// 保留最近几份，旧的自动删掉
    pub keep: usize,
    /// 间隔（小时）。默认 24 小时一次
    pub interval_hours: u64,
    /* ---- 下面这些是「上次备份的结果」，用来在设置页里给人看 ---- */
    pub last_at: i64,
    pub last_ok: bool,
    pub last_error: Option<String>,
    pub last_size: u64,
    pub last_name: String,
}

impl Default for BackupPrefs {
    fn default() -> Self {
        Self {
            enabled: true,
            dir: String::new(),
            keep: 7,
            interval_hours: 24,
            last_at: 0,
            last_ok: false,
            last_error: None,
            last_size: 0,
            last_name: String::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    pub created: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub prefs: BackupPrefs,
    /// 实际使用的目录（prefs.dir 为空时是默认目录）
    pub dir: String,
    /// 目录里现有几份
    pub count: usize,
    /// 它们加起来占多少字节
    pub total_bytes: u64,
    /// 目录能不能写：设置页据此提前告诉用户「这地方存不了」
    pub writable: bool,
    /// 目录不可写时的原因
    pub dir_error: Option<String>,
}

/* ------------------------------ 路径与读写 ------------------------------ */

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("找不到配置目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    Ok(dir.join(PREFS_FILE))
}

pub fn load_prefs(app: &AppHandle) -> BackupPrefs {
    prefs_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_prefs(app: &AppHandle, prefs: &BackupPrefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    let text = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("写备份设置失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("落盘备份设置失败: {e}"))
}

/// 默认备份目录：**放在文档目录下、仓库旁边**，而不是藏进 AppData。
/// 用户自己也能看见、再拷到别处去，恢复时也不依赖这台机器上的应用数据。
fn default_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .map(|d| d.join("Quill Backups"))
        .unwrap_or_else(|_| PathBuf::from("Quill Backups"))
}

pub fn dir_of(app: &AppHandle, prefs: &BackupPrefs) -> PathBuf {
    if prefs.dir.trim().is_empty() {
        default_dir(app)
    } else {
        PathBuf::from(prefs.dir.trim())
    }
}

/// 试一下这个目录到底能不能写：建目录 + 写一个探针文件再删掉。
/// 只 `create_dir_all` 是不够的 —— 只读目录上它也可能成功（目录已存在）。
fn probe_writable(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建备份目录失败: {e}"))?;
    let probe = dir.join(".quill-write-test");
    std::fs::write(&probe, b"ok").map_err(|e| format!("备份目录不可写: {e}"))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 20261120-191700 这种时间戳。**用本地时间** —— 文件名是给人看的，
/// 显示成 UTC 会让用户以为备份是清早六点做的。
fn stamp(ts: i64) -> String {
    let (y, m, d, hh, mm, ss) = local_parts(ts);
    format!("{y:04}{m:02}{d:02}-{hh:02}{mm:02}{ss:02}")
}

/// 本地时间；拿不到时区就退回 UTC（总比没有强）
fn local_parts(ts: i64) -> (i64, u32, u32, u32, u32, u32) {
    use time::OffsetDateTime;
    match OffsetDateTime::from_unix_timestamp(ts) {
        Ok(utc) => match utc.to_offset(local_offset()) {
            dt => (
                dt.year() as i64,
                dt.month() as u32,
                dt.day() as u32,
                dt.hour() as u32,
                dt.minute() as u32,
                dt.second() as u32,
            ),
        },
        Err(_) => civil(ts),
    }
}

/// 系统当前时区偏移。拿不到就按 UTC。
fn local_offset() -> time::UtcOffset {
    use time::OffsetDateTime;
    // now_local() 在多线程环境里可能失败，那就退到 UTC
    OffsetDateTime::now_local()
        .map(|t| t.offset())
        .unwrap_or(time::UtcOffset::UTC)
}

/// 秒 → (年, 月, 日, 时, 分, 秒)，不引 chrono 的日期换算
fn civil(ts: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = ts.div_euclid(86_400);
    let secs = ts.rem_euclid(86_400) as u32;
    // Howard Hinnant 的 civil_from_days
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, secs / 3600, (secs % 3600) / 60, secs % 60)
}

/// 递归收集仓库里的文件（含 `.git`，那正是要保住的东西）
fn collect_files(root: &Path, out: &mut Vec<PathBuf>, dir: &Path) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("读取 {} 失败: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if md.is_dir() {
            collect_files(root, out, &path)?;
        } else if md.is_file() {
            out.push(path);
        }
    }
    let _ = root;
    Ok(())
}

fn rel_path(root: &Path, file: &Path) -> String {
    file.strip_prefix(root)
        .unwrap_or(file)
        .to_string_lossy()
        .replace('\\', "/")
}

/* ------------------------------ 备份 ------------------------------ */

/// 打一份备份。`note` 会写进文件名后缀，便于区分「定时」和「恢复前快照」。
pub fn create(vault_dir: &Path, dest: &Path, note: &str) -> Result<BackupInfo, String> {
    if !vault_dir.exists() {
        return Err("文档仓库目录不存在".into());
    }
    probe_writable(dest)?;

    let ts = now_secs();
    let suffix = if note.is_empty() {
        String::new()
    } else {
        format!("-{note}")
    };
    let name = format!("quill-{}{}{}", stamp(ts), suffix, EXT);
    let final_path = dest.join(&name);
    // 先写临时文件：打包中断只会留下 .part，不会被当成一份「能恢复的备份」
    let tmp_path = dest.join(format!(".{name}.part"));

    let file = std::fs::File::create(&tmp_path).map_err(|e| {
        format!(
            "创建备份文件失败（目录不可写或空间不足？）: {e}"
        )
    })?;
    let mut zip = zip::ZipWriter::new(file);
    let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let mut files = Vec::new();
    collect_files(vault_dir, &mut files, vault_dir)?;
    let mut buf = Vec::new();
    for path in files {
        let rel = rel_path(vault_dir, &path);
        let mut f = match std::fs::File::open(&path) {
            Ok(f) => f,
            // 打不开的文件（被占用/已删除）跳过，不让整次备份失败
            Err(_) => continue,
        };
        buf.clear();
        if f.read_to_end(&mut buf).is_err() {
            continue;
        }
        zip.start_file(&rel, opts).map_err(|e| format!("打包 {rel} 失败: {e}"))?;
        zip.write_all(&buf).map_err(|e| format!("写入 {rel} 失败: {e}"))?;
    }
    zip.finish().map_err(|e| format!("收尾备份失败: {e}"))?;

    let size = std::fs::metadata(&tmp_path).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        let _ = std::fs::remove_file(&tmp_path);
        return Err("备份文件是空的，可能磁盘已满".into());
    }
    std::fs::rename(&tmp_path, &final_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("备份落盘失败: {e}")
    })?;

    Ok(BackupInfo {
        name,
        size,
        created: ts * 1000,
    })
}

/// 目录里现有的备份，新的在前
pub fn list(dest: &Path) -> Vec<BackupInfo> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dest) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(EXT) || name.starts_with('.') {
            continue;
        }
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        out.push(BackupInfo {
            created: md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
            name,
            size: md.len(),
        });
    }
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

/// 只留最近 `keep` 份，返回删掉了几份
pub fn prune(dest: &Path, keep: usize) -> usize {
    let list = list(dest);
    let keep = keep.max(1);
    let mut removed = 0;
    for info in list.into_iter().skip(keep) {
        if std::fs::remove_file(dest.join(&info.name)).is_ok() {
            removed += 1;
        }
    }
    removed
}

/* ------------------------------ 恢复 ------------------------------ */

/// 解压到临时目录。返回临时目录路径 —— 调用方负责搬进去或者删掉。
fn extract_to(zip_path: &Path, into: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("打开备份失败: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("这个文件不是有效的备份: {e}"))?;
    std::fs::create_dir_all(into).map_err(|e| format!("创建临时目录失败: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("读取备份条目失败: {e}"))?;
        let name = entry.name().to_string();
        // 防路径穿越：只允许往解压根目录下面写
        let out_path = match entry.enclosed_name() {
            Some(p) => into.join(p),
            None => continue,
        };
        if entry.is_dir() {
            let _ = std::fs::create_dir_all(&out_path);
            continue;
        }
        if let Some(parent) = out_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut out = std::fs::File::create(&out_path)
            .map_err(|e| format!("解压 {name} 失败: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("写入 {name} 失败: {e}"))?;
    }
    Ok(())
}

/// 整库恢复。
///
/// 顺序：先把当前状态打一份快照（安全网）→ 解压到临时目录 → 验证 →
/// 原仓库改名为 `.before-restore-<时间>`（**不删**）→ 临时目录就位。
/// 任何一步失败都尽量把原仓库还原，别留下一个空目录。
pub fn restore_all(
    vault_dir: &Path,
    backup: &Path,
    snapshot_dest: &Path,
) -> Result<RestoreReport, String> {
    // 安全网：恢复之前先给现在的样子留一份
    let snapshot = create(vault_dir, snapshot_dest, "before-restore").ok();

    let parent = vault_dir
        .parent()
        .ok_or_else(|| "仓库目录没有上级目录，无法恢复".to_string())?;
    let ts = stamp(now_secs());
    let tmp = parent.join(format!(".quill-restore-{ts}"));
    let _ = std::fs::remove_dir_all(&tmp);
    extract_to(backup, &tmp)?;

    // 校验：解出来的东西至少得像个仓库（有 .md 或者有 .git）
    let has_md = std::fs::read_dir(&tmp)
        .map(|it| {
            it.flatten()
                .any(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
        })
        .unwrap_or(false);
    if !has_md && !tmp.join(".git").exists() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err("这份备份里没有文档，已中止恢复".into());
    }

    let old = parent.join(format!(".quill-before-restore-{ts}"));
    std::fs::rename(vault_dir, &old).map_err(|e| format!("无法移动原仓库（是不是还被占用？）: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp, vault_dir) {
        // 换不进去就把原来的放回来
        let _ = std::fs::rename(&old, vault_dir);
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("放置恢复结果失败: {e}"));
    }

    Ok(RestoreReport {
        snapshot: snapshot.map(|s| s.name),
        displaced: old
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    /// 恢复前自动打的那份快照（失败时为 None）
    pub snapshot: Option<String>,
    /// 旧仓库被改名成了什么（没删，用户还可以回去拿）
    pub displaced: String,
}

/// 从备份里恢复**单篇文档**：解压到临时目录，只把那一篇搬进仓库。
pub fn restore_doc(vault_dir: &Path, backup: &Path, file: &str) -> Result<(), String> {
    let name = safe_md_name(file)?;
    let parent = vault_dir
        .parent()
        .ok_or_else(|| "仓库目录没有上级目录".to_string())?;
    let tmp = parent.join(format!(".quill-restore-one-{}", stamp(now_secs())));
    let _ = std::fs::remove_dir_all(&tmp);
    extract_to(backup, &tmp)?;
    let src = tmp.join(&name);
    if !src.exists() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("这份备份里没有 {name}"));
    }
    // 覆盖前给现有那一篇留个 `.bak`：单篇恢复不该把人写的东西直接抹掉
    let dst = vault_dir.join(&name);
    if dst.exists() {
        let _ = std::fs::copy(&dst, dst.with_extension("md.bak"));
    }
    std::fs::copy(&src, &dst).map_err(|e| format!("写回 {name} 失败: {e}"))?;
    let _ = std::fs::remove_dir_all(&tmp);
    let _ = vault::commit_now(vault_dir, &format!("从备份恢复《{}》", name.trim_end_matches(".md")));
    Ok(())
}

fn safe_md_name(file: &str) -> Result<String, String> {
    if file.is_empty()
        || file.contains("..")
        || file.contains('/')
        || file.contains('\\')
        || !file.ends_with(".md")
    {
        return Err(format!("非法文件名: {file}"));
    }
    Ok(file.to_string())
}

/// 备份里有哪些文档（恢复单篇的下拉用）
pub fn docs_in(backup: &Path) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(backup).map_err(|e| format!("打开备份失败: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("这个文件不是有效的备份: {e}"))?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_string();
            // 只认仓库根下的 .md，别把 .git 里的东西混进来
            if name.ends_with(".md") && !name.contains('/') {
                out.push(name);
            }
        }
    }
    out.sort();
    Ok(out)
}

/* ------------------------------ 状态与定时器 ------------------------------ */

pub fn status(app: &AppHandle) -> BackupStatus {
    let prefs = load_prefs(app);
    let dir = dir_of(app, &prefs);
    let writable = probe_writable(&dir).is_ok();
    let dir_error = probe_writable(&dir).err();
    let list = list(&dir);
    BackupStatus {
        dir: dir.to_string_lossy().to_string(),
        count: list.len(),
        total_bytes: list.iter().map(|b| b.size).sum(),
        writable,
        dir_error,
        prefs,
    }
}

/// 真正的「备份一次」：打一份、清旧的、把结果记进设置。
/// 失败也写进设置 —— 下次启动设置页还看得见上次为什么没成。
pub fn run_once(app: &AppHandle, note: &str) -> Result<BackupInfo, String> {
    let mut prefs = load_prefs(app);
    let vault_dir = vault::dir_of(app).map_err(|e| e.to_string())?;
    let dir = dir_of(app, &prefs);
    let result = create(&vault_dir, &dir, note);
    match &result {
        Ok(info) => {
            prefs.last_at = now_secs();
            prefs.last_ok = true;
            prefs.last_error = None;
            prefs.last_size = info.size;
            prefs.last_name = info.name.clone();
            prune(&dir, prefs.keep);
        }
        Err(err) => {
            prefs.last_at = now_secs();
            prefs.last_ok = false;
            prefs.last_error = Some(err.clone());
        }
    }
    let _ = save_prefs(app, &prefs);
    result
}

pub fn save_prefs_cmd(app: &AppHandle, mut prefs: BackupPrefs) -> Result<BackupStatus, String> {
    // 目录先验一遍：存不了就别让用户以为设置成功了
    if !prefs.dir.trim().is_empty() {
        probe_writable(Path::new(prefs.dir.trim()))?;
    }
    prefs.keep = prefs.keep.clamp(1, 365);
    prefs.interval_hours = prefs.interval_hours.clamp(1, 24 * 90);
    save_prefs(app, &prefs)?;
    Ok(status(app))
}

/// 后台定时器：每分钟看一眼「到点没有」。
///
/// 为什么不用定时任务：应用开着才需要备份，关掉之后下次打开补齐就够了；
/// 用系统计划任务反而多一份要维护的东西。
pub fn spawn_auto(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(60));
        let prefs = load_prefs(&app);
        if !prefs.enabled {
            continue;
        }
        let due = prefs.last_at == 0
            || now_secs() - prefs.last_at >= (prefs.interval_hours as i64) * 3600;
        if !due {
            continue;
        }
        // 失败会写进 prefs，下一次循环仍然会因为「到点」再试一次
        match run_once(&app, "") {
            Ok(info) => eprintln!("[backup] ok {} {} bytes", info.name, info.size),
            Err(err) => eprintln!("[backup] failed: {err}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "quill-bk-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let vault = root.join("vault");
        let dest = root.join("backups");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        (vault, dest)
    }

    fn seed(vault: &Path) {
        std::fs::write(vault.join("a.md"), "# A\n\n第一版内容\n").unwrap();
        std::fs::write(vault.join("b.md"), "# B\n\n另一篇\n").unwrap();
        std::fs::write(vault.join(".quill-meta.json"), "{\"starred\":[\"a.md\"]}").unwrap();
        std::fs::create_dir_all(vault.join(".git")).unwrap();
        std::fs::write(vault.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    }

    /// 打一份、列出来、能读出里面有哪几篇
    #[test]
    fn creates_and_lists_backup() {
        let (vault, dest) = scratch("make");
        seed(&vault);
        let info = create(&vault, &dest, "").unwrap();
        assert!(info.size > 0, "备份不该是空的");
        assert!(info.name.ends_with(".zip"));

        let list = list(&dest);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, info.name);

        let docs = docs_in(&dest.join(&info.name)).unwrap();
        assert_eq!(docs, vec!["a.md".to_string(), "b.md".to_string()]);
        let _ = std::fs::remove_dir_all(vault.parent().unwrap());
    }

    /// 备份要连 .git 一起打包 —— 那正是「仓库挂了还能回来」的关键
    #[test]
    fn backup_contains_git_dir() {
        let (vault, dest) = scratch("git");
        seed(&vault);
        let info = create(&vault, &dest, "").unwrap();
        let file = std::fs::File::open(dest.join(&info.name)).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .filter_map(|i| archive.by_index(i).ok().map(|e| e.name().to_string()))
            .collect();
        assert!(names.iter().any(|n| n.starts_with(".git/")), "应该包含 .git");
        let _ = std::fs::remove_dir_all(vault.parent().unwrap());
    }

    /// 只留最近 N 份
    #[test]
    fn prunes_old_backups() {
        let (vault, dest) = scratch("prune");
        seed(&vault);
        for _ in 0..4 {
            create(&vault, &dest, "").unwrap();
            // 文件名只精确到秒，同秒会重名；错开一下
            std::thread::sleep(std::time::Duration::from_millis(1100));
        }
        assert_eq!(list(&dest).len(), 4);
        // 手动塞几份不同名字的，保证 prune 有东西可删
        for i in 0..3 {
            let p = dest.join(format!("quill-old-{i}.zip"));
            std::fs::write(&p, b"x").unwrap();
        }
        let removed = prune(&dest, 2);
        assert!(removed >= 1, "应该删掉旧的");
        assert_eq!(list(&dest).len(), 2);
        let _ = std::fs::remove_dir_all(vault.parent().unwrap());
    }

    /// 恢复单篇：内容回来，原来的那篇留成 .md.bak
    #[test]
    fn restores_one_doc() {
        let (vault, dest) = scratch("one");
        seed(&vault);
        let info = create(&vault, &dest, "").unwrap();
        std::fs::write(vault.join("a.md"), "# A\n\n改成别的了\n").unwrap();

        restore_doc(&vault, &dest.join(&info.name), "a.md").unwrap();
        assert_eq!(
            std::fs::read_to_string(vault.join("a.md")).unwrap(),
            "# A\n\n第一版内容\n"
        );
        assert!(vault.join("a.md.bak").exists(), "覆盖前应该留一份 .bak");
        // 别的文件不受影响
        assert_eq!(
            std::fs::read_to_string(vault.join("b.md")).unwrap(),
            "# B\n\n另一篇\n"
        );
        let _ = std::fs::remove_dir_all(vault.parent().unwrap());
    }

    /// 整库恢复：内容回来、旧仓库被改名留下、恢复前有快照
    #[test]
    fn restores_whole_vault_and_keeps_snapshot() {
        let (vault, dest) = scratch("all");
        seed(&vault);
        let info = create(&vault, &dest, "").unwrap();

        std::fs::write(vault.join("a.md"), "被改坏了\n").unwrap();
        std::fs::remove_file(vault.join("b.md")).unwrap();

        let report = restore_all(&vault, &dest.join(&info.name), &dest).unwrap();
        assert!(report.snapshot.is_some(), "恢复前应该自动打一份快照");
        assert_eq!(
            std::fs::read_to_string(vault.join("a.md")).unwrap(),
            "# A\n\n第一版内容\n"
        );
        assert!(vault.join("b.md").exists(), "删掉的那篇也该回来");
        assert!(vault.join(".git/HEAD").exists(), "git 历史要一起回来");
        assert!(
            vault.parent().unwrap().join(&report.displaced).exists(),
            "旧仓库应该被改名保留，而不是删掉"
        );
        let _ = std::fs::remove_dir_all(vault.parent().unwrap());
    }

    /// 目录写不进去时，错误要说人话（验收标准里那条「只读目录要报可读的错」）
    #[test]
    fn reports_unwritable_dir() {
        let (vault, _dest) = scratch("ro");
        seed(&vault);
        // 用一个「父级是文件」的路径当目标目录，稳定地造出写入失败
        let blocker = vault.parent().unwrap().join("blocker");
        std::fs::write(&blocker, b"x").unwrap();
        let err = create(&vault, &blocker.join("sub"), "").unwrap_err();
        assert!(err.contains("备份目录") || err.contains("创建备份目录"));
        let _ = std::fs::remove_dir_all(vault.parent().unwrap());
    }
}
