# Pinecone Setup Guide

This guide will help you set up Pinecone for your RAG service.

## Step 1: Get Your API Key

1. In your Pinecone dashboard, click **"Get your API key"** or go to the **API Keys** section
2. Copy your API key - you'll need this for environment variables

## Step 2: Create an Index

Your RAG service uses OpenAI embeddings, which produce **1536-dimensional** vectors.

### Option A: Using Pinecone Console (Recommended)

1. Go to your Pinecone dashboard
2. Click **"Create Index"**
3. Configure your index:

   **Index Name**: `rag-index` (or any name you prefer)
   
   **Dimensions**: `1536` (required for OpenAI embeddings)
   
   **Metric**: `cosine` (recommended for semantic search)
   
   **Cloud Provider**: Choose your preferred region
   
   **Pod Type**: 
   - **Starter/Free tier**: `s1.x1` or `s1`
   - **Production**: `p1.x1` or higher
   
4. Click **"Create Index"**
5. Wait for the index to be created (usually takes 1-2 minutes)

### Option B: Using Python Script (Alternative)

Create a file `setup-pinecone.py`:

```python
from pinecone import Pinecone, ServerlessSpec
import os

# Initialize Pinecone
pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))

# Create index
index_name = "rag-index"
dimension = 1536  # OpenAI embeddings dimension
metric = "cosine"

try:
    # Check if index exists
    if index_name in pc.list_indexes().names():
        print(f"Index '{index_name}' already exists")
    else:
        # Create new index
        pc.create_index(
            name=index_name,
            dimension=dimension,
            metric=metric,
            spec=ServerlessSpec(
                cloud="aws",  # or "gcp", "azure"
                region="us-east-1"  # choose your region
            )
        )
        print(f"Index '{index_name}' created successfully")
except Exception as e:
    print(f"Error: {e}")
```

Run it:
```bash
export PINECONE_API_KEY=your_key
python setup-pinecone.py
```

### Option C: Using curl/HTTP API

```bash
curl -X POST "https://api.pinecone.io/indexes" \
  -H "Api-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "rag-index",
    "dimension": 1536,
    "metric": "cosine",
    "spec": {
      "serverless": {
        "cloud": "aws",
        "region": "us-east-1"
      }
    }
  }'
```

## Step 3: Configure Your Application

Update your `.env` file with your Pinecone credentials:

```bash
OPENAI_API_KEY=sk-your_openai_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=rag-index  # The name you used when creating the index
```

**Note**: If you're using Pinecone Serverless (newer), you don't need `PINECONE_ENVIRONMENT`. If you're using Pod-based (older), you may need to set `PINECONE_ENVIRONMENT=your_environment`.

## Step 4: Verify Your Setup

Test your Pinecone connection:

```bash
# Start your server
npm run dev

# In another terminal, test ingestion
npm run ingest -- uploads/test-document.pdf

# Test query
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "test query", "topK": 3}'
```

## Step 5: Deploy with Environment Variables

When deploying to Railway, Render, or other platforms, make sure to set:

- `PINECONE_API_KEY` - Your Pinecone API key
- `PINECONE_INDEX_NAME` - Your index name (e.g., `rag-index`)
- `OPENAI_API_KEY` - Your OpenAI API key

## Troubleshooting

### Index Not Found Error
- Double-check your `PINECONE_INDEX_NAME` matches exactly (case-sensitive)
- Wait a few minutes after creating the index for it to fully initialize

### Dimension Mismatch Error
- Ensure your index has dimension `1536` (OpenAI embeddings)
- If you created an index with wrong dimensions, delete and recreate it

### API Key Invalid
- Verify your API key in Pinecone dashboard
- Ensure there are no extra spaces when copying/pasting

### No Results Returned
- Make sure you've ingested documents first
- Check that documents were successfully upserted to Pinecone
- Verify the index has vectors (check in Pinecone dashboard)

## Index Configuration Reference

For this RAG service, use these settings:

| Setting | Value | Reason |
|---------|-------|--------|
| **Dimensions** | `1536` | OpenAI `text-embedding-3-small` or `text-embedding-ada-002` |
| **Metric** | `cosine` | Best for semantic similarity search |
| **Type** | Serverless | Easier to manage, auto-scales |
| **Region** | Choose closest to your users | Lower latency |

## Next Steps

Once your Pinecone index is set up:

1. ✅ Test locally with `npm run dev`
2. ✅ Ingest some sample documents
3. ✅ Test queries
4. ✅ Deploy to production
5. ✅ Set environment variables on your hosting platform

Your RAG service is now ready to use Pinecone for vector storage and retrieval!

