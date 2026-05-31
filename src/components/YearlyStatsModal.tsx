import type { MonthData } from "../types/dashboard";
import { getCellTotal } from "./MonthTable";

interface YearlyStatsModalProps {
  year: number;
  months: MonthData[];
  onSelectMonth: (year: number, month: number) => void;
  onClose: () => void;
}

const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

const getMonthTotal = (month: MonthData | undefined): number => {
  if (!month) return 0;
  return Object.values(month.cells).reduce((sum, dayCells) => {
    return sum + Object.values(dayCells).reduce((daySum, cell) => daySum + getCellTotal(cell), 0);
  }, 0);
};

export function YearlyStatsModal({ year, months, onSelectMonth, onClose }: YearlyStatsModalProps) {
  const yearTotal = allMonths.reduce((sum, m) => {
    const monthData = months.find((item) => item.year === year && item.month === m);
    return sum + getMonthTotal(monthData);
  }, 0);

  const handleMonthClick = (month: number) => {
    const exists = months.some((item) => item.year === year && item.month === month);
    if (exists) {
      onSelectMonth(year, month);
      onClose();
    } else {
      alert("这个月份还没创建，请先点 + 新增月份");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="detail-modal yearly-stats-modal"
        role="dialog"
        aria-modal="true"
        aria-label="年度统计"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>{year}年 统计</h3>
          <button type="button" onClick={onClose}>关闭</button>
        </header>

        <div className="yearly-total">
          全年合计：￥{yearTotal.toLocaleString("zh-CN")}
        </div>

        <table className="yearly-table">
          <thead>
            <tr>
              <th>月份</th>
              <th>金额</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {allMonths.map((month) => {
              const monthData = months.find((item) => item.year === year && item.month === month);
              const total = getMonthTotal(monthData);
              const exists = !!monthData;

              return (
                <tr
                  key={month}
                  className={exists ? "yearly-row-clickable" : "yearly-row-empty"}
                  onClick={() => handleMonthClick(month)}
                >
                  <td>{month}月</td>
                  <td className="yearly-amount">￥{total.toLocaleString("zh-CN")}</td>
                  <td>{exists ? "已创建" : "未创建"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
