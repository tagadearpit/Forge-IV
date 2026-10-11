<div align="center">

# StudyMind 

**A source-grounded AI study companion.**
Multimodal AI Hackathon 2026 · Track D — Personalized Tutoring & Adaptive Learning

[Demo](https://github.com/tagadearpit/Forge-IV) · `demo@studymind.app` / `Demo@1234`

</div>

---

## The problem

Students study from lecture videos, textbooks and slide decks scattered across a
dozen places. So they ask a general-purpose chatbot. The chatbot answers fluently,
confidently, and often wrongly — because it has never seen the syllabus. There is
no way to tell a correct answer from a plausible one, and no idea whether the
concept mentioned on Tuesday's slide was ever covered.

StudyMind fixes three things at once:

1. **Grounding.** Answers come only from the student's own uploaded material, and
   every one carries the exact page, slide or timestamp it came from.
2. **Honesty.** Questions the material does not cover are declined rather than
   guessed.
3. **Adaptivity.** A per-topic mastery model updated after every answer decides
   what to ask next.

## What is built

| Track D requirement | Status | Notes |
|---|---|---|
| 1. Multimodal knowledge base | **Partial** | PDF verified end to end. PPTX/image/video/audio code paths exist but are **untested against real files** — see KNOWN_LIMITATIONS §7. |
| 2. Source grounding + refusal | Implemented | Calibrated and measured. Known over-refusal on paraphrases (22%). |
| 3. Adaptive assessment + verification + dedupe | Implemented | Numerical answers re-derived in code; misconceptions evidence-linked. |
| 4. Learner model (BKT + forgetting curve) | Implemented | Real code, exercised by the simulation. |
| 5. System evaluation | **Partial** | Harness + hand-written test set v2 shipped, but **no real framework has run** (no PyPI access, no judge key). Reports `framework: "none"`. |
| 6a. Course flow map | Implemented | Deterministic layered SVG graph (not a force-directed layout). |
| 6b. Revision material | Implemented | Flashcards + summaries. |
| 6c. Study schedule | Implemented | Weak topics + forgetting curve + days-to-exam. |
| 6d. Hindi / mixed-language | Implemented | Tutor toggle; voice input switches to `hi-IN`. |
| 6e. Audio tutoring | **Partial** | TTS read-aloud works via Web Speech API. Mic input uses `webkitSpeechRecognition` — **Chrome/Edge only; Firefox has no fallback beyond a message.** Video/audio *ingestion* is untested. |

**Markdown + LaTeX** rendering is implemented (`react-markdown` + `remark-math` +
`rehype-katex`) with raw HTML disabled. `docs/KNOWN_LIMITATIONS.md` is the
authoritative list of gaps.

---

## Quick start

```bash
# 1. install
npm install

# 2. configure
cp server/.env.example server/.env
cp web/.env.example    web/.env.local

# 3. seed the demo account + sample course
npm run seed -w server

# 4. run both services
npm run dev:server      # http://localhost:3001
npm run dev:web         # http://localhost:3000
```

Open <http://localhost:3000> and sign in with **`demo@studymind.app`** / **`Demo@1234`**.

The seed creates a working demo account with an ingested sample course, mastery
history, a completed quiz and a 6-day streak — nothing is empty on first view.

### Database

`MONGODB_URI` points at MongoDB Atlas. Leave it empty and the server starts an
ephemeral in-process MongoDB instead, so the whole app runs with zero external
setup (data does not survive a restart). `/api/health` reports which mode is live.

---

## Environment variables

### `server/.env`

| Variable | Default | Notes |
|---|---|---|
| `PORT` | *(unset)* | **Render injects this — do not set** |
| `CLIENT_ORIGIN` | `http://localhost:3000` | **Only** this origin is allowed by CORS |
| `MONGODB_URI` | *(empty)* | Empty ⇒ in-memory Mongo |
| `JWT_SECRET` | dev default | **Required** in production — the server refuses to boot with the default |
| `JWT_EXPIRES_IN` | `7d` | |
| `BCRYPT_COST` | `12` | |
| `GEMINI_API_KEY` | *(empty)* | Empty ⇒ offline deterministic provider |
| `GEMINI_MODEL` | `gemini-2.0-flash` | |
| `GROUNDING_SIMILARITY_THRESHOLD_LOCAL` | `0.17` | Calibrated for the local hashing space |
| `GROUNDING_LEXICAL_THRESHOLD_LOCAL` | `0.55` | Calibrated for the local hashing space |
| `GROUNDING_SIMILARITY_THRESHOLD_GEMINI` | *(empty)* | **NOT CALIBRATED for Gemini.** Empty ⇒ the Gemini gate fails closed (lexical signal only). Calibrate with `scripts/calibrate_grounding.ts` and set it. |
| `GROUNDING_LEXICAL_THRESHOLD_GEMINI` | *(empty)* | Set alongside the above |
| `GROUNDING_SIMILARITY_THRESHOLD` | *(empty)* | Legacy single-value override; honoured only when the per-provider value is unset |

### `web/.env.local`

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |

No secret is ever committed. `.env.example` files are the templates.

---

## Architecture

Full detail, with sequence diagrams, in **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

```
Browser (Next.js 14 · Vercel)  ──HTTPS + JWT──►  Express API (Render)
                                                    ├── MongoDB Atlas
                                                    ├── Gemini API
                                                    └── Ingestion workers
```

### The single AI seam

`server/src/ai/provider.ts` defines one `AIProvider` interface. Two
implementations ship:

- **`GeminiProvider`** — real Gemini text, vision, embeddings, audio.
- **`LocalProvider`** — fully offline and deterministic. Real chunking, real
  cosine retrieval, real extractive answers assembled only from retrieved text.

Business logic never knows which is active. The local provider exists so the
prototype is runnable and verifiable with no API key — and so the no-hallucination
guarantee can be **proved** rather than asserted.

---

## How grounding works

Two independent guards.

**1. A gate before generation.** Retrieval is scored on two signals. If neither
clears its threshold the tutor returns `outside_material` **without calling the
model at all** — so it has no opportunity to invent anything.

Cosine similarity alone cannot separate the classes. Measured against the seeded
corpus, in-material questions scored 0.10–0.51 and off-material questions
0.02–0.17 — the distributions overlap, so a single threshold either
over-refuses legitimate questions or under-refuses unrelated ones. Question-word
coverage separates far more cleanly (0.50–1.00 vs 0.00–0.67). The gate is the OR
of the two.

Thresholds are **per provider**, because the local hashing vectoriser and Gemini
produce different similarity distributions — a single shared number cannot be
correct for both. They were **calibrated, not guessed**:

```bash
cd server && MONGODB_URI=<uri> npx tsx scripts/calibrate_grounding.ts
```

Result under the **local** provider: 10/10 in-material questions kept, 11/12
off-material declined (the single accept is the deliberate
quantum-chromodynamics paragraph the sample course plants as a refusal probe).

> **Gemini thresholds are NOT CALIBRATED.** `GROUNDING_SIMILARITY_THRESHOLD_GEMINI`
> ships empty on purpose. With no Gemini key available we could not measure the
> real score distribution, and inventing a number would be fabricating evidence.
> While unset, the Gemini gate **fails closed**: similarity alone can never admit
> an answer, so only lexical coverage can. That is deliberately conservative and
> will over-refuse until you calibrate. Run the script above with
> `GEMINI_API_KEY` set and copy the printed values in.

**2. A citation audit after generation.** Any citation pointing at a unit that was
not actually retrieved is stripped before the answer reaches the user. The count
is recorded, surfaced in the UI ("N unverified citations removed"), and included
in the evaluation metrics.

---

## How the learner model works

Full detail in **[`docs/LEARNER_MODEL.md`](docs/LEARNER_MODEL.md)**. Summary:

Bayesian knowledge tracing per topic — a Bayes step over a two-state hidden
model, then a separate forward projection via the transition probability — plus an
FSRS-lite stability term driving `retention = pL · exp(−days/stability)`.

Question selection targets the **Zone of Proximal Development** (mastery 0.3–0.7),
because topics already mastered and hopeless topics both yield little learning per
minute.

**Why BKT over plain spaced repetition:** spaced repetition cannot express a slip.
After ten correct answers, one miss is far more likely a slip than real forgetting,
and BKT discounts it; spaced repetition has no way to say that.

---

## Evaluation

Everything is runnable. See **`evaluation/README.md`** and
**`docs/KNOWN_LIMITATIONS.md`**.

```bash
python3 evaluation/run_eval.py            # exits NON-ZERO if no framework ran
npx tsx scripts/simulate_students.ts     # simulation over the REAL learner-model code
python3 evaluation/parity_test.py        # legacy Python sim vs TypeScript, 1e-9
```

### ⚠️ No evaluation framework has run

`run_eval.py` reports **`framework: "none"`** and exits **1**.

This build environment has **no outbound access to PyPI** and **no judge-model
key**, so RAGAS/DeepEval could not be installed or run. That is an environment
limitation, not a skipped step. The numbers below are **own metrics** computed
against ground-truth unit sets, plus clearly separated **deterministic lexical
proxies** — neither is a framework result.

### Test set v2 (hand-written, frozen before scoring)

54 in-material questions across six styles (conceptual, paraphrase, multi-unit,
numeric, compare, structure) and 16 off-material (12 **near-miss** — same
subject, genuinely absent — and 4 trivial). Ground truth is keyed by
`{page, snippet}` and resolved to live ObjectIds at run time, so it survives
reseeds. The old templated set survives as `testset_smoke.json` and is
**excluded** from these numbers.

### Measured — retrieval & grounding (provider: local)

| Metric | Value |
|---|---:|
| context recall | **1.000** |
| citation recall | **0.764** |
| citation precision | 0.293 |
| context precision | 0.156 |
| refusal accuracy — trivial | **1.000** |
| refusal accuracy — **near-miss** | **0.500** |
| **false-refusal rate on in-material** | **0.222** (12 of 54) |

Lexical proxies (secondary, not framework metrics): faithfulness 0.889,
answer relevancy 0.268.

**These numbers are bad in two specific, structural ways**, documented rather
than tuned away:

- **22% of legitimate questions are wrongly refused.** Every one is a paraphrase
  or wordy question — the gate's lexical signal keys on literal overlap, which
  paraphrases lack by construction.
- **Only half of near-miss questions are refused.** They share one distinctive
  term with the material (e.g. *"What is a **TLB** shootdown?"* matches on "TLB").

An IDF-weighted coverage variant was built and measured: it improved near-miss
refusal 0.500 → 0.583 but **worsened** over-refusal 0.222 → 0.259, because the
0.55 threshold is calibrated for the unweighted distribution. Adopting it would
have been an un-calibrated threshold swap dressed up as progress, so the gate
stays on the signal it was calibrated against.

### Measured — personalization (simulated)

| Profile | Adaptive gain | Random gain | Δ |
|---|---:|---:|---:|
| strong | 0.359 | 0.288 | +0.071 |
| weak | 0.086 | 0.101 | **−0.016** |
| mixed | 0.328 | 0.261 | +0.068 |
| beginner_err | 0.167 | 0.150 | +0.017 |
| late_bloomer | 0.340 | 0.330 | +0.011 |
| erratic | 0.277 | 0.295 | **−0.018** |

Adaptive wins **4/6** — and *loses* on two profiles. Repetition rate is far
lower under adaptive (0.007–0.021 vs 0.172).

**Simulated students.** This measures the question-selection scheduler, **not
real students**. The response model was not tuned after seeing results.

> An earlier Python re-implementation of this simulation reported 4/4 wins.
> Re-running the **real TypeScript learner-model code** produced 4/6. That gap
> is exactly why the simulation now imports production functions instead of
> copying them.

## Honest findings

The full list lives in **`docs/KNOWN_LIMITATIONS.md`**. The headlines:

- **No real evaluation framework has run** (no PyPI access, no judge key).
  Reported as `framework: "none"` with a non-zero exit.
- **The grounding gate over-refuses** (22% false refusals on in-material
  questions) and **under-refuses near-misses** (50%). Both structural.
- **Gemini thresholds are not calibrated**, so the Gemini gate fails closed.
- **The Gemini provider has never made a live API call** — unit-tested against a
  fake provider only.
- **Video/audio/PPTX ingestion is untested** against real files.
- **Personalization evidence is simulated**, not real students.
- **Login returns distinct 404/401**, enabling account enumeration. Intentional
  per the brief; rate-limited but not eliminated.

### `npm audit --omit=dev`

```
2 vulnerabilities (1 high, 1 critical)
  next     >=9.3.4-canary.0 - <=16.3.0-preview.10   critical (direct)
           DoS via Image Optimizer; request deserialization DoS;
           HTTP request smuggling in rewrites
  postcss  <=8.5.22                                 high     (transitive, via next)
           XSS via Unescaped </style>; arbitrary file read via sourceMappingURL
```

Both are fixed only by moving to **Next.js 16** — a major breaking upgrade that
was **not applied**, because shipping an unvalidated major upgrade is worse than
a documented advisory. Multer was upgraded 1.x → 2.4.0 (no advisory).

## Prior approaches considered

- **RAG over fine-tuning.** Fine-tuning bakes facts into weights, so you cannot
  cite a page, you cannot retract a fact when the student corrects it, and
  retraining per course is prohibitive. Retrieval keeps a pointer to the exact
  source, which is the entire product.
- **BKT over plain spaced repetition.** Covered above — slips.
- **BKT over IRT / Elo.** IRT calibrates *items* across a large bank; we cannot
  pre-calibrate difficulty for material the student just uploaded. BKT estimates
  the *student*, which is what we can actually measure.
- **Vector index in Atlas vs. in-process scoring.** Retrieval runs in-process so
  the same code path works against a local MongoDB. Against Atlas the declared
  `units.embedding` index enables `$vectorSearch` with no change to callers.
- **Cosine-only vs. composite grounding gate.** Measured; cosine alone does not
  separate. Documented above.

---

## Security & privacy

- bcrypt cost 12, hashed server-side — the client never sends a hash
- JWT 7-day expiry; every query is scoped by `userId`
- zod validation on every request body; uniform `{ error: { code, message } }`
- CORS locked to `CLIENT_ORIGIN`
- The server **refuses to boot in production** with the default `JWT_SECRET`
- Rate limits on auth (10/15 min per IP+email), tutor (30/min) and heavy work
- Uploads are per-user and never used to train anything

---

## Verification

```bash
cd server
npm test                    # 33 unit tests
bash scripts/verify.sh      # 47 end-to-end checks
```

Covers auth error copy, page-number preservation, grounded citations,
off-material refusal, corrupt/empty/unsupported uploads, zero-question quizzes,
answer-key non-leakage, dedupe, mastery movement and streak. Idempotent across
runs.

Bugs this suite caught during the build, each fixed:

| Bug | Symptom |
|---|---|
| `cosineSimilarity` compared `min(len)` components | Retrieval silently returned noise under Gemini (768-dim vs 256-dim) |
| `$group {_id:'$day'}` read as `r.day` | Study streak always 0 |
| Aggregation `$match` does not auto-cast ObjectId | Streak query matched nothing |
| Array methods chained onto a `reduce` result | Runtime `TypeError` in topic clustering |
| `CastError` surfaced as 500 | Typo'd `:id` looked like a crash |
| `hasEOL` not set by pdf-parse | Whole PDF page ingested as one line; headings lost |
| pdf.js text runs lack trailing spaces | Words fused: "ProgrammingLecture" |
| Font encoding undeclared | Em-dash decoded as control char U+0097 |
| `numericTolerance` returned a constant 0.01 | A 12000 answer was graded with exact equality |
| `applyOp` checked `a===0` for division | `5/0` returned `Infinity` |
| Module-level `unitTopicMap` | Two concurrent users could get each other's topic tags |
| `testset.json` is an object, not an array | In-app eval crashed on `entries.slice()` |
| Division guard in eval harness | HTTP 429s were counted as refusal failures, not errors |

---

## Repository layout

```
Forge-IV/
├── server/                Express + TypeScript API
│   ├── src/ai/            provider.ts — the single AI seam
│   ├── src/models/        10 Mongoose models
│   ├── src/services/      ingestion · rag · assessment · learnerModel · studyPlan
│   ├── src/routes/        auth · sources · topics · tutor · assessments · mastery …
│   └── scripts/           verify.sh · build_testset.ts · calibrate_grounding.ts
├── web/                   Next.js 14 App Router
│   └── src/app/           landing · auth · app shell · 9 product pages
├── evaluation/            run_eval.py · simulate_students.py · testset.json
└── docs/                  ARCHITECTURE · LEARNER_MODEL · DEMO_SCRIPT
```

## Deployment

**[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** has the full walkthrough.

Deploy in this order — **Atlas → Vercel → Render** — because Render needs the
Vercel URL for `CLIENT_ORIGIN`:

| Platform | Key settings |
|---|---|
| **MongoDB Atlas** | M0 cluster · user (Read/Write) · Network Access `0.0.0.0/0` (Render/Vercel egress IPs are dynamic — see the warning) · Connect → Drivers → **Node.js** · copy the `mongodb+srv://` string |
| **Vercel** | Root Directory **`web`** · Next.js · build `npm run build` · output `.next` · env `NEXT_PUBLIC_API_URL` |
| **Render** | **New → Blueprint** → `render.yaml` is committed, so only three values need pasting · build `npm ci && npm run build -w @studymind/server` · start `node server/dist/index.js` · health `/api/health` · don't set `PORT`, Render injects it |

`render.yaml` and `web/vercel.json` are committed, so the Blueprint import
needs no manual configuration. `trust proxy` is already set to `1` for
Render's load balancer, and `/api/health` is public, so health checks work
unauthenticated.

Traps worth knowing before you start:
- `NEXT_PUBLIC_*` is **inlined at build time** — change it and you must
  **redeploy**, not restart.
- `CLIENT_ORIGIN` must match the Vercel origin exactly (scheme, host, no
  trailing slash) or every browser call returns `403 CORS_DENIED`.
- **Render's free plan spins down after 15 min idle** and takes ~50s to wake.
  The first request after idle will look like a hang. That's the plan.
- **Uploads are ephemeral on the free plan** — a redeploy wipes them. Mount a
  disk at `/var/data` and set `UPLOAD_DIR=/var/data/uploads` to keep them.
- Atlas passwords must be **URL-encoded**; a raw `@` breaks the URI silently.

Seed the deployed DB once, otherwise there's nothing to see:
```bash
cd server && MONGODB_URI="mongodb+srv://..." JWT_SECRET="..." npm run seed
```

---

## Team

`<Your Team Name>` — placeholder.

## License

Demo course material (`server/src/scripts/sampleCourse.ts`) was written
specifically for this prototype and is offered under CC BY 4.0. All diagrams are
original SVG — no third-party imagery is bundled.
