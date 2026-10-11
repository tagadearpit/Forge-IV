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

### Headline (own metrics, computed against ground-truth unit sets)

| Metric | Definition |
|---|---|
| **Citation precision** | Fraction of cited units that appear in the ground-truth set. |
| **Citation recall** | Fraction of ground-truth units that were actually cited. |
| **Context precision** | Fraction of *retrieved* units in the ground-truth set. |
| **Context recall** | Fraction of ground-truth units that were retrieved. |
| **Refusal accuracy (trivial / near-miss)** | Off-material queries correctly declined, split by difficulty. |
| **False-refusal rate** | In-material questions incorrectly declined — the over-refusal cost. |

### Secondary — deterministic lexical proxies

`faithfulnessLexical`, `answerRelevancyLexical`. Token-overlap measures, clearly
**not** framework metrics and **not** judge scores. They are a conservative lower
bound on faithfulness.

### A note on framework honesty

`run_eval.py` prefers RAGAS when importable **and** a judge key is present. In
this environment neither is true, so it reports `framework: "none"` and exits
**non-zero**. The `local-exact` metrics that earlier versions reported as headline
numbers have been demoted to the clearly-labelled secondary block above. See
`docs/KNOWN_LIMITATIONS.md` §1.

## Test sets

| File | Use |
|---|---|
| `testset_v2.json` | 54 hand-written in-material questions. **Headline numbers.** |
| `testset_v2_offmaterial.json` | 16 off-material (12 near-miss, 4 trivial). **Headline numbers.** |
| `testset_smoke.json` | Old templated set. **Smoke only — never reported.** |

The old set asked `what does this statement say: "<verbatim sentence>"` with that
same sentence as the reference answer, so faithfulness ≈ 1.0 was guaranteed by
construction and measured nothing.

Ground truth in v2 is keyed by `{page, snippet}` and resolved to live ObjectIds at
run time, so it survives reseeding.

## Personalization

`simulate_students.py` (Python, parity-tested) and
`server/scripts/simulate_students.ts` (imports the **real** learner-model code —
this is the authoritative one).
