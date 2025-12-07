#!/bin/bash
# Quick Demo Setup Script
# Sets up the RAG service for portfolio demos

set -e

echo "🚀 Setting up RAG API Demo..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "Please create .env with:"
    echo "  OPENAI_API_KEY=your_key"
    echo "  PINECONE_API_KEY=your_key"
    echo "  PINECONE_INDEX_NAME=rag-index"
    exit 1
fi

echo "✅ Environment variables found"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install --legacy-peer-deps
fi

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Setup Pinecone index
echo "🗄️  Setting up Pinecone index..."
npm run setup-pinecone

# Ingest sample datasets
echo "📚 Ingesting sample datasets..."
echo "  - Law Firms..."
npm run ingest -- samples/law-firms/*.md 2>/dev/null || echo "    (some files may not exist)"
echo "  - Compliance..."
npm run ingest -- samples/compliance/*.md 2>/dev/null || echo "    (some files may not exist)"
echo "  - Real Estate..."
npm run ingest -- samples/real-estate/*.md 2>/dev/null || echo "    (some files may not exist)"
echo "  - Dev Teams..."
npm run ingest -- samples/dev-teams/*.md 2>/dev/null || echo "    (some files may not exist)"

echo ""
echo "✅ Demo setup complete!"
echo ""
echo "🎯 Next steps:"
echo "   1. Start server: npm run dev"
echo "   2. Open demo UI: http://localhost:3000"
echo "   3. Or test API: curl http://localhost:3000/health"
echo ""
echo "📖 Demo queries:"
echo "   - 'What are the key GDPR data subject rights?'"
echo "   - 'What contingencies should be in a purchase agreement?'"
echo "   - 'What are best practices for API documentation?'"

