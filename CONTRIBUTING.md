# 参与贡献

感谢你有兴趣改进 Quill。这个项目还在早期开发阶段（0.1.x），有任何想法都欢迎开 issue 聊。

## 开发环境

需要：

- Node.js 20+ 与 pnpm 10+
- Rust 工具链 + MSVC 生成工具（只有跑桌面版 / 打包才需要）

Windows 上一键装好 Rust + MSVC：

```powershell
# 以管理员身份运行
powershell -ExecutionPolicy Bypass -File ..\setup-tauri-env.ps1
```

## 起步

```powershell
pnpm install
pnpm dev          # 纯浏览器调试（http://localhost:5173）
pnpm tauri dev    # 桌面应用
```

纯前端改动用 `pnpm dev` 就够了，存储会自动退化成 IndexedDB；只有涉及文件系统、git、全局快捷键、窗口行为时才需要 `pnpm tauri dev`。

## 提交前请自查

```powershell
pnpm typecheck    # 类型检查必须过
pnpm build        # 构建必须过
node test-core.mjs  # 核心逻辑断言（Markdown 序列化等）
```

改动涉及编辑器 / 界面时，建议顺带跑一遍对应的验收脚本（需要先起 dev server）：

```powershell
node verify-browser.mjs    # 基础渲染
node verify-features.mjs   # 折叠 / 专注 / 搜索等
node verify-batch2.mjs     # 斜杠命令 / 模板 / 导图导出
node verify-batch3.mjs     # 拖拽 / 标签 / 回收站 / 热力图
```

它们用 CDP 驱动无头 Edge 跑真实 DOM 断言并截图到 `.verify/`，比人肉点点看靠谱。

## 代码约定

- **不要绕过存储抽象**：所有读写都走 `src/core/storage.ts` 的 `DocStorage` 接口，浏览器与桌面两套实现要同时能用。
- **Markdown 序列化与反序列化必须对称**：改 `core/markdown.ts` 就要同步改 `core/md-parse.ts`，并补 `test-core.mjs` 的断言。
- **折叠等 UI 状态不要写进文档数据**：ProseMirror 装饰器 + 事务位置映射是既定做法。
- **动效统一走 CSS 变量**（`--dur` / `--ease` / `--ease-out`），并确保 `prefers-reduced-motion` 下能降级。

## 提交信息

用中文或英文都行，一句话说清「改了什么、为什么」。例如：

```
修复导图跳转时光标落在 listItem 边界导致 TextSelection 报错
```

## 开源协议

贡献的代码将以 [MIT](LICENSE) 协议发布。
