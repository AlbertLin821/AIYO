-- Migration 003: 為 segments 新增 tags 欄位
-- 若資料庫為舊版 schema（含 transcript 缺 tags），則新增 tags

ALTER TABLE segments ADD COLUMN IF NOT EXISTS tags JSONB;
