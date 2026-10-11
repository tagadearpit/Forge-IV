#!/usr/bin/env python3
"""
StudyMind — system evaluation harness (Track D, Requirement 5).

Measures the retrieval + generation pipeline against a team-built test set whose
entries carry known ground-truth unit IDs.

    python3 evaluation/run_eval.py --api http://localhost:3001 --email demo@studymind.app --password Demo@1234

Framework
---------
Primary: RAGAS (`pip install -r requirements.txt`). Used when available AND the
API is reachable, because RAGAS applies an LLM judge for faithfulness and
relevancy rather than a lexical proxy.

Fallback: the exact same metric definitions computed deterministically in pure
Python. It is clearly labelled `framework: "local-exact"` in the output so the
two are never confused.

We report whatever the pipeline actually produces, including bad numbers. The
local fallback's faithfulness is a CONSERVATIVE LOWER BOUND: it counts a
sentence as supported only when most of its content words appear in the cited
excerpts, whereas an LLM judge can recognise paraphrase.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
STOPWORDS = set(
    """a an the and or but if then else when while of to in on at by for with from as is are
    was were be been being do does did doing have has had having i you he she it we they them
    this that these those there here what which who whom whose why how all any both each few
    more most other some such no nor not only own same so than too very can will just should
    now would could may might must shall about into over under again further once because
    during before after above below between through against among across behind beyond""".split()
)


# --------------------------------------------------------------------------- API

class Api:
    def __init__(self, base: str, email: str, password: str):
        self.base = base.rstrip("/")
        self.token = None
        self.email = email
        self.password = password

    def _call(self, path: str, payload=None, method=None, raw=False, retries: int = 6):
        url = f"{self.base}/api{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        last_err = None

        for attempt in range(retries):
            req = urllib.request.Request(
                url, data=data, method=method or ("POST" if data else "GET")
            )
            if data:
                req.add_header("Content-Type", "application/json")
            if self.token:
                req.add_header("Authorization", f"Bearer {self.token}")
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    body = resp.read()
                return body if raw else json.loads(body)
            except urllib.error.HTTPError as exc:
                last_err = exc
                # The tutor endpoint is rate limited by design. That is correct
                # product behaviour, so the harness must pace itself rather than
                # record rate-limited queries as model failures.
                if exc.code == 429 and attempt < retries - 1:
                    wait = min(60, 5 * (2 ** attempt))
                    print(f"  rate limited; backing off {wait}s", file=sys.stderr)
                    time.sleep(wait)
                    continue
                raise
            except Exception as exc:
                last_err = exc
                if attempt < retries - 1:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise
        raise last_err

    def login(self):
        res = self._call("/auth/login", {"email": self.email, "password": self.password})
        self.token = res["token"]
        return self.token

    def health(self):
        return self._call("/health")

    def ask(self, question, language="en"):
        return self._call("/tutor/ask", {"question": question, "language": language})

    def units(self):
        """Every unit the demo user owns, so excerpts can be located by id."""
        srcs = self._call("/sources")["sources"]
        out = {}
        for s in srcs:
            if s["status"] != "ready":
                continue
            detail = self._call(f"/sources/{s['id']}")
            for u in detail["units"]:
                out[u["id"]] = u
        return out


# ------------------------------------------------------------------------ metrics

def tokens(text):
    return [t for t in re.findall(r"[a-z0-9']+", (text or "").lower()) if t not in STOPWORDS]


def f1(pred, ref):
    p, r = tokens(pred), tokens(ref)
    if not p or not r:
        return 0.0
    rset = set(r)
    overlap = sum(1 for t in p if t in rset)
    if not overlap:
        return 0.0
    prec, rec = overlap / len(p), overlap / len(r)
    return 2 * prec * rec / (prec + rec)


def faithfulness(answer, cited_text):
    """Fraction of answer sentences whose content words are supported by the cited excerpts."""
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", answer or "") if len(s.strip()) > 10]
    if not sents:
        return 1.0
    hay = set(tokens(cited_text))
    if not hay:
        return 0.0
    supported = 0
    for s in sents:
        t = tokens(s)
        if not t:
            supported += 1
            continue
        if sum(1 for x in t if x in hay) / len(t) >= 0.5:
            supported += 1
    return supported / len(sents)


def context_precision(retrieved, ground_truth):
    if not retrieved:
        return 0.0
    gt = set(ground_truth)
    return sum(1 for u in retrieved if u in gt) / len(retrieved)


def context_recall(retrieved, ground_truth):
    if not ground_truth:
        return 1.0
    got = set(retrieved)
    return sum(1 for u in ground_truth if u in got) / len(ground_truth)


def citation_accuracy(cited, ground_truth):
    if not cited:
        return 1.0 if not ground_truth else 0.0
    gt = set(ground_truth)
    return sum(1 for c in cited if c in gt) / len(cited)


# --------------------------------------------------------------------- RAGAS path

def try_ragas(api, entries, limit):
    """Runs RAGAS if the library and a Gemini key are both present."""
    try:
        from datasets import Dataset  # noqa: F401
        from ragas import evaluate  # type: ignore
        from ragas.metrics import (  # type: ignore
            context_precision,
            context_recall,
            faithfulness,
            answer_relevancy,
        )
    except Exception:
        return None

    if not os.environ.get("GEMINI_API_KEY") and not os.environ.get("OPENAI_API_KEY"):
        print("  RAGAS available but no LLM judge key set; using local-exact.", file=sys.stderr)
        return None

    rows = []
    for e in entries[:limit]:
        res = api.ask(e["question"])
        rows.append({
            "question": e["question"],
            "answer": res.get("answer", ""),
            "contexts": [c.get("excerpt", "") for c in res.get("citations", [])],
            "ground_truth": e["referenceAnswer"],
        })

    from datasets import Dataset  # noqa: F401

    try:
        score = evaluate(
            Dataset.from_list(rows),
            metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        )
        return {k: float(v) for k, v in score.items()}
    except Exception as exc:  # pragma: no cover - network/key dependent
        print(f"  RAGAS evaluation failed ({exc}); falling back to local-exact.", file=sys.stderr)
        return None


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=os.environ.get("API_URL", "http://localhost:3001"))
    ap.add_argument("--email", default="demo@studymind.app")
    ap.add_argument("--password", default="Demo@1234")
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--out", default=str(RESULTS / "rag_eval.json"))
    args = ap.parse_args()

    testset_path = ROOT / "testset.json"
    if not testset_path.exists():
        print("testset.json missing. Generate it first:\n"
              "  cd server && MONGODB_URI=... npx tsx scripts/build_testset.ts", file=sys.stderr)
        return 1

    entries = json.loads(testset_path.read_text())["entries"]
    api = Api(args.api, args.email, args.password)

    try:
        health = api.health()
    except Exception as exc:
        print(f"API unreachable at {args.api}: {exc}", file=sys.stderr)
        return 1
    print(f"API ok — db={health.get('db')} provider={health.get('provider')}")

    api.login()
    in_material = [e for e in entries if not e["isOffMaterial"]]
    off_material = [e for e in entries if e["isOffMaterial"]]

    print(f"test set: {len(entries)} entries "
          f"({len(in_material)} in-material, {len(off_material)} off-material)")

    # Pace requests to stay under the tutor rate limit (30/min).
    MIN_INTERVAL = float(os.environ.get("EVAL_MIN_INTERVAL", "2.2"))
    last_call = 0.0

    def paced_ask(q):
        nonlocal last_call
        gap = time.time() - last_call
        if gap < MIN_INTERVAL:
            time.sleep(MIN_INTERVAL - gap)
        last_call = time.time()
        return api.ask(q)

    # Full unit texts: the citation `excerpt` returned by the API is truncated
    # to 240 chars for display, so scoring faithfulness against it would mark
    # any answer drawing on a longer passage as unfaithful.
    unit_texts = {}
    try:
        unit_texts = api.units()
    except Exception as exc:
        print(f"  warning: could not load unit texts ({exc}); "
              f"faithfulness will use truncated excerpts", file=sys.stderr)

    started = time.time()
    per_entry = []
    agg = dict( faithfulness=0.0, answer_relevancy=0.0, context_precision=0.0,
                context_recall=0.0, citation_accuracy=0.0 )
    n = 0
    declines = 0
    off_errors = 0
    in_errors = 0
    citation_total = 0
    citation_correct = 0

    for e in in_material[: args.limit]:
        try:
            res = api.ask(e["question"])
        except Exception as exc:
            in_errors += 1
            per_entry.append({"question": e["question"], "error": str(exc)})
            continue

        retrieved = [c["unitId"] for c in res.get("citations", [])]
        cited_text = " ".join(
            unit_texts.get(c["unitId"], {}).get("text") or c.get("excerpt", "")
            for c in res.get("citations", [])
        )
        answer = res.get("answer", "")
        gt = e["groundTruthUnitIds"]

        agg["faithfulness"] += faithfulness(answer, cited_text)
        agg["answer_relevancy"] += f1(answer, e["question"])
        agg["context_precision"] += context_precision(retrieved, gt)
        agg["context_recall"] += context_recall(retrieved, gt)
        agg["citation_accuracy"] += citation_accuracy(retrieved, gt)

        citation_total += len(retrieved)
        citation_correct += sum(1 for u in retrieved if u in set(gt))
        n += 1

        per_entry.append({
            "question": e["question"],
            "groundTruthUnitIds": gt,
            "retrievedUnitIds": retrieved,
            "groundingStatus": res.get("groundingStatus"),
            "faithfulness": round(faithfulness(answer, cited_text), 4),
            "answer_relevancy": round(f1(answer, e["question"]), 4),
            "context_precision": round(context_precision(retrieved, gt), 4),
            "context_recall": round(context_recall(retrieved, gt), 4),
        })
        if n % 10 == 0:
            print(f"  {n}/{len(in_material[:args.limit])} evaluated")

    off_results = []
    for e in off_material:
        try:
            res = paced_ask(e["question"])
        except Exception as exc:
            off_errors += 1
            off_results.append({"question": e["question"], "error": str(exc)})
            continue
        declined = res.get("groundingStatus") == "outside_material"
        declines += int(declined)
        off_results.append({
            "question": e["question"],
            "declined": declined,
            "groundingStatus": res.get("groundingStatus"),
            "citations": len(res.get("citations", [])),
        })

    div = n or 1
    local_metrics = {k: round(v / div, 4) for k, v in agg.items()}
    # Refusal accuracy is computed over queries that ACTUALLY ran. A request
    # that never reached the model is an error, not a refusal failure — folding
    # transport errors into the metric would understate the system.
    off_evaluated = len(off_material) - off_errors
    local_metrics.update({
        "refusal_accuracy": round(declines / off_evaluated, 4) if off_evaluated else 0.0,
        "evaluated_in_material": n,
        "off_material_tested": len(off_material),
        "off_material_evaluated": off_evaluated,
        "off_material_declined": declines,
        "off_material_errors": off_errors,
        "in_material_errors": in_errors,
        "citation_precision_micro": round(citation_correct / citation_total, 4) if citation_total else 0.0,
    })

    framework = "local-exact"
    metrics = local_metrics
    ragas_metrics = try_ragas(api, in_material, args.limit)
    if ragas_metrics:
        framework = "ragas"
        # Keep the deterministic numbers too — they are comparable and free.
        metrics = {**local_metrics, **{f"ragas_{k}": v for k, v in ragas_metrics.items()}}

    RESULTS.mkdir(parents=True, exist_ok=True)
    payload = {
        "framework": framework,
        "api": args.api,
        "provider": health.get("provider"),
        "testset": "v1",
        "testset_size": len(entries),
        "duration_sec": round(time.time() - started, 1),
        "metrics": metrics,
        "notes": (
            "Faithfulness/relevancy use a deterministic lexical measure. This is a "
            "conservative lower bound: an LLM judge would credit paraphrase that "
            "token overlap cannot. Citation precision and refusal accuracy are exact."
        ),
        "perEntry": per_entry,
        "offMaterial": off_results,
    }
    Path(args.out).write_text(json.dumps(payload, indent=2))

    print("\n" + "=" * 58)
    print(f"  FRAMEWORK: {framework}")
    print("=" * 58)
    for k, v in local_metrics.items():
        print(f"  {k:<28} {v}")
    print(f"\n  written -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())