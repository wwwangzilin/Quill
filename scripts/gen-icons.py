#!/usr/bin/env python3
"""
由 src-tauri/icons/icon-source.svg 生成 Tauri 全套应用图标（.ico / .icns / 各尺寸 png / iOS / Android）。

需要：Pillow（pip install pillow）与 playwright（用其自带 Chromium 把 SVG 栅格化）。
用法（仓库根目录）：  python scripts/gen-icons.py

输出覆盖 src-tauri/icons/ 下已有的同名文件，尺寸按现有文件为准，所以多一个少一个都不会漏。
这是 `pnpm tauri icon` 的等价实现：它只吃一张方图，没法分别处理 iOS（不透明）、
Android 自适应图标前景（只留羽毛、缩进安全区）这几种，所以这里自己分三张图出。
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
SRC = ICONS / "icon-source.svg"
BG_COLOR = "#1f6f78"  # Android 自适应图标的背景色


def rasterize(svg: str, size: int = 1024) -> Image.Image:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": size, "height": size})
        pg.set_content(f'<body style="margin:0;background:transparent">{svg}</body>')
        pg.screenshot(path="/tmp/_quill_icon.png", omit_background=True)
        b.close()
    return Image.open("/tmp/_quill_icon.png").convert("RGBA")


def variants(svg: str):
    rounded = svg
    # 方底：去掉圆角和描边，给 iOS（系统自己裁圆角，必须不透明）
    square = re.sub(r'rx="232"', 'rx="0"', svg)
    square = re.sub(r'<rect x="3" y="3"[^>]*/>', "", square)
    # 前景：去掉所有底（两个 rect），只留羽毛和墨迹，给 Android 自适应图标
    fg = re.sub(r"<rect [^>]*/>", "", svg)
    return rasterize(rounded), rasterize(square), rasterize(fg)


def resized(im: Image.Image, n: int) -> Image.Image:
    return im.resize((n, n), Image.LANCZOS)


def main() -> None:
    svg = SRC.read_text(encoding="utf-8")
    rounded, square, fg = variants(svg)

    for f in sorted(ICONS.rglob("*.png")):
        n = Image.open(f).size[0]
        rel = f.relative_to(ICONS).as_posix()
        if rel.startswith("ios/"):
            out = resized(square, n).convert("RGB").convert("RGBA")  # 不透明
        elif rel.startswith("android/") and f.name == "ic_launcher_foreground.png":
            # 自适应图标只有中间 66% 一定可见：把前景缩进去
            canvas = Image.new("RGBA", (n, n), (0, 0, 0, 0))
            inner = int(n * 0.62)
            canvas.alpha_composite(resized(fg, inner), ((n - inner) // 2, (n - inner) // 2))
            out = canvas
        elif rel.startswith("android/") and f.name == "ic_launcher_round.png":
            im = resized(square, n)
            mask = Image.new("L", (n * 4, n * 4), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, n * 4 - 1, n * 4 - 1), fill=255)
            im.putalpha(mask.resize((n, n), Image.LANCZOS))
            out = im
        else:
            out = resized(rounded, n)
        out.save(f)

    base = rounded
    base.save(ICONS / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    base.save(ICONS / "icon.icns")

    bg_xml = ICONS / "android" / "values" / "ic_launcher_background.xml"
    if bg_xml.exists():
        t = bg_xml.read_text(encoding="utf-8")
        bg_xml.write_text(re.sub(r"#[0-9a-fA-F]{6}", BG_COLOR, t), encoding="utf-8")
    print("图标已重新生成：", ICONS)


if __name__ == "__main__":
    sys.exit(main())
