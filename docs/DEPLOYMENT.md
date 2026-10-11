# Deployment — Vercel · Replit · MongoDB Atlas

Three services, one order that actually works:

```
1. MongoDB Atlas   ← everything needs the connection string
2. Vercel          ← gives you the URL that Replit must allow in CORS
3. Replit          ← needs Atlas URI + the Vercel URL as CLIENT_ORIGIN
```

Doing Replit before Vercel means you have to edit CORS afterwards. Atlas first
always.

---

## 1. MongoDB Atlas

### Create the cluster

1. [cloud.mongodb.com](https://cloud.mongodb.com) → **Create** → choose the
   free **M0** tier.
2. Region: pick one near your users.
3. **Database Access** → *Add New Database User*
   - Username: `studymind`
   - Password: **generate** — save it, you only see it once
   - Role: **Read and write to any database**
4. **Network Access** → *Add IP Address* — see the warning below.

### The IP allowlist — the #1 reason this fails

Replit's egress IPs are **dynamic**. Your laptop's IP is also dynamic. The Atlas
Network Access screen defaults to whitelisting nothing, and every connection
then dies with a 10-second timeout and no useful error.

| Situation | What to do |
|---|---|
| **Hackathon prototype / demo** | Add `0.0.0.0/0` (allow from anywhere). Acceptable **only** with a long random password — Atlas still requires auth. Document it. |
| **Production** | Don't. Use Atlas Data API / Prisma Accelerate, or a static egress IP. |
| **Local dev from a fixed IP** | Add your home IP (`curl ifconfig.me`). |

There is a test button in the Atlas UI that says `0.0.0.0/0 is not recommended`.
Ignore it for the demo, and put a line in your README saying you did.

### Copy the connection string

**Database** → *Connect* → *Drivers* → Node.js:

```
mongodb+srv://studymind:<PASSWORD>@studymind.XXXX.mongodb.net/?retryWrites=true&w=majority
```

**URL-encode the password.** If Atlas gave you `p@ssw0rd`, it must be
`p%40ssw0rd`. A raw `@` silently breaks the string and the error is unhelpful.

> **Never commit this string.** It goes in Replit Secrets, not in `.env` in git.

---

## 2. Vercel (frontend)

### Import

1. [vercel.com/new] → import **tagadearpit/Forge-IV**
2. **Root Directory: `web`** ← critical. The repo is a monorepo; without this
   Vercel tries to build the Express server as a Next app.
3. Framework preset: **Next.js** (auto-detected)

| Setting | Value |
|---|---|
| Root Directory | `web` |
| Framework Preset | Next.js |
| Build Command | `npm run build` |
| Output Directory | `.next` |
| Install Command | `npm install` |
| Node Version | 20.x or newer |

`web/vercel.json` already pins these, so the defaults should just work.

### Environment variables

| Key | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | *(leave for now — set after Replit is live)* |

> `NEXT_PUBLIC_*` values are **inlined at build time**. If you change the API
> URL you must **redeploy**, not just restart. This is the most common
> "why is it still calling localhost" bug.

### Verify

```bash
curl -s https://<your-app>.vercel.app | grep -o 'StudyMind' | head -1
```

---

## 3. Replit (backend)

The repo already contains `.replit`, so the Run button works with no manual
steps.

### Import

1. [replit.com] → **+ Create Repl** → *Import from GitHub* → `tagadearpit/Forge-IV`
   branch **`feat/studymind-backend`**
2. It runs `npm install && npm run build -w @studymind/server && npm run start -w @studymind/server`

`.replit` contents:

```toml
run = "npm install && npm run build -w @studymind/server && npm run start -w @studymind/server"
entrypoint = "server/dist/index.js"
modules = ["nodejs-20"]
[[ports]]
localPort = 3001
externalPort = 80
```

The server binds `0.0.0.0:$PORT` (`server/src/index.ts`) — required by Replit.

### Secrets (Replit → Tools → Secrets)

| Key | Value |
|---|---|
| `MONGODB_URI` | the Atlas string from step 1 |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `CLIENT_ORIGIN` | `https://<your-app>.vercel.app` |
| `NODE_ENV` | `production` |
| `UPLOAD_DIR` | `uploads` |
| `GEMINI_API_KEY` | *(optional — omit to stay on the offline provider)* |

### Verify

```bash
curl -s https://<repl-name>.<user>.repl.co/api/health
# {"status":"ok","db":"connected","provider":"local",...}
```

`"db":"connected"` is the one that matters. If it says `"error"`, it's the IP
allowlist 99% of the time.

### Deploy (publish) — optional

For a stable URL that doesn't change per Repl, use **Deployments → Publish**.
`.replit` already has a `[deployment]` section targeting Cloud Run. Set the same
secrets in the published deployment — **Repl secrets do not automatically carry
over** to a published deployment.

---

## 4. Wire them together

After Replit is live, set `NEXT_PUBLIC_API_URL` in Vercel and **redeploy**:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<repl-name>.<user>.repl.co` |

Then set `CLIENT_ORIGIN` in Replit to `https://<your-app>.vercel.app` and
restart.

> **Order matters.** `CLIENT_ORIGIN` must exactly match the Vercel origin —
> scheme, host, no trailing slash, no `/`. A mismatch returns
> `403 CORS_DENIED` and nothing else, which looks like a dead API.

### Check CORS both ways

```bash
# allowed → 204
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS \
  https://<repl>/api/auth/login \
  -H 'Origin: https://<your-app>.vercel.app' \
  -H 'Access-Control-Request-Method: POST'

# disallowed → 403
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS \
  https://<repl>/api/auth/login \
  -H 'Origin: https://evil.example.com' \
  -H 'Access-Control-Request-Method: POST'
```

---

## 5. First-run seed

The deployed database is empty, so sign up has nothing to show. Seed it:

```bash
# from a clone with secrets loaded locally
cd server
MONGODB_URI="mongodb+srv://..." JWT_SECRET="..." npm run seed
```

Creates `demo@studymind.app` / `Demo@1234` with an ingested sample course,
mastery history, a completed quiz and a 6-day streak.

Re-running the seed **resets only the demo user's data** — it deletes their
sources, topics, units, mastery and assessments, then recreates them. It does
not touch other users.

---

## Environment variable reference

| Variable | Set on | Required | Notes |
|---|---|---|---|
| `MONGODB_URI` | Replit | ✅ | Atlas string, password URL-encoded |
| `JWT_SECRET` | Replit | ✅ | ≥32 chars. Server **refuses to boot** otherwise |
| `CLIENT_ORIGIN` | Replit | ✅ | Exact Vercel origin |
| `NODE_ENV` | Replit | ✅ | `production` |
| `UPLOAD_DIR` | Replit | | defaults `uploads` |
| `NEXT_PUBLIC_API_URL` | Vercel | ✅ | Replit public URL. Build-time inlined |
| `GEMINI_API_KEY` | Replit | | omit → offline deterministic provider |
| `GEMINI_MODEL` | Replit | | default `gemini-2.0-flash` |
| `GROUNDING_SIMILARITY_THRESHOLD_LOCAL` | Replit | | calibrated: `0.17` |
| `GROUNDING_LEXICAL_THRESHOLD_LOCAL` | Replit | | calibrated: `0.55` |
| `GROUNDING_SIMILARITY_THRESHOLD_GEMINI` | Replit | | **empty = fails closed.** See KNOWN_LIMITATIONS §2 |

### Switching to Gemini

```
GEMINI_API_KEY=AIza...
AI_PROVIDER=gemini
```

Then, **in this order** — the steps are not optional:

1. `npx tsx scripts/calibrate_grounding.ts` → copy the printed thresholds into
   Replit secrets. Until they exist, the Gemini gate refuses answers.
2. `npx tsx scripts/reembed.ts` → re-embed every unit into the 768-dim space.
   Skipping this leaves the knowledge base silently unretrievable, because
   retrieval correctly refuses to compare 256-dim vectors with 768-dim ones.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/api/health` → `"db":"error"`, hangs 10s | Atlas IP allowlist | add `0.0.0.0/0` |
| `403 CORS_DENIED` in browser | `CLIENT_ORIGIN` mismatch | exact origin, no trailing slash |
| Frontend calls `localhost:3001` | `NEXT_PUBLIC_*` is build-time | set the var, then **redeploy** |
| Every answer is "not covered in your material" on Gemini | thresholds uncalibrated | run `calibrate_grounding.ts` |
| Knowledge base empty after adding a Gemini key | units still 256-dim | run `reembed.ts` |
| `401` on the PDF/video viewer | stale build | file tokens last 5 min; the client refreshes. Check `CLIENT_ORIGIN` if it never loads |
| Server won't start on Replit | build failed | run the `run` command in the Shell tab and read the error |
| Uploads vanish on restart | expected | files live on the container filesystem; use durable object storage in production |

---

## What has NOT been verified

This deployment path has **never been executed**. Everything above is derived
from the code and from the local production-mode boot, which *was* verified:

```
$ npm run build -w @studymind/server && NODE_ENV=production node dist/index.js
[db] connected (atlas)
[studymind] listening on http://0.0.0.0:3002
$ curl /api/health → {"status":"ok","db":"connected","provider":"local"}
$ JWT_SECRET=change-me NODE_ENV=production node dist/index.js
JWT_SECRET is not acceptable in production.
```

What that does **not** prove: Atlas actually accepting connections from Replit's
egress IP, Vercel serving the app, the two origins agreeing on CORS, or
`NEXT_PUBLIC_API_URL` resolving at build time. First real deploy is where those
get tested.