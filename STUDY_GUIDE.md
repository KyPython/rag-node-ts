# RAG Node.js TypeScript Service - Study Guide

**Complete learning path for understanding and mastering this RAG implementation**

---

## 📚 Table of Contents

1. [Quick Overview](#quick-overview)
2. [Architecture Deep Dive](#architecture-deep-dive)
3. [Core Concepts](#core-concepts)
4. [Code Walkthrough](#code-walkthrough)
5. [Key Technologies](#key-technologies)
6. [Study Path](#study-path)
7. [Practice Exercises](#practice-exercises)
8. [Common Questions](#common-questions)

---

## 🎯 Quick Overview

### What is RAG?
**Retrieval-Augmented Generation (RAG)** combines:
- **Retrieval**: Finding relevant information from a knowledge base
- **Augmentation**: Adding that information to the LLM's context
- **Generation**: Using the LLM to generate answers based on retrieved context

### Why RAG?
- **Accuracy**: LLMs can hallucinate. RAG grounds answers in actual documents.
- **Up-to-date**: Can use latest documents without retraining the model
- **Transparency**: Shows which documents were used (citations)
- **Cost-effective**: Smaller models can work well with good context

### This Project
A production-ready RAG service that:
1. Ingests documents (PDFs, Markdown)
2. Stores them as vectors in Pinecone
3. Retrieves relevant passages for queries
4. Generates answers with citations

---

## 🏗️ Architecture Deep Dive

### High-Level Flow

```
User Query
    ↓
[Express Server] → Request ID, Logging, Metrics
    ↓
[Cache Layer] → Check if query was cached
    ↓ (if miss)
[Retriever] → Embed query → Search Pinecone → Get top-K passages
    ↓
[LLM Answer Generator] → Build prompt with contexts → Call OpenAI → Extract citations
    ↓
[Response] → Return answer + citations
```

### Component Breakdown

#### 1. **Ingestion Pipeline** (`src/rag/ingest.ts`)
```
Document (PDF/MD)
    ↓
Text Extraction
    ↓
Text Chunking (1000 chars, 200 overlap)
    ↓
Embedding Generation (OpenAI)
    ↓
Vector Storage (Pinecone)
```

**Key Functions:**
- `parsePDF()` - Extracts text from PDF files
- `parseMarkdown()` - Reads markdown files
- `chunkText()` - Splits documents into overlapping chunks
- `embedChunks()` - Converts text to vectors
- `upsertToPinecone()` - Stores vectors with metadata

#### 2. **Retrieval Pipeline** (`src/rag/retriever.ts`)
```
User Query
    ↓
Embed Query (OpenAI)
    ↓
Vector Search (Pinecone)
    ↓
Top-K Similar Passages
    ↓
Return with Scores & Metadata
```

**Key Functions:**
- `retrieveRelevantPassages()` - Main retrieval function
  - Embeds the query
  - Searches Pinecone for similar vectors
  - Returns passages with relevance scores

#### 3. **Answer Generation** (`src/llm/answer.ts`)
```
Retrieved Passages
    ↓
Build Prompt (System + User)
    ↓
Call OpenAI GPT
    ↓
Extract Citations ([p0], [p1], etc.)
    ↓
Return Answer + Citation Indices
```

**Key Functions:**
- `generateAnswer()` - Main answer generation
  - Constructs prompts with retrieved contexts
  - Calls OpenAI Chat API
  - Extracts citation references
  - Returns structured answer

#### 4. **Production Features**

**Caching** (`src/cache/cache.ts`)
- Redis (production) or In-Memory (development)
- Reduces API costs and latency
- Cache key: `rag:query:{mode}:{topK}:{base64(query)}`

**Metrics** (`src/metrics/metrics.ts`)
- Prometheus metrics
- HTTP request count and duration
- Exposed at `/metrics` endpoint

**Error Handling** (`src/middleware/errorHandler.ts`)
- Structured error responses
- Request ID tracking
- Distinguishes 4xx vs 5xx errors

**Request Tracking** (`src/middleware/requestId.ts`)
- Unique UUID per request
- Included in logs and responses
- Enables request tracing

---

## 💡 Core Concepts

### 1. **Vector Embeddings**

**What are they?**
- Numerical representations of text
- Similar text → similar vectors
- OpenAI embeddings: 1536 dimensions

**Example:**
```typescript
"machine learning" → [0.123, -0.456, 0.789, ...] (1536 numbers)
"artificial intelligence" → [0.125, -0.458, 0.791, ...] (very similar!)
"pizza recipe" → [0.999, 0.001, -0.500, ...] (very different!)
```

**Why use them?**
- Semantic search (not just keyword matching)
- "car" and "automobile" are close in vector space
- Enables natural language queries

### 2. **Text Chunking**

**Why chunk?**
- LLMs have context limits (e.g., 8K tokens)
- Documents are too long to embed as one piece
- Chunks allow granular retrieval

**Strategy:**
- Size: 1000 characters
- Overlap: 200 characters
- Why overlap? Preserves context at boundaries

**Example:**
```
Document: "The quick brown fox jumps over the lazy dog. The dog was sleeping."

Chunk 1: "The quick brown fox jumps over the lazy dog."
Chunk 2: "over the lazy dog. The dog was sleeping." (200 char overlap)
```

### 3. **Similarity Search**

**Cosine Similarity:**
- Measures angle between vectors
- Range: -1 to 1 (1 = identical, 0 = orthogonal, -1 = opposite)
- Formula: `cos(θ) = (A · B) / (||A|| × ||B||)`

**Pinecone Query:**
```typescript
index.query({
  vector: queryEmbedding,  // 1536-dimensional vector
  topK: 5,                 // Get top 5 most similar
  includeMetadata: true    // Include original text
})
```

### 4. **Prompt Engineering**

**System Prompt:**
- Instructs the LLM on behavior
- "Answer using ONLY provided contexts"
- "Cite sources with [p0], [p1]"

**User Prompt:**
- Contains the query
- Includes retrieved contexts
- Formatted for clarity

**Example:**
```
System: "You are a helpful assistant. Answer using only the provided contexts..."

User: "Query: What is machine learning?

Contexts:
Passage [p0]: Machine learning is a subset of AI...
Passage [p1]: ML algorithms learn from data...

Answer:"
```

### 5. **Citation Extraction**

**How it works:**
1. LLM generates answer with citations: `[p0]`, `[p1]`
2. Regex extracts citation indices: `/\[p(\d+)\]/g`
3. Maps indices back to original passages
4. Returns structured response with citations

---

## 🔍 Code Walkthrough

### Study Order (Recommended)

#### **Level 1: Understanding the Flow**

1. **Start with `src/index.ts`** (Main server)
   - See how requests flow through middleware
   - Understand the `/query` endpoint
   - See how caching works
   - Follow error handling

2. **Then `src/rag/retriever.ts`** (Retrieval)
   - How queries become embeddings
   - How Pinecone search works
   - What gets returned

3. **Then `src/llm/answer.ts`** (Answer generation)
   - How prompts are built
   - How LLM is called
   - How citations are extracted

#### **Level 2: Understanding Ingestion**

4. **`src/rag/ingest.ts`** (Document processing)
   - PDF parsing
   - Text chunking
   - Embedding generation
   - Pinecone upsert

5. **`src/scripts/ingestLocal.ts`** (CLI tool)
   - How to use the ingestion pipeline
   - Error handling
   - Logging

#### **Level 3: Production Features**

6. **`src/cache/cache.ts`** (Caching layer)
   - Redis vs In-Memory
   - Cache key generation
   - TTL management

7. **`src/metrics/metrics.ts`** (Observability)
   - Prometheus metrics
   - Request tracking
   - Performance monitoring

8. **`src/middleware/`** (Request handling)
   - Request ID generation
   - Error handling
   - Structured responses

#### **Level 4: Utilities**

9. **`src/utils/config.ts`** (Configuration)
   - Environment variable validation
   - Type-safe config

10. **`src/utils/logger.ts`** (Logging)
    - Structured JSON logging
    - Request ID integration

11. **`src/utils/truncation.ts`** (Cost optimization)
    - Context length limiting
    - Token estimation

---

## 🛠️ Key Technologies

### **LangChain.js**
- **Purpose**: LLM framework
- **Used for**: Embeddings, text splitting
- **Key Classes**:
  - `OpenAIEmbeddings` - Text to vectors
  - `RecursiveCharacterTextSplitter` - Document chunking

### **Pinecone**
- **Purpose**: Vector database
- **Used for**: Storing and searching embeddings
- **Key Operations**:
  - `upsert()` - Store vectors
  - `query()` - Search similar vectors

### **OpenAI API**
- **Purpose**: LLM and embeddings
- **Used for**:
  - Embeddings: `text-embedding-3-small` (or `ada-002`)
  - Chat: `gpt-4o-mini` (or `gpt-4`)

### **Express.js**
- **Purpose**: HTTP server
- **Used for**: API endpoints, middleware

### **TypeScript**
- **Purpose**: Type safety
- **Benefits**: Catch errors early, better IDE support

---

## 📖 Study Path

### **Week 1: Fundamentals**

**Day 1-2: RAG Concepts**
- [ ] Read this study guide
- [ ] Understand vector embeddings
- [ ] Understand similarity search
- [ ] Watch: "What is RAG?" videos

**Day 3-4: Code Structure**
- [ ] Read `README.md`
- [ ] Explore `src/` directory structure
- [ ] Understand the flow: Query → Retrieve → Answer
- [ ] Run the demo: `npm run demo-setup && npm run dev`

**Day 5-7: Core Components**
- [ ] Study `src/rag/retriever.ts`
- [ ] Study `src/llm/answer.ts`
- [ ] Study `src/index.ts` (query endpoint)
- [ ] Try queries via demo UI

### **Week 2: Deep Dive**

**Day 8-10: Ingestion Pipeline**
- [ ] Study `src/rag/ingest.ts`
- [ ] Understand chunking strategy
- [ ] Run ingestion: `npm run ingest -- samples/**/*.md`
- [ ] Check Pinecone dashboard

**Day 11-12: Production Features**
- [ ] Study caching (`src/cache/cache.ts`)
- [ ] Study metrics (`src/metrics/metrics.ts`)
- [ ] Study error handling (`src/middleware/errorHandler.ts`)
- [ ] Test `/metrics` endpoint

**Day 13-14: Integration**
- [ ] Understand how all pieces fit together
- [ ] Trace a request end-to-end
- [ ] Review error scenarios
- [ ] Review logging output

### **Week 3: Mastery**

**Day 15-17: Customization**
- [ ] Modify chunking strategy
- [ ] Adjust prompt templates
- [ ] Experiment with different models
- [ ] Tune cache TTL

**Day 18-21: Advanced Topics**
- [ ] Study vector search algorithms
- [ ] Understand embedding models
- [ ] Learn about hybrid search
- [ ] Explore query expansion

---

## 🏋️ Practice Exercises

### **Beginner**

1. **Run the Demo**
   ```bash
   npm run demo-setup
   npm run dev
   # Visit http://localhost:3000
   # Try different queries
   ```

2. **Ingest Your Own Documents**
   ```bash
   # Create a test document
   echo "# My Document\n\nThis is a test." > test.md
   # Ingest it
   npm run ingest -- test.md
   # Query it
   curl -X POST http://localhost:3000/query \
     -H "Content-Type: application/json" \
     -d '{"query": "What is in my document?", "topK": 3}'
   ```

3. **Explore the Code**
   - Add console.logs to trace execution
   - Modify chunk size and see the effect
   - Change the LLM model

### **Intermediate**

4. **Modify Chunking Strategy**
   - Change chunk size to 500 or 2000
   - Adjust overlap percentage
   - See how it affects retrieval quality

5. **Customize Prompts**
   - Edit `src/llm/answer.ts`
   - Change system prompt
   - Add instructions for different answer styles

6. **Add Filtering**
   - Filter by document source
   - Filter by date range
   - Filter by document type

### **Advanced**

7. **Implement Hybrid Search**
   - Combine vector search with keyword search
   - Use BM25 for keyword matching
   - Merge results with reranking

8. **Add Query Expansion**
   - Generate query variations
   - Use LLM to rewrite queries
   - Improve recall

9. **Optimize Performance**
   - Measure cache hit rates
   - Optimize embedding batch size
   - Implement async processing

---

## ❓ Common Questions

### **Q: Why 1536 dimensions?**
A: OpenAI's embedding models (`text-embedding-3-small`, `ada-002`) produce 1536-dimensional vectors. Pinecone index must match this dimension.

### **Q: Why chunk with overlap?**
A: Overlap preserves context at boundaries. Without it, information at chunk edges might be lost.

### **Q: How does caching work?**
A: Cache key is based on query + topK + mode. Identical queries return cached responses, saving API costs.

### **Q: What if a query has no relevant documents?**
A: The LLM is instructed to say "I cannot answer based on the provided context." Citations will be empty.

### **Q: How accurate are the citations?**
A: Citations are extracted from LLM output using regex. The LLM is instructed to cite sources, but accuracy depends on prompt quality.

### **Q: Can I use a different vector database?**
A: Yes! The retriever can be adapted. LangChain supports many vector stores (Weaviate, Qdrant, etc.).

### **Q: How do I improve answer quality?**
A: 
- Better chunking (experiment with size/overlap)
- Better prompts (refine system/user prompts)
- More relevant retrieval (increase topK, improve embeddings)
- Better models (use GPT-4 instead of GPT-4o-mini)

### **Q: What's the cost?**
A:
- Embeddings: ~$0.0001 per 1K tokens
- GPT-4o-mini: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
- Pinecone: Free tier available, then pay-per-use
- Caching reduces costs significantly

---

## 🎯 Key Takeaways

1. **RAG = Retrieval + Augmentation + Generation**
2. **Embeddings enable semantic search** (not just keywords)
3. **Chunking is critical** for good retrieval
4. **Citations provide transparency** and trust
5. **Caching reduces costs** dramatically
6. **Production features** (metrics, logging, error handling) are essential

---

## 📚 Additional Resources

### **Documentation**
- [LangChain.js Docs](https://js.langchain.com/)
- [Pinecone Docs](https://docs.pinecone.io/)
- [OpenAI API Docs](https://platform.openai.com/docs)

### **Concepts**
- Vector embeddings
- Cosine similarity
- Semantic search
- Prompt engineering
- RAG architecture patterns

### **This Project**
- `README.md` - Setup and usage
- `PORTFOLIO.md` - Showcase guide
- `SALES_DEMO_GUIDE.md` - Sales process
- `TESTING.md` - API testing
- `DEPLOYMENT.md` - Deployment guide

---

**Happy Learning! 🚀**

Start with the Quick Overview, then follow the Study Path. Practice with the exercises, and don't hesitate to explore the code!

