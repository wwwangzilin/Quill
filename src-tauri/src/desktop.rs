//! 桌面集成：托盘常驻、关闭到托盘、开机自启、后台自动同步。
//!
//! 为什么要有「关闭到托盘」：快捷便签（Ctrl+Space）是注册在进程上的全局快捷键，
//! 主窗口一关进程就没了，快捷键跟着失效 —— 等于「随手记一笔」这个功能是断的。
//! 所以点 × 默认收进托盘而不是退出，要真退出走托盘菜单或设置里关掉这个开关。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::{git, prepare, toggle_quicknote_at};

const PREFS_FILE: &str = "desktop.json";

/// 桌面行为偏好。存 Rust 侧一份：托盘点击和窗口关闭事件发生在前端之外，
/// 前端 localStorage 里的设置它们读不到。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrefs {
    /// 点 × 收进托盘（而不是退出）
    pub close_to_tray: bool,
    /// 定时把文档仓库推到远程
    pub auto_sync: bool,
    /// 自动同步间隔（分钟）
    pub sync_minutes: u64,
}

impl Default for DesktopPrefs {
    fn default() -> Self {
        Self {
            // 默认开：不开的话便签快捷键活不过关窗
            close_to_tray: true,
            // 默认关：没配远程仓库的人不该被反复打扰
            auto_sync: false,
            sync_minutes: 30,
        }
    }
}

#[derive(Default)]
pub struct DesktopState(pub Mutex<DesktopPrefs>);

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("取配置目录失败: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    Ok(dir.join(PREFS_FILE))
}

pub fn load(app: &AppHandle) -> DesktopPrefs {
    prefs_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 读当前偏好。用 try_state：早期事件（窗口还没 setup 完）里 state 可能还没注册
pub fn current(app: &AppHandle) -> DesktopPrefs {
    app.try_state::<DesktopState>()
        .and_then(|s| s.0.lock().ok().map(|p| p.clone()))
        .unwrap_or_default()
}

fn write_prefs(app: &AppHandle, prefs: &DesktopPrefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    let text = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("写入设置失败: {e}"))
}

#[tauri::command]
pub fn desktop_prefs(app: AppHandle) -> DesktopPrefs {
    current(&app)
}

#[tauri::command]
pub fn save_desktop_prefs(app: AppHandle, prefs: DesktopPrefs) -> Result<(), String> {
    write_prefs(&app, &prefs)?;
    if let Some(state) = app.try_state::<DesktopState>() {
        if let Ok(mut cur) = state.0.lock() {
            *cur = prefs;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn autostart_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let al = app.autolaunch();
    let r = if enabled { al.enable() } else { al.disable() };
    r.map_err(|e| format!("开机自启设置失败: {e}"))
}

/* ------------------------------ 同步 ------------------------------ */

/// 提交 + 推送。任何一步失败都如实返回，绝不静默吞掉。
pub fn sync_now(app: &AppHandle) -> Result<String, String> {
    let dir = prepare(app)?;
    if git::remote_url(&dir).is_none() {
        return Err("还没配置远程仓库".into());
    }
    let _ = git::commit_all(&dir, "自动同步");
    git::push(&dir)?;
    Ok("已同步到远程".into())
}

/// 后台定时同步。间隔每次都重新读偏好，设置里改了立刻生效。
pub fn spawn_auto_sync(app: AppHandle) {
    std::thread::spawn(move || {
        // 启动先缓一会儿，别跟界面初始化抢 git 锁
        std::thread::sleep(Duration::from_secs(20));
        loop {
            let prefs = current(&app);
            if prefs.auto_sync {
                match sync_now(&app) {
                    Ok(msg) => {
                        log::info!("自动同步：{msg}");
                        let _ = app.emit("quill:sync-done", msg);
                    }
                    Err(err) => {
                        log::warn!("自动同步失败：{err}");
                        let _ = app.emit("quill:sync-failed", err);
                    }
                }
            }
            let mins = current(&app).sync_minutes.clamp(1, 24 * 60);
            std::thread::sleep(Duration::from_secs(mins * 60));
        }
    });
}

/// 退出前补一次同步。最多等 6 秒 —— 网络不通时不能把退出卡死。
pub fn sync_on_exit(app: &AppHandle) {
    if !current(app).auto_sync {
        return;
    }
    let handle = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(sync_now(&handle));
    });
    match rx.recv_timeout(Duration::from_secs(6)) {
        Ok(Ok(msg)) => log::info!("退出前同步完成：{msg}"),
        Ok(Err(err)) => log::warn!("退出前同步失败：{err}"),
        Err(_) => log::warn!("退出前同步超时，先放行退出"),
    }
}

/* ------------------------------ 托盘 ------------------------------ */

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "quick" => {
            // 建窗口必须走 async（Windows 上同步建窗会死锁），事件回调里只能 spawn
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = toggle_quicknote_at(handle).await {
                    log::warn!("托盘唤起便签失败: {err}");
                }
            });
        }
        "show" => show_main(app),
        "sync" => {
            let handle = app.clone();
            std::thread::spawn(move || {
                let msg = match sync_now(&handle) {
                    Ok(m) => m,
                    Err(e) => e,
                };
                let _ = handle.emit("quill:sync-done", msg);
            });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let quick = MenuItem::with_id(app, "quick", "记一笔（Ctrl+Space）", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "打开 Quill", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "立即同步到远程", true, None::<&str>)?;
    let sep_a = PredefinedMenuItem::separator(app)?;
    let sep_b = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Quill", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quick, &show, &sep_a, &sync, &sep_b, &quit])?;

    let mut builder = TrayIconBuilder::with_id("quill-tray")
        .tooltip("Quill —— 想到哪写到哪")
        .menu(&menu)
        // Windows 习惯：左键点图标开主窗口，右键才出菜单
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    log::info!("托盘图标已就绪");
    Ok(())
}
