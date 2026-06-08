import { useState } from "react";
import type { MonthData, ShopName } from "../types/dashboard";
import { getCellTotal } from "./MonthTable";

interface ShopPaymentModalProps {
  year: number;
  months: MonthData[];
  shops: ShopName[];
  edits: Record<string, string>;
  onEdit: (key: string, value: string) => void;
}

const monthsInYear = Array.from({ length: 12 }, (_, index) => index + 1);
const shopRowCount = 20;

const getShopMonthTotal = (monthData: MonthData | undefined, shop: ShopName) => {
  if (!monthData) {
    return 0;
  }

  return Object.values(monthData.cells).reduce((sum, dayCells) => {
    return sum + getCellTotal(dayCells[shop]);
  }, 0);
};

const shopNameKey = (year: number, rowId: string) => `${year}:${rowId}:name`;
const amountKey = (year: number, rowId: string, month: number) => `${year}:${rowId}:${month}`;
const paidKey = (year: number, rowId: string, month: number) => `${year}:${rowId}:${month}:paid`;

interface SelectedPaymentCell {
  rowId: string;
  shopName: string;
  month: number;
  amount: string;
}

export function ShopPaymentModal({ year, months, shops, edits, onEdit }: ShopPaymentModalProps) {
  const [selectedPaymentCell, setSelectedPaymentCell] = useState<SelectedPaymentCell | null>(null);
  const shopRows = Array.from({ length: shopRowCount }, (_, index) => {
    const shop = shops[index];
    return shop
      ? { id: shop, name: shop, isBlank: false }
      : { id: `blank-${index - shops.length}`, name: "", isBlank: true };
  });

  return (
    <div className="payment-table-shell">
      <table className="payment-table">
        <thead>
          <tr>
            <th>店铺</th>
            {monthsInYear.map((month) => (
              <th key={month}>{month}月</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shopRows.map((shop) => {
            return (
              <tr key={shop.id}>
                <th scope="row">
                  <input
                    aria-label={shop.isBlank ? "手动添加店铺名" : `${shop.name}店铺名`}
                    className="payment-name-input"
                    value={edits[shopNameKey(year, shop.id)] ?? shop.name}
                    onChange={(event) => onEdit(shopNameKey(year, shop.id), event.target.value)}
                  />
                </th>
                {monthsInYear.map((month) => {
                  const monthData = months.find((item) => item.year === year && item.month === month);
                  const total = shop.isBlank ? 0 : getShopMonthTotal(monthData, shop.id);
                  const key = amountKey(year, shop.id, month);
                  const value = edits[key] ?? (total ? String(total) : "");
                  const displayName = edits[shopNameKey(year, shop.id)] ?? shop.name;
                  const isPaid = edits[paidKey(year, shop.id, month)] === "paid";

                  return (
                    <td key={`${shop.id}-${month}`}>
                      <button
                        className="payment-cell-button"
                        type="button"
                        onClick={() =>
                          setSelectedPaymentCell({
                            rowId: shop.id,
                            shopName: displayName || "未填写店铺",
                            month,
                            amount: value,
                          })
                        }
                      >
                        {value ? `${value}${isPaid ? " 🌹" : ""}` : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {selectedPaymentCell && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelectedPaymentCell(null)}>
          <section
            className="detail-modal payment-status-modal"
            role="dialog"
            aria-modal="true"
            aria-label="店铺收款状态"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>{selectedPaymentCell.shopName} / {year}年{selectedPaymentCell.month}月</h3>
              <button type="button" onClick={() => setSelectedPaymentCell(null)}>关闭</button>
            </header>

            <div className="payment-amount-edit">
              <label htmlFor="payment-amount-field">金额(可修改)</label>
              <div className="payment-amount-row">
                <input
                  id="payment-amount-field"
                  className="payment-amount-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="金额"
                  value={edits[amountKey(year, selectedPaymentCell.rowId, selectedPaymentCell.month)] ?? selectedPaymentCell.amount}
                  onChange={(event) =>
                    onEdit(amountKey(year, selectedPaymentCell.rowId, selectedPaymentCell.month), event.target.value)
                  }
                />
                {edits[paidKey(year, selectedPaymentCell.rowId, selectedPaymentCell.month)] === "paid" ? (
                  <span className="payment-amount-rose" aria-label="已付款">🌹</span>
                ) : null}
              </div>
            </div>

            <div className="payment-status-actions" aria-label="付款状态">
              <button
                className={edits[paidKey(year, selectedPaymentCell.rowId, selectedPaymentCell.month)] === "paid" ? "" : "selected"}
                type="button"
                onClick={() => onEdit(paidKey(year, selectedPaymentCell.rowId, selectedPaymentCell.month), "unpaid")}
              >
                未付款
              </button>
              <button
                className={edits[paidKey(year, selectedPaymentCell.rowId, selectedPaymentCell.month)] === "paid" ? "selected" : ""}
                type="button"
                onClick={() => onEdit(paidKey(year, selectedPaymentCell.rowId, selectedPaymentCell.month), "paid")}
              >
                付款
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
