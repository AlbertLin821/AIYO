# AIYO 本機測試前置作業（Windows PowerShell）
# 用法：於專案根目錄執行 .\scripts\prepare-local-test.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "== AIYO 本機測試準備 ==" -ForegroundColor Cyan

Write-Host "`n[1/5] npm install（api-gateway、frontend）..." -ForegroundColor Yellow
npm install --prefix "$Root\api-gateway" --silent
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm install --prefix "$Root\frontend" --silent
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n[2/5] pip install（ai-service）..." -ForegroundColor Yellow
python -m pip install -r "$Root\ai-service\requirements.txt" -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n[3/5] pip install（video-indexer，可選）..." -ForegroundColor Yellow
if (Test-Path "$Root\video-indexer\requirements.txt") {
  python -m pip install -r "$Root\video-indexer\requirements.txt" -q
}

Write-Host "`n[4/5] Docker：PostgreSQL + Redis..." -ForegroundColor Yellow
try {
  docker compose -f "$Root\docker-compose.yml" up -d postgres redis 2>&1 | Out-Host
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  等待 PostgreSQL 就緒（最多 45 秒）..." -ForegroundColor Gray
    $deadline = (Get-Date).AddSeconds(45)
    $ready = $false
    while ((Get-Date) -lt $deadline -and -not $ready) {
      try {
        docker exec aiyo-postgres pg_isready -U aiyo -d aiyo_db 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true }
      } catch {}
      if (-not $ready) { Start-Sleep -Seconds 2 }
    }
    if ($ready) {
      Write-Host "  PostgreSQL 已就緒。" -ForegroundColor Green
    } else {
      Write-Host "  警告：無法確認 pg_isready，仍會嘗試遷移。" -ForegroundColor DarkYellow
    }
  }
} catch {
  Write-Host "  Docker 未啟動或無法連線：請啟動 Docker Desktop 後再執行本腳本，或自行啟動本機 PostgreSQL。" -ForegroundColor DarkYellow
}

Write-Host "`n[5/5] 資料庫遷移（scripts/migrations）..." -ForegroundColor Yellow
Push-Location "$Root\api-gateway"
if (-not $env:DATABASE_URL) {
  $env:DATABASE_URL = "postgresql://aiyo:aiyo_password@localhost:5432/aiyo_db"
  Write-Host "  PowerShell 未設定 DATABASE_URL，已設預設值（與 docker-compose 一致）；migrate 仍會讀取專案根目錄 .env。" -ForegroundColor Gray
}
npm run migrate:deploy
$migrateOk = $LASTEXITCODE -eq 0
Pop-Location
if (-not $migrateOk) {
  Write-Host "  遷移失敗：請確認 PostgreSQL 已啟動且 DATABASE_URL 正確（專案根目錄 .env）。" -ForegroundColor Red
} else {
  Write-Host "  遷移完成。" -ForegroundColor Green
}

Write-Host "`n[檢查] ai-service 單元測試..." -ForegroundColor Yellow
Push-Location "$Root\ai-service"
python -m unittest discover -s tests -q
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  exit $LASTEXITCODE
}
Pop-Location
Write-Host "  測試通過。" -ForegroundColor Green

Write-Host "`n[環境檢查] node scripts/deploy/validate_env.mjs --target=all" -ForegroundColor Yellow
Set-Location $Root
node scripts/deploy/validate_env.mjs --target=all
$envExit = $LASTEXITCODE

Write-Host "`n== 後續步驟（請手動） ==" -ForegroundColor Cyan
Write-Host "1. 若尚未設定專案根目錄 .env：複製 .env.example 為 .env 並填入金鑰（勿提交 .env）。"
Write-Host "2. Ollama：安裝並啟動後執行（模型名稱請對照 .env 的 OLLAMA_MODEL / OLLAMA_EMBED_MODEL）："
Write-Host "   ollama pull nomic-embed-text"
Write-Host "   ollama pull qwen3:8b"
Write-Host "   （若 docker-compose 的 ollama 服務無法啟動 GPU，建議改用本機 Ollama 安裝版。）"
Write-Host "3. 啟動服務（三個終端機）："
Write-Host "   cd api-gateway && npm run dev"
Write-Host "   cd ai-service && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
Write-Host "   cd frontend && npm run dev"
Write-Host "4. 瀏覽器開啟前端（通常 http://localhost:3000），API Gateway 為 http://localhost:3001 。"

if ($envExit -ne 0) {
  Write-Host "`nvalidate_env 有缺項或仍為占位值，請補齊 .env 後再測完整功能。" -ForegroundColor DarkYellow
}

Write-Host "`n完成。" -ForegroundColor Green
