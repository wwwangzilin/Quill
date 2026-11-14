//! 超大文档：按章读、按章写回。
//!
//! 偏移一律是**字节**，前后端统一，别混字符下标。

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::util::{commit, safe_name};

/* ==================== 超大文档：按章读 ==================== */

/// 一章在文件里的位置。**字节**偏移 —— 前后端统一用字节，别混字符下标。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterMark {
    pub title: String,
    pub from: u64,
    pub to: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocOutline {
    pub marks: Vec<ChapterMark>,
    /// 整个文件的字节数
    pub bytes: u64,
}

/** 章名最长这么多**字节**（≈66 个汉字，够宽了） */
const MAX_HEAD_BYTES: usize = 200;

/** 章名后面常跟着的元信息 */
const META_KEYS: [&str; 8] = ["作者", "更新时间", "字数", "来源", "本章", "链接", "简介", "标签"];

/**
 * 光凭「第X章」认不全分节写法。
 *
 * 扒下来的小说很常见两种别的：
 * ①「1.变成血族萝莉」「2.契约！」—— 纯数字编号（实测某篇 1047 节全是这个）；
 * ②「楔子」「序章」「间幕」「后记」—— 没有数字的固定词。
 * 只认「第X章」的话，这些文档的目录里就剩几个「第X卷」，看着像章节丢了。
 */
const EXTRA_HEADS: [&str; 10] = [
    "楔子", "序章", "终章", "尾声", "后记", "番外", "间幕", "幕间", "外传", "作者的话",
];

/**
 * 「1.标题」「2、标题」「12．标题」这种纯数字编号。
 *
 * 约束放得紧，因为正文里也有数字开头的句子：
 * ①必须行首（调用方已 trim）；
 * ②1~4 位数字，紧跟 `.` `．` `、` —— **故意不含中文逗号**：
 *   「2012，2032，两者之间间隔了二十年之久。」这种年份并列的句子就是这么挡掉的
 *   （实测在《半生出走》里踩到过）；
 * ③分隔符后不能紧跟数字，免得把「1.5 倍」当成一节；
 * ④整行不能太长（调用方按 MAX_HEAD_BYTES 卡）。
 */
fn is_num_head(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 || i > 4 {
        return false;
    }
    let mut ch = s[i..].chars();
    match ch.next() {
        Some('.') | Some('．') | Some('、') => {}
        _ => return false,
    }
    match ch.as_str().trim_start().chars().next() {
        Some(c) => !c.is_ascii_digit(),
        None => false,
    }
}

/** 「第…章/节/回/卷/篇/部」 */
fn is_cn_head(s: &str) -> bool {
    let mut it = s.chars();
    if it.next() != Some('第') {
        return false;
    }
    let mut n = 0;
    for c in it {
        // 「第 1 章」也认 —— 前端那份规则（rawChapters.ts 的 CN_HEAD）本来就允许空格，
        // 两边不一致的话，同一篇文档走编辑器和大文档会切出不同的目录。
        if c == ' ' || c == '\u{3000}' {
            continue;
        }
        if c.is_ascii_digit() || "０１２３４５６７８９一二三四五六七八九十百千零两".contains(c) {
            n += 1;
            if n > 12 {
                return false;
            }
        } else {
            return "章节回卷篇話话部".contains(c);
        }
    }
    false
}

/** Chapter 1 / CHAPTER IV */
fn is_en_head(s: &str) -> bool {
    let low = s.to_ascii_lowercase();
    if !low.starts_with("chapter") {
        return false;
    }
    match low[7..].trim_start().chars().next() {
        Some(c) => c.is_ascii_digit() || "ivxlcdm".contains(c),
        None => false,
    }
}

/** 这一行如果是章名，返回干净的名字 */
fn head_of_line(line: &str) -> Option<String> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }
    let bare = t.trim_start_matches('#').trim_start();
    let is_extra = EXTRA_HEADS.iter().any(|w| bare.starts_with(w));
    if !is_cn_head(bare) && !is_en_head(bare) && !is_num_head(bare) && !is_extra {
        return None;
    }
    let mut cut = bare.len();
    for k in META_KEYS {
        if let Some(i) = bare.find(k) {
            let after = &bare[i + k.len()..];
            if (after.starts_with(':') || after.starts_with('：')) && i < cut {
                cut = i;
            }
        }
    }
    let out = bare[..cut].trim();
    if out.is_empty() {
        None
    } else {
        Some(out.to_string())
    }
}

/// 只扫章节边界，**不返回正文**。
///
/// 为什么不放在前端切：Tauri 的 IPC 会把返回值 JSON 化，700 万字（约 21MB）
/// 的字符串转义之后更大 —— 前端为了切一次章，得先把这一大坨搬过去。
/// 这里用 BufReader 流式扫一遍，只回几百个小对象；正文按需用 read_slice 取。
pub fn outline(dir: &Path, file: &str) -> Result<DocOutline, String> {
    let name = safe_name(file)?;
    let f = std::fs::File::open(dir.join(&name)).map_err(|e| format!("打开失败: {e}"))?;
    let mut r = std::io::BufReader::new(f);
    let mut buf: Vec<u8> = Vec::new();
    let mut at: u64 = 0;
    let mut marks: Vec<ChapterMark> = Vec::new();

    loop {
        buf.clear();
        let n = std::io::BufRead::read_until(&mut r, b'\n', &mut buf)
            .map_err(|e| format!("读取失败: {e}"))?;
        if n == 0 {
            break;
        }
        // 只对短行做判断：正文段落动辄几百字，先按长度切掉绝大多数
        if buf.len() <= MAX_HEAD_BYTES {
            if let Ok(line) = std::str::from_utf8(&buf) {
                if let Some(title) = head_of_line(line) {
                    marks.push(ChapterMark {
                        title,
                        from: at,
                        to: 0,
                    });
                }
            }
        }
        at += n as u64;
    }

    for i in 0..marks.len() {
        marks[i].to = if i + 1 < marks.len() {
            marks[i + 1].from
        } else {
            at
        };
    }
    if marks.is_empty() {
        marks.push(ChapterMark {
            title: String::new(),
            from: 0,
            to: at,
        });
    }
    Ok(DocOutline { marks, bytes: at })
}

/// 只读 `[from, to)` 这一段。按章取正文用，一次最多几十 KB。
///
/// 切到半个字也不报错：截到最后一个完整字符为止 —— 调用方拿它去取标题，
/// 不该因为边界差几个字节就整个失败。
pub fn read_slice(dir: &Path, file: &str, from: u64, to: u64) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let name = safe_name(file)?;
    let mut f = std::fs::File::open(dir.join(&name)).map_err(|e| format!("打开失败: {e}"))?;
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let from = from.min(len);
    let to = to.clamp(from, len);
    f.seek(SeekFrom::Start(from)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; (to - from) as usize];
    f.read_exact(&mut buf).map_err(|e| format!("读取失败: {e}"))?;
    Ok(String::from_utf8(buf).unwrap_or_else(|e| {
        let n = e.utf8_error().valid_up_to();
        String::from_utf8_lossy(&e.into_bytes()[..n]).into_owned()
    }))
}

/// FNV-1a 32 —— 手写的，只为「这一章还是不是原来那一章」这一个判断。
///
/// 不是密码学哈希。它防的是**坐标错位**（原书前面被人插了几行，摘出去时记的
/// from/to 就全偏了，照原样覆盖会写错地方），不是防恶意构造。
fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in bytes {
        h ^= *b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// 把 `[from, to)` 这一段换成新正文 —— 「摘出来改」改完之后合并回原书用。
///
/// **整篇读、整篇写**：先把文件读进来、拼接、再整体写回。
/// 700 万字的原稿约 21MB，读+写大约一秒 —— 按一次「合并」等一下就好，
/// 换来的是不必处理「文件变长变短、后面的数据要挪」这类麻烦，
/// 也不会留一个「写到一半被打断、只剩半篇」的窗口。
///
/// `expect_digest` 是**摘走时那一段**的 FNV-1a 32，用来确认它没被动过。
/// 传 0 表示不校验。
///
/// ⚠️ 别拿「区间长度」当校验：`to - from` 和摘走时的长度是**恒等**的，
/// 比了等于没比 —— 原书在别处被改过时它照样通过，然后写到错的位置上去。
/// （这条是单元测试逼出来的，第一版就是这么写的。）
pub fn write_slice(
    dir: &Path,
    file: &str,
    from: u64,
    to: u64,
    text: &str,
    expect_digest: u32,
) -> Result<u64, String> {
    let name = safe_name(file)?;
    let path = dir.join(&name);
    let raw = std::fs::read(&path).map_err(|e| format!("读取失败: {e}"))?;
    let n = raw.len() as u64;
    if from > to || to > n {
        return Err(format!("区间越界：{from}..{to}，文件只有 {n} 字节"));
    }
    if expect_digest != 0 {
        let got = fnv1a32(&raw[from as usize..to as usize]);
        if got != expect_digest {
            return Err(format!(
                "这一章已经变过了（认出 {got:08x}，摘出去时是 {expect_digest:08x}）—— 先对一眼再合并"
            ));
        }
    }
    let mut out = Vec::with_capacity(raw.len() + text.len());
    out.extend_from_slice(&raw[..from as usize]);
    out.extend_from_slice(text.as_bytes());
    out.extend_from_slice(&raw[to as usize..]);
    std::fs::write(&path, &out).map_err(|e| format!("写入失败: {e}"))?;
    let _ = commit(
        dir,
        &format!("合并《{}》的一章", name.trim_end_matches(".md")),
    );
    Ok(out.len() as u64)
}

#[cfg(test)]
mod head_tests {
    use super::*;

    /**
     * 扒来的小说分节写法五花八门，只认「第X章」会让目录里只剩几个「第X卷」——
     * 主人报的「分卷的只识别出卷、章节没识别出来」就是这种。
     */
    #[test]
    fn recognizes_real_world_chapter_forms() {
        let yes = [
            "第一章 病人",
            "第 12 节 收尾",
            "第2卷 角斗场",
            "Chapter 4",
            "CHAPTER IV",
            "1.变成血族萝莉",
            "2、契约！",
            "12．标题",
            "楔子",
            "序章：萝变",
            "后记",
            "作者的话",
            "# 第三章 也是章的",
        ];
        for s in yes {
            assert!(head_of_line(s).is_some(), "这条该认出来：{s:?}");
        }

        let no = [
            "他说第一章很好看", // 不在行首
            "2012，2032，两者之间间隔了二十年之久。", // 中文逗号不是编号分隔符
            "1.5 倍于从前",     // 分隔符后紧跟数字
            "1.",               // 光一个编号，没标题
            "12345.编号太长了",
            "今天天气不错",
        ];
        for s in no {
            assert!(head_of_line(s).is_none(), "这条不该认：{s:?}");
        }
    }

    /** 元信息尾巴要裁掉，章名才干净 */
    #[test]
    fn strips_meta_tail() {
        assert_eq!(
            head_of_line("第一章 病人作者：某某").as_deref(),
            Some("第一章 病人")
        );
        assert_eq!(head_of_line("2、契约！").as_deref(), Some("2、契约！"));
    }
}

#[cfg(test)]
mod slice_tests {
    use super::*;

    /**
     * 合并回写是**破坏性**操作（直接改主人那本书），所以单独钉一遍：
     * ①只动指定的那一段，前后都得原样在；
     * ②新内容更长时文件要跟着变长，不能把后面的章挤没；
     * ③长度对不上（说明那一段已经变过）时必须**拒绝**，不能硬盖。
     */
    #[test]
    fn write_slice_only_touches_that_range() {
        let dir = std::env::temp_dir().join(format!("quill-slice-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = "book.md";
        let body = "第一章 甲\n甲甲甲\n第二章 乙\n乙乙乙\n第三章 丙\n丙丙丙\n";
        std::fs::write(dir.join(file), body).unwrap();

        let o = outline(&dir, file).unwrap();
        let seg = o
            .marks
            .iter()
            .find(|m| m.title.contains("第二章"))
            .expect("切章没切出第二章");
        let seg_from = seg.from;
        let seg_to = seg.to;
        let digest = fnv1a32(&std::fs::read(dir.join(file)).unwrap()[seg_from as usize..seg_to as usize]);

        // 换成更长的一段：文件要变长，第一章和第三章一个都不能少
        let n = write_slice(
            &dir,
            file,
            seg_from,
            seg_to,
            "第二章 乙\n改过了改过了改过了\n",
            digest,
        )
        .unwrap();
        let after = std::fs::read_to_string(dir.join(file)).unwrap();
        assert!(after.contains("第一章 甲"), "第一章被弄丢了：{after}");
        assert!(after.contains("第三章 丙"), "第三章被挤掉了：{after}");
        assert!(after.contains("改过了改过了"), "新内容没写进去：{after}");
        assert!(!after.contains("乙乙乙"), "旧内容还留着：{after}");
        assert_eq!(n as usize, after.len(), "返回的长度和文件实际长度对不上");

        // 拿**过期的摘要**再合一次：这一段已经换过内容了，必须拒绝。
        // 这正是「原书在别处被改过、坐标已经偏了」的模型 ——
        // 光比区间长度是拦不住的（from/to 没变，长度就没变）。
        let err = write_slice(&dir, file, seg_from, seg_to, "乱写", digest).unwrap_err();
        assert!(err.contains("已经变过"), "校验失败时的提示不对：{err}");

        // 摘出去时的那一章原样还在时，应当放行
        let dir2 = std::env::temp_dir().join(format!("quill-slice-test2-{}", std::process::id()));
        std::fs::create_dir_all(&dir2).unwrap();
        std::fs::write(dir2.join(file), body).unwrap();
        let o2 = outline(&dir2, file).unwrap();
        let s2 = o2.marks.iter().find(|m| m.title.contains("第二章")).unwrap();
        let d2 = fnv1a32(&std::fs::read(dir2.join(file)).unwrap()[s2.from as usize..s2.to as usize]);
        assert!(write_slice(&dir2, file, s2.from, s2.to, "第二章 乙\n新的\n", d2).is_ok());

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&dir2).ok();
    }
}
