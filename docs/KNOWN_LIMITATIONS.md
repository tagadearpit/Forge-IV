# Known Limitations

Honest list of what this prototype does not do well, has not verified, or has
left in a state that would bite someone in production.

---

## 1. No real evaluation framework has run

`evaluation/run_eval.py` reports `framework: "none"` and exits non-zero.

**Why:** this build environment has **no outbound access to PyPI** (`pip` fails
with `ConnectionResetError`), so RAGAS and DeepEval cannot be installed, and
**no judge-model key** (`GEMINI_API_KEY` / `OPENAI_API_KEY`) is available.
Installing a real framework was therefore impossible here, not merely skipped.

**Consequence:** every evaluation number in the README is either an *own metric*
computed against ground-truth unit sets, or a *deterministic lexical proxy*
clearly labelled as such. **None of them are RAGAS/framework results.** The
lexical proxies are a conservative lower bound on faithfulness and should not be
quoted as judge scores.

To close this: `pip install -r evaluation/requirements.txt`, set a judge key,
re-run. The harness detects RAGAS and switches `framework` to `ragas` automatically.

---

## 2. Gemini thresholds are NOT CALIBRATED

`GROUNDING_SIMILARITY_THRESHOLD_GEMINI` ships **empty**.

The local hashing vectoriser and Gemini produce different similarity
distributions, so the local threshold (0.17) is meaningless for Gemini. Rather
than invent a number, the gate **fails closed** when Gemini is active and
uncalibrated: similarity alone can never admit an answer, so only lexical
coverage can. This will **over-refuse** until calibrated.

Run `MONGODB_URI=... npx tsx scripts/calibrate_grounding.ts` with `GEMINI_API_KEY`
set and copy the printed values into `.env`.

The **local** thresholds are calibrated and reproducible; re-running the script
reproduces 0.17 / 0.55.

---

## 3. Gemini path is unverified end to end

The Gemini provider is implemented but has **never made a live API call** in this
environment. It is exercised only by unit tests with a fake 8-dim provider.

Untested against the real API: vision (`describeImage`), audio
(`transcribeAudio`), real embeddings, and Gemini's JSON adherence in
`groundedAnswer` / `draftQuestions`.

---

## 4. The grounding gate over-refuses, and under-refuses near-misses

Measured on test set v2 (54 in-material, 16 off-material):

| Metric | Value |
|---|---:|
| False-refusal rate on in-material questions | **0.222** (12 of 54) |
| Refusal accuracy — trivial off-material | 1.000 |
| Refusal accuracy — **near-miss** off-material | **0.500** |

Both failure modes are real and structural:

- **Over-refusal** concentrates on **paraphrased** questions. The gate's lexical
  signal keys on literal word overlap, which a paraphrase lacks by construction.
- **False accepts** are near-misses that share one distinctive term with the
  material — e.g. *"What is a **TLB** shootdown?"* matches on "TLB" even though
  shootdowns appear nowhere in the course.

An **IDF-weighted** variant of the coverage signal was implemented and measured
(`idfWeightedOverlap`, retained in `services/rag.ts`). It improved near-miss
refusal 0.500 → 0.583 but **worsened** over-refusal 0.222 → 0.259, because the
0.55 threshold is calibrated for the unweighted distribution. Adopting it would
have been an un-calibrated threshold swap presented as an improvement, so the
gate stays on the signal it was calibrated against.

This is the classic over-refusal / false-accept tradeoff and is the single
biggest quality gap in the system.

---

## 5. Citation precision is weak

`citationPrecision` = **0.293**, `contextPrecision` = **0.156**.

The tutor cites every unit it drew from, while each test question usually names
one or two ground-truth units. When an answer legitimately synthesises three
related passages, precision is capped near 1/3.

A fairer metric would score against the full set of *supporting* units, but we
did not want to reshape the test set after seeing scores.

---

## 6. Personalization evidence is SIMULATED ONLY

`server/scripts/simulate_students.ts` imports the real learner-model code
(`bktUpdate`, `updateStability`, `retention`, `priorityScore`, `inZPD`,
`selectNextTopic`) and runs 6 profiles × 6 sessions × 5 questions × 5 trials.

Results: adaptive selection wins **4/6** profiles, and **loses** on `weak`
(-0.016) and `erratic` (-0.018). Its real advantage is repetition control
(0.007–0.021 vs 0.172 for random).

These are **simulated students under a stated response model**. They measure the
question-selection scheduler, **not real students**, and must never be presented
as evidence of real-world learning gain. The response model was **not tuned after
seeing results**.

A prior Python re-implementation of this simulation claimed 4/4 wins; running the
real TypeScript code showed 4/6. That discrepancy is why the simulation now
imports the production functions.

---

## 7. Video and audio ingestion are NOT verified end to end

The code path exists (ffmpeg audio extraction → timestamped transcription →
30–60 s units) but **no video or audio file was ever ingested successfully** in
this environment. `transcribeAudio` returns `[]` under the local provider.

Only PDF ingestion is verified, and only against a synthetic PDF that this
repository generates itself. PPTX parsing is implemented (per-slide text +
speaker notes) but likewise untested against a real deck.

---

## 8. Login error messages enable account enumeration

`POST /auth/login` deliberately returns a distinct **404 `USER_NOT_FOUND`** for an
unknown email and **401 `INVALID_PASSWORD`** for a known one, because the brief
specified that exact copy and the matching "Create an account" affordance.

This is an intentional usability/security **tradeoff**: attackers can enumerate
which addresses have accounts. Mitigations in place: per-IP+email rate limiting
(10 attempts / 15 min) and generic wording for every other failure. A production
deployment should collapse both to one generic response, losing the
account-creation shortcut.

---

## 9. npm audit — 2 known vulnerabilities (1 critical, 1 high)

`npm audit --omit=dev` summary:

```
next      >=9.3.4-canary.0 - <=16.3.0-preview.10   critical  (direct)
  - Next.js self-hosted applications vulnerable to DoS via Image Optimizer
  - Next.js HTTP request deserialization can lead to DoS
  - Next.js HTTP request smuggling in rewrites
postcss   <=8.5.22                                 high      (transitive, via next)
  - PostCSS XSS via Unescaped </style> in CSS Stringify Output
  - PostCSS arbitrary file read via attacker-controlled sourceMappingURL
```

Both are fixed only by moving to **Next.js 16**, a major breaking upgrade that was
**not applied** — it would require re-validating every route and component with no
time budget left, and an unvalidated major upgrade is worse than a documented
advisory. Re-run `npm audit --omit=dev` and schedule the upgrade.

Multer was upgraded 1.x → **2.4.0** (no advisory); its storage callback no longer
guarantees `req.params`, which the upload filename previously relied on.

---

## 10. Test-set limitations

- **Single synthetic course.** All content is one lecture written by us for this
  prototype. Results do not generalise to real multi-course, multi-modal corpora.
- **We wrote both the material and the questions**, which biases the set toward
  in-material questions and predictable phrasing.
- **No figure/diagram questions.** The seeded course contains no images, so the
  "figure-based" style is approximated by questions about structures described in
  prose (the virtual-address bit split). Real diagram understanding is untested.
- **Near-miss off-material questions are also ours.** Their difficulty is not
  calibrated against real student questions.
- The old templated set survives as `testset_smoke.json` and is **excluded** from
  headline numbers; it exists only to prove the pipeline runs.

---

## 11. Not deployed

The prototype has never been deployed to Vercel or Replit. No working public
URL exists. Only local runs against an ephemeral/local MongoDB have been verified.