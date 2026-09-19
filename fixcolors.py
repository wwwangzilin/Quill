# -*- coding: utf-8 -*-
"""把 Quill 里漏网的旧霓虹配色统一换成新的琥珀金体系。"""

import io


def patch(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    miss = []
    for a, b in pairs:
        if a not in s:
            miss.append(a[:70])
            continue
        s = s.replace(a, b)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    return miss


css = r'D:\projects\tool\quill\src\style.css'
css_pairs = [
    # 按钮 / 品牌点 / 分段控件的发光阴影
    ('box-shadow: 0 0 14px rgba(160, 107, 255, 0.55);', 'box-shadow: 0 0 14px rgba(203, 165, 107, 0.45);'),
    ('box-shadow: 0 4px 18px rgba(120, 110, 255, 0.32);', 'box-shadow: 0 4px 18px rgba(168, 132, 63, 0.36);'),
    ('box-shadow: 0 2px 12px rgba(120, 110, 255, 0.35);', 'box-shadow: 0 2px 12px rgba(168, 132, 63, 0.38);'),
    # 链接下划线
    ('text-decoration-color: rgba(77, 157, 255, 0.4);', 'text-decoration-color: rgba(138, 168, 155, 0.45);'),
    # 文本选中
    ('background: rgba(160, 107, 255, 0.3);', 'background: rgba(203, 165, 107, 0.3);'),
    # Toast 边框
    ('border-color: rgba(255, 107, 203, 0.45);', 'border-color: rgba(192, 122, 99, 0.5);'),
    ('border-color: rgba(77, 200, 130, 0.35);', 'border-color: rgba(125, 155, 138, 0.4);'),
    # 拖拽落点线的发光
    ('box-shadow: 0 0 14px rgba(160, 107, 255, 0.75);', 'box-shadow: 0 0 14px rgba(203, 165, 107, 0.7);'),
]

mm = r'D:\projects\tool\quill\src\ui\MindMap.tsx'
mm_pairs = [
    # 导图根节点描边
    ('.mm-node.root .box { stroke: #a06bff; stroke-width: 1.6; }',
     '.mm-node.root .box { stroke: #cba56b; stroke-width: 1.6; }'),
    # 导出图片的背景色
    ("bg.setAttribute('fill', dark ? '#0b0b0f' : '#fbfbfa')",
     "bg.setAttribute('fill', dark ? '#0f0e0d' : '#faf7f2')"),
    # 导出图片里内联的节点/连线样式
    ("fill: ${dark ? '#eaeaf2' : '#1c1c22'}", "fill: ${dark ? '#e8e4dc' : '#221f1b'}"),
    ("fill: ${dark ? '#15151c' : '#ffffff'}", "fill: ${dark ? '#171614' : '#fffdf9'}"),
    ("rgba(140,140,180,0.45)", "rgba(180,170,155,0.4)"),
    ("rgba(90,90,120,0.5)", "rgba(120,112,100,0.5)"),
    # 渐变改成单色金（三个 stop 收成两个）
    ('<stop offset="0%" stopColor="#a06bff" />', '<stop offset="0%" stopColor="#d3ae74" />'),
    ('<stop offset="55%" stopColor="#4d9dff" />', '<stop offset="100%" stopColor="#a8843f" />'),
    ('<stop offset="100%" stopColor="#ff6bcb" />', ''),
]

for path, pairs in ((css, css_pairs), (mm, mm_pairs)):
    miss = patch(path, pairs)
    name = path.split('\\')[-1]
    if miss:
        print('MISS %s: %s' % (name, ' | '.join(miss)))
    else:
        print('OK   %s  (%d 处)' % (name, len(pairs)))
