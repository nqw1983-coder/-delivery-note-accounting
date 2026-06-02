# 水果店手写送货单记账项目 Agent 规则

## 项目目标

服务水果店老板,在 iPad / iPhone / 桌面浏览器上录入和查看每月每家客户的送货金额。

**线上地址:** https://delivery-note.pages.dev

第一阶段已完成网页版,部署在 Cloudflare Pages,数据存 Supabase Postgres。
后续如有需要,再考虑微信小程序 / 苹果原生 / 安卓原生。

## 核心原则(2026-06 版,已根据用户实际使用调整)

1. **主流程是手动录入**(点表格格子直接输入金额)。OCR 扫描保留为辅助能力,但 UI 上不再作为主要入口。
2. 表格按"客户 × 日期"二维呈现,一屏看完整月。
3. 输入即保存:点格子 → 输数字 → 失焦自动写入本地 + 异步上云。
4. 修改/清空都不弹确认,直接执行(用户明确要求)。
5. 替换非零金额、新增客户仍弹一次确认,防误操作。
6. 不显示侧栏月份金额,不显示当日合计列,避免视觉噪声。
7. 表格固定 11 家有名客户 + 2 空白预留列 = 13 列,在 iPad 横屏一屏全显示无横向滚动。
8. iPad/iPhone 是主目标平台,Mac 桌面是次要(管理/查看)。

## 当前页面结构(2026-06)

```
┌────────┬───────────────────────────────────────────────┐
│ 送货单 │ 2026年5月    已同步云端数据                  │
│ 记账   │ ┌──┬────┬────┬────┬...┬──┬──┐                │
│ ⚙ ⬇ +  │ │日期│万醉│万杨│吾湘│...│空白│空白│           │
│        │ │1日 │ 0 │ 0 │ 0 │   │   │   │                │
│ [2026] │ │... │  ...  ...  ...                         │
│ 收款   │ │31日│ 0 │ 0 │ 0 │   │   │   │                │
│ [搜索] │ │本月│313│134│...                              │
│ 5月    │                                                │
│ 4月    │                                                │
│ 3月    │                                                │
│ ...    │                                                │
└────────┴───────────────────────────────────────────────┘
   148px              ~960px (iPad 10.5 横屏)
```

### 侧栏(左)— 148px 窄列

- 标题"送货单记账"(22px 字号,一行显示)
- 3 个图标横排:**⚙ 设置 / ⬇ 导出 / + 加月份**(柱状统计图标已删,扫描按钮已删)
- 年份下拉
- 店铺收款确认入口
- 搜索月份
- 12 行月份列表(纯文字"2026年X月",不显示金额)

### 主区(右)

- 标题"YYYY年M月"+ 同步状态文字(同一行,右侧)
- 表格结构(iPad 横屏一屏完整布满):
  - **顶部表头行**(浅灰底):日期 | 万醉 | 万杨 | ... | 至尊 | (空白×2) | 当日合计
  - **31 天数据行**(白色背景,偶数行浅灰)
  - **重复表头行**(浅绿底,加重字体)— 让最后几天(28-31日)能直接对照客户列,不用滚回顶部
  - **本月合计行**(深绿字)
- 每格 22px 高,字号 12px,表头行 26px 高
- 首列(日期)42px 宽,客户列等分剩余宽度

## 数据架构

| 层 | 位置 |
|---|---|
| 主存储 | Supabase Postgres(`deliveries` / `shop_aliases` / `known_shops` 三张表) |
| 本地缓存 | `localStorage` Offline-First,启动时合并 |
| 待同步队列 | `localStorage["pending_sync"]` 网络恢复自动补传 |
| 字典硬层 | [src/data/shopMemory.ts](src/data/shopMemory.ts) — git 永久保存 |
| 字典软层 | localStorage + Supabase `shop_aliases` 表 |

## OCR(辅助功能,不再是主路径)

虽然 OCR 不是主流程,但代码仍保留,且经过强化:

- 通过 Supabase Edge Function 代理(`supabase/functions/ocr-proxy/`),API Key 在服务端
- 默认模型 `qwen-vl-ocr-latest`(OCR 专项,~1.7s)
- 图片预处理:长边 ≤ 1024px,JPEG 88%
- 三层增强保留:白名单 prompt 注入 / 字典替换 / 拼音字形模糊匹配
- 用户在设置里仍可切换 qwen3-vl-plus / qwen-vl-max / qwen-vl-plus

## 认证

- 简单 SHA-256 密码门(`src/lib/auth.ts`),`PASSWORD_HASH` 常量
- 默认密码哈希对应 "niequanwei1983"
- sessionStorage 短期 + localStorage 30 天免输
- `?admin=1` 进入管理员模式(JSON 反向恢复入口)

## 部署

```bash
npm run build
npx wrangler pages deploy dist \
  --project-name=delivery-note \
  --branch=master \
  --commit-dirty=true \
  --commit-message="<message>"
```

环境变量(Cloudflare Pages 后台):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `NODE_VERSION=20`

OCR Edge Function 环境变量(Supabase Dashboard):
- `ALIYUN_DASHSCOPE_KEY`
- `PRIMARY_PROVIDER=aliyun`(可选,默认就是 aliyun)
- `TENCENT_SECRET_ID/KEY`(可选 fallback)

## 安全边界

涉及以下操作时,必须先提醒用户确认:

1. 强制推送代码 / 删 git 历史
2. 修改 Supabase schema(加列/删列/改类型)
3. 修改 `shopMemory.ts` 已有条目(只能追加,不能改/删)
4. 修改密码 / 改 `PASSWORD_HASH`(失效后用户登不进去)
5. 删除云端数据 / 清空 Supabase 表
6. 暴露 API Key 到前端代码 / git 提交

用户发账号、密码、Key、隐私数据时,要提醒安全风险,并建议以后不要直接发。

## 开发流程

1. **目标**:说明这一步解决什么问题
2. **拆分**:按用户实际使用顺序拆,不堆砌看起来很完整但用不到的功能
3. **交付**:给出真实运行结果(截图或 curl 实测),不能"理论上应该能用"
4. **验证**:必须实际跑通,自动化(puppeteer headless)或用户真机
5. **静态预览**:UI 改动**必须先生成 mockup 截图给用户看**,确认后再 deploy

## 不可以做的事

1. 把没真实运行的功能说成"已完成"
2. 把 OCR / 语音等次要功能塞回主流程(用户已明确不要)
3. 在表格里加新列(列已固定 13 列)
4. 改 `BUILT_IN_KNOWN_SHOPS` / `BUILT_IN_SHOP_ALIASES` 已有条目
5. 在 sidebar 加新入口("店铺收款确认"已是上限)
6. 把环境变量 / Key 写进 git 提交

## 卡死停止规则

遇到以下情况必须停止,不得继续循环:

1. 同一工具调用相同参数连续失败 ≥ 2 次
2. 连续 3 步无实质进展(输出与上一步雷同)
3. 删/清/覆盖等不可逆操作未经用户明确确认
4. 关键工具不可用(Supabase 网络挂、阿里云 API 挂)
5. 用户报"还有问题"或"你说的不对" — 必须切换为实测重诊,不再口头辩解

停止时必须输出:卡在哪步 / 已完成什么 / 建议下一步

## 验证标准

每次完成后,必须真机或 headless 验证:

1. https://delivery-note.pages.dev 打开,HTTP 200
2. 密码门能进
3. iPad 横屏 1112×834 表格布局完整(13 列 + 31 天 + 本月合计)
4. 输入数字 → 失焦 → 数据进 Supabase
5. 月份切换正常
6. 数据导出 Excel/CSV/JSON 文件能打开

无法验证时必须明说,不能假装已验证。

## 历史决策记忆

- **2026-05**: 用户原本想用 OCR 扫描,实测在 iPhone 上 6-7 秒太慢,精度不稳。决定回归手动录入
- **2026-05**: 尝试过语音输入(Web Speech API + qwen-vl-ocr),但用户最终偏好"点格子输入数字"
- **2026-06**: 顶部语音录入按钮删除,表格删除"当日合计"列,侧栏紧凑化到 148px
- **2026-06**: 站点 https://delivery-note.pages.dev 上线,Cloudflare Pages + Supabase 全免费(OCR 备用,月 ¥0~7)
- **2026-06-02**: Excel 导出改成二维表(日期 × 客户),跟 App 表格视觉一致;CSV/JSON 同步改造;文件名加时分时间戳避免覆盖
- **2026-06-02**: 表格底部加重复表头行(浅绿底),最后几天数据可直接对照客户列;行高 23→22px
- **2026-06-02**: GitHub Actions 加两个定时任务:每天 18:00 保活 ping(防 Supabase 暂停)/ 18:05 自动备份到 backups/ 目录
- **2026-06-02**: iOS 听写中文数字("二百三十八")自动转阿拉伯("238"),通过 extractAmount() 集成到 handleMonthCellChange
