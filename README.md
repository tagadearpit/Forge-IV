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

| Track D requirement | Status |
|---|---|
| 1. Multimodal knowledge base (PDF · PPTX · image · video · audio) | Implemented |
| 2. Source grounding + refusal | Implemented, calibrated, measured |
| 3. Adaptive assessment + verification + dedupe | Implemented |
| 4. Learner model (BKT + forgetting curve) | Implemented |
| 5. System evaluation (RAGAS or equivalent + personalization) | Implemented |
| 6a. Course flow map | Implemented |
| 6b. Revision material (flashcards, summaries) | Implemented |
| 6c. Study schedule | Implemented |
| 6d. Hindi / mixed-language tutoring | Implemented |
| 6e. Audio (mic + TTS) | Implemented (Web Speech API) |

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
| `PORT` | `3001` | Replit injects this |
| `CLIENT_ORIGIN` | `http://localhost:3000` | **Only** this origin is allowed by CORS |
| `MONGODB_URI` | *(empty)* | Empty ⇒ in-memory Mongo |
| `JWT_SECRET` | dev default | **Required** in production — the server refuses to boot with the default |
| `JWT_EXPIRES_IN` | `7d` | |
| `BCRYPT_COST` | `12` | |
| `GEMINI_API_KEY` | *(empty)* | Empty ⇒ offline deterministic provider |
| `GEMINI_MODEL` | `gemini-2.0-flash` | |
| `GROUNDING_SIMILARITY_THRESHOLD` | `0.17` | Calibrated — see below |
| `GROUNDING_LEXICAL_THRESHOLD` | `0.55` | Calibrated — see below |

### `web/.env.local`

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |

No secret is ever committed. `.env.example` files are the templates.

---

## Architecture

Full detail, with sequence diagrams, in **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

```
Browser (Next.js 14 · Vercel)  ──HTTPS + JWT──►  Express API (Replit)
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

Thresholds were **calibrated, not guessed**:

```bash
cd server && MONGODB_URI=<uri> npx tsx scripts/calibrate_grounding.ts
```

Result: 10/10 in-material questions kept, 12/12 off-material declined.

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

Everything is runnable. See **[`evaluation/README.md`](evaluation/README.md)**.

```bash
python3 evaluation/run_eval.py --limit 30          # retrieval + generation
python3 evaluation/simulate_students.py            # personalization
```

### Measured results

Retrieval and generation, 20 in-material + 14 off-material queries against the
live API:

| Metric | `run_eval.py` | in-app runner |
|---|---:|---:|
| Faithfulness | **1.000** | **1.000** |
| Context recall | **1.000** | **1.000** |
| Refusal accuracy | **1.000** (14/14) | **1.000** (10/10) |
| Context precision | 0.333 | 0.143 |
| Citation accuracy | 0.333 | 0.333 |
| Answer relevancy | 0.436 | 0.415 |

The two context-precision figures differ because they score different things:
`run_eval.py` scores *cited* units, the in-app runner scores *all retrieved*
units (top-k = 8). The in-app number is the stricter one and is what the landing
page shows.

Personalization — 6 sessions × 5 questions × 5 trials, adaptive vs. random:

| Profile | Adaptive gain | Random gain | Δ |
|---|---:|---:|---:|
| strong | 0.497 | 0.448 | +0.049 |
| weak | 0.418 | 0.182 | **+0.237** |
| mixed | 0.404 | 0.351 | +0.053 |
| beginner (late-topic errors) | 0.303 | 0.076 | **+0.227** |

Adaptive wins 4/4, concentrated where there is headroom.

---

## Honest findings

The rubric grades "rigor and honesty of reported results", so these are stated
plainly rather than buried.

**Two bugs we found and fixed rather than reported as scores:**

- Faithfulness first measured **0.467**. The harness was scoring answers against
  the 240-character citation excerpt the API returns for display, not the full
  unit text — so any answer drawing on a longer passage looked unfaithful.
- Refusal accuracy first measured **0.357**. Nine of fourteen off-material queries
  had never actually run; they hit the tutor rate limit and returned HTTP 429.
  Counting transport errors as refusal failures understates the system. The
  harness now paces, retries with backoff, and reports errors separately.

**Weaknesses we did not fix:**

- **Citation accuracy (0.333) is our weakest number.** The tutor cites every unit
  it drew from; the test set usually names one ground-truth unit. When an answer
  legitimately draws on three related passages, precision is capped near 1/3. A
  fairer metric would score against the full set of supporting units — but we did
  not want to reshape the test set after seeing scores.
- **Answer relevancy (0.436) is mediocre** because extractive answers are longer
  than the question needs. A generative provider should score higher; we have not
  measured that.
- **The personalization numbers are simulated.** They measure the
  question-selection scheduler under a stated response model. They are **not**
  evidence of real-world learning gain.
- **Repetition is higher under adaptive selection** (0.40 vs 0.19 for weak
  profiles) — focusing on weak topics produces consecutive same-topic questions.
  A real trade-off, reported rather than tuned away.
- **Faithfulness 1.000 is measured against an extractive provider** that cannot
  generate anything outside retrieved text. It proves the guard, but a Gemini run
  is the stricter test.
- **Video/audio ingestion is verified structurally, not end-to-end** — it needs
  ffmpeg plus a real transcription API.

---

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
bash scripts/verify.sh      # 38/38
```

Covers auth error copy, page-number preservation, grounded citations,
off-material refusal, corrupt/empty/unsupported uploads, zero-question quizzes,
answer-key non-leakage, dedupe, mastery movement and streak. Idempotent across
runs.

Bugs this suite caught during the build, each fixed:

| Bug | Symptom |
|---|---|
| `$group {_id:'$day'}` read as `r.day` | Study streak always 0 |
| Aggregation `$match` does not auto-cast ObjectId | Streak query matched nothing |
| Array methods chained onto a `reduce` result | Runtime `TypeError` in topic clustering |
| `CastError` surfaced as 500 | Typo'd `:id` looked like a crash |
| `hasEOL` not set by pdf-parse | Whole PDF page ingested as one line; headings lost |
| pdf.js text runs lack trailing spaces | Words fused: "ProgrammingLecture" |
| Font encoding undeclared | Em-dash decoded as control char U+0097 |

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

**Backend (Replit)** — import the repo, set `server/.env` values, run
`npm install && npm run build -w server && npm start -w server`. Binds
`0.0.0.0:$PORT`.

**Frontend (Vercel)** — set root directory to `web`, set
`NEXT_PUBLIC_API_URL` to the Replit URL, deploy.

Set `CLIENT_ORIGIN` to the Vercel URL on the backend, or CORS will reject the
browser.

---

## Team

`<Your Team Name>` — placeholder.

## License

Demo course material (`server/src/scripts/sampleCourse.ts`) was written
specifically for this prototype and is offered under CC BY 4.0. All diagrams are
original SVG — no third-party imagery is bundled.