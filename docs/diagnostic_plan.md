# AIYO Project Diagnostic & Optimization Plan

## 1. Problem Statement
**Symptoms:**
- AI Assistant provides imprecise video recommendations.
- AI Assistant fails to effectively present/display specific video content (timestamps, segments) to the user.
- The retrieval process seems to miss relevant segments even when they exist in the database.

**Core Hypothesis:**
The failure stems from a breakdown in the **RAG (Retrieval-Augmented Generation) Pipeline**, specifically:
1.  **Retrieval Gap**: The initial retrieval uses keyword-based `ILIKE` matching, which lacks semantic depth and fails on synonyms.
2.  **Context Gap**: The prompt provided to the LLM does not sufficiently emphasize the importance of the `segment_id`, `start_sec`, and `end_sec` metadata.
3.  **Reasoning Gap**: The Agent's instructions do not explicitly guide it to "extract and format" the video segments into a user-friendly, interactive format.

---

## 2. Phase 1: Deep-Dive Diagnostics (Investigation)

### A. Retrieval Pipeline Audit
**Target Files:** `ai-service/app/main.py`, `ai-service/app/reranker.py`, `ai-service/app/tools/youtube.py`
- [ ] **Query Analysis**: Inspect how `enhanced_query` is constructed. Is it losing semantic meaning by aggregating too many keywords?
- [ ] **Search Pattern Analysis**: Evaluate the `ILIKE` SQL logic. Does it allow for enough coverage, or is it too restrictive?
- [ ] **Embedding/Vector Check**: Check if `pgvector` distance calculations are being utilized effectively or if they are being overshadowed by the keyword `ILIKE` results.
- [ ] **Re-ranking Audit**: Analyze `reranker.py` to see if the re-ranking step is actually adding value or just re-ordering a poor initial set.

### B. Prompt & Agent Logic Audit
**Target 	Files:** `ai-service/app/tools/agent.py`, `ai-service/app/main.py`
- [ ] **System Prompt Extraction**: Identify the exact `System Message` used to initialize the Agent.
- [ ] **Context Injection Analysis**: Trace how `build_rag_context` results are inserted into the prompt. Are the timestamps and segment IDs clearly delimited?
- [ ] **Tool Output Analysis**: Check if the `travel_info` and `youtube` tool outputs are being truncated or simplified before being passed to the LLM.

---

## 3. Phase 2: Proposed Optimization Strategies

### Strategy 1: Hybrid Search Implementation (Retrieval)
- **Action**: Replace/Augment `ILIKE` with a **Hybrid Search** approach:
    - **Dense Retrieval**: Use `vector <=> %s` (Cosine Similarity) as the primary driver.
    - **Sparse Retrieval**: Keep a lightweight keyword match (BM25 style) for specific entities (e.g., "Kaohsiung").
- **Benefit**: Improves recall for semantic queries and precision for exact name queries.

### Strategy 2: Semantic Chunking & Metadata Enrichment (Data)
- **Action**: Update the `video-indexer` logic to use **Semantic Chunking** (splitting by meaning rather than fixed length) and ensure `metadata` (title, channel, timestamp) is always attached to every chunk.
- **Benefit**: Prevents single-context segments from being "lost" or "broken" during retrieval.

###Strategy 3: Prompt Engineering & Chain-of-Thought (Reasoning)
- **Action**: Redesign the Agent's System Prompt:
    - **Instruction**: "When a user asks about a location, first scan the retrieved segments. Identify the `start_sec` and `end_sec` of the relevant parts. Then, describe the content and present it as [Video Title] (at 0:00)."
    - **Few-Shot Examples**: Provide 2-3 examples of a "Bad Response" vs. a "Good Response" within the prompt.
- **Benefit**: Directly addresses the "AI is too dumb to show content" issue.

---

## 4. Execution Timeline
1.  **Day 1**: Complete Diagnostic (Files inspected and findings documented).
2.  **Day 2**: Implementation of Hybrid Search and Reranker improvements.
3.  **Day 3**: Prompt Engineering and System Message redesign.
4.  **Day 4**: Integration testing and performance benchmarking.
