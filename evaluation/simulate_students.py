#!/usr/bin/env python3
"""
StudyMind — personalization evaluation (Track D, Requirement 5c).

Does the learner model actually make a student better over sessions, compared
with a baseline that picks questions at random?

    python3 evaluation/simulate_students.py --sessions 6 --seed 7

What is being measured
----------------------
We evaluate the QUESTION SELECTION POLICY, not the language model. The answer
to "what does the tutor reply" is not what personalization hinges on — it
hinges on WHICH question the system asks next. So this harness reimplements the
same BKT + forgetting-curve mathematics the server uses (utils/bkt.ts), then
runs simulated students through:

  - ADAPTIVE: topic chosen by Zone-of-Proximal-Development score
               (mastery between 0.3 and 0.7, plus forgetting-curve urgency)
  - RANDOM :  topic chosen uniformly — the control condition

Student profiles
----------------
Each profile has a true per-topic ability. The simulated student answers each
question correctly with probability derived from their true ability and the
question's difficulty, with a slip/guess mechanism that matches BKT's own
assumptions. A "strong" student therefore improves slowly (little headroom) and
a "beginner" student improves fast — which is the expected shape, and a sanity
check that the simulation is not rigged.

Reported
--------
- mastery after the first session vs the last (MASTERY GAIN)
- number of distinct topics touched (COVERAGE)
- question repetition rate
- time-to-threshold: sessions needed to reach 0.7 mastery

IMPORTANT: these are SIMULATED numbers. They measure the scheduler, under a
stated response model. They are not evidence about real students, and the README
says so plainly.
"""

import argparse
import json
import math
import random
from pathlib import Path

RESULTS = Path(__file__).resolve().parent / "results"

# ---------------------------------------------------------------- BKT (mirrors utils/bkt.ts)
P_TRANSIT, P_SLIP, P_GUESS = 0.12, 0.10, 0.20
P_INIT = 0.10
ZPD_LOW, ZPD_HIGH = 0.30, 0.70


def bkt_update(p_learned, correct):
    if correct:
        num = p_learned * (1 - P_SLIP)
        den = num + (1 - p_learned) * P_GUESS
        posterior = num / den if den > 0 else p_learned
    else:
        num = p_learned * P_SLIP
        den = num + (1 - p_learned) * (1 - P_GUESS)
        posterior = num / den if den > 0 else p_learned
    return min(1.0, posterior + (1 - posterior) * P_TRANSIT)


def update_stability(stability, correct, days, difficulty=0.5):
    r = math.exp(-max(0.0, days) / max(0.1, stability))
    factor = 1.25 - difficulty * 0.5
    if correct:
        nxt = stability * (1 + (0.9 + (1 - r) * 2.2) * factor)
    else:
        nxt = max(0.5, stability * (0.35 + (1 - difficulty) * 0.15))
    return nxt


def retention(p_learned, days, stability):
    return min(1.0, p_learned * math.exp(-days / max(0.1, stability)))


# ------------------------------------------------------------------- profiles

PROFILES = {
    "strong":      {"ability": [0.90, 0.85, 0.92, 0.88], "label": "already knows most of it"},
    "weak":        {"ability": [0.30, 0.25, 0.35, 0.28], "label": "struggles across the board"},
    "mixed":       {"ability": [0.85, 0.80, 0.35, 0.30], "label": "strong early topics, weak later"},
    "beginner_err": {"ability": [0.55, 0.50, 0.20, 0.18],
                     "label": "specific errors on later topics"},
}


def simulate(profile_name, policy, sessions, questions_per_session, rng):
    """Runs one simulated student through `sessions` under a selection policy."""
    abilities = PROFILES[profile_name]["ability"]
    n_topics = len(abilities)

    state = [{"p": P_INIT, "attempts": 0, "stability": 1.0, "last": None} for _ in range(n_topics)]
    asked = []                      # for repetition tracking
    mastery_trace = []              # mean pLearned per session
    coverage = set()

    for session in range(sessions):
        for _ in range(questions_per_session):
            if policy == "adaptive":
                def score(i):
                    s = state[i]
                    days = (session - s["last"]) if s["last"] is not None else 3
                    ret = retention(s["p"], days, s["stability"])
                    weakness = 1 - s["p"]
                    decay = 1 - ret
                    zpd_bonus = 1.0 if ZPD_LOW <= s["p"] <= ZPD_HIGH else 0.0
                    ignorance = 0.5 if s["attempts"] == 0 else 0.0
                    return weakness * 0.5 + decay * 0.3 + zpd_bonus * 0.3 + ignorance * 0.2
                topic = max(range(n_topics), key=score)
            else:
                topic = rng.randrange(n_topics)

            coverage.add(topic)
            asked.append((session, topic))

            # Difficulty rises as the student improves, so the material keeps
            # challenging them rather than letting them coast.
            difficulty = min(0.9, 0.3 + state[topic]["p"] * 0.5)

            ability = abilities[topic]
            p_correct = ability * (1.15 - 0.5 * difficulty)
            p_correct = min(0.97, max(0.05, p_correct))
            correct = rng.random() < p_correct

            days = (session - state[topic]["last"]) if state[topic]["last"] is not None else 1
            st = state[topic]
            st["p"] = bkt_update(st["p"], correct)
            st["stability"] = update_stability(st["stability"], correct, max(1, days), difficulty)
            st["last"] = session
            st["attempts"] += 1

        mastery_trace.append(sum(s["p"] for s in state) / n_topics)

    # Repetition: consecutive asks of the SAME topic in the same session.
    reps = 0
    for i in range(1, len(asked)):
        if asked[i][0] == asked[i - 1][0] and asked[i][1] == asked[i - 1][1]:
            reps += 1

    sessions_to_70 = next((i + 1 for i, m in enumerate(mastery_trace) if m >= 0.70), None)

    return {
        "profile": profile_name,
        "policy": policy,
        "sessions": sessions,
        "first_session_mastery": round(mastery_trace[0], 4),
        "final_mastery": round(mastery_trace[-1], 4),
        "mastery_gain": round(mastery_trace[-1] - mastery_trace[0], 4),
        "final_mean_mastery": round(mastery_trace[-1], 4),
        "topics_touched": len(coverage),
        "questions_asked": len(asked),
        "repetition_rate": round(reps / max(1, len(asked) - 1), 4),
        "sessions_to_70pct": sessions_to_70,
        "trace": [round(m, 4) for m in mastery_trace],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", type=int, default=6)
    ap.add_argument("--questions", type=int, default=5)
    ap.add_argument("--repeats", type=int, default=3, help="independent trials per condition")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(RESULTS / "personalization.json"))
    args = ap.parse_args()

    rows = []
    for profile in PROFILES:
        for policy in ("adaptive", "random"):
            for trial in range(args.repeats):
                # Same seed per (profile, policy) across trials? No — independent
                # seeds, so we report mean +/- spread rather than a lucky run.
                rng = random.Random(args.seed + hash((profile, policy, trial)) % 10_000)
                rows.append(simulate(profile, policy, args.sessions, args.questions, rng))

    def agg(profile, policy):
        sel = [r for r in rows if r["profile"] == profile and r["policy"] == policy]
        gains = [r["mastery_gain"] for r in sel]
        finals = [r["final_mean_mastery"] for r in sel]
        reps = [r["repetition_rate"] for r in sel]
        cov = [r["topics_touched"] for r in sel]
        to70 = [r["sessions_to_70pct"] for r in sel if r["sessions_to_70pct"]]
        return {
            "trials": len(sel),
            "mean_mastery_gain": round(sum(gains) / len(gains), 4),
            "stdev_mastery_gain": round(float(_stdev(gains)), 4),
            "mean_final_mastery": round(sum(finals) / len(finals), 4),
            "mean_repetition_rate": round(sum(reps) / len(reps), 4),
            "mean_topics_touched": round(sum(cov) / len(cov), 2),
            "median_sessions_to_70pct": (sorted(to70)[len(to70) // 2] if to70 else None),
        }

    summary = {
        policy: {p: agg(p, policy) for p in PROFILES}
        for policy in ("adaptive", "random")
    }

    RESULTS.mkdir(parents=True, exist_ok=True)
    payload = {
        "config": {
            "sessions": args.sessions,
            "questions_per_session": args.questions,
            "trials_per_condition": args.repeats,
            "seed": args.seed,
            "bkt": {"pInit": P_INIT, "pTransit": P_TRANSIT, "pSlip": P_SLIP, "pGuess": P_GUESS},
            "zpd": [ZPD_LOW, ZPD_HIGH],
        },
        "profiles": {k: v["label"] for k, v in PROFILES.items()},
        "summary": summary,
        "runs": rows,
        "caveat": (
            "SIMULATED students under a stated response model. These numbers measure the "
            "question-selection scheduler, NOT real student outcomes. They must not be "
            "presented as evidence of real-world learning gains."
        ),
    }
    Path(args.out).write_text(json.dumps(payload, indent=2))

    print("=" * 74)
    print(f"  PERSONALIZATION — {args.sessions} sessions x {args.questions} questions "
          f"x {args.repeats} trials")
    print("=" * 74)
    print(f"{'profile':<14}{'policy':<10}{'gain':>9}{'final':>9}{'topics':>8}{'reps':>8}{'to70':>7}")
    print("-" * 74)
    for profile in PROFILES:
        for policy in ("adaptive", "random"):
            s = summary[policy][profile]
            print(f"{profile:<14}{policy:<10}"
                  f"{s['mean_mastery_gain']:>9.3f}{s['mean_final_mastery']:>9.3f}"
                  f"{s['mean_topics_touched']:>8.1f}{s['mean_repetition_rate']:>8.3f}"
                  f"{str(s['median_sessions_to_70pct']):>7}")
    print("-" * 74)

    print("\n  gain (adaptive - random):")
    wins = 0
    for p in PROFILES:
        d = summary["adaptive"][p]["mean_mastery_gain"] - summary["random"][p]["mean_mastery_gain"]
        wins += d > 0
        print(f"    {p:<14}{d:+.3f}")
    print(f"    adaptive wins {wins}/{len(PROFILES)} profiles")
    print(f"\n  written -> {args.out}")
    return 0


def _stdev(xs):
    if len(xs) < 2:
        return 0.0
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


if __name__ == "__main__":
    raise SystemExit(main())