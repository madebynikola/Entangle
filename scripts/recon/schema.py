"""Schema and size profile of data/raw/data. Read-only; prints a report.

Usage: python3 scripts/recon/schema.py [data_dir]
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path(sys.argv[1] if len(sys.argv) > 1 else "data/raw/data")


def load():
    def arr(name, key):
        return json.load(open(DATA / name, encoding="utf-8"))[key]

    def jsonl(name):
        return [json.loads(l) for l in open(DATA / name, encoding="utf-8") if l.strip()]

    return {
        "researchers": arr("researchers.json", "researchers"),
        "publications": jsonl("publications.jsonl"),
        "projects": arr("projects.json", "projects"),
        "patents": arr("patents.json", "patents"),
        "companies": arr("companies.json", "companies"),
        "company_pages": jsonl("company-pages.jsonl"),
    }


def is_empty(v):
    return v is None or v == "" or v == [] or v == {}


def text_len(v):
    """Characters of human-readable text in a value (strings, recursively)."""
    if isinstance(v, str):
        return len(v)
    if isinstance(v, list):
        return sum(text_len(x) for x in v)
    if isinstance(v, dict):
        return sum(text_len(x) for x in v.values())
    return 0


def profile(name, recs):
    print(f"\n## {name}: {len(recs)} records")
    fields = Counter()
    empty = Counter()
    types = defaultdict(Counter)
    lens = defaultdict(list)
    for r in recs:
        for k, v in r.items():
            fields[k] += 1
            types[k][type(v).__name__] += 1
            if is_empty(v):
                empty[k] += 1
            lens[k].append(text_len(v))
    total_chars = sum(len(json.dumps(r, ensure_ascii=False)) for r in recs)
    text_chars = sum(text_len(r) for r in recs)
    print(f"json chars {total_chars:,} (~{total_chars // 4:,} tok); text chars {text_chars:,} (~{text_chars // 4:,} tok)")
    print(f"{'field':28} {'present':>8} {'empty':>6} {'types':24} {'avg ch':>8} {'p95 ch':>8} {'max ch':>8} {'sum tok':>10}")
    for k in fields:
        ls = sorted(lens[k])
        avg = sum(ls) / len(ls)
        p95 = ls[int(len(ls) * 0.95) - 1] if ls else 0
        t = ",".join(f"{a}" for a in types[k])
        print(f"{k:28} {fields[k]:>8} {empty[k]:>6} {t:24} {avg:>8.0f} {p95:>8} {ls[-1]:>8} {sum(ls) // 4:>10,}")


def nested(name, recs, key):
    """Profile the dicts in a list field (authors, challenges, ...)."""
    sub = [x for r in recs for x in (r.get(key) or []) if isinstance(x, dict)]
    if sub:
        profile(f"{name}.{key}[]", sub)


if __name__ == "__main__":
    d = load()
    for name, recs in d.items():
        profile(name, recs)
    nested("publications", d["publications"], "authors")
    nested("projects", d["projects"], "participants")
    nested("projects", d["projects"], "partners")
    nested("patents", d["patents"], "inventors")
    nested("companies", d["companies"], "challenges")
    nested("companies", d["companies"], "past_collaborations")
