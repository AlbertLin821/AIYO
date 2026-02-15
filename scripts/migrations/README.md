# 資料庫遷移說明

## 自動初始化（推薦）

使用 Docker Compose 首次啟動 PostgreSQL 時，`init-db.sql` 會自動執行並建立所有資料表。

## 手動遷移

若資料庫已存在或需要在既有環境執行遷移：

```bash
# 使用 psql 連線並執行
psql -U aiyo -d aiyo_db -f scripts/migrations/001_initial_schema.sql
```

##  migration 編號規則

- `001_`：初始 Schema
- 後續遷移依序為 `002_`, `003_` 等
- 檔名建議：`NNN_描述.sql`
