import type { AmountCell, MonthData, ShopName } from "../types/dashboard";

export const years = [2026, 2027, 2028];

export const shops: ShopName[] = ["万醉", "万杨", "万李二", "吾湘", "吾黄", "吾醉", "萍姐", "柳", "保黄", "保4楼", "五洲", "至尊"];

const now = "2026-05-29T00:00:00.000Z";

const cell = (...amounts: number[]): AmountCell => ({
  parts: amounts.map((amount, index) => ({
    id: `part-${amount}-${index}`,
    amount,
    status: "已确认",
    createdAt: now,
  })),
  updatedAt: now,
});

const emptyMonth = (year: number, month: number): MonthData => ({
  year,
  month,
  stores: [...shops],
  cells: {},
  createdAt: now,
  updatedAt: now,
});

export const initialMonths: MonthData[] = [
  {
    ...emptyMonth(2026, 5),
    cells: {
      2: { 吾湘: cell(52, 165) },
      5: { 吾黄: cell(86) },
      9: { 吾醉: cell(165) },
      12: { 萍姐: cell(130) },
      16: { 柳: cell(72) },
      21: { 吾湘: cell(96), 吾黄: cell(48) },
      26: { 吾醉: cell(120), 萍姐: cell(64) },
    },
  },
  emptyMonth(2026, 4),
  emptyMonth(2026, 3),
  emptyMonth(2026, 2),
  emptyMonth(2026, 1),
];

export const createEmptyMonth = (year: number, month: number): MonthData => {
  const createdAt = new Date().toISOString();

  return {
    year,
    month,
    stores: [...shops],
    cells: {},
    createdAt,
    updatedAt: createdAt,
  };
};
