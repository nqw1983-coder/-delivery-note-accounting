# 送货单记账简化版 — 项目说明

**线上地址:** https://delivery-note.pages.dev
**默认密码:** `niequanwei1983`(在 `src/lib/auth.ts` 的 `PASSWORD_HASH` 修改)

## 当前架构(2026-06)

```
小白用户 iPad/iPhone
   ↓ Safari + 加到主屏
https://delivery-note.pages.dev      ← Cloudflare Pages CDN
   ↓ 密码门 (SHA-256)
React + Vite SPA
   ↓ 写入 / 读取
Supabase Postgres (Singapore)        ← 主存储
   + Edge Function ocr-proxy          ← OCR 代理(Key 在服务端)
                ↓
       阿里云 qwen-vl-ocr-latest      ← 备用 OCR(辅助,不是主流程)
```

## 主流程(2026-06,核心变更)

**已不再以 OCR 扫描为主**,改为:

1. 用户进 iPad → 输密码登录 → 自动跳到当月表格
2. 点表格里某个格子(日期 × 客户)→ 弹 iOS 数字键盘
3. 直接输入金额 → 失焦/回车 → 立刻写本地 + 后台异步上云
4. 想看其他月份 → 左侧列表点

OCR 代码完整保留,作为辅助;用户在设置弹窗里仍可触发。

## 识别字典持久化规则(强制,辅助 OCR 流程用)

| 层 | 位置 | 角色 | 易失性 |
|---|---|---|---|
| **硬层(项目内置)** | [src/data/shopMemory.ts](src/data/shopMemory.ts) | 已审核标准映射,git commit 永久保存 | 永久 |
| **软层(浏览器增量)** | `localStorage["delivery-ocr-settings"]` | 用户最新学习 | 清缓存即失 |
| **云端层** | Supabase `shop_aliases` / `known_shops` 表 | 跨设备共享 | 永久 |

启动时三层合并(`src/App.tsx` 的 `syncCloudDictionary` + `loadOcrSettings`)。

### AI Agent 操作准则(强制)

- 任何对 `BUILT_IN_KNOWN_SHOPS` / `BUILT_IN_SHOP_ALIASES` 的修改**必须**同时更新 [src/data/shopMemory.ts](src/data/shopMemory.ts)
- 修改前必须 Read 当前内容,避免覆盖
- **不能**反向把 `shopMemory.ts` 设为空
- 只追加不删除
- 不要建立 `白名单店名 → 另一个白名单店名` 的 alias(会破坏正常识别)

## 运行

```bash
npm run dev      # 本地开发(vite,带阿里云代理)
npm run build    # 生产构建
npm run preview  # 本地预览生产构建
```

## 部署到 Cloudflare Pages

```bash
export CLOUDFLARE_API_TOKEN="<你的 token>"
npx wrangler pages deploy dist \
  --project-name=delivery-note --branch=master --commit-dirty=true \
  --commit-message="<msg>"
```

详细见 [docs/DEPLOY.md](docs/DEPLOY.md)

## 关键技术细节

### 前端
- **React 18 + Vite 6 + TypeScript**,SPA 单页
- **PWA**:`vite-plugin-pwa` autoUpdate + skipWaiting + clientsClaim(SW 立即接管,避免缓存毒瘤)
- **Offline-First**:写本地立即,后台异步上云,失败入 `localStorage["pending_sync"]` 队列
- **侧栏 148px**(iPad 横屏紧凑布局),图标横排在标题下方
- **表格固定 13 列**:11 家有名客户 + 2 空白预留,iPad 横屏一屏布满

### OCR(辅助,不主用)
- 默认模型 `qwen-vl-ocr-latest`(OCR 专项,~1.7s)
- 图片预处理:长边 1024px + JPEG 88%(从最初 1280px/92% 优化)
- 客户端用原生 `fetch` 调 Supabase Edge Function `ocr-proxy`(**不用** `supabase.functions.invoke` — 该库在新版 publishable key 下有 fetch 包装 bug)
- 三层 OCR 增强:白名单注入 prompt / 字典替换 / 拼音字形模糊匹配

### Supabase
- URL: `https://zaqeboyaltepwpavmvkf.supabase.co`
- Publishable key 在客户端环境变量(可公开),service_role 严禁出现
- Edge Function 部署用 `--no-verify-jwt`(新版 `sb_publishable_*` 不被默认 JWT 网关接受)
- 三张表:`deliveries`(主) / `shop_aliases` / `known_shops`

### 认证
- SHA-256 密码门,`src/lib/auth.ts`
- 改密码:`node scripts/hash-password.js <新密码>` → 哈希粘到 `PASSWORD_HASH`

## 已踩过的坑(血泪记忆)

1. **OCR 接入 401 鬼故事**(2026-05):一个 `invalid_api_key` 对应三个独立根因(模型未授权 / 代理头被改 / 浏览器扩展拦截)。教训:别信错误码字面意思,控制变量对照
2. **iPhone OCR 6-7 秒**(2026-05):跨境延迟 + qwen-vl-max 推理慢。换 qwen-vl-ocr-latest 后降到 ~1.7s curl
3. **supabase.functions.invoke 假性失败**(2026-06):新版 sb_publishable key 在 supabase-js 库内部 fetch 包装层失败,但不抛出真实错误。改用原生 fetch 直接命中 Edge Function
4. **Service Worker 缓存毒瘤**(2026-06):用户多次报"还看到旧版本"。修复:`skipWaiting + clientsClaim`,无痕窗口 / fresh profile 测试
5. **测试图 1×1 像素阿里云 400**:OCR 模型要求 ≥ 10×10,curl smoke test 用 100×100 灰图
6. **Cloudflare 部署 commit message 非 UTF-8**:中文 git commit message 让 wrangler 报 `Invalid commit message`。用 `--commit-message="english"` 显式传

## 不能做的事

- 把 `shopMemory.ts` 已有条目改/删 — 这是用户长期积累
- 把 OCR / 语音 / 扫描重新塞回主流程(用户已要求删)
- 在 sidebar 加新入口
- 表格里加新列(已固定 13 列)
- 在 git 提交中暴露任何 Key / 凭据(.env.local 已 gitignore)

## 故障排查铁律(沿用全局 ~/.claude/CLAUDE.md 总则)

1. **报错先复现** — 不复现不下结论
2. **不信错误码字面意思** — 用对照实验定位
3. **能自己测就别让用户测** — headless puppeteer / curl 自验
4. **控制变量** — 多个可疑因素并存时,固定其它只动一个
5. **不过早宣布胜利** — 修复后必须真实环境端到端验证
6. **第一时间质疑架构** — 浏览器直连第三方 API + 携带密钥 = 高风险信号
