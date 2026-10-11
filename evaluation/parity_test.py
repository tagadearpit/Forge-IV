#!/usr/bin/env python3
"""
Parity test: does the Python BKT re-implementation reproduce the TypeScript one?

The golden file evaluation/golden_bkt.json is generated from the REAL TypeScript
code (server/scripts/simulate_students.ts). If Python agrees to 1e-9 on every
case, the legacy evaluation/simulate_students.py is measuring the same system and
may be kept. If it diverges, the Python sim must be deleted rather than trusted.

    python3 evaluation/parity_test.py

Exit code 0 = parity holds, 1 = divergence.
"""
import json
import math
import sys
from pathlib import Path

TOL = 1e-9

ROOT = Path(__file__).resolve().parent
GOLDEN = ROOT / "golden_bkt.json"

# Mirrors server/src/utils/bkt.ts
P_TRANSIT, P_SLIP, P_GUESS = 0.12, 0.10, 0.20


def clamp01(x):
    return min(1.0, max(0.0, x))


def bkt_posterior(p_learned, correct):
    if correct:
        num = p_learned * (1 - P_SLIP)
        den = num + (1 - p_learned) * P_GUESS
    else:
        num = p_learned * P_SLIP
        den = num + (1 - p_learned) * (1 - P_GUESS)
    return num / den if den > 0 else p_learned


def bkt_update(p_learned, correct):
    post = clamp01(bkt_posterior(p_learned, correct))
    return clamp01(post + (1 - post) * P_TRANSIT), post


def update_stability(stability, correct, days, difficulty=0.5):
    r = math.exp(-max(0.0, days) / max(0.1, stability))
    factor = 1.25 - difficulty * 0.5
    if correct:
        nxt = max(0.1, stability) * (1 + (0.9 + (1 - r) * 2.2) * factor)
    else:
        nxt = max(0.5, max(0.1, stability) * (0.35 + (1 - difficulty) * 0.15))
    return round(nxt, 4), round(r, 4)


def retention(p_learned, days, stability):
    return clamp01(p_learned * math.exp(-days / max(0.1, stability)))


def priority_score(p_learned, retention_value, attempts, days_to_exam):
    weakness = 1 - p_learned
    decay = 1 - retention_value
    ignorance = 0.5 if attempts == 0 else 0.0
    urgency = 0.0
    if days_to_exam is not None and days_to_exam > 0:
        urgency = clamp01(1 - days_to_exam / 60)
    return round(weakness * 0.5 + decay * 0.3 + ignorance * 0.2 + urgency * 0.4, 4)


def in_zpd(p, low=0.3, high=0.7):
    return low <= p <= high


def main():
    if not GOLDEN.exists():
        print("golden_bkt.json missing — generate it with:\n"
              "  cd server && npx tsx scripts/simulate_students.ts", file=sys.stderr)
        return 2

    cases = json.loads(GOLDEN.read_text())["cases"]
    failures = []

    for i, c in enumerate(cases):
        p_learned = c["pLearned"]
        correct = c["correct"]
        days = c["days"]
        difficulty = c["difficulty"]
        stability = c["stability"]

        got_pl, got_post = bkt_update(p_learned, correct)
        got_st, got_retr = update_stability(stability, correct, days, difficulty)
        got_ret = retention(got_pl, days, got_st)
        got_pri = priority_score(got_pl, got_ret, 5, 30)
        got_zpd = in_zpd(got_pl)

        checks = [
            ("pLearned", got_pl, c["expectedPLearned"]),
            ("posterior", got_post, c["expectedPosterior"]),
            ("stability", got_st, c["expectedStability"]),
            ("retrievability", got_retr, c["expectedRetrievability"]),
            ("retention", got_ret, c["expectedRetention"]),
            ("priority", got_pri, c["expectedPriority"]),
        ]
        for name, got, want in checks:
            if abs(got - want) > TOL:
                failures.append(f"case {i} {name}: python={got!r} ts={want!r} delta={got-want:.3e}")
        if got_zpd != c["expectedInZpd"]:
            failures.append(f"case {i} inZPD: python={got_zpd} ts={c['expectedInZpd']}")

    print(f"parity cases: {len(cases)}")
    if failures:
        print(f"FAIL: {len(failures)} mismatch(es) beyond {TOL}")
        for f in failures[:10]:
            print("  " + f)
        print("\nThe Python simulation does NOT match the TypeScript implementation.")
        print("Delete evaluation/simulate_students.py rather than trusting it.", file=sys.stderr)
        return 1

    print(f"PASS: Python reproduces the TypeScript learner model to within {TOL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())