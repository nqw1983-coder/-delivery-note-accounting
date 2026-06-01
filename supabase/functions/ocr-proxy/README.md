# OCR 代理 Edge Function

把客户端 OCR 请求转发到云端,把 API Key 留在服务端,客户端永远拿不到。

## 工作模式

```
客户端浏览器
    ↓ POST imageDataUrl + prompt
Supabase Edge Function (ocr-proxy)
    ↓ 用环境变量里的 Key 调
腾讯云 OCR(免费 1000 次/月) → 失败 fallback → 阿里云 qwen-vl
    ↓
返回 { content, provider, model }
```

## 配置(必须在部署前完成)

### 1. 拿到云服务凭据

**腾讯云**(主用,免费 1000 次/月):
1. 登录 https://console.cloud.tencent.com/cam/capi
2. 创建 SubAccount + AccessKey,记下 `SecretId` 和 `SecretKey`
3. 去 https://console.cloud.tencent.com/ocr 开通"通用文字识别"服务

**阿里云**(fallback,精度更高,按次付费约 ¥0.008/次):
1. 登录 https://bailian.console.aliyun.com → API-KEY 创建
2. 复制 `sk-...` 开头的 Key

### 2. 在 Supabase 配置环境变量

打开 Supabase Dashboard → 你的项目 → Project Settings → Edge Functions → Manage secrets,添加:

| Key | Value |
|---|---|
| `TENCENT_SECRET_ID` | 腾讯云 SecretId |
| `TENCENT_SECRET_KEY` | 腾讯云 SecretKey |
| `ALIYUN_DASHSCOPE_KEY` | 阿里云 `sk-...` |
| `PRIMARY_PROVIDER` | `tencent`(默认,腾讯优先)或 `aliyun` |

## 部署

```bash
# 装 Supabase CLI(只需一次)
brew install supabase/tap/supabase

# 在项目根目录,登录并关联项目
supabase login   # 或 supabase login --token sbp_... (用 Personal Access Token)
supabase link --project-ref <你的 project-ref>

# 部署(必须加 --no-verify-jwt,Supabase 2025+ 新版 publishable key 不被默认 JWT 网关接受)
supabase functions deploy ocr-proxy --no-verify-jwt
```

### 为什么用 `--no-verify-jwt`

- 2025 起 Supabase 引入新的 `sb_publishable_*` key 格式,**不是 JWT**
- 默认 Edge Function 网关要求 JWT 验证,publishable key 会被拒
- 我们的认证模型:客户端密码门 + 应用级业务约束,不依赖 Function 网关 JWT
- 风险:任何拿到 Function URL 的人都能调,可能消耗 OCR 额度
  - 缓解:在阿里云控制台设置月度消费上限
  - 缓解:Function URL 不公开,仅嵌入到受密码保护的前端

## 测试

部署后可用 curl 测试:

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/ocr-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的 publishable key>" \
  -d '{
    "imageDataUrl": "data:image/jpeg;base64,...",
    "prompt": "识别图片里的文字"
  }'
```

## 注意事项

1. **腾讯云只返回纯文本**,客户端 prompt 里的"按 JSON 输出"对腾讯无效。
   - 腾讯模式下,Edge Function 会把识别出的文字塞进 `remark` 字段返回
   - 客户端可以选择"用腾讯文本 + 自己再调小模型解析",或者直接给用户手动填表
2. **阿里云返回符合 prompt 的 JSON**,识别精度更好但每次约 ¥0.008
3. **PRIMARY_PROVIDER=tencent** 时优先省钱;质量优先建议 `aliyun`
4. **CORS** 已开 `*`,密码门是唯一访问控制
