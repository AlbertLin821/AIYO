# 僅執行資料庫遷移（PostgreSQL 已啟動後使用）
$Root = Split-Path -Parent $PSScriptRoot
Set-Location "$Root\api-gateway"
npm run migrate:deploy
exit $LASTEXITCODE
