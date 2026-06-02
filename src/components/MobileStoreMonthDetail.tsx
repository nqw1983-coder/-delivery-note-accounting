import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import type { MonthData, ShopName } from "../types/dashboard";

interface MobileStoreMonthDetailProps {
  monthData: MonthData;
  shop: string;
  onBack: () => void;
  onChangeCell: (day: number, shop: ShopName, value: string) => boolean;
  /** 点某天 → 跳回当日明细页(并切到该日期) */
  onSelectDay: (day: number) => void;
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
  onSelectDay,
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
        <button className="mobile-icon" onClick={onBack} aria-label="返回当日明细">
          <ChevronLeft size={20} />
        </button>
        <div className="center">
          <div className="title">{shop}</div>
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
            <button
              key={d}
              type="button"
              className={`mobile-store-day-row ${amount > 0 ? "has-value" : "zero"}`}
              onClick={() => onSelectDay(d)}
            >
              <span className="day">{d}日</span>
              <span className={`amt ${amount > 0 ? "" : "zero"}`}>
                {amount > 0 ? amount.toLocaleString("zh-CN") : "0"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
