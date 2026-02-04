# Deploying Hatchway Runner to Railway

This guide walks through deploying a Hatchway runner as a Railway service with persistent storage for project workspaces.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Railway Project: hatchway                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────┐   ┌───────────────────┐  │
│  │    Web Service           │   │  Runner Service   │  │
│  │    (Next.js)             │   │                   │  │
│  │    Port 3000             │   │  Health: 8080     │  │
│  │                          │◀──│  WS Client        │  │
│  │    Public URL            │   │  Volume: /data    │  │
│  │    WebSocket: /ws/runner │   │                   │  │
│  └──────────────────────────┘   └───────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Key Points:**
- Runner connects directly to web app via **WebSocket at /ws/runner**
- Runner needs **persistent volume** at `/data/workspace`
- Health checks on port **8080** (HTTP)
- Uses same `RUNNER_SHARED_SECRET` as web app

---

## Prerequisites

1. **Existing Railway Project** with:
   - Web service (hatchway Next.js app) - deployed
   - Shared secret configured (`RUNNER_SHARED_SECRET`)

2. **GitHub Repository** pushed with latest changes

3. **Railway CLI** (optional but recommended):
   ```bash
   npm install -g @railway/cli
   railway login
   ```

---

## Step 1: Create Runner Service

### Option A: Via Railway Dashboard (Recommended for First Time)

1. Go to your Railway project: https://railway.app/project/[your-project]
2. Click **"+ New Service"**
3. Select **"GitHub Repo"**
4. Choose your `hatchway` repository
5. Railway will detect the Dockerfile automatically

### Option B: Via Railway CLI

```bash
cd /path/to/hatchway
railway link  # Link to your existing project
railway up --service runner
```

---

## Step 2: Configure Build Settings

In Railway service settings:

### **Root Directory**
- Set to: `/` (monorepo root)

### **Dockerfile Path**
- Set to: `apps/runner/Dockerfile`

### **Build Command** (if not using Dockerfile)
Skip this if using the Dockerfile (it handles builds internally)

### **Start Command** (override if needed)
```bash
node apps/runner/dist/index.js runner
```

---

## Step 3: Add Persistent Volume

**Critical**: The runner needs persistent storage for project workspaces.

1. In Railway service settings, go to **"Volumes"** tab
2. Click **"+ New Volume"**
3. Configure:
   - **Mount Path:** `/data/workspace`
   - **Size:** 10 GB (start small, increase as needed)
4. Click **"Add Volume"**

**Cost:** ~$0.25/GB/month (~$2.50/month for 10GB)

**Why needed:**
- Stores AI-generated project code
- Persists `node_modules/` across builds
- Required for dev servers to run

---

## Step 4: Set Environment Variables

Add these to the runner service (Railway Settings → Variables):

### **Required Variables:**

```env
# Runner Identity (unique per instance)
RUNNER_ID=railway-runner-prod

# Authentication (must match web app's secret)
RUNNER_SHARED_SECRET=${{shared.RUNNER_SHARED_SECRET}}

# WebSocket Connection (use your web app's public URL)
RUNNER_WS_URL=wss://your-app.up.railway.app/ws/runner

# API Endpoint (use your web app's public URL)
API_BASE_URL=https://your-app.up.railway.app

# Workspace Location (matches volume mount)
WORKSPACE_ROOT=/data/workspace

# Service Mode (disables TUI, enables health endpoint)
NODE_ENV=production

# Health Check Port
HEALTH_PORT=8080
```

### **Optional Variables:**

```env
# Enable verbose build logging
DEBUG_BUILD=1

# Sentry Configuration (if using)
SENTRY_DSN=https://...
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=${{RAILWAY_GIT_COMMIT_SHA}}

# Anthropic API Key (for AI builds)
ANTHROPIC_API_KEY=${{shared.ANTHROPIC_API_KEY}}
```

### **How to Get Your URLs:**

1. **Web App URL:**
   - Go to web service → Settings → Domains
   - Copy the Railway-provided domain
   - WebSocket URL format: `wss://[your-app-domain].railway.app/ws/runner`
   - API URL format: `https://[your-app-domain].railway.app`

---

## Step 5: Configure Shared Secrets

If you haven't already created a shared secret:

1. Go to Railway project settings (not service settings)
2. Click **"Shared Variables"** tab
3. Add:
   ```
   RUNNER_SHARED_SECRET=[generate-random-token]
   ```

Generate a secure token:
```bash
openssl rand -base64 32
```

This same secret must be used by:
- Web app
- Runner service(s)

---

## Step 6: Deploy

1. **Push changes** to GitHub (includes updated runner code)
2. Railway will **auto-deploy** when it detects changes
3. Monitor logs:
   ```bash
   railway logs --service runner
   ```

### Expected Startup Logs:

```
📁 Creating workspace directory: /data/workspace
✅ Health endpoint listening on port 8080
[runner] workspace root: /data/workspace
[runner] api base url: https://your-app.railway.app
[runner] runner id: railway-runner-prod
✅ connected to server wss://your-app.railway.app/ws/runner
[runner] ⏱️  Heartbeat sent: railway-runner-prod
```

---

## Step 7: Verify Health

### Check Health Endpoint

```bash
curl https://your-runner.railway.app/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "runner": {
    "id": "railway-runner-prod",
    "connected": true,
    "workspace": "/data/workspace",
    "workspaceExists": true
  },
  "uptime": 123.45,
  "timestamp": "2025-11-26T12:34:56.789Z"
}
```

### Check Readiness (for k8s-style readiness probes)

```bash
curl https://your-runner.railway.app/ready
```

**Expected Response (200 OK):**
```json
{
  "ready": true,
  "runnerId": "railway-runner-prod"
}
```

**Not Ready (503):**
```json
{
  "ready": false,
  "runnerId": "railway-runner-prod"
}
```

---

## Step 8: Test the Runner

1. **Check Web App UI:**
   - Open Hatchway web interface
   - Look in sidebar footer → Runner dropdown
   - Your Railway runner should appear: `railway-runner-prod` with green dot

2. **Create a Test Project:**
   - Click "New Project"
   - Enter prompt: "Create a simple hello world React app"
   - Ensure runner is selected
   - Submit

3. **Monitor Runner Logs:**
   ```bash
   railway logs --service runner --tail
   ```

You should see:
   - Build command received
   - AI streaming started
   - Files being written
   - Dependencies installed
   - Build completed

4. **Verify Workspace Persistence:**
   - SSH into Railway container (if needed):
     ```bash
     railway run --service runner bash
     ls -la /data/workspace
     ```
   - Should see project directories

---

## Scaling: Multiple Runners

### Deploy Additional Runners

To add more runners (e.g., for different regions or load distribution):

1. **Duplicate the runner service** in Railway
2. **Give unique RUNNER_ID**:
   ```env
   RUNNER_ID=railway-runner-us-west
   ```
3. **Add separate volume** (each runner needs its own)
4. **Same WebSocket/API URLs** (all connect to same web app)

### Load Distribution

Runners self-register with the web app when they connect via WebSocket. The web app's runner selector dropdown will show all connected runners. Users can choose which runner to use for each project.

---

## Troubleshooting

### Issue: Runner Not Appearing in UI

**Check:**
1. Runner logs show "connected to server"
2. Web app logs show runner connection
3. `RUNNER_SHARED_SECRET` matches between services
4. WebSocket URL is correct (wss:// not ws://)

**Debug:**
```bash
railway logs --service runner | grep -i "connect\|error"
```

### Issue: "No workspace directory" Error

**Check:**
1. Volume is mounted at `/data/workspace`
2. `WORKSPACE_ROOT=/data/workspace` in env vars
3. Container has write permissions

**Fix:**
```bash
# SSH into container
railway run --service runner bash
# Check mount
df -h | grep workspace
# Check permissions
ls -la /data/
```

### Issue: Dev Servers Won't Start

**Check:**
1. Port allocation in database matches what runner tries to use
2. No port conflicts in container
3. Workspace has project files

**Debug:**
```bash
railway logs --service runner | grep -i "port\|dev server"
```

### Issue: Builds Fail with "ANTHROPIC_API_KEY not found"

**Fix:**
Add to runner environment variables:
```env
ANTHROPIC_API_KEY=${{shared.ANTHROPIC_API_KEY}}
```

Make sure it's defined in shared variables.

### Issue: Runner Keeps Disconnecting

**Check:**
1. WebSocket heartbeat (30 second ping interval)
2. Runner ping/pong working
3. Network stability

**Railway logs:**
```bash
railway logs --service runner | grep -i "timeout\|disconnect\|reconnect"
```

### Issue: Out of Disk Space

**Check volume usage:**
```bash
railway run --service runner -- du -sh /data/workspace/*
```

**Solutions:**
- Increase volume size (Railway settings)
- Delete old projects from workspace
- Implement cleanup policy

---

## Cost Estimation

### Per Runner Service:

- **Compute**: $5-10/month (based on usage)
- **Volume (10GB)**: ~$2.50/month
- **Total**: ~$7.50-12.50/month per runner

### Recommended Setup:

- **1 runner for personal use**: ~$10/month
- **2-3 runners for team**: ~$20-30/month
- **Scaled fleet (5+)**: $40+/month

Compare to running locally:
- Local runner: $0 (uses your machine)
- Railway runner: Always available, no local resources needed

---

## Advanced Configuration

### Custom Start Command

If you need to pass custom flags:

```bash
node apps/runner/dist/index.js runner --heartbeatInterval 20000
```

### Multiple Replicas (Not Recommended)

Railway can deploy multiple replicas of the same service, but:
- ❌ Each needs separate volume (can't share)
- ❌ RUNNER_ID will collide (both get same RAILWAY_REPLICA_ID)
- ✅ Better to deploy separate services with unique IDs

### Internal Networking (Future)

Currently the runner uses **public URLs** to reach web app. In the future, you could use Railway's private networking:

```env
# Instead of public URLs:
RUNNER_WS_URL=ws://web.railway.internal:3000/ws/runner
API_BASE_URL=http://web.railway.internal:3000
```

Requires Railway Pro plan ($20/month).

---

## Maintenance

### Viewing Logs

```bash
# Real-time logs
railway logs --service runner --tail

# Filter for errors
railway logs --service runner | grep -i "error\|fail"

# Filter for build activity
railway logs --service runner | grep -i "build"
```

### Restarting Service

```bash
railway service restart --service runner
```

Or via dashboard: Service → Settings → Restart

### Updating Code

```bash
git push origin main
# Railway auto-deploys
```

### Clearing Workspace (Drastic)

If you need to wipe all projects and start fresh:

```bash
railway run --service runner -- rm -rf /data/workspace/*
railway service restart --service runner
```

**Warning**: This deletes all AI-generated projects!

---

## Migration Checklist

Before deploying to Railway, ensure:

- [x] Web app is deployed with database and WebSocket server
- [x] Shared secret is configured
- [x] Volume is created (10GB minimum)
- [x] Environment variables are set
- [x] Dockerfile exists (apps/runner/Dockerfile)
- [x] Code includes Railway enhancements (RUNNER_ID, health endpoint, etc.)

After deployment:

- [ ] Health endpoint returns 200 OK
- [ ] Runner appears in UI dropdown with green dot
- [ ] Test build completes successfully
- [ ] Dev server starts and accessible
- [ ] Tunnel creation works
- [ ] Workspace persists across service restarts

---

## Security Considerations

### 1. **Shared Secret**
- Use Railway's shared variables (encrypted at rest)
- Rotate periodically (update all services simultaneously)
- Never commit to Git

### 2. **API Authentication**
- Runner uses Bearer token for WebSocket connections
- Web app validates token on connection
- Invalid tokens rejected with close code 1008

### 3. **Workspace Isolation**
- Each project in separate directory
- No cross-project access
- Files owned by container user

### 4. **Network Security**
- Runner only connects outbound (to web app)
- No inbound connections except health checks
- Tunnel traffic routed through Cloudflare

---

## Comparison: Local vs Railway Runner

| Aspect | Local Runner | Railway Runner |
|--------|--------------|----------------|
| **Cost** | $0 | ~$10/month |
| **Availability** | Your machine must be on | 24/7 uptime |
| **Resources** | Uses your CPU/RAM | Dedicated container |
| **Workspace** | `~/hatchway-workspace` | `/data/workspace` (persistent volume) |
| **Scaling** | Single machine | Can deploy multiple |
| **Access** | localhost only | Accessible from anywhere |
| **Maintenance** | Manual updates | Auto-deploy from Git |
| **TUI Dashboard** | Yes (Ink.js) | No (service mode) |
| **Logs** | Terminal | Railway logs + Sentry |

---

## Next Steps

Once your Railway runner is deployed and healthy:

1. **Set as default runner** in web app (select from dropdown)
2. **Test with real project** (not just hello world)
3. **Monitor costs** in Railway dashboard
4. **Scale if needed** (deploy additional runners for load distribution)
5. **Implement cleanup policy** (delete old projects from workspace)

---

## Support

**Issues?**
- Check Railway logs: `railway logs --service runner`
- Review health endpoint: `https://[runner-url].railway.app/health`
- GitHub Issues: https://github.com/codyde/hatchway/issues

**Performance Issues?**
- Increase Railway plan (more CPU/RAM)
- Increase volume size
- Deploy additional runner instances

---

**You're ready to deploy!** 🚀

Your runner will be accessible 24/7, ready to build projects on demand without requiring your local machine to be running.
