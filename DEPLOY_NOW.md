# Quick Deploy Instructions

## 🚂 Deploy to Railway (Recommended - 2 minutes)

1. **Go to Railway:**
   - Visit: https://railway.app/new
   - Click "Login with GitHub"
   - Authorize Railway to access your GitHub

2. **Deploy Your Repo:**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose `KyPython/rag-node-ts`
   - Railway will auto-detect Node.js

3. **Add Environment Variables:**
   - In your project dashboard, click on the service
   - Go to "Variables" tab
   - Add these:
     ```
     OPENAI_API_KEY=sk-...
     PINECONE_API_KEY=...
     PINECONE_INDEX_NAME=your-index-name
     NODE_ENV=production
     ```

4. **Deploy:**
   - Railway automatically builds and deploys
   - Wait for "Deploy Succeeded" status
   - Click "Settings" → "Generate Domain" for public URL
   - Your API will be live at: `https://your-app.railway.app`

5. **Test:**
   ```bash
   curl https://your-app.railway.app/health
   ```

## 🔥 Alternative: Deploy to Render (Free Tier)

1. Go to https://render.com
2. Sign up with GitHub
3. New → Web Service → Connect `rag-node-ts`
4. Settings:
   - Build: `npm install && npm run build`
   - Start: `npm start`
5. Add environment variables (same as above)
6. Deploy!

Your service will be live in ~5 minutes!

