# Claude desk 一键复制任务：万李二 + 收款确认固定店铺列 + iPad 改 iPhone 界面

请在项目 `/Users/nqw1983163.com/Documents/送货单记账简化版` 中实现下面需求。

先看参考 mock 和截图：

- mock 页面：`/Users/nqw1983163.com/Documents/送货单记账简化版/mockups/wanlier-mobile-mock.html`
- mock 截图：`/Users/nqw1983163.com/Documents/送货单记账简化版/mockups/wanlier-mobile-mock.png`
- Codex 已验证截图：`/Users/nqw1983163.com/Documents/送货单记账简化版/mockups/wanlier-implemented-daydetail.png`
- Codex 已验证截图：`/Users/nqw1983163.com/Documents/送货单记账简化版/mockups/wanlier-dev-payment-final.png`

## 总目标

1. 新增店铺“万李二”，位置在“万杨”下面。
2. 当日明细页顶部店铺按钮增加“万李二”。
3. 当日明细页列表增加“万李二”。
4. 原来 11 家有名店铺 + 2 个空白，改成 12 家有名店铺 + 1 个空白，总数仍保持 13。
5. 店铺收款确认页增加“万李二”行，位置在“万杨”下面。
6. 店铺收款确认页左侧店铺列固定不动，右侧 1月到12月可以左右滑动。
7. 店铺收款确认页数字不能和相邻月份重叠。
8. iPad 界面改成 iPhone 那套界面：月份账本、当日明细、店铺本月明细、店铺收款确认，都使用现在 iPhone 的双屏/多屏流程。
9. Mac 桌面浏览器先保留原来的桌面表格界面，不要一起改。

## 重要边界

- 不要部署。
- 不要改密码。
- 不要删除云端数据。
- 不要改 Supabase schema。
- 不要把 API Key 写进代码。
- 不要修改 `shopMemory.ts` 已有条目。
- 不要删除或改名已有店铺，只能插入“万李二”。
- 如果仓库里已经有 Codex 做过的同类改动，可以复用；请检查是否完整，不要重复制造冲突。

## 建议改动 1：默认店铺名单

文件：`src/data/seedData.ts`

把默认店铺列表改成：

```ts
export const shops: ShopName[] = [
  "万醉",
  "万杨",
  "万李二",
  "吾湘",
  "吾黄",
  "吾醉",
  "萍姐",
  "柳",
  "保黄",
  "保4楼",
  "五洲",
  "至尊",
];
```

还要注意：老板打开的是已有月份，不一定是新建月份。旧月份 `stores` 里可能没有“万李二”，所以要在读取本地月份数据时自动补默认店铺。

建议在 `src/lib/dashboardStore.ts` 里处理：

```ts
import { createEmptyMonth, initialMonths, shops } from "../data/seedData";

function normalizeMonthStores(months: MonthData[]): MonthData[] {
  return months.map((month) => ({
    ...month,
    stores: [...shops, ...month.stores.filter((shop) => !shops.includes(shop))],
  }));
}
```

然后 `loadStoredMonths()` 返回数据前统一过一遍 `normalizeMonthStores()`。

## 建议改动 2：手机当日明细 12 家 + 1 空白

文件：`src/components/MobileDayDetail.tsx`

把：

```ts
const MAX_LABELED_STORES = 11;
const TOTAL_STORE_SLOTS = 13;
```

改成：

```ts
const MAX_LABELED_STORES = 12;
const TOTAL_STORE_SLOTS = 13;
```

把顶部空白按钮逻辑从至少补 1 个空白，改成不强制补空白：

```ts
const topStores = displayedStores.slice(0, MAX_LABELED_STORES);
const topBlankCount = Math.max(12 - topStores.length, 0);
```

结果必须是：

- 顶部 12 个店铺按钮：万醉、万杨、万李二、吾湘、吾黄、吾醉、萍姐、柳、保黄、保4楼、五洲、至尊。
- 列表 12 个店铺 + 1 个空白。
- “万李二”在“万杨”下面。

## 建议改动 3：iPad 也使用 iPhone 界面

当前 `src/lib/useMobile.ts` 只按宽度判断：

```ts
useMobile(760)
```

这会导致 iPad 横屏走桌面表格。请改成：iPhone 和 iPad 都返回 true，Mac 桌面普通浏览器仍按宽度判断。

建议方向：

```ts
function isAppleTouchDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIPhoneOrIPad = /iPhone|iPad/i.test(ua);
  const isModernIPad = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return isIPhoneOrIPad || isModernIPad;
}
```

`useMobile()` 的初始值和监听更新都要同时考虑：

- `window.matchMedia(max-width)` 为 true，返回 true。
- iPhone/iPad 设备返回 true。
- Mac 桌面大屏返回 false。

建议把函数名保留为 `useMobile`，少动调用处。调用处 `const isMobile = useMobile(760);` 可以不改。

iPad 改完后的效果：

- iPad 横屏 1112×834：显示 iPhone 那套月份账本，不显示左侧 sidebar 和桌面二维月表。
- iPad 竖屏 834×1112：也显示 iPhone 那套月份账本。
- 点月份进入当日明细。
- 点顶部店铺进入该店本月明细。
- 店铺收款确认入口可用。
- Mac 桌面宽屏仍显示原桌面表格。

## 建议改动 4：桌面/iPad 原月表和导出同步 12 家

虽然 iPad 将改成手机界面，但 Mac 桌面和导出也要跟上“万李二”。

文件：`src/components/MonthTable.tsx`

把：

```ts
const MAX_LABELED_STORES = 11;
```

改成：

```ts
const MAX_LABELED_STORES = 12;
```

仍保持 `TOTAL_STORE_COLUMNS = 13`，这样是 12 家 + 1 空白，不增加总列数。

文件：`src/lib/exporter.ts`

把：

```ts
const MAX_LABELED_STORES = 11;
```

改成：

```ts
const MAX_LABELED_STORES = 12;
```

导出 Excel/CSV 要能看到“万李二”列。

## 建议改动 5：店铺收款确认固定左列，右侧月份滑动

文件：`src/components/ShopPaymentModal.tsx`

一般不需要大改组件结构，因为表格已经有“店铺”列 + 12个月列。新增“万李二”后会自动多一行。请确认“万李二”在“万杨”下面。

文件：`src/styles.css`

重点修手机/iPad 的店铺收款确认页面：

```css
.mobile-shoppayment-shell .payment-table-shell {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.mobile-shoppayment-shell .payment-table {
  width: max-content;
  min-width: 698px;
  height: auto;
}

.mobile-shoppayment-shell .payment-table th:first-child {
  position: sticky;
  left: 0;
  z-index: 2;
  width: 74px;
  min-width: 74px;
  background: #f7faf7;
}

.mobile-shoppayment-shell .payment-table thead th:first-child {
  z-index: 3;
}

.mobile-shoppayment-shell .payment-table th:not(:first-child),
.mobile-shoppayment-shell .payment-table td {
  width: 52px;
  min-width: 52px;
}

.mobile-shoppayment-shell .payment-cell-button {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: clamp(10px, 3vw, 14px);
  line-height: 1.1;
}
```

可以按实际效果微调尺寸，但必须满足：

- 左侧店铺列不动。
- 右侧月份可以横向滑动。
- 数字不能压到隔壁月份。
- 5 位数字、小数都不能重叠。

## 验证要求

必须实际运行验证，不要只说理论上可以。

1. `npm run build` 通过。
2. iPhone 宽度 390×844：
   - 月份账本正常。
   - 当日明细顶部有“万李二”。
   - 当日明细列表“万李二”在“万杨”下面。
   - 列表只剩 1 个空白。
   - 店铺收款确认有“万李二”行。
   - 店铺收款确认左侧店铺列固定，右侧月份可滑动，数字不重叠。
3. iPad 横屏 1112×834：
   - 进入后显示 iPhone 那套月份账本，不显示桌面 sidebar 和二维月表。
   - 点月份能进入当日明细。
   - 店铺收款确认能打开，左侧店铺列固定，右侧月份可滑动。
4. iPad 竖屏 834×1112：
   - 同样显示 iPhone 那套界面。
5. Mac 桌面宽屏：
   - 仍显示桌面表格。
   - 桌面表格包含“万李二”列，且总客户列仍保持 13 个位置。
6. 生成截图交给 Codex 审查：
   - iPhone 当日明细截图。
   - iPhone 店铺收款确认截图。
   - iPad 横屏月份账本截图。
   - iPad 横屏店铺收款确认截图。
   - Mac 桌面表格截图。

## 交付给 Codex 审查时请说明

- 改了哪些文件。
- `npm run build` 是否通过。
- 截图路径。
- 有没有未完成或拿不准的地方。
