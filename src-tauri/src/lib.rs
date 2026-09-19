mod git;
mod vault;

use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use vault::{DocEntry, SaveResult, TrashEntry, VaultInfo};

/// 每次调用都确保仓库就绪：目录存在 + git init + 本地身份兜底
fn prepare(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = vault::dir_of(app)?;
    git::ensure(&dir)?;
    Ok(dir)
}

/// 全局唤起：再按一次就藏起来
fn toggle_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
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
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
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
            // 全局唤起：Ctrl + Shift + Space
            let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            if let Err(err) = app.global_shortcut().register(toggle) {
                log::warn!("全局快捷键注册失败（可能被别的程序占了）: {err}");
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
            reveal_vault
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
