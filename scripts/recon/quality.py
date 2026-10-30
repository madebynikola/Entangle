"""Data-quality checks: duplicates, missing text, scripts and encodings, stale
profiles, personal data. Read-only; prints a report.

Usage: python3 scripts/recon/quality.py [data_dir]
"""
import csv
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from schema import DATA, load  # noqa: E402

CYR = dict(zip(
    "абвгдђежзијклљмнњопрстћуфхцчџшАБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ",
    ["a", "b", "v", "g", "d", "đ", "e", "ž", "z", "i", "j", "k", "l", "lj", "m", "n", "nj", "o", "p", "r", "s", "t",
     "ć", "u", "f", "h", "c", "č", "dž", "š",
     "A", "B", "V", "G", "D", "Đ", "E", "Ž", "Z", "I", "J", "K", "L", "Lj", "M", "N", "Nj", "O", "P", "R", "S", "T",
     "Ć", "U", "F", "H", "C", "Č", "Dž", "Š"]))


def fold(s):
    """Cyrillic -> Latin, strip diacritics, lowercase, đ -> dj."""
    s = "".join(CYR.get(ch, ch) for ch in s)
    s = s.replace("đ", "dj").replace("Đ", "Dj")
    s = unicodedata.normalize("NFKD", s)
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip().lower()


def has_cyr(s):
    return bool(re.search(r"[Ѐ-ӿ]", s or ""))


MOJIBAKE = re.compile(r"Ã.|Ä[\u0080-¿‡Ť]|Å[\u0080-¿¡¾]|â€|Â[ -¿]|�")


def strings(v, path=""):
    if isinstance(v, str):
        yield path, v
    elif isinstance(v, list):
        for x in v:
            yield from strings(x, path + "[]")
    elif isinstance(v, dict):
        for k, x in v.items():
            yield from strings(x, f"{path}.{k}" if path else k)


def main():
    d = load()
    R = d["researchers"]
    P = d["publications"]
    C = d["companies"]
    rid = {r["id"]: r for r in R}

    print("## same name, different researcher ids (exact)")
    by = defaultdict(list)
    for r in R:
        by[r["name"]].append(r)
    exact = {n: rs for n, rs in by.items() if len(rs) > 1}
    print(f"  {len(exact)} names")
    for n, rs in exact.items():
        print(f"  {n}: " + " | ".join(f"{r['id']} {r['faculty']} / {r['fields'][:1]}" for r in rs))

    print("\n## same folded name (diacritics / script variants), different ids")
    byf = defaultdict(list)
    for r in R:
        byf[fold(r["name"])].append(r)
    for n, rs in byf.items():
        names = {r["name"] for r in rs}
        if len(rs) > 1 and len(names) > 1:
            print(f"  {n}:")
            for r in rs:
                kw = set(map(str.lower, r["keywords"]))
                print(f"    {r['id']} {r['name']!r} {r['title']} | {r['faculty']} | {r['department']} | pubs {len(r['publications'])} | lang {r['language']}")
            a, b = rs[0], rs[1]
            ov = set(map(str.lower, a["keywords"])) & set(map(str.lower, b["keywords"]))
            sp = set(a["publications"]) & set(b["publications"])
            print(f"    keyword overlap {len(ov)}; shared pubs {len(sp)}")

    print("\n## same folded surname + same department, given name differs by 1-2 chars (possible duplicates)")
    import difflib
    bydep = defaultdict(list)
    for r in R:
        parts = fold(r["name"]).split()
        bydep[(fold(r["department"]), parts[-1] if parts else "")].append(r)
    for k, rs in bydep.items():
        for i in range(len(rs)):
            for j in range(i + 1, len(rs)):
                a, b = fold(rs[i]["name"]), fold(rs[j]["name"])
                if a != b and difflib.SequenceMatcher(None, a, b).ratio() > 0.8:
                    print(f"  {rs[i]['id']} {rs[i]['name']} ~ {rs[j]['id']} {rs[j]['name']} ({rs[i]['department']})")

    print("\n## near-duplicate researcher profiles (keyword Jaccard >= 0.5, different id)")
    kws = [(r["id"], set(map(str.lower, r["keywords"]))) for r in R]
    seen = 0
    for i in range(len(kws)):
        for j in range(i + 1, len(kws)):
            a, b = kws[i][1], kws[j][1]
            if a and b and len(a & b) / len(a | b) >= 0.5:
                ra, rb = rid[kws[i][0]], rid[kws[j][0]]
                print(f"  {ra['id']} {ra['name']} ({ra['faculty']}) ~ {rb['id']} {rb['name']} ({rb['faculty']}): J={len(a & b) / len(a | b):.2f}")
                seen += 1
    print(f"  {seen} pairs")

    print("\n## linked-author records whose name differs from the profile? (checked in joins.py: 0)")
    print("## unlinked authors whose folded name equals a researcher's folded name")
    fname = defaultdict(list)
    for r in R:
        fname[fold(r["name"])].append(r["id"])
    unl = Counter()
    for p in P:
        linked = {a["researcher_id"] for a in p["authors"] if a.get("researcher_id")}
        for a in p["authors"]:
            if not a.get("researcher_id") and fold(a["name"]) in fname:
                unl[(a["name"], tuple(fname[fold(a["name"])]), a["affiliation"][:60], bool(linked & set(fname[fold(a['name'])])))] += 1
    print(f"  {sum(unl.values())} author slots, {len(unl)} distinct")
    for k, v in unl.most_common(25):
        print(f"    {v:>3} {k}")

    print("\n## researcher.publications entries whose author record has no researcher_id")
    pubs = {p["id"]: p for p in P}
    for r in R:
        for pid in r["publications"]:
            p = pubs[pid]
            if not any(a.get("researcher_id") == r["id"] for a in p["authors"]):
                print(f"  {r['id']} {r['name']!r} -> {pid}: authors {[ (a['name'], a['researcher_id']) for a in p['authors']]}")

    print("\n## duplicate publications")
    t = defaultdict(list)
    ab = defaultdict(list)
    for p in P:
        t[fold(p["title"])].append(p["id"])
        if p.get("abstract"):
            ab[fold(p["abstract"])[:300]].append(p["id"])
    dt = {k: v for k, v in t.items() if len(v) > 1}
    da = {k: v for k, v in ab.items() if len(v) > 1}
    print(f"  same folded title: {len(dt)} groups, {sum(len(v) for v in dt.values())} records")
    for k, v in list(dt.items())[:10]:
        print(f"    {v} {k[:90]}")
    print(f"  same abstract start (300 ch): {len(da)} groups, {sum(len(v) for v in da.values())} records")
    for k, v in list(da.items())[:8]:
        print(f"    {v} {k[:90]}")

    print("\n## duplicate companies / challenges")
    cn = Counter(fold(re.sub(r"\b(d\.o\.o\.|doo|a\.d\.)", "", c["name"])) for c in C)
    print(f"  same folded company name: {[k for k, v in cn.items() if v > 1]}")
    ct = defaultdict(list)
    for c in C:
        for ch in c["challenges"]:
            ct[fold(ch["text"])[:120]].append(ch["id"])
    print(f"  same challenge text: {[v for v in ct.values() if len(v) > 1][:10]}")
    pt = defaultdict(list)
    for p in d["company_pages"]:
        pt[fold(p["text"])[:300]].append((p["company_id"], p["kind"]))
    print(f"  same page text: {[v for v in pt.values() if len(v) > 1][:10]}")

    print("\n## missing / thin")
    print(f"  researchers no bio: {sum(1 for r in R if not r['bio'])}")
    print(f"  researchers no bio AND no notes AND no industry_experience: {sum(1 for r in R if not r['bio'] and not r['notes'] and not r['industry_experience'])}")
    kwonly = [r["id"] for r in R if not r["bio"] and not r["open_to"] and not r["notes"]]
    print(f"  keywords-only-ish (no bio, open_to, notes): {len(kwonly)} {kwonly[:10]}")
    print(f"  researchers 0 publications: {[(r['id'], r['name'], r['title']) for r in R if not r['publications']]}")
    print(f"  researchers no fields: {[(r['id'], r['name']) for r in R if not r['fields']]}")
    print(f"  publications no abstract: {sum(1 for p in P if not p.get('abstract'))}, no keywords: {sum(1 for p in P if not p.get('keywords'))}, neither: {sum(1 for p in P if not p.get('abstract') and not p.get('keywords'))}")
    short = [p for p in P if p.get("abstract") and len(p["abstract"]) < 200]
    print(f"  publications abstract < 200 ch: {len(short)} e.g. {[(p['id'], p['abstract'][:80]) for p in short[:3]]}")
    print(f"  patents no abstract: {[t['id'] for t in d['patents'] if not t['abstract']]}")
    print(f"  companies past_collaborations 'None.'-like: {sum(1 for c in C if c['past_collaborations'].strip().lower() in ('none.', 'none', 'nema.', 'nema'))}")

    print("\n## stale / moved / retired signals")
    pat = re.compile(r"retir|emerit|left the university|no longer|moved to|has left|passed away|deceased|penzi|пензи|napustio|napustila|напусти|on leave|sabbatical|maternity|parental leave|inactive|not active|stale|outdated|former(ly)? ", re.I)
    hits = []
    for r in R:
        for f in ("notes", "bio", "industry_experience", "title"):
            m = pat.search(r.get(f) or "")
            if m:
                s = r[f]
                i = m.start()
                hits.append((r["id"], r["name"], r["title"], f, s[max(0, i - 80):i + 100].replace("\n", " ")))
    print(f"  {len(hits)} hits in {len({h[0] for h in hits})} researchers")
    for h in hits[:45]:
        print(f"    {h}")
    print(f"  titles that say emeritus: {sum(1 for r in R if 'emerit' in r['title'].lower())}")
    last = {}
    for r in R:
        yrs = [pubs[p]["year"] for p in r["publications"]]
        last[r["id"]] = max(yrs) if yrs else None
    old = [(k, rid[k]["name"], rid[k]["title"], v) for k, v in last.items() if v and v < 2018]
    print(f"  researchers whose latest publication is before 2018: {len(old)} {old[:12]}")

    print("\n## scripts and encodings")
    cyr_fields = Counter()
    lat_sr = Counter()
    moj = []
    nonnfc = Counter()
    ctrl = Counter()
    ent = Counter()
    for name, recs in d.items():
        for r in recs:
            for path, s in strings(r):
                key = f"{name}.{path}"
                if has_cyr(s):
                    cyr_fields[key] += 1
                if MOJIBAKE.search(s):
                    moj.append((key, r.get("id") or r.get("company_id"), MOJIBAKE.search(s).group(), s[:80]))
                if unicodedata.normalize("NFC", s) != s:
                    nonnfc[key] += 1
                if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f​­﻿]", s):
                    ctrl[key] += 1
                if re.search(r"&(amp|lt|gt|quot|#\d+);|<[a-z/][^>]*>", s):
                    ent[key] += 1
    print(f"  fields with Cyrillic text (records): {cyr_fields.most_common(30)}")
    print(f"  mojibake hits: {len(moj)} {moj[:10]}")
    print(f"  non-NFC strings: {nonnfc.most_common(10)}")
    print(f"  control / zero-width / BOM chars: {ctrl.most_common(10)}")
    print(f"  HTML entities / tags: {ent.most_common(10)}")
    sr_words = re.compile(r"\b(je|su|i|u|za|na|sa|od|koji|koja|kao|smo|nam|nije|da)\b")
    srlat = [p["id"] for p in P if p.get("abstract") and len(sr_words.findall(p["abstract"])) > 8]
    srcyr = [p["id"] for p in P if has_cyr(p.get("abstract"))]
    print(f"  publications with Serbian-Latin abstract (heuristic): {len(srlat)}; Cyrillic abstract: {len(srcyr)}")
    print(f"  researchers language sr/sr-Cyrl but bio English? sample: {[(r['id'], r['language'], (r['bio'] or '')[:60]) for r in R if r['language'] != 'en'][:6]}")
    print(f"  companies language sr: {[(c['id'], c['name']) for c in C if c['language'] != 'en']}")
    srpages = [p for p in d["company_pages"] if len(sr_words.findall(p["text"])) > 15 or has_cyr(p["text"])]
    print(f"  company pages in Serbian (heuristic): {len(srpages)}")
    for f in ("researchers.csv", "companies.csv"):
        bom = open(DATA / f, "rb").read(3) == b"\xef\xbb\xbf"
        rows = list(csv.DictReader(open(DATA / f, encoding="utf-8-sig", newline="")))
        print(f"  {f}: BOM={bom}, {len(rows)} rows, cols {list(rows[0])}")

    print("\n## personal data in free text")
    email = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
    phone = re.compile(r"(\+381|\b0\d{1,2})[\s/-]?\d{2,3}[\s/-]?\d{3,4}\b")
    pers = re.compile(r"\b(divorc|married|husband|wife|children|daughter|son\b|pregnan|maternity|illness|sick|health (issue|problem|reason)|diagnos|religio|ethnic|political|party member|salary|born in \d{4}|age \d\d|\d\d years old|disab|burnout|conflict with|dispute|lawsuit|grudge|unreliable|difficult to work)", re.I)
    for name, recs in d.items():
        e = p_ = 0
        ph = Counter()
        for r in recs:
            for path, s in strings(r):
                if email.search(s):
                    e += 1
                if phone.search(s):
                    p_ += 1
                for m in pers.finditer(s):
                    ph[(path, m.group().lower())] += 1
        print(f"  {name}: emails {e}, phone-like {p_}; personal terms {ph.most_common(20)}")
    for r in R:
        m = pers.search(r.get("notes") or "")
        if m:
            i = m.start()
            print(f"    notes {r['id']}: ...{r['notes'][max(0, i - 100):i + 120]}...")


if __name__ == "__main__":
    main()
