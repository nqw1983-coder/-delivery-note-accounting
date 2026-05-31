import { useState } from "react";
import {
  PROVIDER_LABELS,
  diagnoseKey,
  exportShopMemoryAsTs,
  getDefaultModel,
  testConnection,
  type OcrProvider,
  type OcrSettings,
} from "../lib/ocr";

interface SettingsModalProps {
  current: OcrSettings | null;
  onSave: (settings: OcrSettings) => void;
  onClear: () => void;
  onClose: () => void;
}

export function SettingsModal({ current, onSave, onClear, onClose }: SettingsModalProps) {
  const [provider, setProvider] = useState<OcrProvider>(current?.provider ?? "qwen");
  const [apiKey, setApiKey] = useState(current?.apiKey ?? "");
  const [model, setModel] = useState(current?.model ?? "");
  const [knownShopsText, setKnownShopsText] = useState((current?.knownShops ?? []).join("、"));
  const [aliasesText, setAliasesText] = useState(
    Object.entries(current?.shopAliases ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>("");
  const [showKey, setShowKey] = useState(false);

  const parseKnownShops = (text: string): string[] =>
    text
      .split(/[,，、\s\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const parseAliases = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const [k, v] = line.split(/[=＝→]/).map((s) => s.trim());
        if (k && v) out[k] = v;
      });
    return out;
  };

  const handleSave = () => {
    if (!apiKey.trim()) return;
    onSave({
      provider,
      apiKey: apiKey.trim(),
      model: model.trim() || undefined,
      knownShops: parseKnownShops(knownShopsText),
      shopAliases: parseAliases(aliasesText),
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult("");
    const diag = diagnoseKey(apiKey);
    const diagLine = `Key 长度 ${diag.length}（正常 35 左右）｜首4位 "${diag.prefix}"｜末4位 "${diag.suffix}"${diag.hasNonAscii ? "｜⚠️ 含非ASCII字符" : ""}${diag.hasInternalWhitespace ? "｜⚠️ 内部含空格" : ""}`;

    const result = await testConnection({ provider, apiKey: apiKey.trim(), model: model.trim() || undefined, knownShops: parseKnownShops(knownShopsText), shopAliases: parseAliases(aliasesText) });
    const proxyLine = result.endpoint.startsWith("/") ? "✅ 走代理（同源）" : "⚠️ 未走代理（直连阿里云，可能是旧标签页）";
    const urlLine = `请求URL: ${result.endpoint}\n${proxyLine}`;
    if (result.ok) {
      setTestResult(`✅ 连接成功（模型 ${result.model}）\n${urlLine}\n${diagLine}`);
    } else {
      setTestResult(`❌ HTTP ${result.status}\n${urlLine}\n${diagLine}\n返回：${result.message}`);
    }
    setTesting(false);
  };

  const handleCopyCurl = async () => {
    const key = apiKey.trim();
    const m = (model.trim() || "qwen-vl-max").toLowerCase();
    const curl = `curl -s -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d '{"model":"${m}","messages":[{"role":"user","content":"hi"}]}'`;
    try {
      await navigator.clipboard.writeText(curl);
      setTestResult("已复制 curl 命令到剪贴板。\n粘到终端运行：\n- 返回 choices/200 → 浏览器里的 Key 有效（问题在浏览器链路，告诉我）\n- 返回 invalid_api_key → 浏览器里的 Key 和你之前那把不一样（复制问题）");
    } catch {
      setTestResult("复制失败，请手动复制下面命令到终端运行：\n\n" + curl);
    }
  };

  const handleExportMemory = async () => {
    const ts = exportShopMemoryAsTs({
      provider,
      apiKey: apiKey.trim(),
      model: model.trim() || undefined,
      knownShops: parseKnownShops(knownShopsText),
      shopAliases: parseAliases(aliasesText),
    });
    try {
      await navigator.clipboard.writeText(ts);
      setTestResult(
        "✅ 已复制 TypeScript 代码到剪贴板。\n" +
          "请粘贴覆盖项目里的 src/data/shopMemory.ts（导出常量 BUILT_IN_KNOWN_SHOPS 和 BUILT_IN_SHOP_ALIASES 那两段）并 commit，\n" +
          "这样字典就持久化到代码库，换浏览器/清缓存也不会丢。"
      );
    } catch {
      setTestResult("复制失败，请手动复制下面代码：\n\n" + ts);
    }
  };

  const placeholder = getDefaultModel(provider);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="detail-modal scan-modal"
        role="dialog"
        aria-modal="true"
        aria-label="识别服务设置"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>识别服务设置</h3>
          <button type="button" onClick={onClose}>关闭</button>
        </header>

        <div className="scan-form">
          <label className="scan-field">
            <span>识别服务</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value as OcrProvider)}>
              {(Object.keys(PROVIDER_LABELS) as OcrProvider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </label>

          <label className="scan-field">
            <span>
              API Key（当前 {apiKey.length} 个字符）
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                style={{ marginLeft: 8, fontSize: 12, color: "#145c3c", background: "none", border: "none", textDecoration: "underline" }}
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </span>
            <input
              type={showKey ? "text" : "password"}
              name="ocr-api-key-field"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={provider === "qwen" ? "sk-... (DashScope/百炼)" : "火山引擎 ARK Key"}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              spellCheck={false}
            />
          </label>

          <label className="scan-field">
            <span>模型（可选，留空用默认）</span>
            <input
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={placeholder}
              spellCheck={false}
            />
            {provider === "qwen" && (
              <div className="model-presets">
                {[
                  { label: "qwen-vl-max（默认/平衡）", value: "qwen-vl-max" },
                  { label: "qwen3-vl-plus（新一代⭐推荐）", value: "qwen3-vl-plus" },
                  { label: "qwen-vl-ocr-latest（OCR专项）", value: "qwen-vl-ocr-latest" },
                  { label: "qwen-vl-plus（便宜/快）", value: "qwen-vl-plus" },
                ].map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`model-preset-btn ${model === p.value ? "active" : ""}`}
                    onClick={() => setModel(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </label>

          <p className="scan-hint" style={{ lineHeight: 1.6, margin: 0 }}>
            {provider === "qwen" ? (
              <>
                通义千问：去 <strong>bailian.console.aliyun.com</strong>（百炼）创建 API Key。<br />
                💡 拿真实送货单点上面 4 个按钮逐个测试，找最准的；准确率参考：<code>qwen3-vl-plus</code> ≥ <code>qwen-vl-ocr-latest</code> &gt; <code>qwen-vl-max</code> &gt; <code>qwen-vl-plus</code>。模型未开通会报 403，去百炼模型广场免费开通即可。
              </>
            ) : (
              <>
                豆包：去 <strong>console.volcengine.com/ark</strong> 创建接入点获取 API Key。
              </>
            )}
          </p>

          <label className="scan-field">
            <span>已知客户名单（用顿号、逗号或换行分隔）</span>
            <textarea
              value={knownShopsText}
              onChange={(event) => setKnownShopsText(event.target.value)}
              placeholder="例：玉西平、柳、万顺平、石杨、萍姐"
              rows={3}
              spellCheck={false}
              style={{ width: "100%", padding: "8px 12px", fontSize: 14, color: "#16281f", background: "#ffffff", border: "1px solid #d0ddd3", borderRadius: 8, resize: "vertical", fontFamily: "inherit" }}
            />
            <small style={{ color: "#456356", fontSize: 12 }}>
              💡 模型会优先把潦草字匹配到这份名单里的客户，识别率立刻飙升。建议把所有常送的客户都填进来。
            </small>
          </label>

          <label className="scan-field">
            <span>字迹纠正字典（每行一条，格式：识别值=正确值）</span>
            <textarea
              value={aliasesText}
              onChange={(event) => setAliasesText(event.target.value)}
              placeholder={"吾西产=玉西平\n万面亭=万顺平\n吾湘=吾湘餐饮"}
              rows={4}
              spellCheck={false}
              style={{ width: "100%", padding: "8px 12px", fontSize: 14, color: "#16281f", background: "#ffffff", border: "1px solid #d0ddd3", borderRadius: 8, resize: "vertical", fontFamily: "monospace" }}
            />
            <small style={{ color: "#456356", fontSize: 12 }}>
              💡 兜底纠正：模型仍识别错时，按这份字典自动替换。
            </small>
          </label>

          {testResult && (
            <pre style={{ margin: 0, padding: "10px", background: "#f7faf7", border: "1px solid #d0ddd3", borderRadius: 6, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {testResult}
            </pre>
          )}
        </div>

        <div className="scan-actions">
          <button className="scan-btn-clear" type="button" onClick={onClear}>清除</button>
          <button className="scan-btn-clear" type="button" onClick={handleTest} disabled={!apiKey.trim() || testing}>
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button className="scan-btn-clear" type="button" onClick={handleExportMemory}>
            导出字典
          </button>
          <button className="scan-btn-clear" type="button" onClick={handleCopyCurl} disabled={!apiKey.trim()}>
            复制curl
          </button>
          <button className="scan-btn-confirm" type="button" onClick={handleSave} disabled={!apiKey.trim()}>
            保存
          </button>
        </div>
      </section>
    </div>
  );
}
