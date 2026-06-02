# 水果店送货单记账

面向水果店 / 餐饮供货 / 线下小店的送货单记账 PWA 网页工具。

老板在 iPad / iPhone / 桌面浏览器上,按"客户 × 日期"二维表格快速录入每天每家的送货金额,数据自动同步到云端,多端共享。

**线上地址:** https://delivery-note.pages.dev

## 当前功能(2026-06)

- 🎯 **自适应双布局**:iPad/桌面 = 2D 表格;iPhone = 月份列表 + 当日明细双屏(同 URL 自动切)
- ☁️ Supabase 云同步:多端共享一份数据,iPad 录入,Mac 立即可见
- 📵 离线可用:断网时本地缓存,联网自动补传
- 🔐 简单密码门:只有知道密码的人能进
- 📥 数据导出:Excel / CSV / JSON 三种格式,可备份到 iPad 文件 App / iCloud / 微信
- 📊 年度统计 + 店铺收款确认
- 🖼️ OCR 辅助识别:上传手写送货单照片,自动识别店面/日期/金额(辅助功能,不是主流程)
- 📱 PWA:加到 iPad 主屏后跟原生 App 体验一致

## 主要使用流程

1. iPad Safari 打开网址 → 输入密码登录
2. 点底部分享 → 添加到主屏幕(只需一次)
3. 以后从主屏图标进入 → 直接看到当月表格
4. 点想填的格子(日期 × 客户) → 输入金额 → 失焦自动保存
5. 切换月份在左侧列表

## 技术栈

- **前端**:React 18 + TypeScript + Vite 6 + vite-plugin-pwa
- **后端**:Supabase Postgres + Edge Functions(Deno)
- **托管**:Cloudflare Pages(全球 CDN,免费)
- **OCR**:阿里云通义千问 `qwen-vl-ocr-latest`(默认,辅助)/ 豆包 Vision(可选)
- **UI 库**:lucide-react(图标)
- **认证**:SHA-256 密码门

## 月成本

| 项 | 费用 |
|---|---|
| Cloudflare Pages | ¥0 |
| Supabase 数据库 | ¥0(免费 500MB) |
| Supabase Edge Function | ¥0(免费 50 万次/月) |
| 阿里云 OCR(可选) | 不用时 ¥0;用的话约 ¥0.008/次 |
| **合计** | **¥0~10/月** |

## 本地运行

```bash
npm install
npm run dev        # 开发,带 vite 代理直连阿里云
npm run build      # 生产构建
npm run preview    # 本地预览生产构建
```

## 部署到 Cloudflare Pages

详见 [docs/DEPLOY.md](docs/DEPLOY.md)

```bash
export CLOUDFLARE_API_TOKEN="<token>"
npx wrangler pages deploy dist \
  --project-name=delivery-note --branch=master --commit-dirty=true \
  --commit-message="my deploy"
```

## 项目文档

- [AGENTS.md](AGENTS.md) — AI 协作规则、当前架构、安全边界
- [CLAUDE.md](CLAUDE.md) — 技术细节、已踩过的坑、字典持久化规则
- [docs/DEPLOY.md](docs/DEPLOY.md) — 完整部署指南
- [docs/iPad使用说明.md](docs/iPad使用说明.md) — 给小白用户的图文说明

## 数据说明

- 主存储:Supabase Postgres(新加坡机房)
- 本地缓存:浏览器 `localStorage`,Offline-First
- 字典:[src/data/shopMemory.ts](src/data/shopMemory.ts)(内置)+ Supabase `shop_aliases` 表(增量)

## 安全提醒

- 送货单图片可能含客户名、金额。OCR 走 Supabase Edge Function 转发到阿里云,Key 留服务端
- 密码门只防"陌生人扫到网址",不是企业级安全。anon publishable key 公开是设计如此
- 阿里云控制台建议设月度消费上限(防 Key 泄露被刷)

## 开源许可证

MIT License
