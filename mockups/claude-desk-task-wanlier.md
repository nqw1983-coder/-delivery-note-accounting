# 给 Claude desk 的任务：新增万李二并修复手机收款确认重叠

请在项目 `/Users/nqw1983163.com/Documents/送货单记账简化版` 里实现下面改动。先看 mock：

- mock 页面：`/Users/nqw1983163.com/Documents/送货单记账简化版/mockups/wanlier-mobile-mock.html`
- mock 截图：`/Users/nqw1983163.com/Documents/送货单记账简化版/mockups/wanlier-mobile-mock.png`

## 目标

1. 手机当日明细页，店铺列表在“万杨”下面新增一栏“万李二”。
2. 手机当日明细页顶部店铺按钮也新增“万李二”。
3. 原来 11 家有名客户 + 2 个空白，改成 12 家有名客户 + 1 个空白，总行数仍保持 13 行。
4. 店铺收款确认页也新增“万李二”这一行，位置同样在“万杨”下面。
5. 修复手机店铺收款确认页数字重叠问题。现在填了数字以后，5月、6月这类相邻列容易挤在一起，必须调整到不会重叠。

## 建议改动文件

### 1. `src/data/seedData.ts`

把默认店铺列表从：

```ts
["万醉", "万杨", "吾湘", "吾黄", "吾醉", "萍姐", "柳", "保黄", "保4楼", "五洲", "至尊"]
```

改为：

```ts
["万醉", "万杨", "万李二", "吾湘", "吾黄", "吾醉", "萍姐", "柳", "保黄", "保4楼", "五洲", "至尊"]
```

注意：只追加/插入“万李二”，不要删除或改名已有店铺。

### 2. `src/components/MobileDayDetail.tsx`

当前写死：

```ts
const MAX_LABELED_STORES = 11;
const TOTAL_STORE_SLOTS = 13;
```

改成：

```ts
const MAX_LABELED_STORES = 12;
const TOTAL_STORE_SLOTS = 13;
```

这样顶部按钮显示 12 个店铺按钮，不再显示顶部空白按钮；下面列表是 12 个店铺 + 1 个空白。

检查这段逻辑：

```ts
const topStores = displayedStores.slice(0, MAX_LABELED_STORES);
const topBlankCount = Math.max(12 - topStores.length, 1);
```

这里会导致即使已经有 12 个店铺，顶部仍然补 1 个空白。请改成：

```ts
const topStores = displayedStores.slice(0, MAX_LABELED_STORES);
const topBlankCount = Math.max(12 - topStores.length, 0);
```

### 3. `src/components/ShopPaymentModal.tsx`

这个页接收的 `shops` 来自默认店铺列表，所以新增万李二后会自动多一行。请确认“万李二”显示在“万杨”下面。

如果空白预留行数量因为店铺增加而少一行，这是正常的，不要把总行数继续加大。

### 4. `src/styles.css`

重点修复手机付款表格重叠。

建议方向：

```css
.mobile-shoppayment-shell .payment-table {
  width: max-content;
  min-width: 760px;
}

.mobile-shoppayment-shell .payment-table th:first-child {
  position: sticky;
  left: 0;
  z-index: 2;
  width: 86px;
}

.mobile-shoppayment-shell .payment-table th:not(:first-child),
.mobile-shoppayment-shell .payment-table td {
  width: 56px;
  min-width: 56px;
}

.mobile-shoppayment-shell .payment-cell-button {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: clamp(11px, 3.2vw, 15px);
  line-height: 1.1;
}
```

可以按实际 CSS 结构微调，但结果必须满足：

- 手机付款页可以左右滑动。
- 左侧店铺名最好固定，方便看是哪家店。
- 数字不能压到隔壁月份。
- 长数字要么缩小，要么省略显示，但不能重叠。

## 验证要求

请实际运行并验证：

1. `npm run build` 通过。
2. 手机宽度下打开页面，进入当日明细：
   - 顶部有“万李二”按钮。
   - 列表里“万李二”在“万杨”下面。
   - 只剩 1 行“空白”。
3. 进入“店铺收款确认”：
   - 有“万李二”行。
   - 在手机宽度下，填入或显示 4 位数字、带小数数字时，不和相邻月份重叠。
4. 生成截图或说明实际验证结果。

## 注意

- 不要部署。
- 不要改密码。
- 不要删除云端数据。
- 不要改 Supabase schema。
- 不要把 API Key 写进代码。
- 不要修改 `shopMemory.ts` 已有条目。
