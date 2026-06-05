import type { ChangeEvent, RefObject } from "react";
import { Download, Plus, RefreshCw, Save, Search, Settings } from "lucide-react";
import type { MonthData } from "../types/dashboard";
import { years } from "../data/seedData";

interface SidebarProps {
  selectedYear: number;
  selectedMonth: number;
  isShopPaymentActive: boolean;
  months: MonthData[];
  searchText: string;
  onSelectYear: (year: number) => void;
  onSelectMonth: (year: number, month: number) => void;
  onSearchTextChange: (value: string) => void;
  onAddMonth: () => void;
  onYearlyStats?: () => void;  // 暂保留以兼容 App 调用,组件内不再使用
  onShopPayment: () => void;
  onExport: () => void;
  onOpenSettings: () => void;
  onSync?: () => void;
  syncing?: boolean;
  // 以下扫描相关 prop 保留以兼容父组件,组件内已不再渲染
  fileInputRef?: RefObject<HTMLInputElement>;
  fileName?: string | null;
  onFileChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onStartScan?: () => void;
  scanning?: boolean;
  pendingCount?: number;
  getMonthTotal?: (month: MonthData) => number;
}

const monthSlots = Array.from({ length: 12 });

const formatMonthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export function Sidebar({
  selectedYear,
  selectedMonth,
  isShopPaymentActive,
  months,
  searchText,
  onSelectYear,
  onSelectMonth,
  onSearchTextChange,
  onAddMonth,
  onShopPayment,
  onExport,
  onOpenSettings,
  onSync,
  syncing,
}: SidebarProps) {
  const normalizedSearch = searchText.trim();
  const visibleMonths = months
    .filter((item) => item.year === selectedYear)
    .filter((item) => {
      if (!normalizedSearch) {
        return true;
      }

      const values = [
        String(item.year),
        String(item.month),
        `${item.year}年${item.month}月`,
        formatMonthKey(item.year, item.month),
      ];

      return values.some((value) => value.includes(normalizedSearch));
    })
    .sort((a, b) => b.month - a.month);

  return (
    <aside className="sidebar" aria-label="月份和上传区域">
      <div>
        <div className="brand-row">
          <h1>送货单记账</h1>
          <div className="brand-actions">
            <button className="icon-button" type="button" aria-label="识别服务设置" onClick={onOpenSettings}>
              <Settings size={18} />
            </button>
            <button
              className={`icon-button ${syncing ? "icon-spinning" : ""}`}
              type="button"
              aria-label="保存并同步云端"
              onClick={onSync}
              disabled={syncing}
              title="保存并同步:上传本地待保存数据,再拉取云端最新数据"
            >
              {syncing ? <RefreshCw size={18} /> : <Save size={18} />}
            </button>
            <button className="icon-button" type="button" aria-label="导出数据" onClick={onExport}>
              <Download size={18} />
            </button>
            <button className="icon-button primary-icon" type="button" aria-label="增加月份" onClick={onAddMonth}>
              <Plus size={18} />
            </button>
          </div>
        </div>

        <select
          className="year-select"
          value={selectedYear}
          onChange={(event) => onSelectYear(Number(event.target.value))}
          aria-label="选择年份"
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>

        <button
          className={`payment-entry-button ${isShopPaymentActive ? "selected" : ""}`}
          type="button"
          onClick={onShopPayment}
        >
          店铺收款确认
        </button>

        <label className="search-box">
          <Search size={16} />
          <input
            type="search"
            placeholder="搜索月份"
            aria-label="搜索月份"
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </label>

        <div className="month-list" aria-label="月份列表">
          {monthSlots.map((_, index) => {
            const month = visibleMonths[index];

            if (!month) {
              return <div className="month-row month-empty" key={`empty-${index}`} aria-hidden="true" />;
            }

            const isSelected = !isShopPaymentActive && month.month === selectedMonth;

            return (
              <button
                className={`month-row ${isSelected ? "selected" : ""}`}
                key={`${month.year}-${month.month}`}
                type="button"
                onClick={() => onSelectMonth(month.year, month.month)}
              >
                <span>{month.year}年{month.month}月</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 扫描区已按用户要求移除(本布局不再使用 OCR 扫描) */}
    </aside>
  );
}
