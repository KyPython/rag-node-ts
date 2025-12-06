# Deployment Guide

This RAG service can be deployed to various platforms. Choose the one that best fits your needs.

## Quick Deploy Options

### 🚂 Railway (Recommended for simplicity)

1. **Connect Repository:**
   - Go to [railway.app](https://railway.app)
   - Sign up/login with GitHub
   - Click "New Project" → "Deploy from GitHub repo"
   - Select `rag-node-ts` repository

2. **Configure Environment Variables:**
   - In Railway dashboard, go to Variables tab
   - Add these environment variables:
     ```
     OPENAI_API_KEY=your_key
     PINECONE_API_KEY=your_key
     PINECONE_INDEX_NAME=your_index
     NODE_ENV=production
     ```
   - Optional: `PORT` (Railway auto-assigns)

3. **Deploy:**
   - Railway auto-detects the Node.js app
   - It will run `npm install` and `npm run build`
   - The service will start automatically

4. **Get Your URL:**
   - Railway provides a public URL like `https://rag-node-ts-production.up.railway.app`
   - Test: `curl https://your-app.railway.app/health`

### ⚡ Vercel (Serverless)

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **Add Environment Variables:**
   - Go to Vercel dashboard → Your project → Settings → Environment Variables
   - Add all required env vars

4. **Redeploy:**
   ```bash
   vercel --prod
   ```

**Note:** Vercel works best for serverless. For long-running processes like document ingestion, consider Railway or Render.

### 🐳 Render

1. **Create New Web Service:**
   - Go to [render.com](https://render.com)
   - Connect your GitHub account
   - Click "New" → "Web Service"
   - Select `rag-node-ts` repository

2. **Configure:**
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** `Node`

3. **Add Environment Variables:**
   - In Environment tab, add:
     - `OPENAI_API_KEY`
     - `PINECONE_API_KEY`
     - `PINECONE_INDEX_NAME`
     - `NODE_ENV=production`

4. **Deploy:**
   - Click "Create Web Service"
   - Render will build and deploy automatically

### 🐳 Docker (Any platform)

Build and run locally or deploy to any Docker-compatible platform:

```bash
# Build
docker build -t rag-node-ts .

# Run
docker run -p 3000:3000 \
  -e OPENAI_API_KEY=your_key \
  -e PINECONE_API_KEY=your_key \
  -e PINECONE_INDEX_NAME=your_index \
  rag-node-ts
```

Deploy to:
- **Fly.io:** `flyctl launch` then `flyctl deploy`
- **Google Cloud Run:** `gcloud run deploy`
- **AWS ECS/Fargate:** Use AWS CLI or Console
- **DigitalOcean App Platform:** Connect GitHub repo

### 🔥 Fly.io

1. **Install Fly CLI:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login:**
   ```bash
   flyctl auth login
   ```

3. **Launch:**
   ```bash
   flyctl launch
   ```

4. **Set Secrets:**
   ```bash
   flyctl secrets set OPENAI_API_KEY=your_key
   flyctl secrets set PINECONE_API_KEY=your_key
   flyctl secrets set PINECONE_INDEX_NAME=your_index
   ```

5. **Deploy:**
   ```bash
   flyctl deploy
   ```

## Environment Variables

All platforms require these environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key |
| `PINECONE_API_KEY` | Yes | Your Pinecone API key |
| `PINECONE_INDEX_NAME` | Yes | Your Pinecone index name |
| `PINECONE_ENVIRONMENT` | No | Pinecone environment (if needed) |
| `PORT` | No | Server port (auto-set by most platforms) |
| `NODE_ENV` | No | Set to `production` for production |

## Post-Deployment

1. **Test Health Endpoint:**
   ```bash
   curl https://your-app-url.com/health
   ```

2. **Test Query Endpoint:**
   ```bash
   curl -X POST https://your-app-url.com/query \
     -H "Content-Type: application/json" \
     -d '{"query": "test query", "topK": 3}'
   ```

3. **Ingest Documents:**
   - You may need to run ingestion locally or via a separate process
   - Some platforms support running one-off commands

## Recommended Platform by Use Case

- **Simple, fast setup:** Railway
- **Serverless/Edge:** Vercel
- **Free tier with persistence:** Render
- **Global edge deployment:** Fly.io
- **Enterprise/K8s:** Docker → Kubernetes

## Troubleshooting

### Build Fails
- Ensure `package.json` has all dependencies
- Check Node.js version (requires 20+)
- Review build logs for specific errors

### Runtime Errors
- Verify all environment variables are set
- Check Pinecone index exists and has correct dimensions
- Review application logs

### Slow Response Times
- Check Pinecone query latency
- Monitor OpenAI API rate limits
- Consider upgrading platform tier

