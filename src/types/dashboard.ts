export type ShopName = string;

export type AmountStatus = "已确认" | "待补充" | "疑似重复";

export interface AmountPart {
  id: string;
  amount: number;
  remark?: string;
  status: AmountStatus;
  createdAt: string;
}

export interface AmountCell {
  parts: AmountPart[];
  updatedAt: string;
}

export interface MonthData {
  year: number;
  month: number;
  stores: ShopName[];
  cells: Record<number, Partial<Record<ShopName, AmountCell>>>;
  createdAt: string;
  updatedAt: string;
}

export interface SelectedCell {
  day: number;
  shop: ShopName;
}
