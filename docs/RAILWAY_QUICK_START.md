# Railway Runner - Quick Start Guide

## 5-Minute Deployment

### 1. Create Service
```bash
# In Railway dashboard:
+ New Service → GitHub Repo → hatchway
```

### 2. Configure Build
- **Root Directory:** `/`
- **Dockerfile Path:** `apps/runner/Dockerfile`

### 3. Add Volume
```
Volumes → + New Volume
Mount Path: /data/workspace
Size: 10 GB
```

### 4. Set Environment Variables

**Copy-paste this template** (replace the URLs):

```env
RUNNER_ID=railway-runner-prod
RUNNER_SHARED_SECRET=${{shared.RUNNER_SHARED_SECRET}}
RUNNER_WS_URL=wss://YOUR-WEB-APP-DOMAIN.up.railway.app/ws/runner
API_BASE_URL=https://YOUR-WEB-APP-DOMAIN.up.railway.app
WORKSPACE_ROOT=/data/workspace
NODE_ENV=production
HEALTH_PORT=8080
ANTHROPIC_API_KEY=${{shared.ANTHROPIC_API_KEY}}
```

**Get YOUR-WEB-APP-DOMAIN:**
- Go to web service → Settings → Domains → Copy the `.railway.app` URL

### 5. Deploy
```bash
git push origin main
# Railway auto-deploys in ~2-3 minutes
```

### 6. Verify
```bash
# Check logs
railway logs --service runner

# Should see:
# ✅ Health endpoint listening on port 8080
# ✅ connected to server wss://your-app.railway.app/ws/runner
# [runner] ⏱️  Heartbeat sent: railway-runner-prod
```

### 7. Test in UI
- Open Hatchway web app
- Sidebar footer → Runner dropdown
- Should show: `🟢 railway-runner-prod`
- Create a test project → Should build successfully!

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Runner not in dropdown | Check `RUNNER_WS_URL` and `RUNNER_SHARED_SECRET` |
| "No workspace directory" | Verify volume mounted at `/data/workspace` |
| Builds fail immediately | Check `ANTHROPIC_API_KEY` is set |
| Runner keeps reconnecting | Check WebSocket URL has `wss://` (not `ws://`) |

---

## Cost

- **Compute**: ~$5-10/month (Starter plan)
- **Volume (10GB)**: ~$2.50/month
- **Total**: ~$7.50-12.50/month

**Pro Tip**: Start with 10GB volume. Monitor usage and increase as needed.

---

## What's Next?

- ✅ Runner deployed
- ✅ Verified in UI
- ✅ Test build completed

**Optional Enhancements:**
- Deploy multiple runners for redundancy
- Set up structured monitoring for the runner
- Configure auto-scaling (Railway Pro)
- Implement workspace cleanup cron job

Full docs: [RAILWAY_RUNNER_DEPLOYMENT.md](./RAILWAY_RUNNER_DEPLOYMENT.md)
