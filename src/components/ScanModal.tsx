import { useEffect, useRef, useState } from "react";

// 识别中带秒计时 + 进度条,让 3-7 秒不觉得长
function RecognizingProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 100) / 10);
    }, 100);
    return () => clearInterval(timer);
  }, []);
  // 进度条按预期 5 秒平滑推进到 90%,剩 10% 等返回填满
  const pct = Math.min(90, (elapsed / 5) * 90);
  return (
    <div style={{ padding: "8px 12px 12px" }}>
      <p style={{ textAlign: "center", color: "#145c3c", fontWeight: 600, margin: "0 0 8px" }}>
        🔍 识别中… {elapsed.toFixed(1)} 秒
      </p>
      <div style={{ height: 6, background: "#e8efe9", borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "linear-gradient(90deg, #2ea36b, #145c3c)",
            transition: "width 0.1s linear",
          }}
        />
      </div>
      <p style={{ textAlign: "center", color: "#688e7a", fontSize: 12, margin: "6px 0 0" }}>
        通常 3-6 秒,识别完成自动填入表单
      </p>
    </div>
  );
}

export interface ScanFormData {
  shop: string;
  month: number;
  day: number;
  amount: number;
  remark: string;
}

interface ScanModalProps {
  currentYear: number;
  currentMonth: number;
  maxDay: number;
  existingShops: string[];
  initialData?: Partial<ScanFormData>;
  imagePreview?: string;
  recognizeError?: string;
  recognizing?: boolean;
  batchPosition?: { index: number; total: number };
  onConfirm: (data: ScanFormData) => void;
  onSkip?: () => void;
  onClose: () => void;
}

export function ScanModal({
  currentYear,
  currentMonth,
  maxDay,
  existingShops,
  initialData,
  imagePreview,
  recognizeError,
  recognizing,
  batchPosition,
  onConfirm,
  onSkip,
  onClose,
}: ScanModalProps) {
  const [shop, setShop] = useState(initialData?.shop ?? "");
  const [month, setMonth] = useState(initialData?.month || currentMonth);
  const [day, setDay] = useState(initialData?.day ?? 0);
  const [amount, setAmount] = useState(initialData?.amount ?? 0);
  const [remark, setRemark] = useState(initialData?.remark ?? "");
  const [error, setError] = useState("");

  // 标记表单是否已被用户手动编辑过——一旦编辑，自动填充逻辑不再覆盖。
  // batchIndex 变化时父组件传 key={batchIndex}，组件重新挂载，此 ref 自动重置为 false。
  const userEditedRef = useRef(false);

  // 自动填充识别结果（仅当用户尚未编辑过表单时）
  useEffect(() => {
    if (!initialData) return;
    if (userEditedRef.current) return; // 用户已手动改 → 绝不覆盖
    const hasResult =
      (initialData.shop && initialData.shop.length > 0) ||
      (initialData.day && initialData.day > 0) ||
      (initialData.amount && initialData.amount > 0);
    if (!hasResult) return; // 空结果不填，避免误清
    if (initialData.shop !== undefined) setShop(initialData.shop);
    if (initialData.month !== undefined) setMonth(initialData.month || currentMonth);
    if (initialData.day !== undefined) setDay(initialData.day);
    if (initialData.amount !== undefined) setAmount(initialData.amount);
    if (initialData.remark !== undefined) setRemark(initialData.remark);
    setError("");
  }, [initialData, currentMonth]);

  // 把"用户编辑过"的标记封进 setter，外部依然通过原 setter 调用
  const markEdited = () => {
    userEditedRef.current = true;
  };

  const handleClear = () => {
    markEdited(); // 标记为已编辑，避免被自动填充覆盖回识别结果
    setShop("");
    setMonth(currentMonth);
    setDay(0);
    setAmount(0);
    setRemark("");
    setError("");
  };

  const handleConfirm = () => {
    if (!shop.trim() || !month || month < 1 || !day || day < 1 || !amount || amount <= 0) {
      setError("识别不清楚，请人工补全店面、日期和金额");
      return;
    }
    if (month !== currentMonth) {
      setError("本次只支持录入当前月份，如需其他月份请先切换月份");
      return;
    }
    if (day > maxDay) {
      setError(`本次只支持录入当前月份，如需其他月份请先切换月份`);
      return;
    }
    setError("");
    onConfirm({ shop: shop.trim(), month, day, amount, remark: remark.trim() });
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="detail-modal scan-modal"
        role="dialog"
        aria-modal="true"
        aria-label="识别确认"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>
            识别确认 — {currentYear}年{currentMonth}月
            {batchPosition && (
              <span className="scan-batch-badge"> 第 {batchPosition.index + 1} / {batchPosition.total} 张</span>
            )}
          </h3>
          <button type="button" onClick={onClose}>{batchPosition ? "结束批量" : "关闭"}</button>
        </header>

        {imagePreview && (
          <div className="scan-preview">
            <img src={imagePreview} alt="送货单预览" />
          </div>
        )}

        {recognizing && !recognizeError && (
          <RecognizingProgress />
        )}

        {recognizeError && <p className="scan-error">识别失败：{recognizeError}（请人工补全）</p>}

        <div className="scan-form">
          <label className="scan-field">
            <span>店面</span>
            <input
              type="text"
              value={shop}
              onChange={(event) => { markEdited(); setShop(event.target.value); }}
              placeholder="请输入店面名称"
              list="shop-suggestions"
            />
            <datalist id="shop-suggestions">
              {existingShops.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>

          <label className="scan-field">
            <span>日期（几月几日）</span>
            <div className="scan-date-row">
              <div className="scan-date-input">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={month || ""}
                  onChange={(event) => { markEdited(); setMonth(Number(event.target.value)); }}
                  placeholder="月"
                />
                <b>月</b>
              </div>
              <div className="scan-date-input">
                <input
                  type="number"
                  min={1}
                  max={maxDay}
                  value={day || ""}
                  onChange={(event) => { markEdited(); setDay(Number(event.target.value)); }}
                  placeholder="日"
                />
                <b>日</b>
              </div>
            </div>
          </label>

          <label className="scan-field">
            <span>金额</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount || ""}
              onChange={(event) => { markEdited(); setAmount(Number(event.target.value)); }}
              placeholder="0"
            />
          </label>

          <label className="scan-field">
            <span>备注</span>
            <input
              type="text"
              value={remark}
              onChange={(event) => { markEdited(); setRemark(event.target.value); }}
              placeholder="可选"
            />
          </label>
        </div>

        {error && <p className="scan-error">{error}</p>}

        <div className="scan-actions">
          <button className="scan-btn-clear" type="button" onClick={handleClear}>清空识别结果</button>
          {onSkip && (
            <button className="scan-btn-clear" type="button" onClick={onSkip}>跳过这张</button>
          )}
          <button className="scan-btn-confirm" type="button" onClick={handleConfirm}>
            {batchPosition && batchPosition.index + 1 < batchPosition.total ? "入账并下一张" : "确认入账"}
          </button>
        </div>
      </section>
    </div>
  );
}
