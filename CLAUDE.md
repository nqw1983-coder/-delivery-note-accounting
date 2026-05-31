# 送货单记账简化版 — 项目说明

## 识别字典持久化规则（强制）

本项目的 OCR 识别准确率依赖**两层字典**：

| 层 | 位置 | 角色 | 易失性 |
|---|---|---|---|
| **硬层（项目内置）** | [src/data/shopMemory.ts](src/data/shopMemory.ts) | 已审核过的标准映射，跟随代码 commit 永久保存 | 永久 |
| **软层（浏览器增量）** | `localStorage["delivery-ocr-settings"]` | 用户在弹窗里手动改的最新学习 | 清缓存 / 换浏览器 即失 |

App 启动时，[loadOcrSettings()](src/lib/ocr.ts) 自动合并两层（软层覆盖硬层）。

### 何时把"软层"提升到"硬层"？

下列任何一种情况，必须把字典提升到 `shopMemory.ts`：

- 用户在 App 里学到了超过 10 条新映射
- 用户准备清理浏览器缓存
- 切换设备 / 浏览器之前
- 项目准备 git push 共享给团队

### 怎么提升？

1. 在 App 里点齿轮 → "**导出字典**" 按钮
2. 自动复制 TypeScript 代码到剪贴板
3. 粘贴覆盖 [src/data/shopMemory.ts](src/data/shopMemory.ts) 里的 `BUILT_IN_KNOWN_SHOPS` 和 `BUILT_IN_SHOP_ALIASES` 两个常量
4. `git commit` 持久化

### AI Agent 操作准则（强制）

- 任何对 `BUILT_IN_KNOWN_SHOPS` 或 `BUILT_IN_SHOP_ALIASES` 的修改**必须**同时更新 [src/data/shopMemory.ts](src/data/shopMemory.ts) 文件
- 修改前必须 Read 当前内容，避免覆盖已有映射
- **不能**反向把 `shopMemory.ts` 设为空——这等于擦除用户长期积累的记忆
- 添加新客户/映射时，**保持现有所有条目**，只追加不删除
- 用户每次告诉 AI "这家是 XXX" 时，AI 应当：
  1. 在 `shopMemory.ts` 增加 `识别值: 真实店名` 这条 alias
  2. 把"真实店名"补进 `BUILT_IN_KNOWN_SHOPS`（如未存在）

### 歧义防控

- 不要建立 `白名单中的店名 → 另一个白名单中的店名` 的 alias（例如 `万杨 → 万醉`），这会破坏对真正"万杨"的识别
- 这类歧义只能在 ScanModal 弹窗里手动处理

## 运行

```bash
npm run dev    # 启动开发服务器（带 vite 代理，绕开浏览器扩展拦截 Authorization 头）
npm run build  # 生产构建
```

详细架构和已踩过的坑见 `~/.claude/CLAUDE.md` 里的"故障排查铁律"。

## 关键技术细节

- **代理转发**：[vite.config.ts](vite.config.ts) 把浏览器的 `x-dashscope-auth` 头改写成 `Authorization` 转发给阿里云，规避浏览器扩展拦截
- **三层 OCR 增强**：①白名单注入 prompt ②识别后字典替换 ③拼音/字形模糊匹配
- **预识别 + 缓存**：[App.tsx](src/App.tsx) 的 `prerecognizeBatch` 用 3 路并发，结果按 index 缓存到 `batchResults`
- **图片预处理**：长边 ≤1280 + JPEG 92%（在 [src/lib/ocr.ts](src/lib/ocr.ts) 的 `preprocessImage`）
