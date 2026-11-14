//! 媒体文件：写进 `assets/`，返回写进 Markdown 的相对路径。

use std::path::Path;

use super::util::{commit, now_secs};

/// base64 编码（同样是手写的，省一个依赖）。
///
/// 拖进来的 .txt 得先认出编码才知道是不是 GBK，而那是前端 TextDecoder 的强项
/// （原生带 gbk / big5），Rust 这边要么引 encoding_rs 要么自己写，不划算。
/// 所以这里只把字节原样端过去 —— 用 base64 而不是 JSON 数字数组：
/// 一个几百 KB 的 txt 走数组会膨胀成几 MB 的文本，白等一趟。
pub fn encode_base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = ((chunk[0] as u32) << 16) | ((b1 as u32) << 8) | b2 as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// base64 解码（手写，省一个依赖）
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, &c) in TABLE.iter().enumerate() {
        lookup[c as usize] = i as u8;
    }
    let clean: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits = 0u32;
    for b in clean {
        let v = lookup[b as usize];
        if v == 255 {
            return Err("媒体数据不是合法的 base64".into());
        }
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

/// 把媒体文件写进 assets/，返回相对路径（写进 Markdown 用的那种）
pub fn save_asset(dir: &Path, name: &str, data: &str) -> Result<String, String> {
    let assets = dir.join("assets");
    std::fs::create_dir_all(&assets).map_err(|e| format!("创建 assets 目录失败: {e}"))?;

    let safe: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    // 同一秒里连插两张图也得各自落一份，不能互相覆盖
    let mut file_name = format!("{}_{}", now_secs(), safe.trim());
    let mut n = 2;
    while assets.join(&file_name).exists() {
        file_name = format!("{}_{}-{}", now_secs(), safe.trim(), n);
        n += 1;
    }
    let bytes = decode_base64(data)?;
    std::fs::write(assets.join(&file_name), bytes).map_err(|e| format!("写入媒体失败: {e}"))?;

    commit(dir, &format!("插入媒体 {}", safe.trim()));
    Ok(format!("assets/{file_name}"))
}

/// 把一个外部文件复制进 assets/。拖拽进来的图片/视频走这条路 ——
/// 前端只给路径、不做 base64 编解码，几十上百 MB 的视频不会白白多占一份内存。
pub fn import_asset(dir: &Path, src: &Path) -> Result<String, String> {
    if !src.is_file() {
        return Err(format!("不是文件：{}", src.to_string_lossy()));
    }
    let assets = dir.join("assets");
    std::fs::create_dir_all(&assets).map_err(|e| format!("创建 assets 目录失败: {e}"))?;

    // 只认文件名本身，外部路径的目录部分一概丢掉（顺带把 ../ 这类越界挡在门外）
    let raw = src.file_name().and_then(|s| s.to_str()).unwrap_or("媒体");
    let safe: String = raw
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let mut file_name = format!("{}_{}", now_secs(), safe.trim());
    let mut n = 2;
    while assets.join(&file_name).exists() {
        file_name = format!("{}_{}-{}", now_secs(), safe.trim(), n);
        n += 1;
    }
    std::fs::copy(src, assets.join(&file_name)).map_err(|e| format!("复制媒体失败: {e}"))?;
    commit(dir, &format!("插入媒体 {}", safe.trim()));
    Ok(format!("assets/{file_name}"))
}
