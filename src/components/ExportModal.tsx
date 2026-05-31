import { useMemo, useState } from "react";
import type { MonthData } from "../types/dashboard";
import {
  exportCsv,
  exportExcel,
  exportJson,
  importJson,
  type ExportFilters,
} from "../lib/exporter";

interface ExportModalProps {
  months: MonthData[];
  /** 是否管理员模式(显示恢复入口) */
  isAdmin: boolean;
  onClose: () => void;
  /** 管理员恢复 JSON 后的回调,由父组件合并到 months 状态 */
  onRestore?: (months: MonthData[]) => void;
}

const allShops = (months: MonthData[]): string[] => {
  const set = new Set<string>();
  months.forEach((m) => m.stores.forEach((s) => set.add(s)));
  return Array.from(set).sort();
};

export function ExportModal({ months, isAdmin, onClose, onRestore }: ExportModalProps) {
  const shops = useMemo(() => allShops(months), [months]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [shopName, setShopName] = useState("");
  const [hint, setHint] = useState<string>("");
  const [importing, setImporting] = useState(false);

  const filters: ExportFilters | undefined =
    startDate || endDate || shopName
      ? {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          shopName: shopName || undefined,
        }
      : undefined;

  const handleExcel = () => {
    try {
      exportExcel(months, filters);
      setHint('✅ Excel 已导出,iPad 上会弹"保存到"窗口,可存到文件 App 或分享到微信');
    } catch (err) {
      setHint(`❌ 导出失败:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCsv = () => {
    try {
      exportCsv(months, filters);
      setHint("✅ CSV 已导出");
    } catch (err) {
      setHint(`❌ 导出失败:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleJson = () => {
    try {
      exportJson(months);
      setHint("✅ 完整备份已导出。这是最安全的格式,可用于灾难恢复");
    } catch (err) {
      setHint(`❌ 导出失败:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setHint("正在解析备份文件…");
    try {
      const bundle = await importJson(file);
      const confirmed = window.confirm(
        `将从备份恢复 ${bundle.recordCount} 条记录(导出于 ${bundle.exportedAt.slice(0, 19).replace("T", " ")})。\n\n` +
          `恢复策略:与现有数据合并,以备份较新者为准。是否继续?`
      );
      if (!confirmed) {
        setHint("已取消恢复");
        return;
      }
      onRestore?.(bundle.months);
      setHint(`✅ 已合并 ${bundle.recordCount} 条记录到本地,正在异步同步到云端`);
    } catch (err) {
      setHint(`❌ 恢复失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="detail-modal scan-modal"
        role="dialog"
        aria-modal="true"
        aria-label="数据导出"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>导出数据 / 备份</h3>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="scan-form">
          <p className="scan-hint" style={{ margin: 0, lineHeight: 1.6 }}>
            导出的文件可保存到 <strong>iPad/iPhone 的"文件" App</strong>、iCloud Drive、或直接分享到微信。
            <br />
            💡 建议每月至少导出一次完整备份(JSON),保护数据安全。
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="scan-field">
              <span>起始日期(可选)</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="scan-field">
              <span>结束日期(可选)</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>

          <label className="scan-field">
            <span>限定客户(可选)</span>
            <select value={shopName} onChange={(e) => setShopName(e.target.value)}>
              <option value="">全部客户</option>
              {shops.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          {hint && (
            <pre
              style={{
                margin: 0,
                padding: 10,
                background: "#f7faf7",
                border: "1px solid #d0ddd3",
                borderRadius: 6,
                fontSize: 13,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {hint}
            </pre>
          )}

          {isAdmin && (
            <div
              style={{
                marginTop: 8,
                padding: 12,
                background: "#fff7e6",
                border: "1px solid #ffd591",
                borderRadius: 8,
              }}
            >
              <strong style={{ color: "#874d00", fontSize: 14 }}>⚠️ 管理员区</strong>
              <p style={{ margin: "6px 0", fontSize: 13, lineHeight: 1.5 }}>
                从 JSON 完整备份恢复数据。会与现有数据合并,以备份较新者为准。
              </p>
              <label
                className="scan-btn-clear"
                style={{ display: "inline-block", cursor: "pointer" }}
              >
                {importing ? "恢复中…" : "选择 JSON 备份文件"}
                <input
                  type="file"
                  accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={handleImportChange}
                  disabled={importing}
                />
              </label>
            </div>
          )}
        </div>

        <div className="scan-actions">
          <button className="scan-btn-clear" type="button" onClick={handleCsv}>
            导出 CSV
          </button>
          <button className="scan-btn-clear" type="button" onClick={handleJson}>
            导出完整备份(JSON)
          </button>
          <button className="scan-btn-confirm" type="button" onClick={handleExcel}>
            导出 Excel
          </button>
        </div>
      </section>
    </div>
  );
}
