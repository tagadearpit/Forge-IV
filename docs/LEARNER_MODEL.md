# Learner Model — StudyMind

Tracks what a student knows, per topic, and updates it after every answer.

## 1. Bayesian Knowledge Tracing

Each topic is a two-state hidden variable — *Not-Learned* / *Learned* — with four
parameters per user:

| Symbol | Meaning | Default |
|---|---|---:|
| `pL` | current P(Learned) — the mastery probability | 0.10 |
| `pT` | P(learning the topic) on each opportunity | 0.12 |
| `pS` | P(you know it but answer wrong) — a *slip* | 0.10 |
| `pG` | P(you answer right without knowing it) — a *guess* | 0.20 |

### The update

Given the prior `pL` and an observation `o`:

```
correct (o=1):   pL_post = pL(1-pS) / [ pL(1-pS) + (1-pL)pG ]
incorrect (o=0): pL_post = pL·pS   / [ pL·pS   + (1-pL)(1-pG) ]

then project forward one opportunity:

                 pL_next = pL_post + (1 - pL_post)·pT
```

The denominator in each is the total probability of seeing that observation, so
this is one Bayes step over the two-state HMM.

**Why the projection is a separate step.** The posterior reflects evidence about
the past; the transition projects forward. Collapsing them into a single
expression is a common shortcut and it inflates measured gains — the student
appears to learn from the act of being tested rather than from practising.

Implementation: `server/src/utils/bkt.ts` → `bktPosterior`, `bktTransition`,
`bktUpdate`. All pure functions.

### Why BKT rather than plain spaced repetition

| | BKT | Plain spaced repetition |
|---|---|---|
| Models slips | yes (`pS`) | no — a wrong answer is just wrong |
| Models guessing | yes (`pG`) | no |
| Tracks confidence | yes | no — a 3-day interval means the same thing regardless of history |
| Uses wrong answers | as weak evidence for | ignored or as a full reset |

The slip/guess terms are what make a single wrong answer interpretable. After a
student has answered a topic correctly many times, one miss is far more likely a
slip than genuine forgetting, and BKT discounts it accordingly. Spaced repetition
has no way to express that, so it either over-punishes an unlucky answer or
ignores the signal entirely.

*(Alternative considered and not used: IRT / Elo-style ability estimates. They
scale better across thousands of items but need a calibrated item bank. With a
per-student corpus of uploaded material we cannot pre-calibrate difficulty, so
BKT — which estimates the student, not the item — is the better fit.)*

## 2. Forgetting curve

Retention decays exponentially with elapsed time:

```
retention = pL · exp( −daysSinceReview / stability )
```

`stability` (in days) is updated FSRS-lite style:

```
r          = exp(−days / stability)               # retrievability now

correct:   stability ← stability · (1 + (0.9 + (1−r)·2.2) · difficultyFactor)
incorrect: stability ← max(0.5, stability · (0.35 + (1−difficulty)·0.15))

difficultyFactor = 1.25 − difficulty·0.5
```

A successful recall when retrievability was still low is strong evidence and
yields a large jump. A success when retention was already ≈1 barely moves it —
you cannot become more certain than certain. Failure shrinks stability sharply.

## 3. Confidence

```
confidence = min(1, attempts / 8)
```

Reported as **low** (<3 attempts), **medium**, **high** (≥8). The UI shows this
explicitly so a mastery figure backed by two answers is never presented with the
same authority as one backed by twenty.

## 4. Cold start

New users have no history. Two mechanisms:

1. **Intake prior.** Self-rated familiarity (1–5) maps to a prior of
   `0.15 … 0.60`, blended at weight 1.0 when no attempts exist, 0.3 after. It can
   never mark a topic mastered.
2. **Diagnostic quiz.** During onboarding the student answers questions across
   detected topics; each feeds the normal BKT path.

Confidence stays **low** until real attempts accumulate, so a cold-start mastery
number is visibly provisional.

## 5. Adaptive selection — Zone of Proximal Development

Topics are scored for the next question:

```
score = weakness·0.5 + decay·0.3 + ignorance·0.2 + zpdBonus·0.3 + urgency·0.4
```

- `weakness` = `1 − pL`
- `decay` = `1 − retention` (forgetting-curve pressure)
- `ignorance` = 0.5 if the topic has never been attempted
- `zpdBonus` = 1.0 when `0.30 ≤ pL ≤ 0.70`
- `urgency` = `clamp(1 − daysToExam/60)`, zero without an exam date

The ZPD term is the important one. Topics already mastered (pL > 0.7) and
hopeless topics (pL < 0.3) both yield little learning per minute; the band in
between yields the most. Mastery is deliberately allowed to sit outside the band —
a student is not pushed off a topic the moment it crosses 0.7.

## 6. Measured effect

From `evaluation/simulate_students.py` (6 sessions × 5 questions × 5 trials,
4 simulated profiles, adaptive vs. random selection):

| Profile | Adaptive gain | Random gain | Δ |
|---|---:|---:|---:|
| strong | 0.497 | 0.448 | +0.049 |
| weak | 0.418 | 0.182 | **+0.237** |
| mixed | 0.404 | 0.351 | +0.053 |
| beginner (late-topic errors) | 0.303 | 0.076 | **+0.227** |

Adaptive wins on 4/4 profiles, and the gain concentrates where there is headroom —
which is the expected shape. A `strong` profile gains little because there is
little to gain; that is a sanity check that the harness is not rigged.

**Two honest caveats:**

- These are **simulated** students under a stated response model. They measure
  the question-selection scheduler, not real students. They are not evidence of
  real-world learning gain.
- **Repetition rate is higher under adaptive selection** (0.40 vs 0.19 for the
  weak profile). That is a real trade-off: focusing on weak topics produces
  consecutive same-topic questions. We report it rather than tuning the policy
  until the number looks good.

## 7. Where mastery updates

Single write path — `recordAnswer()` in `services/learnerModel.ts` — so the
dashboard, `/mastery` and `/study-plan` can never disagree.

Graded quiz answers and tutor interactions both call it. Critically, **only
verified questions advance mastery**: an unverified answer key must not be
allowed to corrupt the learner model, so `question.verified` is checked first.