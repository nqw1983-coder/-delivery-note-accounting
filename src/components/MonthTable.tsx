import type { AmountCell, MonthData, ShopName } from "../types/dashboard";

interface MonthTableProps {
  monthData: MonthData;
  onChangeCell: (day: number, shop: ShopName, value: string) => boolean;
  /** 用户点选/聚焦某格时回调,App 用这个状态喂给顶部语音按钮 */
  onCellFocus?: (day: number, shop: ShopName) => void;
  /** 当前选中的格子(由 App 状态控制),用于高亮 */
  selectedCell?: { day: number; shop: ShopName } | null;
}

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
// 表格固定显示 13 列:最多 12 家有名店铺 + 1 个空白预留列
const MAX_LABELED_STORES = 12;
const TOTAL_STORE_COLUMNS = 13;
const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const getCellTotal = (cell?: AmountCell) => {
  if (!cell) {
    return 0;
  }

  return roundMoney(cell.parts.reduce((sum, part) => sum + part.amount, 0));
};

export function MonthTable({ monthData, onChangeCell, onCellFocus, selectedCell }: MonthTableProps) {
  const days = Array.from({ length: daysInMonth(monthData.year, monthData.month) }, (_, index) => index + 1);
  // 限制显示前 12 家有名店铺;额外的数据保留在 DB,只是不在表格里以标签形式出现
  const displayedStores = monthData.stores.slice(0, MAX_LABELED_STORES);
  // 总固定 13 列,labeled 之后补足空白
  const blankCustomerColumns = Array.from({
    length: Math.max(TOTAL_STORE_COLUMNS - displayedStores.length, 0),
  });

  return (
    <div className="table-shell">
      <table className="month-table">
        <thead>
          <tr>
            <th>日期</th>
            {displayedStores.map((shop) => (
              <th key={shop}>{shop}</th>
            ))}
            {blankCustomerColumns.map((_, index) => (
              <th aria-label={`空白客户列${index + 1}`} key={`blank-head-${index}`}></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            return (
              <tr key={day}>
                <th scope="row">{day}日</th>
                {displayedStores.map((shop) => {
                  const amount = getCellTotal(monthData.cells[day]?.[shop]);

                  const isSelected = selectedCell?.day === day && selectedCell?.shop === shop;
                  return (
                    <td key={shop} className={isSelected ? "cell-selected" : undefined}>
                      <input
                        key={`${day}-${shop}-${amount}`}
                        className="amount-cell-input"
                        defaultValue={amount || ""}
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`${day}日${shop}金额`}
                        onFocus={() => onCellFocus?.(day, shop)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                        onBlur={(event) => {
                          const changed = onChangeCell(day, shop, event.currentTarget.value);
                          if (!changed) {
                            event.currentTarget.value = amount ? String(amount) : "";
                          }
                        }}
                      />
                    </td>
                  );
                })}
                {blankCustomerColumns.map((_, index) => (
                  <td className="blank-cell" key={`blank-${day}-${index}`}></td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {/* 重复表头行 — 让用户在表格底部直接对照客户列,不用滚回顶部 */}
          <tr className="repeated-header-row">
            <td>日期</td>
            {displayedStores.map((shop) => (
              <td key={`repeat-${shop}`}>{shop}</td>
            ))}
            {blankCustomerColumns.map((_, index) => (
              <td className="blank-cell" key={`repeat-blank-${index}`}></td>
            ))}
          </tr>
          <tr>
            <th scope="row">本月合计</th>
            {displayedStores.map((shop) => {
              const total = roundMoney(days.reduce((sum, day) => sum + getCellTotal(monthData.cells[day]?.[shop]), 0));
              return <td key={shop}>{total}</td>;
            })}
            {blankCustomerColumns.map((_, index) => (
              <td className="blank-cell" key={`blank-total-${index}`}></td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
