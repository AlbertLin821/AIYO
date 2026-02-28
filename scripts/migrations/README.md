# 資料庫遷移說明

## 原則

- 生產環境 migration 必須獨立執行，不可綁在服務啟動流程
- 本專案 migration 為可重複執行設計（使用 `IF NOT EXISTS` 與 idempotent SQL）

## 自動初始化（僅本地首次）

使用 Docker Compose 首次啟動 PostgreSQL 時，`init-db.sql` 會自動執行並建立核心資料表。

## 部署前手動遷移

建議在部署前由 CI/CD 或人工執行：

```bash
cd api-gateway
npm run migrate:dry-run
npm run migrate:deploy
```

執行結果：

- `migrate:dry-run`：列出即將執行的 migration 檔案
- `migrate:deploy`：依檔名順序套用 `scripts/migrations/*.sql`

## migration 編號規則

- `001_`：初始 schema
- 後續遷移依序為 `002_`, `003_` 等
- 檔名建議：`NNN_描述.sql`
