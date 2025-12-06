# Testing the RAG API

## Prerequisites

Before testing, ensure you have a `.env` file with valid credentials:

```bash
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=your-index-name
```

Also ensure:
1. The Pinecone index exists and has the correct dimensions (1536 for OpenAI embeddings)
2. You've ingested some documents first using: `npm run ingest -- path/to/file.pdf`

## Starting the Server

```bash
npm run dev
```

The server will start on port 3000 (or the port specified in `PORT` env var).

## Testing Endpoints

### 1. Health Check

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-12-06T08:15:00.000Z"
}
```

### 2. Query Endpoint

The `/query` endpoint supports two modes:
- **Full RAG answer mode** (default): Retrieves passages and generates an LLM answer with citations
- **Retrieval-only mode**: Returns only retrieved passages without answer generation

#### Full RAG Answer Mode (Default)

**Basic query with answer generation:**
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?", "topK": 5}'
```

Expected response:
```json
{
  "query": "What is machine learning?",
  "answer": "Machine learning is a subset of artificial intelligence that enables systems to learn from data without explicit programming. It uses algorithms to identify patterns and make predictions [p0][p1]. The field includes supervised, unsupervised, and reinforcement learning approaches [p2].",
  "citations": [
    {
      "index": 0,
      "text": "Machine learning is a subset of artificial intelligence...",
      "score": 0.95,
      "metadata": {
        "source": "uploads/document1.pdf",
        "chunkIndex": 3,
        "totalChunks": 15
      }
    },
    {
      "index": 1,
      "text": "ML algorithms can identify patterns in data...",
      "score": 0.92,
      "metadata": {
        "source": "uploads/document1.pdf",
        "chunkIndex": 4,
        "totalChunks": 15
      }
    },
    {
      "index": 2,
      "text": "There are three main types of machine learning...",
      "score": 0.88,
      "metadata": {
        "source": "uploads/document2.pdf",
        "chunkIndex": 1,
        "totalChunks": 10
      }
    }
  ]
}
```

**Query with default topK (defaults to 5):**
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Explain neural networks"}'
```

#### Retrieval-Only Mode

**Get only retrieved passages without LLM answer:**
```bash
curl -X POST "http://localhost:3000/query?mode=retrieval" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?", "topK": 5}'
```

Expected response:
```json
{
  "query": "What is machine learning?",
  "results": [
    {
      "text": "Machine learning is a subset of artificial intelligence...",
      "score": 0.95,
      "metadata": {
        "source": "uploads/document1.pdf",
        "chunkIndex": 3,
        "totalChunks": 15,
        "id": "uploads/document1.pdf_chunk_3"
      }
    },
    ...
  ]
}
```

**Invalid request (missing query):**
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"invalid": "data"}'
```

Expected response (400 error):
```json
{
  "error": "Invalid request",
  "message": "Request body must contain a \"query\" field of type string"
}
```

### 3. Using the Test Script

A test script is provided for convenience:

```bash
./test-api.sh
```

Or with a custom port:
```bash
PORT=3001 ./test-api.sh
```

## Notes

- The `/query` endpoint requires valid OpenAI and Pinecone credentials
- Results will only be returned if documents have been ingested into the Pinecone index
- The server validates configuration on startup and will exit if required env vars are missing
- All requests are logged in structured JSON format to stdout

