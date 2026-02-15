# AIYO 愛遊 - 互動式旅遊網站專案

## 專案概述

**專案名稱**：AIYO 愛遊  
**生成日期**：2026-02-14 19:39 CST  
**適用對象**：國立嘉義大學資管系學生專題

### 專案目標

AIYO 愛遊是一個互動式旅遊網站，提供以下核心功能：

- 提供一個互動式網站，讓使用者用自然語言（語音＋文字）和 AI 對話
- AI 能從對話中理解旅遊需求，推薦相關的 YouTube 旅遊影片
- 自動切出影片片段，標註出每個片段對應的景點與內容
- 整合地圖與行程規劃，產出可分享、可多人共編的旅遊行程

### 核心使用者輪廓

- **年齡層**：18–45 歲，習慣刷 Reels / YouTube 旅遊影片
- **使用習慣**：懶得打字，偏好語音與「按幾個按鈕就好」
- **痛點**：旅遊前會看大量影片找靈感，但覺得資訊分散、難整理成行程

---

## 文件結構

本專案規格文件已拆分為以下檔案，方便開發團隊查閱：

### 核心規格文件

1. **[使用者需求規格書.md](./docs/使用者需求規格書.md)** (URS)
   - 使用情境與使用者故事
   - 核心功能需求
   - UX 設計要點

2. **[系統需求規格書.md](./docs/系統需求規格書.md)** (SRS)
   - 系統整體架構
   - 影片索引與片段切割技術
   - 對話系統與 RAG 實作
   - 行程規劃與地圖整合

### 技術與實作文件

3. **[技術實作指南.md](./docs/技術實作指南.md)**
   - OpenAI → Ollama/vLLM 替代方案
   - 模型選擇與比較
   - vLLM + Kubernetes 生產部署
   - FastAPI Gateway 實作範例

4. **[部署與成本評估.md](./docs/部署與成本評估.md)**
   - 專案一次性成本
   - 月營運成本估算
   - 收入來源與盈餘分析

5. **[開發路線圖.md](./docs/開發路線圖.md)**
   - 開發時間表（Week 1-7）
   - 各階段技術重點
   - MVP 部署建議

6. **[文獻參考.md](./docs/文獻參考.md)**
   - 旅遊推薦與影片分段相關研究
   - API 官方文件連結
   - LLM 與本地部署參考資料

---

## 快速開始

### 技術棧總覽

```
[ 前端 ] Next.js 14 + React + TypeScript + Tailwind CSS
   |
   |  REST / WebSocket
   v
[ API Gateway ] Node.js + Express + Prisma
   |
   |  HTTP / gRPC
   v
[ AI Service ] Python + FastAPI + vLLM (Qwen3-8B)
   |
   |  DB / Cache / External APIs
   v
[ PostgreSQL + pgvector ] [ Redis ] [ YouTube API / Maps API / Whisper ]
```

### 開發環境需求

- **前端**：Node.js 18+, npm/yarn/pnpm
- **後端**：Node.js 18+, Python 3.10+
- **資料庫**：PostgreSQL 14+ (with pgvector extension)
- **快取**：Redis 6+
- **AI 模型**：vLLM 或 Ollama（支援 Qwen3-8B / Llama3.3-8B）

### 開發階段建議

1. **Week 1-2**：影片索引原型（YouTube API + Whisper + Embedding）
2. **Week 3-4**：RAG + 對話後端（FastAPI + vLLM）
3. **Week 5-6**：前端 UI（Next.js + Tailwind + shadcn/ui）
4. **Week 7**：MVP 部署（Railway / Render + Supabase）

詳細開發路線請參考 [開發路線圖.md](./docs/開發路線圖.md)

---

## 專案特色

### 1. 語音優先設計
- 使用 Web Speech API 支援語音輸入
- 降低使用者輸入門檻，符合目標族群使用習慣

### 2. 影片語意分段
- 使用 Semantic Segmentation 技術自動切割影片
- 結合 Embedding 與向量搜尋，精準定位景點片段

### 3. AI 驅動行程規劃
- RAG (Retrieval-Augmented Generation) 技術整合
- 結合 Google Maps API 進行路線優化與時間估算

### 4. 本地 LLM 部署
- 使用 vLLM 部署 Qwen3-8B / Llama3.3-8B
- 降低 API 成本，提升資料隱私

---

## 相關文件

- [規格.md](./docs/規格.md) - 原始完整規格文件（已拆分，保留作為參考）
- [文獻.md](./docs/文獻.md) - 相關研究文獻整理

---

## 聯絡資訊

本專案為國立嘉義大學資訊管理學系學生專題，為以下第 21 屆畢業專題組員共同所有：

- **1124525** 楊棻晴
- **1124527** 鄭郁馨
- **1124531** 張曜婷
- **1124539** 林子烜
- **1124540** 徐繹承

如有問題或建議，請參考各規格文件中的詳細說明。
