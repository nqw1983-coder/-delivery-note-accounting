import type { AmountCell, MonthData, ShopName } from "../types/dashboard";
import { VoiceCell } from "./VoiceCell";

interface MonthTableProps {
  monthData: MonthData;
  onChangeCell: (day: number, shop: ShopName, value: string) => boolean;
}

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
const customerColumnCount = 13;
const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const getCellTotal = (cell?: AmountCell) => {
  if (!cell) {
    return 0;
  }

  return roundMoney(cell.parts.reduce((sum, part) => sum + part.amount, 0));
};

export function MonthTable({ monthData, onChangeCell }: MonthTableProps) {
  const days = Array.from({ length: daysInMonth(monthData.year, monthData.month) }, (_, index) => index + 1);
  const blankCustomerColumns = Array.from({
    length: Math.max(customerColumnCount - monthData.stores.length, 0),
  });

  const monthTotal = roundMoney(days.reduce((sum, day) => {
    return sum + monthData.stores.reduce((daySum, shop) => daySum + getCellTotal(monthData.cells[day]?.[shop]), 0);
  }, 0));

  return (
    <div className="table-shell">
      <table className="month-table">
        <thead>
          <tr>
            <th>日期</th>
            {monthData.stores.map((shop) => (
              <th key={shop}>{shop}</th>
            ))}
            {blankCustomerColumns.map((_, index) => (
              <th aria-label={`空白客户列${index + 1}`} key={`blank-head-${index}`}></th>
            ))}
            <th>当日合计</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const dayTotal = roundMoney(
              monthData.stores.reduce((sum, shop) => sum + getCellTotal(monthData.cells[day]?.[shop]), 0)
            );

            return (
              <tr key={day}>
                <th scope="row">{day}日</th>
                {monthData.stores.map((shop) => {
                  const amount = getCellTotal(monthData.cells[day]?.[shop]);

                  return (
                    <td key={shop}>
                      <VoiceCell
                        day={day}
                        shop={shop}
                        amount={amount}
                        onChange={onChangeCell}
                      />
                    </td>
                  );
                })}
                {blankCustomerColumns.map((_, index) => (
                  <td className="blank-cell" key={`blank-${day}-${index}`}></td>
                ))}
                <td className="daily-total">{dayTotal}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">本月合计</th>
            {monthData.stores.map((shop) => {
              const total = roundMoney(days.reduce((sum, day) => sum + getCellTotal(monthData.cells[day]?.[shop]), 0));
              return <td key={shop}>{total}</td>;
            })}
            {blankCustomerColumns.map((_, index) => (
              <td className="blank-cell" key={`blank-total-${index}`}></td>
            ))}
            <td className="daily-total">{monthTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
