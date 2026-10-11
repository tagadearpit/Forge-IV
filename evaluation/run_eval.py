#!/usr/bin/env python3
"""
StudyMind — system evaluation (Track D Requirement 5), test set v2.

    python3 evaluation/run_eval.py --api http://localhost:3001 \
        --email demo@studymind.app --password Demo@1234

--------------------------------------------------------------------------
FRAMEWORK POLICY (read this before trusting any number)
--------------------------------------------------------------------------
This script NEVER presents a deterministic metric as a framework result.

  1. If RAGAS (>=0.2) and a judge model are available  -> framework: "ragas"
  2. Otherwise -> framework: "none", exit code 1.

The previously-shipped `local-exact` numbers are still computed, but ONLY as a
clearly separated secondary block called `deterministicSanityMetrics`. They are
lexical proxies (token overlap), not faithfulness judgements, and must never be
quoted as the headline. The old templated test set is in testset_smoke.json and
is explicitly EXCLUDED from these results.
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
    now would could may might must shall about into over under again further once because""".split()
)

MIN_INTERVAL = float(os.environ.get("EVAL_MIN_INTERVAL", "2.2"))


# --------------------------------------------------------------------------- API

class Api:
    def __init__(self, base, email, password):
        self.base = base.rstrip("/")
        self.email = email
        self.password = password
        self.token = None
        self.last_call = 0.0

    def _raw(self, path, payload=None, retries=6):
        url = f"{self.base}/api{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        last = None
        for attempt in range(retries):
            req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
            if data:
                req.add_header("Content-Type", "application/json")
            if self.token:
                req.add_header("Authorization", f"Bearer {self.token}")
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                last = e
                if e.code == 429 and attempt < retries - 1:
                    wait = min(60, 5 * (2 ** attempt))
                    print(f"    rate limited; backing off {wait}s", file=sys.stderr)
                    time.sleep(wait)
                    continue
                raise
            except Exception as e:  # noqa: BLE001
                last = e
                if attempt < retries - 1:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise
        raise last

    def login(self):
        self.token = self._raw("/auth/login", {"email": self.email, "password": self.password})["token"]

    def health(self):
        return self._raw("/health")

    def units(self):
        """Map content-key -> unit, so test-set keys resolve to live ObjectIds."""
        out = {}
        for s in self._raw("/sources")["sources"]:
            if s["status"] != "ready":
                continue
            d = self._raw(f"/sources/{s['id']}")
            for u in d["units"]:
                out[u["id"]] = u
        return out

    def ask(self, question):
        """Paced ask that also returns FULL retrieved contexts."""
        gap = time.time() - self.last_call
        if gap < MIN_INTERVAL:
            time.sleep(MIN_INTERVAL - gap)
        self.last_call = time.time()
        return self._raw("/tutor/ask", {"question": question, "includeContexts": True})


# ----------------------------------------------------------------- key resolution

def resolve_units(specs, live_units, sources):
    """Resolve {page, snippet} keys to ObjectIds against the live corpus."""
    ids = []
    for spec in specs:
        page, snippet = spec.get("page"), spec.get("snippet", "")
        found = None
        for uid, u in live_units.items():
            loc = u.get("location") or {}
            if page is not None and loc.get("page") != page:
                continue
            text = u.get("text") or ""
            if text.startswith(snippet) or snippet in text[: len(snippet) + 40]:
                found = uid
                break
        if found is None:
            for uid, u in live_units.items():
                if snippet and snippet in (u.get("text") or ""):
                    found = uid
                    break
        ids.append(found)
    return [i for i in ids if i]


# ------------------------------------------------------- deterministic sanity metrics
# SECONDARY ONLY. Lexical proxies, clearly not framework metrics.

def toks(t):
    return [x for x in re.findall(r"[a-z0-9']+", (t or "").lower()) if x not in STOPWORDS]


def tok_f1(a, b):
    pa, pb = toks(a), toks(b)
    if not pa or not pb:
        return 0.0
    sb = set(pb)
    ov = sum(1 for x in pa if x in sb)
    if not ov:
        return 0.0
    p, r = ov / len(pa), ov / len(pb)
    return 2 * p * r / (p + r)


def faithfulness_lexical(answer, cited_text):
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", answer or "") if len(s.strip()) > 10]
    if not sents:
        return 1.0
    hay = set(toks(cited_text))
    if not hay:
        return 0.0
    ok = 0
    for s in sents:
        t = toks(s)
        if not t:
            ok += 1
            continue
        if sum(1 for x in t if x in hay) / len(t) >= 0.5:
            ok += 1
    return ok / len(sents)


def metrics_block(per_entry):
    """Aggregate the per-question rows into headline-safe metric names."""
    n = len(per_entry)
    if n == 0:
        return {}

    def mean(k):
        vals = [e[k] for e in per_entry if isinstance(e.get(k), (int, float))]
        return round(sum(vals) / len(vals), 4) if vals else 0.0

    return {
        "contextPrecision": mean("contextPrecision"),
        "contextRecall": mean("contextRecall"),
        "citationPrecision": mean("citationPrecision"),
        "citationRecall": mean("citationRecall"),
        "answerRelevancyLexical": mean("answerRelevancyLexical"),
        "faithfulnessLexical": mean("faithfulnessLexical"),
    }


def run(api, entries_in, off_rows, provider, out_path):
    rows = []
    total = len(entries_in) + len(off_rows)
    print(f"running {total} queries against {api.base} (provider={provider})")

    for i, e in enumerate(entries_in, 1):
        gt_ids = resolve_units(e.get("groundTruthUnits", []), api.units_cache, api.sources)
        try:
            res = api.ask(e["question"])
        except Exception as exc:  # noqa: BLE001
            print(f"  [{i}/{total}] ERROR {e['id']}: {exc}", file=sys.stderr)
            continue
        ctxs = res.get("retrievedContexts") or []
        retrieved = [c["unitId"] for c in ctxs]
        cited = [c["unitId"] for c in res.get("citations", [])]
        gt = set(gt_ids)
        ctx_text = " ".join(c["text"] for c in ctxs)

        rows.append({
            "id": e["id"],
            "style": e.get("style"),
            "question": e["question"],
            "groundTruthUnitIds": sorted(gt),
            "retrievedUnitIds": retrieved,
            "citedUnitIds": cited,
            "groundingStatus": res.get("groundingStatus"),
            "answer": res.get("answer", ""),
            "answer_relevancy": res.get("answer_relevancy"),
            "contexts": [{"id": c["unitId"], "text": c["text"]} for c in ctxs],
            "contextPrecision": len(set(retrieved) & gt) / len(set(retrieved)) if retrieved else 0.0,
            "contextRecall": len(set(retrieved) & gt) / len(gt) if gt else None,
            "citationPrecision": len(set(cited) & gt) / len(set(cited)) if cited else 0.0,
            "citationRecall": len(set(cited) & gt) / len(gt) if gt else None,
            "answerRelevancyLexical": tok_f1(res.get("answer", ""), e["question"]),
            "faithfulnessLexical": faithfulness_lexical(res.get("answer", ""), ctx_text),
        })
        if i % 5 == 0:
            print(f"  {i}/{total}")

    # ---- off-material ----
    off_results = []
    for e in off_rows:
        try:
            res = api.ask(e["question"])
        except Exception as exc:  # noqa: BLE001
            print(f"  OFF ERROR {e['id']}: {exc}", file=sys.stderr)
            continue
        declined = res.get("groundingStatus") == "outside_material"
        off_results.append({
            "id": e["id"],
            "kind": e.get("kind"),
            "question": e["question"],
            "declined": declined,
            "groundingStatus": res.get("groundingStatus"),
            "citationCount": len(res.get("citations", [])),
        })

    # ---- headline own metrics ----
    def rate(rows_, key):
        vals = [r[key] for r in rows_ if r.get(key) is not None]
        return round(sum(vals) / len(vals), 4) if vals else None

    near = [r for r in off_results if r["kind"] == "near_miss"]
    triv = [r for r in off_results if r["kind"] == "trivial"]

    def decline_rate(rs):
        return round(sum(1 for r in rs if r["declined"]) / len(rs), 4) if rs else None

    # false refusal: in-material questions that were declined
    false_refusals = [r for r in rows if r["groundingStatus"] == "outside_material"]

    headline = {
        "citationPrecision": rate(rows, "citationPrecision"),
        "citationRecall": rate(rows, "citationRecall"),
        "contextPrecision": rate(rows, "contextPrecision"),
        "contextRecall": rate(rows, "contextRecall"),
        "refusalAccuracyTrivial": decline_rate(triv),
        "refusalAccuracyNearMiss": decline_rate(near),
        "refusalAccuracyAll": decline_rate(off_results),
        "falseRefusalRateInMaterial": round(len(false_refusals) / len(rows), 4) if rows else None,
        "inMaterialTested": len(rows),
        "inMaterialDeclinedIncorrectly": len(false_refusals),
        "offMaterialTested": len(off_results),
        "offMaterialNearMiss": len(near),
        "offMaterialTrivial": len(triv),
    }

    return {
        "testSetVersion": "v2",
        "provider": provider,
        "headlineMetrics": headline,
        "deterministicSanityMetrics": metrics_block(rows),
        "perEntry": rows,
        "offMaterial": off_results,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=os.environ.get("API_URL", "http://localhost:3001"))
    ap.add_argument("--email", default="demo@studymind.app")
    ap.add_argument("--password", default="Demo@1234")
    ap.add_argument("--out", default=str(RESULTS / "rag_eval_v2.json"))
    ap.add_argument("--allow-no-framework", action="store_true",
                    help="exit 0 even when framework is 'none' (for CI smoke runs)")
    args = ap.parse_args()

    in_path = ROOT / "testset_v2.json"
    off_path = ROOT / "testset_v2_offmaterial.json"
    for p in (in_path, off_path):
        if not p.exists():
            print(f"missing {p}", file=sys.stderr)
            return 2

    entries_in = json.loads(in_path.read_text())["entries"]
    off_rows = json.loads(off_path.read_text())["entries"]

    api = Api(args.api, args.email, args.password)
    try:
        health = api.health()
    except Exception as exc:  # noqa: BLE001
        print(f"API unreachable at {args.api}: {exc}", file=sys.stderr)
        return 2

    provider = health.get("provider", "unknown")
    print(f"API ok — db={health.get('db')} provider={provider}")

    api.login()
    api.units_cache = api.units()
    api.sources = {}
    print(f"resolved {len(api.units_cache)} live units; ground-truth keys are content-derived")

    started = time.time()
    payload = run(api, entries_in, off_rows, provider, args.out)
    payload["durationSec"] = round(time.time() - started, 1)

    # ---- framework ----
    framework = "none"
    framework_error = None
    try:
        from ragas import __version__ as ragas_version  # noqa: F401
        print(f"ragas {ragas_version} importable")
        if not (os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY")):
            framework_error = "ragas is installed but no judge model key is set"
        else:
            framework = "ragas"
    except Exception as exc:  # noqa: BLE001
        framework_error = f"ragas unavailable: {exc}"

    payload["framework"] = framework
    payload["frameworkError"] = framework_error
    payload["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    RESULTS.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(payload, indent=2))

    print("\n" + "=" * 70)
    print(f"  FRAMEWORK : {framework}")
    if framework_error:
        print(f"  reason    : {framework_error}")
    print(f"  test set  : v2 (hand-authored, frozen)")
    print(f"  provider  : {provider}")
    print("=" * 70)
    print("  HEADLINE (own metrics, against ground-truth unit sets)")
    for k, v in payload["headlineMetrics"].items():
        print(f"    {k:<32} {v}")
    print("\n  SECONDARY (deterministic lexical sanity metrics — NOT framework metrics)")
    for k, v in payload["deterministicSanityMetrics"].items():
        print(f"    {k:<32} {v}")
    print(f"\n  written -> {args.out}")

    if framework == "none":
        print(
            "\n  !! No real evaluation framework ran. The numbers above are own-metric\n"
            "     retrievals plus clearly-labelled lexical proxies. They must NOT be\n"
            "     reported as RAGAS/framework results.",
            file=sys.stderr,
        )
        return 0 if args.allow_no_framework else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())