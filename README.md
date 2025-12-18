# RAG-as-a-Service

A **production-ready RAG (Retrieval-Augmented Generation) SaaS** built with Node.js, Express, TypeScript, LangChain, OpenAI, and Pinecone.

🚀 **Ready to deploy as your own RAG SaaS product or integrate into your applications.**

## Why Use This?

- **Out-of-the-box SaaS**: Multi-tenancy, API keys, rate limiting, usage tracking
- **Easy Integration**: Client SDK included for quick integration
- **Production-Ready**: Docker support, Prometheus metrics, structured logging
- **Cost-Optimized**: Smart caching, context truncation, tier-based rate limiting

## Features

### Core RAG
- 📄 **Document Ingestion**: Parse PDF/Markdown, chunk text, store embeddings
- 🔍 **Semantic Search**: Vector similarity search via Pinecone
- 🤖 **LLM Answers**: GPT-4 powered answers with citation support
- ⚡ **Dual Modes**: Retrieval-only or full RAG answer generation

### SaaS Features
- 🔐 **Multi-Tenancy**: Isolated namespaces per customer
- 🔑 **API Key Auth**: Per-tenant API keys with tier support
- ⏱️ **Rate Limiting**: Per-tenant rate limits (minute + daily)
- 📊 **Usage Tracking**: Track tokens, requests, costs for billing
- 👩‍💼 **Admin API**: Tenant management, usage analytics

### Production
- 🐳 **Docker Ready**: Dockerfile + docker-compose included
- 💾 **Caching**: Redis or in-memory caching
- 📈 **Prometheus Metrics**: `/metrics` endpoint
- 🔗 **Request Tracing**: Request IDs for debugging
- 🎨 **Demo UI**: Built-in web interface

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Server**: Express.js
- **RAG Framework**: LangChain.js
- **Embeddings**: OpenAI
- **Vector Database**: Pinecone
- **Document Parsing**: pdf-parse

## Prerequisites

- Node.js 20+
- npm or yarn
- OpenAI API key
- Pinecone API key and index

## Setup

1. **Clone the repository** (after pushing to GitHub):
   ```bash
   git clone <your-repo-url>
   cd rag-node-ts
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Create a `.env` file:
   ```bash
   OPENAI_API_KEY=your_openai_api_key
   PINECONE_API_KEY=your_pinecone_api_key
   PINECONE_INDEX_NAME=your_index_name
   PORT=3000  # Optional, defaults to 3000
   ```

4. **Build the project**:
   ```bash
   npm run build
   ```

## Quick Start Demo

For portfolio demos and quick testing:

```bash
# 1. Setup (one-time)
npm run demo-setup

# 2. Start server
npm run demo

# 3. Open demo UI
# Visit: http://localhost:3000
```

The demo UI provides an interactive interface to test the RAG system. Sample documents are automatically ingested.

## Usage

### Development

Start the development server with hot reload:
```bash
npm run dev
```

The demo UI is available at `http://localhost:3000` when the server is running.

### Production

Build and start:
```bash
npm run build
npm start
```

### Ingest Documents

Ingest PDF or Markdown files into the vector database:
```bash
npm run ingest -- uploads/document1.pdf uploads/document2.md
```

## API Endpoints

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-06T08:00:00.000Z"
}
```

### `POST /query`

Query the RAG system. Supports two modes:

#### Full RAG Answer Mode (Default)

Retrieves passages and generates an LLM answer with citations.

**Request:**
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?", "topK": 5}'
```

**Response:**
```json
{
  "query": "What is machine learning?",
  "answer": "Machine learning is... [p0][p1]",
  "citations": [
    {
      "index": 0,
      "text": "Machine learning is a subset...",
      "score": 0.95,
      "metadata": {
        "source": "uploads/document1.pdf",
        "chunkIndex": 3
      }
    }
  ]
}
```

#### Retrieval-Only Mode

Returns only retrieved passages without LLM answer generation.

**Request:**
```bash
curl -X POST "http://localhost:3000/query?mode=retrieval" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?", "topK": 5}'
```

**Response:**
```json
{
  "query": "What is machine learning?",
  "results": [
    {
      "text": "Machine learning is...",
      "score": 0.95,
      "metadata": {...}
    }
  ]
}
```

See [TESTING.md](./TESTING.md) for more examples.

## Performance & Benchmarking

### Caching

The API includes built-in caching to reduce LLM API costs and improve latency:
- **In-memory cache** (default): Fast, single-instance caching
- **Redis cache**: Distributed caching for production (set `REDIS_URL`)

Cache can be disabled per-request: `?cacheMode=off`

### Benchmarking

Run performance benchmarks to measure API latency:

```bash
# Benchmark with cache enabled (default)
npm run bench -- --url http://localhost:3000 --concurrency 5 --requests 20 --cacheMode on

# Benchmark with cache disabled
npm run bench -- --url http://localhost:3000 --concurrency 5 --requests 20 --cacheMode off

# Compare the results - cache hits should be 10-100x faster!
```

Benchmark options:
- `--url`: API base URL (default: `http://localhost:3000`)
- `--concurrency`: Number of parallel requests (default: 5)
- `--requests`: Total number of requests (default: 20)
- `--cacheMode`: `on` or `off` (default: `on`)

The benchmark reports:
- Average latency
- P95 latency
- Success rate
- Min/Max latency

## Project Structure

```
src/
├── index.ts           # Express server with routes
├── rag/
│   ├── ingest.ts      # Document ingestion pipeline
│   └── retriever.ts   # Vector retrieval
├── llm/
│   └── answer.ts      # LLM answer generation
├── scripts/
│   └── ingestLocal.ts # CLI ingestion script
└── utils/
    ├── config.ts      # Configuration validation
    └── logger.ts      # Structured logging
```

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings and LLM |
| `PINECONE_API_KEY` | Pinecone API key |
| `PINECONE_INDEX_NAME` | Name of your Pinecone index |

### RAG Configuration
| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_MODEL` | `gpt-4o-mini` | LLM model (`gpt-4-turbo`, `gpt-4o`, `gpt-4o-mini`) |
| `MAX_CONTEXT_LENGTH` | `8000` | Max context chars for LLM |
| `CACHE_TTL_SECONDS` | `300` | Cache TTL in seconds |

### SaaS / Multi-Tenancy
| Variable | Description |
|----------|-------------|
| `RAG_API_KEY` | Master API key for authentication |
| `RAG_ADMIN_KEY` | Admin API key for `/admin/*` endpoints |
| `RAG_DEMO_API_KEY` | Demo API key for trials |
| `RAG_TENANT_*` | Tenant configs (format: `name:namespace:apiKey`) |

### Tier Rate Limits
| Variable | Default | Description |
|----------|---------|-------------|
| `TIER_LIMITS_FREE` | `10:100:50000` | Free tier (rpm:rpd:tpd) |
| `TIER_LIMITS_STARTER` | `30:1000:500000` | Starter tier |
| `TIER_LIMITS_PRO` | `100:10000:5000000` | Pro tier |
| `TIER_LIMITS_ENTERPRISE` | `500:100000:50000000` | Enterprise tier |

### Infrastructure
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment |
| `REDIS_URL` | (none) | Redis URL for distributed caching |

## Docker Deployment

### Quick Start
```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f rag

# Stop
docker-compose down
```

### Production
```bash
# Build production image
docker build -t rag-service .

# Run with environment variables
docker run -d \
  -p 3000:3000 \
  -e OPENAI_API_KEY=sk-xxx \
  -e PINECONE_API_KEY=xxx \
  -e PINECONE_INDEX_NAME=my-index \
  -e RAG_API_KEY=sk_rag_master \
  -e RAG_ADMIN_KEY=admin_secret \
  rag-service
```

## Client SDK

A TypeScript/JavaScript SDK is included for easy integration:

```typescript
import { RagClient } from './sdk/rag-client';

const rag = new RagClient({
  apiKey: 'sk_rag_xxx',
  baseUrl: 'https://your-rag-service.com'
});

// Query with full RAG answer
const answer = await rag.query('What is machine learning?');
console.log(answer.answer, answer.citations);

// Retrieval only (no LLM cost)
const passages = await rag.retrieve('machine learning', { topK: 10 });

// Ingest content
await rag.ingest('New knowledge...', 'docs/intro');

// Batch ingest
await rag.ingestBatch([
  { text: 'Content 1', source: 'doc1' },
  { text: 'Content 2', source: 'doc2' },
]);
```

## Admin API

Protected by `RAG_ADMIN_KEY`:

```bash
# Get system health
curl -H "X-Admin-Key: YOUR_ADMIN_KEY" http://localhost:3000/admin/health

# Get usage for a tenant
curl -H "X-Admin-Key: YOUR_ADMIN_KEY" http://localhost:3000/admin/usage/tenant-id

# Export usage records for billing
curl -H "X-Admin-Key: YOUR_ADMIN_KEY" http://localhost:3000/admin/usage/tenant-id/export

# Create new tenant
curl -X POST -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp", "tier": "starter"}' \
  http://localhost:3000/admin/tenants
```

## Deployment

This service can be deployed to various platforms:

- **Vercel**: Serverless deployment
- **Railway**: Easy containerized deployment
- **Render**: Managed Node.js hosting
- **Fly.io**: Global edge deployment
- **Docker**: Containerized deployment

See deployment-specific setup in the respective platform documentation.

## License

ISC

## Contributing

Contributions welcome! Please open an issue or submit a pull request.

