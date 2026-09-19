//! AI 续写：调兼容 OpenAI 的 `/chat/completions`（流式 SSE），把增量逐块推给前端。
//!
//! 两条硬规矩：
//! 1. **API Key 只落在应用配置目录**（`%APPDATA%/com.quill.write/ai.json`），
//!    绝不写进文档仓库 —— 那个仓库是要推到远程备份的。
//! 2. 默认关闭、限长、限频，由前端控制触发时机；这里只负责「别乱花钱」地发一次请求。

use std::path::PathBuf;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::Manager;

fn default_base() -> String {
    "https://api.deepseek.com/v1".to_string()
}

fn default_model() -> String {
    "deepseek-chat".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    #[serde(default = "default_base")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            base_url: default_base(),
            model: default_model(),
            api_key: String::new(),
        }
    }
}

/// 给前端看的配置（**不带 key 明文**，只说有没有配过）
///
/// 注意 rename_all：前端 TS 侧读的是 baseUrl / hasKey，
/// 不声明的话序列化出来是 base_url / has_key，前端会拿到 undefined。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
}

impl From<&AiConfig> for AiStatus {
    fn from(c: &AiConfig) -> Self {
        Self {
            base_url: c.base_url.clone(),
            model: c.model.clone(),
            has_key: !c.api_key.trim().is_empty(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AiRequest {
    pub system: String,
    pub prompt: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

/// 流式事件：增量文本 / 结束（带上完整结果）
#[derive(Debug, Clone, Serialize)]
pub struct AiEvent {
    pub delta: String,
    pub done: bool,
    pub text: Option<String>,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("拿不到配置目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("建配置目录失败: {e}"))?;
    Ok(dir.join("ai.json"))
}

fn load_config(app: &tauri::AppHandle) -> AiConfig {
    let Ok(path) = config_path(app) else {
        return AiConfig::default();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn store_config(app: &tauri::AppHandle, cfg: &AiConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let text = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化失败: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("写配置失败: {e}"))
}

/// 读当前设置（不含 key 明文）
#[tauri::command]
pub fn ai_status(app: tauri::AppHandle) -> Result<AiStatus, String> {
    Ok(AiStatus::from(&load_config(&app)))
}

/// 保存设置；`api_key` 传 None 表示「不改动原来那个」
#[tauri::command]
pub fn ai_save(
    app: tauri::AppHandle,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<AiStatus, String> {
    let mut cfg = load_config(&app);
    if !base_url.trim().is_empty() {
        cfg.base_url = base_url.trim().trim_end_matches('/').to_string();
    }
    if !model.trim().is_empty() {
        cfg.model = model.trim().to_string();
    }
    if let Some(k) = api_key {
        let k = k.trim().to_string();
        if !k.is_empty() {
            cfg.api_key = k;
        }
    }
    store_config(&app, &cfg)?;
    log::info!("AI 设置已更新：{} / {}（key {}）", cfg.base_url, cfg.model, if cfg.api_key.is_empty() { "无" } else { "有" });
    Ok(AiStatus::from(&cfg))
}

/// 把流里的一行 SSE 解析出增量文本
fn delta_of(line: &str) -> Option<String> {
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    // 有的网关会把错误塞在流里
    if let Some(err) = value.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
        return Some(format!("\u{0}ERR:{err}"));
    }
    value
        .pointer("/choices/0/delta/content")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
}

/// 流式续写：边收边通过 channel 推给前端
#[tauri::command]
pub async fn ai_stream(
    app: tauri::AppHandle,
    req: AiRequest,
    channel: Channel<AiEvent>,
) -> Result<(), String> {
    let cfg = load_config(&app);
    if cfg.api_key.trim().is_empty() {
        return Err("还没填 API Key，去「更多 → 备份与设置 → AI 续写」里填一个".into());
    }
    if cfg.base_url.trim().is_empty() {
        return Err("接口地址是空的".into());
    }

    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": cfg.model,
        "stream": true,
        "temperature": req.temperature.unwrap_or(0.7),
        "max_tokens": req.max_tokens.unwrap_or(96),
        "messages": [
            { "role": "system", "content": req.system },
            { "role": "user", "content": req.prompt },
        ],
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| format!("建 HTTP 客户端失败: {e}"))?;

    let resp = client
        .post(&url)
        .bearer_auth(cfg.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 {url} 失败: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let detail = resp.text().await.unwrap_or_default();
        let brief: String = detail.chars().take(300).collect();
        return Err(format!("接口返回 {status}：{brief}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut full = String::new();
    let mut lines = 0usize;

    'outer: while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取响应流失败: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(idx) = buf.find('\n') {
            let line = buf[..idx].trim().to_string();
            buf.drain(..=idx);
            lines += 1;
            if line == "data: [DONE]" {
                log::info!("AI 流收到 [DONE]（{lines} 行，{full_len} 字）", full_len = full.chars().count());
                break 'outer;
            }
            if let Some(delta) = delta_of(&line) {
                if let Some(err) = delta.strip_prefix('\u{0}') {
                    return Err(format!("模型返回错误：{}", err.trim_start_matches("ERR:")));
                }
                if full.is_empty() {
                    log::info!("AI 流开始返回内容");
                }
                full.push_str(&delta);
                channel
                    .send(AiEvent { delta: delta.clone(), done: false, text: None })
                    .map_err(|e| format!("推送失败: {e}"))?;
            }
        }
    }

    log::info!("AI 流结束：{lines} 行 / {} 字", full.chars().count());
    channel
        .send(AiEvent { delta: String::new(), done: true, text: Some(full) })
        .map_err(|e| format!("推送失败: {e}"))?;
    Ok(())
}
