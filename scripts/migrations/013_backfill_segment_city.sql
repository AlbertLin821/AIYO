-- 將 segments.city 從父影片 videos.city 補齊（歷史資料與舊版索引器未寫入 city 時）
UPDATE segments s
SET city = v.city
FROM videos v
WHERE s.video_id = v.id
  AND (s.city IS NULL OR TRIM(s.city) = '')
  AND v.city IS NOT NULL
  AND TRIM(v.city) <> '';
