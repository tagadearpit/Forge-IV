# StudyMind — System Evaluation

Implements Track D Requirement 5. Everything here is runnable and reports
**measured** numbers. Bad numbers are reported as measured; see
[Honest findings](#honest-findings).

## Layout

| File | Purpose |
|---|---|
| `testset.json` | 74 entries with ground-truth unit IDs (60 in-material, 14 off-material) |
| `run_eval.py` | RAG pipeline metrics against the live API |
| `simulate_students.py` | Personalization: adaptive vs. random question selection |
| `results/` | Output of the most recent run |

## Why the test set is generated, not hand-written

Ground-truth unit IDs must point at units that actually exist, otherwise context
recall and citation accuracy are meaningless. `server/scripts/build_testset.ts`
derives the set from the real ingested corpus and validates every ID against
Mongo before writing:

```bash
cd server
MONGODB_URI=<uri> npx tsx scripts/build_testset.ts
```

## Running

```bash
# 1. Seed + start the API (see the root README)
cd server && npm run seed && npm run dev

# 2. Retrieval + generation metrics
pip install -r evaluation/requirements.txt      # optional
python3 evaluation/run_eval.py --limit 30

# 3. Personalization
python3 evaluation/simulate_students.py --sessions 6 --questions 5 --repeats 5
```

Both write JSON to `results/` and print a table. The landing page and dashboard
read the most recent run from the `evalRuns` collection via `GET /api/eval/results`.

## Metric definitions

| Metric | Definition |
|---|---|
| **Faithfulness** | Fraction of answer sentences whose content words appear in the cited excerpts. |
| **Answer relevancy** | Token-level F1 between the question and the answer. |
| **Context precision** | Fraction of *cited* units that are in the ground-truth set. |
| **Context recall** | Fraction of ground-truth units that were retrieved. |
| **Citation accuracy** | Fraction of citations pointing at a ground-truth unit. |
| **Refusal accuracy** | Fraction of off-material queries correctly declined. |

### A note on framework honesty

`run_eval.py` prefers RAGAS when it is installed **and** an LLM-judge key is
present. Otherwise it computes the same definitions deterministically and sets
`framework: "local-exact"` in the output. The two are never conflated.

The local faithfulness measure is a **conservative lower bound**: it credits a
sentence only when ≥50% of its content words appear in the cited text, whereas an
LLM judge would also credit paraphrase. A low local score is therefore evidence
of a problem; a high one is not proof of perfection.

## Honest findings

Numbers below are from a real run against the local deterministic provider
(20 in-material queries, 14 off-material).

| Metric | Score | Reading |
|---|---:|---|
| Faithfulness | **1.000** | Every answer sentence is drawn from cited text. Expected for the extractive provider; a Gemini run would be a stricter test. |
| Context recall | **1.000** | Ground-truth units were always retrieved. |
| Refusal accuracy | **1.000** | 14/14 off-material queries declined. |
| Citation accuracy | **0.333** | **Weak.** The tutor cites up to 3 units; the test set usually names 1. |
| Context precision | **0.333** | Same cause as above. |
| Answer relevancy | **0.436** | **Weak.** Answers concatenate the top passages, so they are longer than the question needs. |

### Two runners, two context-precision numbers — on purpose

`run_eval.py` and the in-app `POST /api/eval/run` report different
`context_precision` (0.333 vs 0.143). They are not contradicting each other; they
measure different things:

- **`run_eval.py`** scores *cited* units against ground truth.
- **in-app runner** scores *all retrieved* units (top-k = 8) against ground truth.

Since most test entries name one ground-truth unit, scoring all 8 retrieved units
gives a lower number by construction. The in-app value is the stricter measure and
is what the landing page displays. Both are labelled, neither is hidden.

Two of these were bugs we found and fixed rather than papered over:

1. **Faithfulness first measured 0.467.** The harness was scoring answers
   against the 240-character citation excerpt the API returns for display, not
   the full unit text — so any answer drawing on a longer passage was marked
   unfaithful. Fixed; it is now scored against full unit text.
2. **Refusal accuracy first measured 0.357.** Nine of fourteen off-material
   queries had never run: they hit the tutor rate limit and returned HTTP 429.
   Counting transport errors as refusal failures understates the system. The
   harness now paces requests, retries on 429 with backoff, and reports
   `off_material_errors` separately.

### Known weaknesses we did not fix

- **Citation precision is the weakest measured number.** The tutor cites every
  unit it drew from. When the test set names a single ground-truth unit but the
  answer legitimately draws on three related passages, precision is capped near
  1/3. Making this honest would mean scoring against the full set of
  *supporting* units rather than one — that is a better metric, but we did not
  want to reshape the test set after seeing scores.
- **Answer relevancy is mediocre** because extractive answers are verbose. A
  generative provider should score higher here; we have not measured that.
- **`run_eval.py` paces at ~2.2 s/query**, so a 74-query run takes ~3 minutes.
