# RAG Node.js TypeScript Service

A production-ready RAG (Retrieval-Augmented Generation) HTTP service built with Node.js, Express, TypeScript, LangChain, OpenAI, and Pinecone.

## Features

- 📄 **Document Ingestion**: Parse PDF and Markdown files, chunk text, and store embeddings in Pinecone
- 🔍 **Semantic Search**: Retrieve relevant passages using vector similarity search
- 🤖 **LLM Answer Generation**: Generate answers using OpenAI with citation support
- 📊 **Structured Logging**: JSON-formatted logs for observability
- 🔗 **Citation Tracking**: Track which passages were used to generate answers
- ⚡ **Dual Query Modes**: Retrieval-only or full RAG answer generation

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

## Usage

### Development

Start the development server with hot reload:
```bash
npm run dev
```

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

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings and LLM |
| `PINECONE_API_KEY` | Yes | Pinecone API key |
| `PINECONE_INDEX_NAME` | Yes | Name of your Pinecone index |
| `PINECONE_ENVIRONMENT` | No | Pinecone environment (if required) |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |

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

