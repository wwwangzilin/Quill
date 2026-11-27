//! WebDAV：只给前端一个「发一条 HTTP 请求」的通道。
//!
//! 同步逻辑（列目录、三方对比、冲突处理）全在前端 `core/webdav.ts`，
//! 这里不碰任何业务，只做两件前端做不到的事：
//!   1. 绕开 WebView 的 CORS —— 多数 WebDAV 服务（坚果云、Nextcloud）不给网页放行；
//!   2. 能发 PROPFIND / MKCOL 这类非常规方法并读响应头。
//! 文档都是 UTF-8 文本，body 直接走字符串，不折腾二进制。

use std::time::Duration;

#[derive(serde::Deserialize)]
pub struct DavRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub pass: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(serde::Serialize)]
pub struct DavResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[tauri::command]
pub async fn webdav_request(req: DavRequest) -> Result<DavResponse, String> {
    if !(req.url.starts_with("http://") || req.url.starts_with("https://")) {
        return Err("地址要以 http:// 或 https:// 开头".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("建 HTTP 客户端失败: {e}"))?;
    let method = reqwest::Method::from_bytes(req.method.trim().to_uppercase().as_bytes())
        .map_err(|e| format!("不认识的请求方法: {e}"))?;

    let mut builder = client.request(method, &req.url);
    if !req.user.is_empty() {
        builder = builder.basic_auth(&req.user, Some(&req.pass));
    }
    for (k, v) in &req.headers {
        builder = builder.header(k.as_str(), v.as_str());
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("请求 {} 失败: {e}", req.url))?;
    let status = resp.status().as_u16();
    let headers = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|s| (k.as_str().to_string(), s.to_string()))
        })
        .collect::<Vec<_>>();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    Ok(DavResponse {
        status,
        headers,
        body,
    })
}

/* ============================ assets/ 图片同步 ============================
 *
 * 图片是二进制，不走上面那个只收发文本的通道，也不绕 base64：
 * 这里直接在 Rust 里「读本地文件 → PUT」「GET → 写本地文件」，一份内存都不多占。
 * 文件名由前端给，这里再做一遍路径穿越检查（不信任前端）。
 */

use std::path::PathBuf;

#[derive(serde::Deserialize)]
pub struct DavAuth {
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub pass: String,
}

#[derive(serde::Serialize)]
pub struct AssetInfo {
    pub name: String,
    pub size: u64,
}

fn assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::prepare(app)?.join("assets"))
}

fn check_asset_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
        || name.starts_with('.')
    {
        return Err(format!("非法文件名: {name}"));
    }
    Ok(())
}

fn bulk_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("建 HTTP 客户端失败: {e}"))
}

/// 本地 assets/ 下有哪些文件（只看一层，只要文件）
#[tauri::command]
pub fn list_assets(app: tauri::AppHandle) -> Result<Vec<AssetInfo>, String> {
    let dir = assets_dir(&app)?;
    let mut out: Vec<AssetInfo> = Vec::new();
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Ok(out);
    };
    for entry in rd.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            if check_asset_name(name).is_ok() {
                out.push(AssetInfo {
                    name: name.to_string(),
                    size: meta.len(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 把本地 assets/<name> PUT 到 url，返回 HTTP 状态码
#[tauri::command]
pub async fn webdav_put_asset(
    app: tauri::AppHandle,
    url: String,
    auth: DavAuth,
    name: String,
) -> Result<u16, String> {
    check_asset_name(&name)?;
    let path = assets_dir(&app)?.join(&name);
    let bytes = std::fs::read(&path).map_err(|e| format!("读取 {name} 失败: {e}"))?;
    let mut req = bulk_client()?.put(&url).body(bytes);
    if !auth.user.is_empty() {
        req = req.basic_auth(&auth.user, Some(&auth.pass));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("上传 {name} 失败: {e}"))?;
    Ok(resp.status().as_u16())
}

/// GET url，成功就写成本地 assets/<name>（已存在则不覆盖）；返回 HTTP 状态码
#[tauri::command]
pub async fn webdav_get_asset(
    app: tauri::AppHandle,
    url: String,
    auth: DavAuth,
    name: String,
) -> Result<u16, String> {
    check_asset_name(&name)?;
    let mut req = bulk_client()?.get(&url);
    if !auth.user.is_empty() {
        req = req.basic_auth(&auth.user, Some(&auth.pass));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("下载 {name} 失败: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Ok(status.as_u16());
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取 {name} 失败: {e}"))?;
    let dir = assets_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 assets 目录失败: {e}"))?;
    let target = dir.join(&name);
    if !target.exists() {
        std::fs::write(&target, &bytes).map_err(|e| format!("写入 {name} 失败: {e}"))?;
    }
    Ok(status.as_u16())
}
