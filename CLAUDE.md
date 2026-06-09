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
- **全平台手机 UI(2026-06-05 起)**:`src/lib/useMobile.ts` 的 `useMobile()` 现**恒返回 true**,iPhone / iPad / Mac 桌面**一律使用手机版(双屏/多屏)界面**。桌面 2D 表格 `MonthTable` 代码保留(导出、`shopPayment` 仍引用其工具函数),但**不再作为运行界面**。`isAppleTouchDevice()` / `matchMedia` 逻辑保留,供日后按需恢复分流。
  - **全端共享同一份 React state + Supabase 数据**,一端录另一端同步看到
- **店铺名单(2026-06-05 起)**:12 家有名 + 1 空白 = 13。顺序:万醉 / 万杨 / **万李二** / 吾湘 / 吾黄 / 吾醉 / 萍姐 / 柳 / 保黄 / 保4楼 / 五洲 / 至尊。旧月份缺"万李二"时,`dashboardStore.ts` 的 `normalizeMonthStores()` 启动自动补齐。
- **桌面 2D 表格(保留未启用)**:`MonthTable` 固定 13 列(12 家有名 + 1 空白),行高 22px,31 天 + 顶部表头 + 重复表头 + 本月合计 一屏完整
- **iPhone/iPad 多屏**:
  - 第一屏 `MobileMonthList`:最多 12 个月份卡片(年月/已同步/¥金额),底部固定"待补单据"橙黄横条
  - 第二屏 `MobileDayDetail`:左右箭头切日期,12 家店 + 1 空白,每行"店名(右对齐)+ 金额框(84px,够 5 位)+ 🎤"三件一组**整体居中**(2026-06-05 布局调整)
- **中文数字自动转换**:iOS 听写"二百三十八" → 238,通过 `extractAmount()` 在 handleMonthCellChange 兜底
- **手动云同步按钮(全平台)**:`handleManualSync()` 触发 `flushPendingSync()` + `fetchDeliveries()` + `mergeCloudDeliveries`,适合用户在 iPad/iPhone 都开着时,在一端录完点同步按钮立即让另一端拉到最新
- **手机版日期选择器**:`<label>` 包 `<input type="date">` + 透明覆盖,iOS 原生触发 picker,不依赖 `showPicker()`
- **手机当日明细页 3 个视图分层**:
  - 顶部:返回 + **同步按钮** + 12 个店铺按钮(2×6 网格)
  - 中间:日期切换卡(箭头 + 大日历按钮 44×44)
  - 下方:12 家店铺录入行 + 1 空白
- **手机店铺月度明细页**(`MobileStoreMonthDetail`):点顶部店铺名跳转;顶部左侧返回 + **同步按钮**,店名右侧 **"核算确认"按钮(确认后显示 🌹,再点取消;状态存 `localStorage["delivery-store-reconcile-v1"]`)**;顶部绿色卡显示本月合计 + 有送货天数;2 列网格 31 天,**每天金额改为可直接编辑的输入框**——改某天即走 `handleMonthCellChange` **回写真实 cell + 云端**,当日明细页同步更新(老板每月在此核对送货单,发现错直接改);点"X日"标签仍可跳回当日明细
- **店铺收款确认金额可改(2026-06-05)**:`ShopPaymentModal` 点单元格弹窗里多了"金额(可修改)"输入框,改 `edits[amountKey]`(覆盖层,存 `localStorage["delivery-shop-payment-edits-v1"]`);默认仍按每月数据自动生成,不改就用自动值。**注意**:这是收款确认的覆盖层,不回写 deliveries;要回写真实送货数据请用上面的"店铺本月明细"可编辑表格
- **各页同步按钮(2026-06-05)**:当日明细 / 店铺本月明细 / 店铺收款确认 三页左上角都加了"同步"按钮(= `handleManualSync`),首页本就有不重复加

### OCR(辅助,不主用)
- 默认模型 `qwen-vl-ocr-latest`(OCR 专项,~1.7s)
- 图片预处理:长边 1024px + JPEG 88%(从最初 1280px/92% 优化)
- 客户端用原生 `fetch` 调 Supabase Edge Function `ocr-proxy`(**不用** `supabase.functions.invoke` — 该库在新版 publishable key 下有 fetch 包装 bug)
- 三层 OCR 增强:白名单注入 prompt / 字典替换 / 拼音字形模糊匹配

### Supabase
- URL: `https://zaqeboyaltepwpavmvkf.supabase.co`
- Publishable key 在客户端环境变量(可公开),service_role 严禁出现
- Edge Function 部署用 `--no-verify-jwt`(新版 `sb_publishable_*` 不被默认 JWT 网关接受)
- 四张表:`deliveries`(主) / `shop_aliases` / `known_shops` / `payment_state`(收款确认+核算确认跨设备同步,2026-06-08 新增)
- `payment_state` 结构:`key text primary key, value text, updated_at timestamptz`。key 前缀 `pe:`=收款确认编辑(店名/金额/付款)、`rc:`=核算确认。RLS 开放策略 `for all using(true) with check(true)` + grant anon

### 认证
- SHA-256 密码门,`src/lib/auth.ts`
- 改密码:`node scripts/hash-password.js <新密码>` → 哈希粘到 `PASSWORD_HASH`

## 近期变更(2026-06-05 ~ 06-08)

1. **新增店铺"万李二"**(在"万杨"下面),全端 12 家有名 + 1 空白 = 13。改了 `src/data/seedData.ts`;`dashboardStore.ts` 加 `normalizeMonthStores()` 给旧月份自动补"万李二";`MonthTable.tsx` / `exporter.ts` 的 `MAX_LABELED_STORES` 11→12(桌面表/导出同步)。
2. **全平台改用手机 UI**:`useMobile()` 恒 true,iPad / Mac 桌面都走 iPhone 那套多屏界面,桌面 2D 表格停用(代码保留)。
3. **当日明细行居中布局**:店名右对齐(`flex:0 0 68px`)+ 金额框 84px(够 5 位)+ 🎤 紧挨,三件一组整体居中。
4. **店铺收款确认金额可手动改**:`ShopPaymentModal` 单元格弹窗加"金额(可修改)"输入框(覆盖层,不回写 deliveries)。
5. **店铺本月明细(图1)按天表格可编辑 + 回写**:每天金额改为输入框,改→`handleMonthCellChange` 回写真实 cell + 云端 + 当日明细;店名右侧加"核算确认"按钮(🌹,本地存储);左上加同步按钮。
6. **三页加同步按钮**:当日明细 / 店铺本月明细 / 店铺收款确认。
7. **每周本机 Excel 备份提醒(06-08)**:启动时检查 `localStorage["delivery-local-excel-backup-v1"]`,距上次本机保存超 7 天(或从没存过)则在首页弹"每周本机备份"弹窗;点「立即保存」**在手势内** `exportExcel(months)` 下载全月 Excel(带日期时分名,不覆盖)+ 记下今天;点「稍后」本次启动不再弹。⚠️ iOS Safari 只允许手势内触发下载,所以导出必须由按钮点击直接触发,不能放在 await 之后。**改成每周提醒之前曾短暂做过"每次同步都自动导出",已撤销。**
8. **店铺收款确认空白行可用(06-08,无需改代码,本就支持)**:`ShopPaymentModal` 20 行 = 12 家有名 + 8 空白。空白行最左"店铺"格是可编辑输入(`payment-name-input`,手动填店名);空白行任意月份格点开即弹"金额(可修改)+ 付款/未付款"弹窗(整格 `width/height:100%` 可点)。
9. **店铺收款确认 / 核算确认跨设备同步(06-08,改了 Supabase)**:新增 `payment_state` 表,收款确认编辑(店名/金额/付款)与核算确认 🌹 实时上云 + 拉取合并,iPhone/iPad/云端三方一致。**⚠️ 之前"收款确认只存本地、不跨设备"的说法已作废。**
   - **(06-08 修复间歇性不同步)** 根因有 5 个:①合并是"云端永远覆盖本地",失败/未上传的本地编辑会被旧云端值回退 ②没时间戳无法 last-write-wins ③upsert 失败静默不重传 ④去抖 timer 切后台丢失 ⑤**只有启动/手点才拉云端,iOS PWA 后台切回不 remount → 不自动拉**。
   - 修法:`payment_state` 加 `updated_at`,本地存每键时间戳(`delivery-payment-ts-v1`),`syncPaymentState` 改为**逐键 last-write-wins**(`new Date(ts).getTime()` 比较):本地新→推上去(自动重传失败的)、云端新→拉下来,**彻底防回退防丢失**;用 `peRef/rcRef/tsRef` 避免闭包过期。
   - 新增 **`visibilitychange` + `focus` 自动同步**:App 切回前台即静默拉取 payment_state + deliveries,**不用手点同步**。
   - **(06-08 再补:前台 8 秒轮询)** 用户场景是"两台都开着摆一起、改 A 盯 B 等它自己变"——只靠 visibilitychange 不够(两台都一直前台,不触发)。加 `setInterval(autoPull, 8000)`:前台时每 8 秒静默拉一次 payment_state + deliveries,**两台都开着也能在 ~8 秒内自动同步**。`autoPull` 有保护:页面隐藏 / 焦点在输入框时本轮跳过(不打断打字)。
10. 本地存储 key:`delivery-store-reconcile-v1`(核算确认)、`delivery-shop-payment-edits-v1`(收款确认覆盖)、`delivery-local-excel-backup-v1`(上次本机 Excel 备份日期)。前两者现**同时镜像到云端 `payment_state`**;第三个仅本地。
11. ⚠️ 验证教训:headless 写测试与线上**共用同一 Supabase**,误写会污染真实 `deliveries`(曾误写 2026-05-05 万醉 777)。写入类验证只用空数据/测试日期,测完按用户许可清理。另:测 React 交互点击后必须 `sleep` 等重渲染再断言;逐字符 onChange 直接上云会竞态(`13579` 曾被中间态 `1357` 覆盖)→ 用去抖。

## 已踩过的坑(血泪记忆)

1. **OCR 接入 401 鬼故事**(2026-05):一个 `invalid_api_key` 对应三个独立根因(模型未授权 / 代理头被改 / 浏览器扩展拦截)。教训:别信错误码字面意思,控制变量对照
2. **iPhone OCR 6-7 秒**(2026-05):跨境延迟 + qwen-vl-max 推理慢。换 qwen-vl-ocr-latest 后降到 ~1.7s curl
3. **supabase.functions.invoke 假性失败**(2026-06):新版 sb_publishable key 在 supabase-js 库内部 fetch 包装层失败,但不抛出真实错误。改用原生 fetch 直接命中 Edge Function
4. **Service Worker 缓存毒瘤**(2026-06):用户多次报"还看到旧版本"。修复:`skipWaiting + clientsClaim`,无痕窗口 / fresh profile 测试
5. **测试图 1×1 像素阿里云 400**:OCR 模型要求 ≥ 10×10,curl smoke test 用 100×100 灰图
6. **Cloudflare 部署 commit message 非 UTF-8**:中文 git commit message 让 wrangler 报 `Invalid commit message`。用 `--commit-message="english"` 显式传
7. **iOS 听写中文 vs 阿拉伯**:iPhone 数字键盘 **没** 麦克风,iPad 数字键盘 **有**;iPad 听写出"二百三十八"中文字符,App 不转换 = NaN = "金额错误"。修复:`extractAmount()` 函数兜底所有中文/口语写法(2026-06-02)
8. **macOS TCC 锁 Documents 子目录**:大量文件操作可能让 Claude Code 的 Terminal/sandbox 失去访问权,表现为 `ls Operation not permitted`。修复:重启 Terminal 即可恢复
9. **GitHub Actions workflow_dispatch 在 inline heredoc 里失效**:把 Node 脚本嵌进 YAML 的 heredoc 让 trigger 解析失败。修复:提到独立 `scripts/*.mjs` 文件

## 自动化定时任务(GitHub Actions)

| 任务 | 时间 | 作用 | 文件 |
|---|---|---|---|
| **Keep Alive** | 每天 18:00 北京 | ping Supabase REST + Edge Function,防免费版 7 天暂停 | `.github/workflows/keep-alive.yml` |
| **Daily Backup** | 每天 18:05 北京 | 拉 Supabase 数据 → 二维表 CSV(每月一个) + JSON 快照 → 提交到 `backups/` | `.github/workflows/daily-backup.yml` + `scripts/daily-backup.mjs` |

两个任务完全跟 Claude / 本地电脑无关,GitHub 长期免费跑。手动触发:`gh workflow run "<name>" --ref master`

## 不能做的事

- 把 `shopMemory.ts` 已有条目改/删 — 这是用户长期积累
- 把 OCR / 语音 / 扫描重新塞回主流程(用户已要求删)
- 在 sidebar 加新入口
- 表格里加新列(已固定 13 列 = 12 家有名 + 1 空白)
- 删除/改名已有店铺(只能像"万李二"那样追加)
- 在 git 提交中暴露任何 Key / 凭据(.env.local 已 gitignore)

## ⚠️⚠️ 头号血泪(2026-06-09,反复犯,必须每次过):"我说改好了,用户看还是旧的"

> 背景:连续多轮,我每次都宣布"已部署/实测通过",用户在真机上却看到**老样子**,反复折腾、信任崩塌。

**根因有两个,缺一不可补齐:**

1. **headless ≠ 真机 iOS。** 我用无头 Chrome(iPhone UA)跑通 ≠ 用户 iPad/iPhone Safari/PWA 跑通。headless 测的是逻辑,**证明不了 iOS 的 Service Worker 缓存、PWA 后台恢复、无痕模式、原生下载弹窗等行为**。不能拿 headless 通过当"真机已修复"。
2. **Service Worker 缓存毒瘤(头号元凶)。** PWA 把旧 bundle 缓存在手机上,部署后用户那台**仍在跑旧代码**——所以"我说改了,他看没变"。每次都要先排除这个,而不是去改逻辑。

**真实案例(2026-06-09,headless 骗了我整整一轮):** 店铺收款确认**空白格手机上点不动、不弹键盘**。我用 headless `el.click()` 测一直"通过",但真机手指点没反应。根因:空单元格按钮 `height:100%` 在自动高度的格子里**塌成 0 高度**,**手指没有可点区域**;而 `el.click()` 对 0 尺寸元素也能触发,所以 headless 测不出来。修复:`.payment-cell-button` / `.payment-name-input` 加 `min-height:42px`。**教训:测"能不能点"必须用真实坐标点击(`page.mouse.click(x,y)` + `elementFromPoint`)验证有真实可点区域,不能用 `el.click()`。**

**强制流程(每次涉及"线上改动 + 用户验证"必做):**
- **首页底部有"版本 MMDD-HHMM"号(`__BUILD_ID__`,见 vite.config.ts)。** 部署后:① 我用 headless 读线上版本号确认部署成功;② **让用户报首页版本号**。
- 用户版本号 == 我刚部署的 → 他在跑新代码,这时再谈功能对不对。
- 用户版本号 != 最新 / 还是旧的 → **是缓存问题,不是功能问题**。让用户彻底杀进程重开 / 无痕窗口验证,别再瞎改逻辑。
- **永远不要在没拿到"用户侧版本号匹配"之前说"已修复"。** 说"已部署版本 X,请你核对首页版本号是否为 X"。
- 写测试代码点击交互:点击后必须 `sleep` 等 React 重渲染再断言(同 tick 读取会假性失败,已踩多次)。

---

## 故障排查铁律(沿用全局 ~/.claude/CLAUDE.md 总则)

1. **报错先复现** — 不复现不下结论
2. **不信错误码字面意思** — 用对照实验定位
3. **能自己测就别让用户测** — headless puppeteer / curl 自验(但 headless 通过 ≠ 真机通过,见上方头号血泪)
4. **控制变量** — 多个可疑因素并存时,固定其它只动一个
5. **不过早宣布胜利** — 修复后必须真实环境端到端验证;线上改动**必须拿到用户侧版本号匹配**才算数
6. **第一时间质疑架构** — 浏览器直连第三方 API + 携带密钥 = 高风险信号
7. **缓存优先排查** — 用户报"还是旧的",先查版本号/SW 缓存,再查代码逻辑
