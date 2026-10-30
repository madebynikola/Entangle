"""Join-key integrity and value distributions. Read-only; prints a report.

Usage: python3 scripts/recon/joins.py [data_dir]
"""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from schema import DATA, load  # noqa: E402


def show(title, counter, n=40):
    print(f"\n### {title} ({len(counter)} distinct)")
    for k, v in counter.most_common(n):
        print(f"  {v:>6}  {k}")


def main():
    d = load()
    R = {r["id"]: r for r in d["researchers"]}
    P = {p["id"]: p for p in d["publications"]}
    J = {p["id"]: p for p in d["projects"]}
    T = {p["id"]: p for p in d["patents"]}
    C = {c["id"]: c for c in d["companies"]}

    print("## id uniqueness")
    for name, recs in d.items():
        if name == "company_pages":
            continue
        ids = Counter(r["id"] for r in recs)
        dups = [k for k, v in ids.items() if v > 1]
        print(f"  {name}: {len(recs)} records, {len(ids)} ids, dup ids {dups[:5]}")
    chal = Counter(ch["id"] for c in d["companies"] for ch in c["challenges"])
    print(f"  challenges: {sum(chal.values())} records, {len(chal)} ids, dup {[k for k, v in chal.items() if v > 1][:5]}")
    bad_ch = [ch["id"] for c in d["companies"] for ch in c["challenges"] if not ch["id"].startswith(c["id"] + "-CH")]
    print(f"  challenge ids not prefixed by their company id: {bad_ch[:5]}")
    print(f"  id patterns: " + ", ".join(
        f"{n}={sorted(set(re.sub(r'[0-9]', '9', r['id']) for r in recs))}"
        for n, recs in d.items() if n != "company_pages"))

    print("\n## researcher -> publication")
    rp_missing = [(rid, pid) for rid, r in R.items() for pid in r["publications"] if pid not in P]
    print(f"  researcher.publications ids not in publications: {len(rp_missing)} {rp_missing[:5]}")
    fwd = {(rid, pid) for rid, r in R.items() for pid in r["publications"]}
    back = {(a["researcher_id"], p["id"]) for p in P.values() for a in p["authors"] if a.get("researcher_id")}
    print(f"  pairs from researcher.publications: {len(fwd)}; from publication.authors: {len(back)}")
    print(f"  in researcher list but author has no matching researcher_id: {len(fwd - back)} {sorted(fwd - back)[:5]}")
    print(f"  author researcher_id set but not in researcher list: {len(back - fwd)} {sorted(back - fwd)[:5]}")
    unknown_rid = {a["researcher_id"] for p in P.values() for a in p["authors"] if a.get("researcher_id") and a["researcher_id"] not in R}
    print(f"  author researcher_ids not in researchers: {len(unknown_rid)} {sorted(unknown_rid)[:5]}")
    orphan = [p["id"] for p in P.values() if not any(a.get("researcher_id") for a in p["authors"])]
    print(f"  publications with no linked author: {len(orphan)} {orphan[:5]}")
    in_any = {pid for r in R.values() for pid in r["publications"]}
    print(f"  publications listed by no researcher: {len(set(P) - in_any)}")
    npub = Counter(len(r["publications"]) for r in R.values())
    print(f"  publications per researcher: min {min(npub)}, max {max(npub)}, dist {sorted(npub.items())}")
    linked = Counter(sum(1 for a in p["authors"] if a.get("researcher_id")) for p in P.values())
    print(f"  linked (in-dataset) authors per publication: {sorted(linked.items())}")
    # name on author record vs profile name
    mism = [(a["researcher_id"], a["name"], R[a["researcher_id"]]["name"]) for p in P.values() for a in p["authors"]
            if a.get("researcher_id") in R and a["name"] != R[a["researcher_id"]]["name"]]
    print(f"  author.name != researcher.name for linked authors: {len(mism)}")
    for m in Counter(mism).most_common(12):
        print(f"    {m}")

    print("\n## researcher -> project")
    rj_missing = [(rid, j) for rid, r in R.items() for j in r["projects"] if j not in J]
    print(f"  researcher.projects ids not in projects: {len(rj_missing)} {rj_missing[:5]}")
    fwd = {(rid, j) for rid, r in R.items() for j in r["projects"]}
    back = {(x["researcher_id"], j["id"]) for j in J.values() for x in j["participants"]}
    print(f"  pairs fwd {len(fwd)}, back {len(back)}, fwd-back {len(fwd - back)}, back-fwd {len(back - fwd)} {sorted(back - fwd)[:5]}")
    print(f"  participant ids not in researchers: {len({x['researcher_id'] for j in J.values() for x in j['participants'] if x['researcher_id'] not in R})}")
    print(f"  participants per project: {sorted(Counter(len(j['participants']) for j in J.values()).items())}")
    show("participant roles", Counter(x["role"] for j in J.values() for x in j["participants"]))
    show("project programmes", Counter(j["programme"] for j in J.values()), 30)
    show("project years", Counter(j["years"] for j in J.values()), 15)

    print("\n## researcher -> patent")
    rt_missing = [(rid, t) for rid, r in R.items() for t in r["patents"] if t not in T]
    print(f"  researcher.patents ids not in patents: {len(rt_missing)}")
    fwd = {(rid, t) for rid, r in R.items() for t in r["patents"]}
    back = {(x["researcher_id"], t["id"]) for t in T.values() for x in t["inventors"]}
    print(f"  pairs fwd {len(fwd)}, back {len(back)}, fwd-back {len(fwd - back)}, back-fwd {len(back - fwd)}")
    show("patent status", Counter(t["status"] for t in T.values()))

    print("\n## company -> pages / challenges")
    pc = Counter(p["company_id"] for p in d["company_pages"])
    print(f"  page company_ids not in companies: {[k for k in pc if k not in C]}")
    print(f"  companies with no pages: {[c for c in C if c not in pc]}")
    print(f"  pages per company: {sorted(Counter(pc.values()).items())}")
    show("page kinds", Counter(p["kind"] for p in d["company_pages"]))
    print(f"  challenges per company: {sorted(Counter(len(c['challenges']) for c in C.values()).items())}")
    show("page dates (year)", Counter(p["date"][:4] for p in d["company_pages"]))

    print("\n## project partners vs companies")
    cname = {c["name"].lower(): c["id"] for c in C.values()}
    core = {re.sub(r"\s+(d\.o\.o\.|a\.d\.|doo|ltd\.?)$", "", c["name"].lower()).strip(): c["id"] for c in C.values()}
    partner_all = Counter(p for j in J.values() for p in j["partners"])
    hits = Counter()
    for p, n in partner_all.items():
        pl = p.lower()
        for k, cid in core.items():
            if k and k in pl:
                hits[(cid, p)] += n
    print(f"  distinct partner strings {len(partner_all)}; partner strings mentioning a dataset company: {len(hits)}")
    for (cid, p), n in hits.most_common(15):
        print(f"    {cid} {n:>3}  {p}")
    show("most common partners", partner_all, 20)

    print("\n## company text mentioning researchers / faculties")
    rnames = {r["name"]: r["id"] for r in R.values()}
    ment = Counter()
    for c in C.values():
        blob = c["past_collaborations"] + " " + c["about"]
        for n, rid in rnames.items():
            if n in blob:
                ment[(c["id"], rid, n)] += 1
    for p in d["company_pages"]:
        for n, rid in rnames.items():
            if n in p["text"]:
                ment[(p["company_id"], rid, n)] += 1
    print(f"  (company, researcher-name) co-mentions: {len(ment)} {list(ment)[:8]}")
    show("past_collaborations samples", Counter(c["past_collaborations"][:140] for c in C.values()), 6)

    print("\n## distributions")
    show("researcher faculty", Counter(r["faculty"] for r in R.values()))
    show("researcher institution", Counter(r["institution"] for r in R.values()))
    show("researcher title", Counter(r["title"] for r in R.values()))
    show("researcher language", Counter(r["language"] for r in R.values()))
    show("company language", Counter(c["language"] for c in C.values()))
    show("company sector", Counter(c["sector"] for c in C.values()), 60)
    show("company location", Counter(c["location"] for c in C.values()))
    show("company size", Counter(("<10" if c["employees"] < 10 else "10-49" if c["employees"] < 50 else "50-249" if c["employees"] < 250 else "250+") for c in C.values()))
    show("publication type", Counter(p["type"] for p in P.values()))
    show("publication year", Counter(p["year"] for p in P.values()), 60)
    fields = Counter(f for r in R.values() for f in r["fields"])
    print(f"\n  distinct researcher fields: {len(fields)}; distinct keywords: {len(Counter(k for r in R.values() for k in r['keywords']))}")
    by_fac = defaultdict(int)
    for p in P.values():
        fac = {R[a['researcher_id']]['faculty'] for a in p['authors'] if a.get('researcher_id') in R}
        for f in fac:
            by_fac[f] += len(p.get('abstract') or '') // 4
    show("abstract tokens by faculty (approx)", Counter(by_fac))


if __name__ == "__main__":
    main()
