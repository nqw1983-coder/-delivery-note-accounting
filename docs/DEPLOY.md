# 部署指南 — Cloudflare Pages + Supabase

## 完整部署清单

### 一、Supabase(后端)

#### 1. 数据库 schema(只需一次)

Dashboard → SQL Editor → New query → 粘贴执行:

```sql
create table deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null,
  shop_name text not null,
  order_no text,
  amount numeric(10,2),
  raw_ocr_text text,
  device text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index deliveries_date_idx on deliveries(delivery_date desc);
create index deliveries_shop_idx on deliveries(shop_name);

create table shop_aliases (
  alias text primary key,
  canonical text not null,
  created_at timestamptz default now()
);

create table known_shops (
  name text primary key,
  created_at timestamptz default now()
);

create or replace function trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_timestamp_deliveries
  before update on deliveries
  for each row execute procedure trigger_set_timestamp();
```

#### 2. 部署 OCR Edge Function

```bash
brew install supabase/tap/supabase   # 装 CLI(只需一次)
supabase login
supabase link --project-ref <你的 project-ref>  # 在 Dashboard URL 中
supabase functions deploy ocr-proxy
```

#### 3. 配置 Edge Function 环境变量

Dashboard → Project Settings → Edge Functions → Manage secrets:

| Key | 必填 | 说明 |
|---|---|---|
| `TENCENT_SECRET_ID` | 推荐 | 腾讯云 OCR(免费 1000 次/月) |
| `TENCENT_SECRET_KEY` | 推荐 | 同上 |
| `ALIYUN_DASHSCOPE_KEY` | 推荐(fallback) | 阿里云 qwen-vl,精度更高 |
| `PRIMARY_PROVIDER` | 可选 | `tencent`(默认)或 `aliyun` |

详见 `supabase/functions/ocr-proxy/README.md`。

---

### 二、Cloudflare Pages(前端)

#### 1. 推到 GitHub

```bash
# 在仓库根目录
git remote add origin https://github.com/<你>/送货单记账.git
git push -u origin master
```

#### 2. Cloudflare Pages 关联仓库

1. 登录 https://dash.cloudflare.com → Workers & Pages → Create
2. 选 **Pages** → Connect to Git → 选你的 GitHub 仓库
3. 构建配置:
   - **Framework preset**: `None`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Node version**: `20`(在 Environment variables 加 `NODE_VERSION=20`)

#### 3. 设置环境变量

Cloudflare Pages → 你的项目 → Settings → Environment variables:

| Variable | Value | 应用到 |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://你的project.supabase.co` | Production + Preview |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Production + Preview |
| `NODE_VERSION` | `20` | Production + Preview |

设置后点 **Retry deployment**,使变量生效。

#### 4. 拿到公网网址

部署完成后会给一个 `xxx.pages.dev` 网址。

---

### 三、修改默认密码(必做)

```bash
node scripts/hash-password.js 你的新密码
# 复制输出的 SHA-256
```

把哈希粘到 `src/lib/auth.ts` 的 `PASSWORD_HASH` 常量,提交 → Cloudflare 自动重新部署。

---

### 四、给小白用户的 iPad 安装指南

发给他这段(可截图):

```
请在 iPad Safari 打开:
  https://你的网址.pages.dev

1. 输入密码: <告诉他>
2. 点底部分享按钮 (方框+向上箭头)
3. 滑到下面找 "添加到主屏幕"
4. 点 "添加"
5. 桌面会出现"送货单"图标,以后点这个图标就行

⚠️ 不要删这个图标。
⚠️ 如果换了 iPad,联系我重新设置 5 分钟。
```

---

## 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 输完密码进不去 | `PASSWORD_HASH` 错 | 重新跑 `hash-password.js` 校验 |
| 拍照后转圈不响应 | Edge Function 没配置 | Supabase Dashboard 查 Function logs |
| 多端看不到对方数据 | 环境变量未设置 | Cloudflare 检查 VITE_ 开头变量 |
| 添加到主屏幕没图标 | manifest.json 没生效 | 浏览器 DevTools → Application → Manifest 检查 |
| Cloudflare 构建失败 | Node 版本不对 | 加环境变量 `NODE_VERSION=20` |
| iPad 加桌面后白屏 | Service Worker 缓存旧版本 | 删除主屏图标 → 重新添加 |

---

## 数据备份(强烈建议每月做)

1. 打开 App → 点侧栏下载图标 (导出)
2. 选"导出完整备份 (JSON)"
3. 保存到 iCloud Drive 或发到自己的微信
4. 万一云端数据丢失,从这个文件能恢复
