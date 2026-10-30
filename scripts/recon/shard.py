"""Work-split numbers: token size of each researcher bundle (profile + own
publications, projects, patents) and each company bundle (profile + pages),
grouped by canonical faculty and department, plus a balanced-shard proposal.
Also counts challenges that read as non-research (finance, hiring, legal).

Usage: python3 scripts/recon/shard.py [data_dir] [n_shards]
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from quality import fold  # noqa: E402
from schema import load  # noqa: E402

# folded faculty name -> canonical English name
FACULTY = {
    "fakultet tehnickih nauka": "Faculty of Technical Sciences",
    "prirodno-matematicki fakultet": "Faculty of Sciences",
    "poljoprivredni fakultet": "Faculty of Agriculture",
    "tehnoloski fakultet": "Faculty of Technology",
    "pravni fakultet": "Faculty of Law",
    "tehnicki fakultet „mihajlo pupin“ zrenjanin": 'Technical Faculty "Mihajlo Pupin" Zrenjanin',
    "medicinski fakultet": "Faculty of Medicine",
    "ekonomski fakultet u subotici": "Faculty of Economics in Subotica",
    "filozofski fakultet": "Faculty of Philosophy",
    "institut biosens": "BioSense Institute",
    "naucni institut za prehrambene tehnologije (fins)": "Institute of Food Technology (FINS)",
    "gradjevinski fakultet subotica": "Faculty of Civil Engineering Subotica",
}


def canon_faculty(name):
    return FACULTY.get(fold(name), name)


def tok(obj):
    return len(json.dumps(obj, ensure_ascii=False)) // 4


NON_RESEARCH = re.compile(
    r"series a|seed (investment|round)|\bseed\b.*round|raise .*€|€.*round|investor|angel|\bvcs?\b|venture fund|"
    r"\bbanks?\b|\bloan|line of credit|financing|leasing|cash-?flow|ebitda|audited|financial (statements|projections|plan)|"
    r"\bhire\b|\bhiring\b|recruit|salar|candidates|country manager|"
    r"lawyer|legal (team|advice|opinion|firm)|licen[cs]|permit|\bvat\b|procurement|tender|sales (team|training)|"
    r"notified body|certification|registration|regulator", re.I)


def main():
    n_shards = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    d = load()
    P = {p["id"]: p for p in d["publications"]}
    J = {p["id"]: p for p in d["projects"]}
    T = {p["id"]: p for p in d["patents"]}

    bundles = []
    for r in d["researchers"]:
        t = tok(r) + sum(tok(P[x]) for x in r["publications"]) + sum(tok(J[x]) for x in r["projects"]) + sum(tok(T[x]) for x in r["patents"])
        bundles.append((r["id"], canon_faculty(r["faculty"]), r["department"], t))
    ts = sorted(b[3] for b in bundles)
    print(f"## researcher bundles: {len(ts)}, total {sum(ts):,} tok (publications shared by co-authors counted per author)")
    print(f"  per researcher: min {ts[0]:,}, median {ts[len(ts) // 2]:,}, p95 {ts[int(len(ts) * .95)]:,}, max {ts[-1]:,}")

    fac = defaultdict(lambda: [0, 0])
    for _, f, _, t in bundles:
        fac[f][0] += 1
        fac[f][1] += t
    print(f"\n## by canonical faculty ({len(fac)})")
    for f, (n, t) in sorted(fac.items(), key=lambda x: -x[1][1]):
        print(f"  {n:>4} researchers {t:>10,} tok  {f}")

    dep = defaultdict(lambda: [0, 0])
    for _, f, dp, t in bundles:
        dep[(f, dp)][0] += 1
        dep[(f, dp)][1] += t
    print(f"\n## departments: {len(dep)} distinct (faculty, department) pairs")
    for (f, dp), (n, t) in sorted(dep.items(), key=lambda x: -x[1][1])[:15]:
        print(f"  {n:>4} {t:>9,} tok  {f} / {dp}")

    # greedy balanced bins over departments, largest first
    bins = [[0, []] for _ in range(n_shards)]
    for key, (n, t) in sorted(dep.items(), key=lambda x: -x[1][1]):
        b = min(bins, key=lambda x: x[0])
        b[0] += t
        b[1].append((key, n))
    print(f"\n## {n_shards} balanced shards by department")
    for i, (t, items) in enumerate(sorted(bins, key=lambda x: -x[0])):
        print(f"  shard {i + 1:>2}: {t:>9,} tok, {sum(n for _, n in items):>4} researchers, {len(items)} departments")

    # compact card: profile without bio/notes + titles of own publications, projects, patents
    cards = []
    for r in d["researchers"]:
        card = {k: r[k] for k in ("id", "name", "title", "faculty", "department", "fields", "keywords", "open_to", "industry_experience")}
        card["pubs"] = [f"{P[x]['year']} {P[x]['title']}" for x in r["publications"]]
        card["projects"] = [J[x]["title"] for x in r["projects"]]
        card["patents"] = [T[x]["title"] for x in r["patents"]]
        cards.append(tok(card))
    cards.sort()
    print(f"\n## compact researcher cards (no bio/notes, titles only): total {sum(cards):,} tok, median {cards[len(cards) // 2]:,}, max {cards[-1]:,}")

    print(f"  companies with fewer than 6 pages: {[c for c, n in Counter(p['company_id'] for p in d['company_pages']).items() if n < 6]}")

    cb = []
    for c in d["companies"]:
        pages = [p for p in d["company_pages"] if p["company_id"] == c["id"]]
        cb.append((c["id"], tok(c) + sum(tok(p) for p in pages), tok(c["challenges"])))
    ts = sorted(x[1] for x in cb)
    print(f"\n## company bundles (profile + pages): {len(ts)}, total {sum(ts):,} tok")
    print(f"  per company: min {ts[0]:,}, median {ts[len(ts) // 2]:,}, max {ts[-1]:,}; challenges alone {sum(x[2] for x in cb):,} tok")

    print("\n## challenges that read as non-research (strict regex)")
    pos = Counter()
    tot = Counter()
    flagged = []
    for c in d["companies"]:
        for i, ch in enumerate(c["challenges"], 1):
            tot[i] += 1
            if NON_RESEARCH.search(ch["text"]):
                pos[i] += 1
                flagged.append(ch["id"])
    print(f"  {len(flagged)} of {sum(tot.values())}; by position in the company's list: " +
          ", ".join(f"CH{i}: {pos[i]}/{tot[i]}" for i in sorted(tot)))
    print(f"  companies with at least one: {len({f.split('-')[0] for f in flagged})}")
    print(f"  ids: {' '.join(flagged)}")

    print("\n## co-authorship inside the dataset")
    pairs = Counter()
    cross = 0
    R = {r["id"]: r for r in d["researchers"]}
    for p in P.values():
        ids = sorted({a["researcher_id"] for a in p["authors"] if a.get("researcher_id")})
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                pairs[(ids[i], ids[j])] += 1
                if canon_faculty(R[ids[i]]["faculty"]) != canon_faculty(R[ids[j]]["faculty"]):
                    cross += 1
    print(f"  {len(pairs)} researcher pairs share a publication; {cross} pair-publications cross faculties")


if __name__ == "__main__":
    main()
