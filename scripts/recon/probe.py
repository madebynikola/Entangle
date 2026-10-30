"""Targeted follow-ups to quality.py: name traps, staleness, personal notes,
non-research challenges, contact data. Read-only; prints a report.

Usage: python3 scripts/recon/probe.py [data_dir]
"""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from quality import fold  # noqa: E402
from schema import load  # noqa: E402


def ctx(s, m, w=110):
    return s[max(0, m.start() - w):m.end() + w].replace("\n", " ")


def main():
    d = load()
    R = {r["id"]: r for r in d["researchers"]}
    P = {p["id"]: p for p in d["publications"]}
    C = {c["id"]: c for c in d["companies"]}

    print("## duplicate-profile pairs")
    for a, b in [("R0139", "R0539"), ("R0556", "R0976"), ("R0614", "R0637"), ("R0894", "R0929")]:
        for x in (a, b):
            r = R[x]
            print(f"  {x} {r['name']!r} | {r['title']} | {r['faculty']} | {r['department']} | lang {r['language']} | pubs {len(r['publications'])} prj {len(r['projects'])} | bio {len(r['bio'])} notes {r['notes'][:90]!r}")
        print()

    print("## same-name different people")
    for a, b in [("R0128", "R0881"), ("R0191", "R0435")]:
        for x in (a, b):
            r = R[x]
            print(f"  {x} {r['name']} | {r['title']} | {r['faculty']} | {r['department']} | {r['fields'][:2]}")
        print()

    print("## unlinked same-name authors: affiliation vs the profile")
    rows = Counter()
    for p in P.values():
        for a in p["authors"]:
            if a.get("researcher_id"):
                continue
            hits = [r for r in R.values() if fold(r["name"]) == fold(a["name"])]
            for r in hits:
                same_fac = fold(r["faculty"])[:20] in fold(a["affiliation"]) or any(w in fold(a["affiliation"]) for w in fold(r["faculty"]).split()[-2:] if len(w) > 5)
                rows[(r["id"], r["name"], r["faculty"], same_fac)] += 1
    same = sum(v for k, v in rows.items() if k[3])
    print(f"  author slots where an unlinked same-name author's affiliation names the profile's faculty: {same}; elsewhere: {sum(rows.values()) - same}")
    for k, v in rows.most_common(8):
        print(f"    {v:>3} {k}")
    # one worked example: is the unlinked 'Ana Kovačević' at FTN the same topic as R0771?
    r = R["R0771"]
    print(f"  R0771 {r['name']} {r['faculty']} / {r['department']} kw {r['keywords'][:5]}")
    ex = [p for p in P.values() for a in p["authors"] if a["name"] == "Ana Kovačević" and not a["researcher_id"]][:4]
    for p in ex:
        print(f"    {p['id']} {p['title'][:90]} | linked: {[(a['name'], a['researcher_id']) for a in p['authors'] if a['researcher_id']]}")

    print("\n## company text that names a researcher")
    for c in C.values():
        texts = [("about", c["about"]), ("past_collaborations", c["past_collaborations"])] + \
                [(f"page:{p['kind']}", p["text"]) for p in d["company_pages"] if p["company_id"] == c["id"]]
        for r in R.values():
            for where, t in texts:
                m = re.search(re.escape(r["name"]), t)
                if m:
                    print(f"  {c['id']} {c['name']} [{where}] {r['id']} {r['name']} ({r['faculty']}): ...{ctx(t, m, 90)}...")

    print("\n## status signals (stale, away, retired)")
    pat = re.compile(
        r"retired|retiring|emerit|left the university|has left|no longer (at|with|affiliated|active|employed)|moved to|"
        r"passed away|deceased|now (a|an|at|works|working)\b|maternity|parental leave|sick leave|medical leave|health|"
        r"penzi|пензи|porodilj|породиљ|bolovanj|боловањ|napustio|napustila|напустио|напустила|preminu|премину|"
        r"više nije|више није|prešao|prešla|прешао|прешла", re.I)
    by = defaultdict(list)
    for r in R.values():
        for f in ("title", "notes", "bio", "industry_experience"):
            for m in pat.finditer(r.get(f) or ""):
                by[r["id"]].append((f, m.group().lower(), ctx(r[f], m, 80)))
    kinds = Counter()
    for rid, hs in by.items():
        for f, k, _ in hs:
            kinds[k] += 1
    print(f"  {len(by)} researchers; terms {kinds.most_common()}")
    for rid, hs in by.items():
        r = R[rid]
        f, k, c = hs[0]
        print(f"  {rid} {r['name']} [{r['title']}] {f}: ...{c}...")

    print("\n## open_to signals")
    ot = Counter()
    for r in R.values():
        s = " ".join(r["open_to"]).lower()
        for k, rx in {"industrial phd / co-supervision": r"ph\.?d|doctora|doktor|co-supervis|supervis",
                      "consulting": r"consult|konsult|консулт", "contract research": r"contract", "joint project": r"joint|project",
                      "internships / theses": r"intern|thesis|master|praks", "not open / none": r"^$|not open|not available|none"}.items():
            if re.search(rx, s):
                ot[k] += 1
    print(f"  {ot.most_common()}")
    print(f"  empty open_to: {[(r['id'], r['name'], r['title']) for r in R.values() if not r['open_to']]}")

    print("\n## challenges that may not be research problems (keyword heuristic)")
    rx = re.compile(r"\b(hire|hiring|recruit|staff|marketing|sales|salesforce|crm|accounting|payroll|office|lease|loan|bank|"
                    r"investor|funding round|website|seo|social media|translation|legal|licen[cs]e|permit|tender|"
                    r"zaposl|prodaj|marketin|knjigovod)\w*", re.I)
    n = 0
    for c in C.values():
        for ch in c["challenges"]:
            m = rx.search(ch["text"])
            if m:
                n += 1
                print(f"  {ch['id']} ({c['sector'][:30]}): {ch['text'][:200]}")
    print(f"  {n} flagged of {sum(len(c['challenges']) for c in C.values())}")

    print("\n## contact data in company pages / publications")
    email = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
    doms = Counter()
    local = Counter()
    for p in d["company_pages"]:
        for e in email.findall(p["text"]):
            lp, dom = e.rsplit("@", 1)
            doms[dom.rstrip(".").lower()] += 1
            local["named-person" if re.search(r"[a-z]+\.[a-z]+", lp) and not re.match(r"(jobs|careers|info|hr|posao|karijera|contact|kontakt|hello|office|press|events|sales|support)", lp) else lp.lower()] += 1
    print(f"  page email domains (top): {doms.most_common(8)}; distinct {len(doms)}")
    print(f"  page email local parts: {local.most_common(15)}")
    for p in P.values():
        for s in [p.get("abstract") or ""] + [a["affiliation"] for a in p["authors"]]:
            for e in email.findall(s):
                print(f"  publication {p['id']}: {e}")
    print(f"  page kinds with emails: {Counter(p['kind'] for p in d['company_pages'] if email.search(p['text']))}")
    job = next(p for p in d["company_pages"] if p["kind"] == "job")
    print(f"  sample job ad {job['company_id']}: {job['title']} | {job['text'][:500]!r}")
    for c in C.values():
        m = re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f​­﻿]", c["about"])
        if m:
            print(f"  control char in {c['id']}.about: {m.group()!r} at {m.start()}: {c['about'][max(0, m.start() - 40):m.start() + 40]!r}")


if __name__ == "__main__":
    main()
