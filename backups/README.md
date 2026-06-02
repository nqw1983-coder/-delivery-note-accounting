# 自动备份

每天北京时间 18:05 由 `.github/workflows/daily-backup.yml` 自动更新。

## 文件

- `YYYY-MM.csv` — 二维表(日期 × 客户),跟 App 表格视觉一致,UTF-8 BOM,Excel 直接打开不乱码
- `snapshot.json` — 完整 JSON 快照,含所有元信息,用于灾难恢复

## 恢复任意一天的数据

```bash
# 看 2026-06-01 当时的 5 月备份
git show `git rev-list -n 1 --before=2026-06-01 master`:backups/2026-05.csv

# 或在 GitHub 网页:打开 backups 目录 → 点任意 CSV → 右上 History → 看每天差异
```

## 手动跑备份(本地)

```bash
node scripts/daily-backup.mjs
```
