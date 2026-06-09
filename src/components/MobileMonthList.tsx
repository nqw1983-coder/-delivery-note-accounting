import { Settings, Download, Plus, RefreshCw } from "lucide-react";
import type { MonthData } from "../types/dashboard";

interface MobileMonthListProps {
  months: MonthData[];
  selectedYear: number;
  selectedMonth: number;
  pendingCount: number;
  getMonthTotal: (month: MonthData) => number;
  onSelectMonth: (year: number, month: number) => void;
  onShopPayment: () => void;
  onAddMonth: () => void;
  onOpenSettings: () => void;
  onExport: () => void;
  onSync: () => void;
  syncing: boolean;
}

const formatYM = (year: number, month: number) => `${year}年${month}月`;
const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

export function MobileMonthList({
  months,
  selectedYear,
  selectedMonth,
  pendingCount,
  getMonthTotal,
  onSelectMonth,
  onShopPayment,
  onAddMonth,
  onOpenSettings,
  onExport,
  onSync,
  syncing,
}: MobileMonthListProps) {
  // 取当前年的所有月份,按 month desc(最近月份在最前),最多 12 个
  const sortedMonths = [...months]
    .filter((m) => m.year === selectedYear)
    .sort((a, b) => b.month - a.month)
    .slice(0, 12);

  return (
    <div className="mobile-page mobile-monthlist">
      <header className="mobile-header">
        <h1>送货单记账</h1>
        <div className="mobile-icons">
          <button className="mobile-icon" aria-label="设置" onClick={onOpenSettings}>
            <Settings size={18} />
          </button>
          <button
            className={`mobile-icon ${syncing ? "icon-spinning" : ""}`}
            aria-label="保存并同步云端"
            onClick={onSync}
            disabled={syncing}
            title="保存并同步"
          >
            <RefreshCw size={18} />
          </button>
          <button className="mobile-icon" aria-label="导出" onClick={onExport}>
            <Download size={18} />
          </button>
          <button
            className="mobile-icon primary"
            aria-label="新增月份"
            onClick={onAddMonth}
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      <button className="mobile-payment-btn" type="button" onClick={onShopPayment}>
        店铺收款确认
      </button>

      <div className="mobile-section-bar">
        <span className="label">月份账本</span>
        <span className="hint">点月份进入明细</span>
      </div>

      <div className="mobile-month-list">
        {sortedMonths.map((m) => {
          const total = getMonthTotal(m);
          const isActive = m.month === selectedMonth;
          const days = daysInMonth(m.year, m.month);
          return (
            <button
              key={`${m.year}-${m.month}`}
              type="button"
              className={`mobile-month-card ${isActive ? "active" : ""} ${total === 0 ? "zero" : ""}`}
              onClick={() => onSelectMonth(m.year, m.month)}
            >
              <div className="left">
                <span className="name">{formatYM(m.year, m.month)}</span>
                <span className="sub">{isActive ? `${days} 天 · 已同步` : "已同步"}</span>
              </div>
              <span className="amt">
                {total === 0 ? "¥ 0" : `¥${total.toLocaleString("zh-CN")}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mobile-pending-alert">
        <div>
          <div className="label">待补单据</div>
          <div className="sub">识别不清楚的单据</div>
        </div>
        <span className="count">{pendingCount}</span>
      </div>

      <button
        type="button"
        className="mobile-build-id"
        onClick={() => {
          const fn = (window as unknown as { __forceUpdate?: () => void }).__forceUpdate;
          if (fn) fn();
          else window.location.reload();
        }}
        aria-label="检查并更新到最新版本"
      >
        版本 {__BUILD_ID__} · 点此更新
      </button>
    </div>
  );
}
