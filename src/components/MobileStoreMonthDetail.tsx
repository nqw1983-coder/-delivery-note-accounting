import { useMemo } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import type { MonthData, ShopName } from "../types/dashboard";

interface MobileStoreMonthDetailProps {
  monthData: MonthData;
  shop: string;
  onBack: () => void;
  onChangeCell: (day: number, shop: ShopName, value: string) => boolean;
  /** 点某天的"日"标签 → 跳回当日明细页(并切到该日期) */
  onSelectDay: (day: number) => void;
  /** 本月该店是否已核算确认 */
  confirmed: boolean;
  /** 切换核算确认状态 */
  onToggleConfirm: () => void;
  /** 手动同步云端 */
  onSync: () => void;
  syncing: boolean;
}

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

const getAmount = (monthData: MonthData, day: number, shop: string): number => {
  const cell = monthData.cells[day]?.[shop];
  if (!cell) return 0;
  return Math.round(cell.parts.reduce((s, p) => s + p.amount, 0) * 100) / 100;
};

export function MobileStoreMonthDetail({
  monthData,
  shop,
  onBack,
  onChangeCell,
  onSelectDay,
  confirmed,
  onToggleConfirm,
  onSync,
  syncing,
}: MobileStoreMonthDetailProps) {
  const totalDays = daysInMonth(monthData.year, monthData.month);
  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => i + 1),
    [totalDays]
  );

  const total = useMemo(
    () => days.reduce((s, d) => s + getAmount(monthData, d, shop), 0),
    [days, monthData, shop]
  );
  const totalDisplay = Math.round(total * 100) / 100;

  // 有数据的天数
  const activeDays = days.filter((d) => getAmount(monthData, d, shop) > 0).length;

  return (
    <div className="mobile-page mobile-store-month">
      <header className="mobile-detail-header">
        <div className="mobile-header-left">
          <button className="mobile-icon" onClick={onBack} aria-label="返回当日明细">
            <ChevronLeft size={20} />
          </button>
          <button
            className={`mobile-sync-btn ${syncing ? "icon-spinning" : ""}`}
            onClick={onSync}
            disabled={syncing}
            aria-label="同步保存"
          >
            <RefreshCw size={15} />
            {syncing ? "同步中" : "同步"}
          </button>
        </div>
        <div className="center">
          <div className="title-row">
            <span className="title">{shop}</span>
            <button
              type="button"
              className={`reconcile-btn ${confirmed ? "done" : ""}`}
              onClick={onToggleConfirm}
              aria-pressed={confirmed}
            >
              核算确认{confirmed ? " 🌹" : ""}
            </button>
          </div>
          <div className="sub">
            {monthData.year}年{monthData.month}月 · 共 ¥{totalDisplay.toLocaleString("zh-CN")}
          </div>
        </div>
        <div style={{ width: 38 }} />
      </header>

      <div className="mobile-store-summary">
        <div>
          <div className="label">本月合计</div>
          <div className="value">¥{totalDisplay.toLocaleString("zh-CN")}</div>
        </div>
        <div>
          <div className="label">有送货</div>
          <div className="value">{activeDays} 天</div>
        </div>
      </div>

      <div className="mobile-store-day-list">
        {days.map((d) => {
          const amount = getAmount(monthData, d, shop);
          return (
            <div
              key={d}
              className={`mobile-store-day-row ${amount > 0 ? "has-value" : "zero"}`}
            >
              <button
                type="button"
                className="day-nav"
                onClick={() => onSelectDay(d)}
                aria-label={`查看 ${d} 日当日明细`}
              >
                {d}日
              </button>
              <input
                className={`amt-input ${amount > 0 ? "" : "zero"}`}
                type="text"
                inputMode="decimal"
                defaultValue={amount > 0 ? amount : ""}
                placeholder="0"
                key={`${monthData.year}-${monthData.month}-${shop}-${d}-${amount}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  const ok = onChangeCell(d, shop as ShopName, e.currentTarget.value);
                  if (!ok) e.currentTarget.value = amount > 0 ? String(amount) : "";
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
