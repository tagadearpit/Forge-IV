# Architecture — StudyMind

Track D: Personalized Tutoring & Adaptive Learning.

## System shape

```
Browser (Next.js 14 · Vercel)
        │  HTTPS JSON + Authorization: Bearer <JWT>
        ▼
Express API (TypeScript · Replit)  ── binds 0.0.0.0:$PORT
        │
        ├──────────────► MongoDB Atlas (Mongoose)
        │
        ├──────────────► Gemini API  (text · vision · embeddings · audio)
        │
        └──────────────► Ingestion workers
                          PDF / PPTX / image / video → chunks + embeddings
```

The browser never talks to Gemini or MongoDB directly. Every privileged call goes
through the API, which is the only component holding credentials.

## Two sequence diagrams

### Ingestion

```
Client        API          Storage      Extractor      Provider     Mongo
  │  POST /sources (multipart)
  ├───────────►│
  │            ├─ store file ──────────────────►│
  │            ├─ create Source(status=queued) ───────────────►│
  │◄─── 202 {sourceId, status} ──┤            │              │
  │            │            queued ───────────────────────────►│
  │            ├─ parse (async) ────────────────────────►│      │
  │            │                  PDF per page / PPTX per     │
  │            │                  slide+notes / video→ts     │
  │            │◄── units[] with exact locations ────┤      │
  │            ├─ chunk (400 tok, 60 overlap, word-snapped)   │
  │            ├─ embed ─────────────────────────────────────►│
  │            │                  vectors ───────────────────►│
  │            ├─ extract topics (headings first, then TF-IDF)►│
  │            ├─ merge near-duplicate topics (cos > 0.88) ──►│
  │            ├─ tag units with topicIds ───────────────────►│
  │            ├─ status=ready ──────────────────────────────►│
  │  GET /sources/:id  (poll)                                   │
  ├───────────►├─────────────────────────────────────────────►│
  │◄─── units[] with page/slide/timestamp ────────────────────┤
```

A unit-level failure records a reason and does **not** fail the whole source; the
source only reaches `ready` when every stage completes.

### Ask the tutor

```
Client        API          Retrieval     Provider     Citation audit
  │  POST /tutor/ask {question, scope, language}
  ├───────────►│
  │            ├─ embed question ─────────────────────────────►│
  │            ├─ score all units for this user + scope ──────►│
  │            ├─ top-k (8) ────────────────────────────────────►│
  │            │◄── hits[] with similarity ────────────────────┤
  │            │
  │            │  GATE:  sim >= 0.17 OR coverage >= 0.55 ?
  │            │    ── no ─► return outside_material. The model is
  │            │             never called. It cannot invent.
  │            │    ── yes
  │            ├─ ground the answer, report unit ids used ───────────►│
  │            │◄── {answer, citedUnitIds[], groundingStatus} ───────┤
  │            ├─ strip any cited id NOT in the retrieved set ──────┤
  │            │◄── audit {requested, verified, stripped} ───────────┤
  │◄── {answer, citations[], groundingStatus} ───┤
```

## The AI seam

`server/src/ai/provider.ts` defines the single `AIProvider` interface. Business
modules depend on that interface and nothing else.

```ts
interface AIProvider {
  generateText(opts): Promise<string>
  generateJSON<T>(opts): Promise<T>
  embed(texts): Promise<number[][]>
  describeImage(opts): Promise<string>
  transcribeAudio(opts): Promise<...>
  extractTopics(opts): Promise<TopicExtraction>
  groundedAnswer(opts): Promise<GroundedAnswerDraft>
  draftQuestions(opts): Promise<DraftQuestion[]>
}
```

Two implementations ship:

| | `GeminiProvider` | `LocalProvider` |
|---|---|---|
| Network | yes | no |
| Used when | `GEMINI_API_KEY` is set | otherwise |
| Grounded answers | generative, constrained | **extractive** — concatenates retrieved sentences |
| Question drafting | generative | cloze / sentence-based extraction |
| Can invent content? | constrained by prompt + citation audit | **no** — it only ever re-emits retrieved text |

The local provider exists so the entire prototype is runnable and verifiable with
no API key, and so the grounding guarantee can be *proved* rather than asserted.
Swapping providers changes one factory line.

## Data model

Ten collections, all indexed on `userId`:

`users` · `sources` · `units` · `topics` · `questions` · `assessments` ·
`responses` · `mastery` · `events` · `evalRuns`

`units.embedding` carries a vector index declaration. Retrieval currently scores
similarity in-process so the identical code path works against a local MongoDB;
against Atlas it can move to a native `$vectorSearch` without changing callers.

## Error contract

Every failure returns `{ error: { code, message } }`:

| Status | Code | When |
|---:|---|---|
| 400 | `INVALID_ID` | malformed `:id` param |
| 400 | `EMPTY_FILE` | zero-byte upload |
| 401 | `NO_TOKEN` / `INVALID_TOKEN` / `TOKEN_EXPIRED` | auth |
| 404 | `USER_NOT_FOUND` | login with unknown email |
| 409 | `EMAIL_EXISTS` / `ALREADY_SUBMITTED` | conflict |
| 413 | `FILE_TOO_LARGE` | over `MAX_UPLOAD_MB` |
| 415 | `UNSUPPORTED_TYPE` | unsupported upload |
| 422 | `VALIDATION_ERROR` / `GENERATION_FAILED` | zod or generation |
| 429 | `RATE_LIMITED` | limiter tripped |
| 500 | `INTERNAL_ERROR` | unexpected fault |

Rate limits: auth 10/15 min per IP+email, tutor 30/min, heavy work 30/min.

## Security

- bcrypt cost 12, hashed server-side (the client never sends a hash)
- JWT 7-day expiry, bearer header, scoped per user on every query
- zod validation on every request body
- CORS locked to `CLIENT_ORIGIN`
- The app refuses to boot in production with the default `JWT_SECRET`
- Upload filenames are sanitised and served with `Content-Disposition: inline`