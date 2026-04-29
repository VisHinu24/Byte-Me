# Deployment

A step-by-step guide for putting the Patient Memory Layer on a public URL.

**Stack**: Vercel (frontend) + Render (backend) + MongoDB Atlas (already hosted) + Groq (already hosted).

**Cost**: $0 on free tiers. Render's free tier sleeps after 15 min idle (~30s cold start on first request); upgrade to **Starter ($7/mo)** to keep warm.

**Time**: ~10 minutes once your repo is on GitHub.

---

## Prerequisites

- [ ] Repo is on GitHub (private is fine for both Vercel and Render)
- [ ] MongoDB Atlas cluster exists with a database called `patient_memory` (you have this)
- [ ] Groq API key (you have this)
- [ ] Optional: a custom domain (skip for now — Vercel and Render both give free `*.vercel.app` and `*.onrender.com` URLs)

---

## Step 1 — Open Atlas Network Access

Render's egress IPs aren't fixed on the free tier. The simplest fix:

1. Go to **MongoDB Atlas → Network Access**
2. Click **Add IP Address**
3. Pick **"Allow access from anywhere"** (`0.0.0.0/0`)
4. Confirm

> ⚠ This makes the database reachable from any IP that has the connection string. The string itself is your auth — keep it secret. For stricter setups, Render's paid plans give you a fixed egress IP you can allowlist.

---

## Step 2 — Deploy the API to Render

1. Go to [render.com](https://render.com) → **New** → **Blueprint**
2. Connect your GitHub account, pick the `project_qn1` repo
3. Render reads [`render.yaml`](./render.yaml) from the repo root and proposes a service named `pml-api`
4. Click **Apply**
5. When prompted, fill in the four secret env vars:

   | Variable | Value |
   | --- | --- |
   | `MONGO_URI` | your Atlas connection string (`mongodb+srv://...patient_memory?...`) |
   | `JWT_SECRET` | any 32+ char random string (e.g. run `openssl rand -hex 32`) |
   | `GROQ_API_KEY` | from console.groq.com → API Keys |
   | `FRONTEND_ORIGIN` | leave blank for now — we'll fill it after Vercel deploys |

   `NODE_ENV=production`, `JWT_EXPIRES_IN=7d`, and `DEMO_MODE=true` are
   pre-set in `render.yaml`. **Don't override `DEMO_MODE`** — it's what
   keeps the open-impersonation demo working in production. Flip it to
   `false` later if/when you add real auth.

6. Wait ~3 min for the build + first deploy
7. Once it's live, copy the URL Render assigns — looks like `https://pml-api-xxxx.onrender.com`
8. **Sanity check**: open `<your-render-url>/health` in a browser. You should see:
   ```json
   { "status": "ok", "mongo": "connected", "uptime": 12, ... }
   ```
   If `mongo` is anything other than `connected`, your `MONGO_URI` is wrong or Atlas Network Access isn't open. Check Render logs.

---

## Step 3 — Deploy the frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**
2. Import the same GitHub repo
3. **Important — set the Root Directory** to `apps/web` (Vercel will offer to do this when it detects multiple frameworks)
4. Vercel auto-detects Vite. The build settings come from [`apps/web/vercel.json`](./apps/web/vercel.json). Don't override.
5. Add **Environment Variable**:

   | Variable | Value |
   | --- | --- |
   | `VITE_API_URL` | the Render URL from Step 2 (e.g. `https://pml-api-xxxx.onrender.com`) |

6. Click **Deploy**
7. Wait ~2 min. Once it's live, copy the URL — looks like `https://project-qn1.vercel.app`

---

## Step 4 — Wire CORS on the API

The API's CORS is permissive by default (dev mode). For production, lock it down:

1. Back on Render → your service → **Environment**
2. Edit `FRONTEND_ORIGIN` and set it to your Vercel URL (e.g. `https://project-qn1.vercel.app`)
3. Save — Render auto-redeploys (~1 min)

You can supply multiple origins comma-separated if you use staging + prod (e.g. `https://staging.vercel.app,https://prod.vercel.app`). Localhost is always allowed for local debugging against the deployed API.

---

## Step 5 — Verify end-to-end

After everything's deployed:

| Check | Expected |
| --- | --- |
| `curl <render-url>/health` | `{"status":"ok","mongo":"connected"}` |
| Visit Vercel URL | Patient list shows 3 patients (Aarav · Priya · Rohan) |
| Click Aarav → Synthesize brief | Real Groq stream, brief renders in ~1-2s, no CORS errors in browser console |
| Top-right impersonation → Dr. Mehta | Patient list goes empty (consent gate working) |
| Switch to Aarav patient identity → Consent tab → grant Dr. Mehta access | Switch back to Dr. Mehta — Aarav now visible |

If any of these fail, check Render logs first (most issues are env vars or CORS).

---

## Common issues

| Symptom | Fix |
| --- | --- |
| `mongo: disconnected` in `/health` | `MONGO_URI` wrong, or Atlas Network Access didn't include `0.0.0.0/0`. Render logs will show the exact reason. |
| Vercel build fails on `npm run build` | Make sure Root Directory is `apps/web`, not the repo root. The `vercel.json` build command does the workspace-aware install. |
| Brief panel shows CORS error | `FRONTEND_ORIGIN` on Render doesn't match the actual Vercel URL. Compare them character-by-character (https vs http, trailing slash). |
| 503 from Render after 30+ min idle | Free tier cold start. First request takes ~30s, subsequent are fast. Upgrade to Starter to keep warm. |
| Every request 401s on the deployed frontend | `DEMO_MODE` is unset or `false` on Render. Without real auth, the open demo needs `DEMO_MODE=true`. |
| `Brief failed: 401 Not authenticated` | `JWT_SECRET` wasn't set on Render. |
| Brief works but says "offline mock" | `GROQ_API_KEY` wasn't set on Render, or it's invalid. |

---

## Updating after the first deploy

Both Vercel and Render auto-deploy when you push to your default branch. Push to GitHub → both rebuild → live in ~3 min. No manual redeploy needed.

For env var changes, edit them on the respective dashboard and the platform redeploys automatically.

---

## Tightening for production (post-demo, optional)

If you want to take this beyond a hackathon demo:

- **Auth** — replace the dev-mode JWT + impersonation header with real OAuth (Auth.js / Clerk / Keycloak). The middleware is already shaped for it.
- **Atlas Network Access** — replace `0.0.0.0/0` with Render's egress IP (paid plans expose this).
- **Rate limit** — current rate limiter is in-memory (lost on restart). Move to Redis-backed when you have multiple instances.
- **Custom domain** — both Vercel and Render let you attach one for free. Update `FRONTEND_ORIGIN` accordingly.
- **Observability** — add `pino` log shipping (Render has a Logtail integration), uptime monitor (e.g. `/health` polled every 5 min).
