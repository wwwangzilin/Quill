//! 文档仓库的 git 集成。
//!
//! 刻意走系统 git CLI 而不是 libgit2/git2-rs：
//! 1. 行为与主人手敲 `git log` 完全一致，排查时所见即所得；
//! 2. 不用为 libgit2 拉一套 C 构建链，Tauri 首次编译能省好几分钟。

use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 跑一条 git 命令，返回 stdout（失败时返回带 stderr 的错误）
fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .arg("-c")
        .arg("core.quotepath=false")
        .args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd
        .output()
        .map_err(|e| format!("无法启动 git（装了吗？）: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        return Err(format!(
            "git {} 失败: {}{}",
            args.join(" "),
            stderr.trim(),
            stdout.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn has_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// 确保目录是个可提交的 git 仓库（含最低限度的本地身份配置）。
pub fn ensure(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建仓库目录失败: {e}"))?;

    if !has_repo(dir) {
        run(dir, &["init", "-q", "-b", "main"])?;
    }
    // 用户没配全局 git 身份时 commit 会直接失败，这里补一套仓库级身份兜底
    if run(dir, &["config", "--get", "user.name"]).is_err() {
        run(dir, &["config", "user.name", "Quill"])?;
    }
    if run(dir, &["config", "--get", "user.email"]).is_err() {
        run(dir, &["config", "user.email", "quill@localhost"])?;
    }
    let _ = run(dir, &["config", "core.quotepath", "false"]);
    Ok(())
}

/// 全部暂存并提交；没有改动时返回 None。
pub fn commit_all(dir: &Path, message: &str) -> Result<Option<String>, String> {
    run(dir, &["add", "-A", "--", "."])?;
    let status = run(dir, &["status", "--porcelain"])?;
    if status.trim().is_empty() {
        return Ok(None);
    }
    run(dir, &["commit", "-q", "-m", message])?;
    let head = run(dir, &["rev-parse", "HEAD"])?;
    Ok(Some(head.trim().to_string()))
}

#[derive(serde::Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short: String,
    pub message: String,
    pub time: i64,
    pub files: Vec<String>,
}

const SEP: char = '\u{1f}';

/// 最近若干次提交（含每次改动的文件清单）。
pub fn log(dir: &Path, limit: usize) -> Result<Vec<CommitInfo>, String> {
    if !has_repo(dir) {
        return Ok(vec![]);
    }
    let n = format!("-{limit}");
    let pretty = format!("--pretty=format:%H{SEP}%h{SEP}%ct{SEP}%s");
    let out = match run(dir, &["log", &n, &pretty, "--name-only"]) {
        Ok(s) => s,
        // 仓库刚 init、还没有任何提交时 git log 会失败，视为空历史
        Err(_) => return Ok(vec![]),
    };

    let mut list: Vec<CommitInfo> = Vec::new();
    for line in out.lines() {
        if line.contains(SEP) {
            let parts: Vec<&str> = line.split(SEP).collect();
            if parts.len() >= 4 {
                list.push(CommitInfo {
                    hash: parts[0].to_string(),
                    short: parts[1].to_string(),
                    time: parts[2].parse().unwrap_or(0),
                    message: parts[3].to_string(),
                    files: Vec::new(),
                });
                continue;
            }
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(last) = list.last_mut() {
            last.files.push(trimmed.to_string());
        }
    }
    Ok(list)
}

/// 取某次提交里某文件的内容（用于对比与预览）。
pub fn show_at(dir: &Path, hash: &str, file: &str) -> Result<String, String> {
    run(dir, &["show", &format!("{hash}:{file}")])
}

/// 把某文件恢复到指定版本，并记一笔「回滚」提交。
pub fn restore(dir: &Path, hash: &str, file: &str) -> Result<Option<String>, String> {
    let spec = format!("{hash}:{file}");
    if run(dir, &["cat-file", "-e", &spec]).is_err() {
        // 该提交里根本没这个文件 —— 说明那时它还不存在，回滚等于把它删掉
        let path = dir.join(file);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("删除失败: {e}"))?;
        }
    } else {
        run(dir, &["checkout", hash, "--", file])?;
    }
    let short = &hash[..hash.len().min(7)];
    commit_all(dir, &format!("回滚 {file} 到 {short}"))
}

/* ============================ 远程备份 ============================ */

pub fn remote_url(dir: &Path) -> Option<String> {
    run(dir, &["remote", "get-url", "origin"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn set_remote(dir: &Path, url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        let _ = run(dir, &["remote", "remove", "origin"]);
        return Ok(());
    }
    if remote_url(dir).is_some() {
        run(dir, &["remote", "set-url", "origin", url])?;
    } else {
        run(dir, &["remote", "add", "origin", url])?;
    }
    Ok(())
}

/// 写仓库级 git 配置（TLS / 凭据），只落在 .git/config 里，不进版本库
pub fn set_config(dir: &Path, key: &str, value: &str) -> Result<(), String> {
    run(dir, &["config", "--local", key, value])?;
    Ok(())
}

pub fn get_config(dir: &Path, key: &str) -> Option<String> {
    run(dir, &["config", "--local", "--get", key])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn unset_config(dir: &Path, key: &str) {
    let _ = run(dir, &["config", "--local", "--unset", key]);
}

/// 有多少提交还没推上去（没有上游时返回 None）
pub fn ahead_count(dir: &Path) -> Option<usize> {
    let out = run(dir, &["rev-list", "--count", "@{u}..HEAD"]).ok()?;
    out.trim().parse::<usize>().ok()
}

/// 把凭据写进仓库内的 .git 目录（不会被提交），并让 git 用它
pub fn save_token(dir: &Path, token: &str) -> Result<(), String> {
    let token = token.trim();
    let file = dir.join(".git").join("quill-credentials");
    if token.is_empty() {
        let _ = std::fs::remove_file(&file);
        unset_config(dir, "credential.helper");
        return Ok(());
    }
    // git credential-store 的格式：一行一个 URL
    let content = format!("https://x-access-token:{token}@github.com\n");
    std::fs::write(&file, content).map_err(|e| format!("写凭据失败: {e}"))?;
    let path = file.to_string_lossy().replace('\\', "/");
    set_config(dir, "credential.helper", &format!("store --file={path}"))
}

/// 推送到 origin。成功时返回 git 的输出（进度信息在 stderr 里）。
pub fn push(dir: &Path) -> Result<String, String> {
    if remote_url(dir).is_none() {
        return Err("还没配置远程仓库".into());
    }
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .arg("-c")
        .arg("core.quotepath=false")
        .args(["push", "-u", "origin", "HEAD"]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd
        .output()
        .map_err(|e| format!("无法启动 git（装了吗？）: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        // 把 git 的原话完整带回去，方便用户自己排查（网络/证书/认证）
        return Err(format!("{}{}", stderr.trim(), stdout.trim()));
    }
    let merged = format!("{}{}", stderr, stdout);
    Ok(merged.trim().to_string())
}
