#!/bin/bash
# Test script for RAG API endpoints

PORT=${PORT:-3000}
BASE_URL="http://localhost:${PORT}"

echo "Testing RAG API on ${BASE_URL}"
echo "=================================="
echo ""

# Test health endpoint
echo "1. Testing GET /health"
curl -s -X GET "${BASE_URL}/health" | jq '.' || curl -s -X GET "${BASE_URL}/health"
echo ""
echo ""

# Test query endpoint (full RAG answer mode - default)
echo "2. Testing POST /query (full RAG answer mode)"
echo "Request: {\"query\": \"What is machine learning?\", \"topK\": 3}"
curl -s -X POST "${BASE_URL}/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?", "topK": 3}' | jq '.' || \
curl -s -X POST "${BASE_URL}/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?", "topK": 3}'
echo ""
echo ""

# Test retrieval-only mode
echo "3. Testing POST /query?mode=retrieval (retrieval-only mode)"
echo "Request: {\"query\": \"Explain neural networks\", \"topK\": 5}"
curl -s -X POST "${BASE_URL}/query?mode=retrieval" \
  -H "Content-Type: application/json" \
  -d '{"query": "Explain neural networks", "topK": 5}' | jq '.' || \
curl -s -X POST "${BASE_URL}/query?mode=retrieval" \
  -H "Content-Type: application/json" \
  -d '{"query": "Explain neural networks", "topK": 5}'
echo ""
echo ""

# Test query endpoint without topK (should use default)
echo "4. Testing POST /query (default topK, full RAG)"
echo "Request: {\"query\": \"What is deep learning?\"}"
curl -s -X POST "${BASE_URL}/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is deep learning?"}' | jq '.' || \
curl -s -X POST "${BASE_URL}/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is deep learning?"}'
echo ""
echo ""

# Test error case - invalid request
echo "5. Testing POST /query (invalid - missing query)"
curl -s -X POST "${BASE_URL}/query" \
  -H "Content-Type: application/json" \
  -d '{"invalid": "data"}' | jq '.' || \
curl -s -X POST "${BASE_URL}/query" \
  -H "Content-Type: application/json" \
  -d '{"invalid": "data"}'
echo ""
echo ""

