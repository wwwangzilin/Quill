mod git;
mod vault;

use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use vault::{DocEntry, SaveResult, TrashEntry, VaultInfo};

/// 每次调用都确保仓库就绪：目录存在 + git init + 本地身份兜底
fn prepare(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = vault::dir_of(app)?;
    git::ensure(&dir)?;
    Ok(dir)
}

/// 全局唤起：再按一次就藏起来；从隐藏状态唤起时顺便让前端开「快速捕获」
fn toggle_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
            let _ = app.emit("quill:quick-capture", ());
        }
    }
}

#[tauri::command]
fn vault_info(app: tauri::AppHandle) -> Result<VaultInfo, String> {
    let dir = prepare(&app)?;
    Ok(vault::info(&dir))
}

#[tauri::command]
fn list_docs(app: tauri::AppHandle) -> Result<Vec<DocEntry>, String> {
    let dir = prepare(&app)?;
    vault::list(&dir)
}

#[tauri::command]
fn read_doc(app: tauri::AppHandle, file: String) -> Result<String, String> {
    let dir = prepare(&app)?;
    vault::read(&dir, &file)
}

#[tauri::command]
fn create_doc(app: tauri::AppHandle, title: String) -> Result<DocEntry, String> {
    let dir = prepare(&app)?;
    vault::create(&dir, &title)
}

#[tauri::command]
fn save_doc(
    app: tauri::AppHandle,
    file: String,
    title: String,
    content: String,
) -> Result<SaveResult, String> {
    let dir = prepare(&app)?;
    vault::save(&dir, &file, &title, &content)
}

#[tauri::command]
fn delete_doc(app: tauri::AppHandle, file: String) -> Result<Option<String>, String> {
    let dir = prepare(&app)?;
    vault::delete(&dir, &file)
}

#[tauri::command]
fn star_doc(app: tauri::AppHandle, file: String, starred: bool) -> Result<(), String> {
    let dir = prepare(&app)?;
    vault::star(&dir, &file, starred)
}

#[tauri::command]
fn set_tags(app: tauri::AppHandle, file: String, tags: Vec<String>) -> Result<(), String> {
    let dir = prepare(&app)?;
    vault::set_tags(&dir, &file, tags)
}

#[tauri::command]
fn all_tags(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = prepare(&app)?;
    Ok(vault::all_tags(&dir))
}

#[tauri::command]
fn list_trash(app: tauri::AppHandle) -> Result<Vec<TrashEntry>, String> {
    let dir = prepare(&app)?;
    vault::list_trash(&dir)
}

#[tauri::command]
fn restore_trash(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let dir = prepare(&app)?;
    vault::restore_trash(&dir, &name)
}

#[tauri::command]
fn purge_trash(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let dir = prepare(&app)?;
    vault::purge_trash(&dir, &name)
}

#[tauri::command]
fn empty_trash(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = prepare(&app)?;
    vault::empty_trash(&dir)
}

#[tauri::command]
fn record_writing(app: tauri::AppHandle, date: String, chars: u64) -> Result<(), String> {
    let dir = prepare(&app)?;
    vault::record_writing(&dir, &date, chars)
}

#[tauri::command]
fn writing_stats(app: tauri::AppHandle) -> Result<HashMap<String, u64>, String> {
    let dir = prepare(&app)?;
    Ok(vault::get_stats(&dir))
}

#[tauri::command]
fn git_history(app: tauri::AppHandle, limit: Option<usize>) -> Result<Vec<git::CommitInfo>, String> {
    let dir = prepare(&app)?;
    git::log(&dir, limit.unwrap_or(80))
}

#[tauri::command]
fn git_file_at(app: tauri::AppHandle, hash: String, file: String) -> Result<String, String> {
    let dir = prepare(&app)?;
    git::show_at(&dir, &hash, &file)
}

#[tauri::command]
fn git_restore(app: tauri::AppHandle, hash: String, file: String) -> Result<Option<String>, String> {
    let dir = prepare(&app)?;
    git::restore(&dir, &hash, &file)
}

#[derive(serde::Serialize)]
struct RemoteInfo {
    url: Option<String>,
    ahead: Option<usize>,
    has_token: bool,
    ssl_ca: Option<String>,
}

#[tauri::command]
fn git_remote_info(app: tauri::AppHandle) -> Result<RemoteInfo, String> {
    let dir = prepare(&app)?;
    Ok(RemoteInfo {
        url: git::remote_url(&dir),
        ahead: git::ahead_count(&dir),
        has_token: git::get_config(&dir, "credential.helper").is_some(),
        ssl_ca: git::get_config(&dir, "http.sslCAInfo"),
    })
}

/// 保存远程备份设置：地址、可选的自签 CA（代理环境）、可选的 token
#[tauri::command]
fn save_git_settings(
    app: tauri::AppHandle,
    url: String,
    ca: Option<String>,
    token: Option<String>,
) -> Result<(), String> {
    let dir = prepare(&app)?;
    git::set_remote(&dir, &url)?;

    match ca.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(path) => {
            git::set_config(&dir, "http.sslBackend", "openssl")?;
            git::set_config(&dir, "http.sslCAInfo", &path.replace('\\', "/"))?;
        }
        None => {
            git::unset_config(&dir, "http.sslBackend");
            git::unset_config(&dir, "http.sslCAInfo");
        }
    }

    if let Some(t) = token {
        git::save_token(&dir, &t)?;
    }
    Ok(())
}

/// 手动备份：先提交当前改动，再推上去
#[tauri::command]
fn git_push_now(app: tauri::AppHandle) -> Result<String, String> {
    let dir = prepare(&app)?;
    let _ = git::commit_all(&dir, "备份快照");
    git::push(&dir)
}

/// 把选中的图片/视频写进仓库的 assets/ 目录，返回可写进 Markdown 的相对路径
#[tauri::command]
fn save_asset(app: tauri::AppHandle, name: String, data: String) -> Result<String, String> {
    let dir = prepare(&app)?;
    vault::save_asset(&dir, &name, &data)
}

/* ============================ 多窗口：便签 / 磁贴 ============================ */

/// 窗口 label 只允许 ASCII 安全字符，把文档名逐字节转十六进制
fn sticky_label(doc: &str) -> String {
    let mut s = String::from("sticky-");
    for b in doc.bytes() {
        if b.is_ascii_alphanumeric() {
            s.push(b as char);
        } else {
            s.push_str(&format!("{b:02x}"));
        }
    }
    s
}

/// 放进 URL hash 的百分号编码（前端用 decodeURIComponent 解回来）
fn encode_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 唤起或收起便签窗口
#[tauri::command]
fn toggle_quicknote(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("quicknote") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
        return Ok(());
    }
    open_quicknote(app)
}

/// 建一个无边框、置顶的小窗口专门用来记便签
#[tauri::command]
fn open_quicknote(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("quicknote") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        "quicknote",
        WebviewUrl::App("index.html#quicknote".into()),
    )
    .title("快捷便签")
    .inner_size(400.0, 470.0)
    .min_inner_size(300.0, 240.0)
    .decorations(false)
    .always_on_top(true)
    .resizable(true)
    .skip_taskbar(true)
    .center()
    .build()
    .map_err(|e| format!("创建便签窗口失败: {e}"))?;
    Ok(())
}

/// 把某篇文档钉成桌面磁贴（置顶小窗，方便随时查阅与复制）
#[tauri::command]
fn open_sticky(app: tauri::AppHandle, doc: String, title: String) -> Result<(), String> {
    let label = sticky_label(&doc);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = format!("index.html#sticky={}", encode_component(&doc));
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(320.0, 400.0)
        .min_inner_size(200.0, 150.0)
        .decorations(false)
        .always_on_top(true)
        .resizable(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| format!("创建磁贴窗口失败: {e}"))?;
    Ok(())
}

/// 小窗口自己关自己
#[tauri::command]
fn close_self(window: tauri::WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|e| format!("关闭窗口失败: {e}"))
}

/// 这篇文档是不是已经钉在桌面上了
#[tauri::command]
fn is_sticky(app: tauri::AppHandle, doc: String) -> bool {
    app.get_webview_window(&sticky_label(&doc)).is_some()
}

/// 在资源管理器里打开仓库目录 —— 「文档都是纯 md 文件」这件事要能被亲眼验证
#[tauri::command]
fn reveal_vault(app: tauri::AppHandle) -> Result<(), String> {
    let dir = prepare(&app)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .arg(dir.as_os_str())
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| format!("打开资源管理器失败: {e}"))?;
    }
    let _ = dir;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    // Ctrl+Space = 便签；Ctrl+Shift+Space = 主窗口
                    let quick = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
                    if shortcut == &quick {
                        let _ = toggle_quicknote(app.clone());
                    } else {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // 启动即初始化仓库，省得第一次保存时才发现问题
            if let Err(err) = prepare(app.handle()) {
                log::warn!("vault 初始化失败: {err}");
            }
            // 主窗口：Ctrl + Shift + Space
            let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            if let Err(err) = app.global_shortcut().register(toggle) {
                log::warn!("主窗口快捷键注册失败（可能被别的程序占了）: {err}");
            }
            // 快捷便签：Ctrl + Space
            let quick = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
            if let Err(err) = app.global_shortcut().register(quick) {
                log::warn!("便签快捷键 Ctrl+Space 注册失败（可能被输入法占了）: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_info,
            list_docs,
            read_doc,
            create_doc,
            save_doc,
            delete_doc,
            star_doc,
            set_tags,
            all_tags,
            list_trash,
            restore_trash,
            purge_trash,
            empty_trash,
            record_writing,
            writing_stats,
            git_history,
            git_file_at,
            git_restore,
            reveal_vault,
            git_remote_info,
            save_git_settings,
            git_push_now,
            save_asset,
            toggle_quicknote,
            open_quicknote,
            open_sticky,
            close_self,
            is_sticky
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
