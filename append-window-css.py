# -*- coding: utf-8 -*-
"""给 Quill 追加独立小窗口（快捷便签 / 桌面磁贴）的样式。"""

import io

PATH = r'D:\projects\tool\quill\src\style.css'

CSS = u'''

/* ==========================================================================
   独立小窗口：快捷便签 / 桌面磁贴
   ========================================================================== */

.qn-root,
.sticky-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-solid);
  color: var(--text);
  overflow: hidden;
}

.qn-bar,
.sticky-bar {
  flex: 0 0 auto;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  user-select: none;
}
.qn-bar .grow,
.sticky-bar .grow {
  flex: 1;
  height: 100%;
}
.qn-title,
.sticky-title {
  font-size: 12px;
  color: var(--text-2);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 190px;
}
.qn-x,
.sticky-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.qn-x:hover,
.sticky-btn:hover {
  background: var(--surface-active);
  color: var(--text);
}

.qn-input {
  flex: 1;
  min-height: 0;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14.5px;
  line-height: 1.85;
  padding: 14px 16px;
}
.qn-input::placeholder {
  color: var(--text-3);
}

.qn-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
}
.qn-hint {
  flex: 1;
  font-size: 10.5px;
  color: var(--text-3);
}

.qn-recent {
  flex: 0 0 auto;
  max-height: 188px;
  overflow-y: auto;
  border-top: 1px solid var(--border);
  padding: 8px 10px 10px;
}
.qn-recent-title {
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 6px;
}
.qn-item {
  font-size: 12px;
  color: var(--text-2);
  padding: 5px 7px;
  border-radius: 6px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.qn-item:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.sticky-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 18px;
}
.sticky-text {
  margin: 0;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.85;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
}
.sticky-empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}
'''

s = io.open(PATH, encoding='utf-8').read()
if '.qn-root' in s:
    print('SKIP  已经追加过了')
else:
    io.open(PATH, 'a', encoding='utf-8', newline='\n').write(CSS)
    print('OK    style.css 追加 %d 字符' % len(CSS))
