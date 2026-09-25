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
// 前端按 JS 的习惯传 maxTokens，这里必须跟着转成 camelCase ——
// 少了这一行，serde 找不到 max_tokens，请求会一声不响地退到兜底值，
// 于是「改写 900、问答 700」全都变成 96，输出永远断在半句上。
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub system: String,
    pub prompt: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

/// 流式事件：增量文本 / 结束（带上完整结果与结束原因）
#[derive(Debug, Clone, Serialize)]
pub struct AiEvent {
    pub delta: String,
    pub done: bool,
    pub text: Option<String>,
    /// 结束原因。`length` 表示被 max_tokens 截断了 —— 这个信号必须传出去，
    /// 否则前端只看到内容莫名其妙断在半句上，分不清是模型抽风还是长度不够。
    #[serde(rename = "finishReason", skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
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

/// 一行 SSE → (增量文本, 结束原因)。
///
/// 结束原因必须一并取出来：`finish_reason: "length"` 是模型在明说「我被 max_tokens
/// 截断了」。只取 content 会把这个信号丢掉，用户就只能看到半句话。
fn parse_chunk(line: &str) -> Option<(Option<String>, Option<String>)> {
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    // 有的网关会把错误塞在流里
    if let Some(err) = value.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
        return Some((Some(format!("\u{0}ERR:{err}")), None));
    }
    let delta = value
        .pointer("/choices/0/delta/content")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());
    let reason = value
        .pointer("/choices/0/finish_reason")
        .and_then(|r| r.as_str())
        .map(|s| s.to_string());
    Some((delta, reason))
}

/// 判断是不是「本机或内网」地址，是的话别让系统代理插手。
///
/// Windows 的 WinINET 代理列表默认不排除回环地址，而本机常驻的加速器
/// （Steam++ 之类）会开一个本地代理 —— 发往 localhost 的请求一旦交给它，
/// 换回来的是一个空 404，本地 Ollama / LM Studio 就此全废。
fn bypass_proxy(url: &str) -> bool {
    let after = url.split("://").nth(1).unwrap_or(url);
    let authority = after.split(['/', '?', '#']).next().unwrap_or("");
    let authority = authority.rsplit('@').next().unwrap_or(authority); // 去掉 user:pass@
    let host = if let Some(rest) = authority.strip_prefix('[') {
        rest.split(']').next().unwrap_or("") // [::1]:8080
    } else {
        authority.split(':').next().unwrap_or("")
    };
    matches!(host, "localhost" | "::1" | "0.0.0.0")
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
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
    let max_tokens = req.max_tokens.unwrap_or(96);
    let temperature = req.temperature.unwrap_or(0.7);
    // 这两个值最容易被「前端没传、悄悄退回默认」坑掉，落一行日志省得以后再查一遍
    log::info!("AI 请求：{url} / max_tokens {max_tokens} / 温度 {temperature:.2}");
    let body = serde_json::json!({
        "model": cfg.model,
        "stream": true,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [
            { "role": "system", "content": req.system },
            { "role": "user", "content": req.prompt },
        ],
    });

    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(90));
    if bypass_proxy(&url) {
        builder = builder.no_proxy();
    }
    let client = builder
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
        // 带上真实 URL：404 这类错误多半是地址拼错了，不给 URL 根本没法查
        return Err(format!("接口返回 {status}（{url}）：{brief}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut full = String::new();
    let mut lines = 0usize;
    let mut finish: Option<String> = None;

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
            if let Some((delta, reason)) = parse_chunk(&line) {
                if reason.is_some() {
                    finish = reason;
                }
                if let Some(delta) = delta {
                    if let Some(err) = delta.strip_prefix('\u{0}') {
                        return Err(format!("模型返回错误：{}", err.trim_start_matches("ERR:")));
                    }
                    if full.is_empty() {
                        log::info!("AI 流开始返回内容");
                    }
                    full.push_str(&delta);
                    channel
                        .send(AiEvent {
                            delta: delta.clone(),
                            done: false,
                            text: None,
                            finish_reason: None,
                        })
                        .map_err(|e| format!("推送失败: {e}"))?;
                }
            }
        }
    }

    log::info!(
        "AI 流结束：{lines} 行 / {n} 字 / 结束原因 {reason}",
        n = full.chars().count(),
        reason = finish.as_deref().unwrap_or("未知"),
    );
    channel
        .send(AiEvent { delta: String::new(), done: true, text: Some(full), finish_reason: finish })
        .map_err(|e| format!("推送失败: {e}"))?;
    Ok(())
}
