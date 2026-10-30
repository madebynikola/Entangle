# EINSTEIN dataset: recon

What is in `data/raw/`, how it joins, how big it is, where it is dirty, and what that means for the agents.
Source: `jigjoy-ai/einstein-matchmaker-data` at `4fb99b3`, dataset version 2.0. Every number below comes from
the scripts in `scripts/recon/` (see [Reproduce](#reproduce)). Tokens are `chars / 4`.

## At a glance

| File (`data/raw/data/`) | Format | Records | Size | ~Tokens |
| --- | --- | ---: | ---: | ---: |
| `researchers.json` | JSON, `{name, version, note, researchers: [...]}` | 1,047 | 3.3 MB | 745k |
| `publications.jsonl` | JSON Lines, one publication per line | 10,779 | 19.6 MB | 4.85M |
| `projects.json` | JSON, `{..., projects: [...]}` | 1,823 | 2.6 MB | 592k |
| `patents.json` | JSON, `{..., patents: [...]}` | 111 | 0.1 MB | 26k |
| `companies.json` | JSON, `{..., companies: [...]}`; 489 challenges nested | 153 | 1.2 MB | 293k |
| `company-pages.jsonl` | JSON Lines, one page per line | 917 | 1.7 MB | 419k |
| `researchers.csv`, `companies.csv` | CSV, UTF-8 **with BOM**, lists joined by `; ` | 1,047 / 153 | 2.7 / 0.6 MB | (copies) |
| **Total (JSON only)** | | | 28.4 MB | **~6.9M** |

The CSVs are flat copies of the two JSON profile files (same rows, same columns). The pipeline does not need them.
Publications are 70% of all tokens. The company side (profiles + pages) is only 10%.

## Files

Coverage is "non-empty / total". All fields are present on every record; "empty" means `""`, `[]` or `null`.

### researchers.json — 1,047 researcher profiles

| Field | Type | Non-empty | Notes |
| --- | --- | --- | --- |
| `id` | str | all | `R0001`…`R1047` |
| `name`, `title`, `institution`, `faculty`, `department` | str | all | English, Serbian Latin or Serbian Cyrillic (see [labels](#label-variants)) |
| `fields` | str[] | 1,046 | 2,793 distinct values |
| `keywords` | str[] | all | 8,678 distinct values |
| `bio` | str | 987 | avg 863 chars, max 1,128 |
| `publications` | id[] | 1,045 | 0–23 per person, median 14 |
| `projects` | id[] | 1,024 | |
| `patents` | id[] | 111 | at most 1 each |
| `open_to` | str[] | 1,042 | what they will do with industry: joint projects, contract research, consulting, theses; about half mention supervision or doctoral students |
| `industry_experience` | str | 995 | |
| `notes` | str | 1,010 | availability, teaching load, preferences; written like private remarks |
| `language` | str | all | `en` 965, `sr` 58, `sr-Cyrl` 24 |

```json
{"id": "R0001", "name": "Natalija Fejsa", "title": "Assistant Professor", "institution": "University of Novi Sad",
 "faculty": "Faculty of Sciences", "department": "Department of Mathematics and Informatics",
 "fields": ["Formal Methods and Program Verification", "…"], "keywords": ["proof assistants", "certified compilation", "…"],
 "bio": "Natalija Fejsa received her B.Sc. and M.Sc. degrees…", "publications": ["SYN-PUB-00001", "…"],
 "projects": ["SYN-PRJ-1043", "…"], "patents": [], "open_to": ["joint projects with companies requiring formal correctness guarantees…", "…"],
 "industry_experience": "…short consulting engagement in 2022 with a regional automotive software supplier…",
 "notes": "…interested in collaborating with NTP companies working on safety-critical…", "language": "en"}
```

### publications.jsonl — 10,779 publications

| Field | Type | Non-empty | Notes |
| --- | --- | --- | --- |
| `id` | str | all | `SYN-PUB-00001`… |
| `title` | str | all | |
| `abstract` | str | 10,139 | avg 970 chars, max 1,606; **640 have none** (all of those have keywords) |
| `year` | int | all | 1995–2026; 709 from 2026 |
| `venue` | str | all | |
| `type` | str | all | journal 8,127 · conference 1,835 · book chapter 607 · preprint 210 |
| `keywords` | str[] | 10,704 | |
| `authors` | obj[] | all | `{name, researcher_id, affiliation}`; `researcher_id` is null for outside co-authors (24,142 of 38,442 author slots) |

Every publication has 1–3 linked (in-dataset) authors: 1 for 8,166, 2 for 1,705, 3 for 908.

```json
{"id": "SYN-PUB-00001", "title": "A Coq Formalization of a Simple Register-Allocation Pass for a Subset of C",
 "abstract": "Register allocation is a well-known compiler phase…", "year": 2013,
 "venue": "Proceedings of the Workshop on Certified Programs and Proofs (CPP 2013)", "type": "conference",
 "keywords": ["register allocation", "Coq", "…"],
 "authors": [{"name": "Natalija Fejsa", "researcher_id": "R0001", "affiliation": "Faculty of Sciences, University of Novi Sad"},
             {"name": "Boštjan Krajnc", "researcher_id": null, "affiliation": "University of Ljubljana, Slovenia"}, "…"]}
```

### projects.json — 1,823 projects

| Field | Type | Non-empty | Notes |
| --- | --- | --- | --- |
| `id` | str | all | `SYN-PRJ-0001`… |
| `acronym` | str | 1,804 | |
| `title` | str | all | |
| `programme` | str | all | 22 spellings, see [labels](#label-variants) |
| `years` | str | all | `"2021–2024"` with an en dash; 2018–2026 |
| `summary` | str | all | avg 754 chars, max 1,230 |
| `partners` | str[] | 1,805 | free text, 3,070 distinct strings; mostly faculties and institutes |
| `participants` | obj[] | all | `{researcher_id, role}`, 1–3 per project; roles: team member, principal investigator, work package leader, coordinator (+ 3 rare variants) |

```json
{"id": "SYN-PRJ-0022", "acronym": "TESTMIG", "title": "Automated Testing Strategies for Legacy-to-Cloud Migration Pipelines",
 "programme": "Science Fund of the Republic of Serbia (PROMIS, IDEAS, Prizma)", "years": "2021–2024",
 "summary": "TESTMIG investigates how automated test generation and fuzzing techniques must be adapted…",
 "partners": ["Faculty of Technical Sciences, University of Novi Sad", "Faculty of Electronic Engineering, University of Niš", "…"],
 "participants": [{"researcher_id": "R0983", "role": "principal investigator"}, {"researcher_id": "R0375", "role": "team member"}, "…"]}
```

### patents.json — 111 patents

Fields: `id` (`SYN-PAT-001`…), `title`, `year`, `status` (granted 77 · pending 32 · expired 2),
`abstract` (empty for SYN-PAT-001…004), `inventors` (`{researcher_id, name}`, always exactly one).

```json
{"id": "SYN-PAT-005", "title": "Method and System for Calibration-Free Camera Height Estimation in Indoor Environments…",
 "year": 2022, "status": "granted", "abstract": "The invention describes a computational method for estimating…",
 "inventors": [{"researcher_id": "R0033", "name": "Žarko Gavrilović"}]}
```

### companies.json — 153 companies, 489 challenges

| Field | Type | Notes |
| --- | --- | --- |
| `id` | str | `C001`…`C153` |
| `name`, `sector`, `location` | str | 64 sector strings (free text); locations: Novi Sad 74, Subotica 30, Zrenjanin 27, NTP Novi Sad 18, other 4 |
| `employees`, `founded` | int | <10: 24 · 10–49: 70 · 50–249: 56 · 250+: 3 |
| `about` | str | avg 1,317 chars; written in the first person |
| `products`, `tech` | str[] | |
| `challenges` | obj[] | 1–4 per company: `{id, text, detail}`. `id` is `<company id>-CH<n>`. `text` is one line (avg 262 chars), `detail` is a paragraph (avg 1,151, max 1,593) |
| `plans`, `rd_capacity`, `past_collaborations` | str | `past_collaborations` is free text; 10 say "None." |
| `language` | str | `en` 127, `sr` 26 (whole profile in Serbian Latin) |

```json
{"id": "C001", "name": "ArmaturaSec d.o.o.", "sector": "Cybersecurity", "employees": 67, "founded": 2008, "location": "Zrenjanin",
 "about": "ArmaturaSec d.o.o. has been building network security hardware in Zrenjanin since 2008…",
 "products": ["NetGuard-OT: network access control appliance for industrial Ethernet segments", "…"],
 "tech": ["Embedded Linux (custom Yocto build)", "…"],
 "challenges": [{"id": "C001-CH1",
   "text": "We need to detect unusual behaviour on Modbus and BACnet networks without labelled attack data…",
   "detail": "Our ProtoSense module watches Modbus and BACnet traffic and is supposed to flag anything that looks wrong…"}, "…"],
 "plans": "…", "rd_capacity": "…", "past_collaborations": "We ran a one-semester student project with a technical faculty in Novi Sad in 2021…",
 "language": "en"}
```

### company-pages.jsonl — 917 pages

Fields: `company_id`, `kind` (job 301 · news 181 · website 153 · blog 147 · event 135), `title`, `date` (2023–2024),
`text` (avg 1,670 chars, max 2,486). Six pages per company, except C077 with five. About 156 pages are in Serbian.
Job ads are useful to the Industry Analyst: they show the tech stack and the skills a company cannot find.

```json
{"company_id": "C001", "kind": "job", "title": "Firmware Engineer — Network Protocols (Zrenjanin)", "date": "2024-02-05",
 "text": "ArmaturaSec is looking for a firmware engineer to join our core development team in Zrenjanin…"}
```

## IDs and join keys

```
researcher R0001 ──< publications[] >── publication SYN-PUB-00001 .authors[].researcher_id
            │     ──< projects[]     >── project     SYN-PRJ-0001 .participants[].researcher_id (+ role)
            │     ──< patents[]      >── patent      SYN-PAT-001  .inventors[].researcher_id
            │
            ✕  no key between researchers and companies
            │
company C001 ──< challenges[] (C001-CH1 … C001-CH4, nested)
             ──< company pages (company_id = C001): website, job, news, blog, event
```

- **All ids are unique, and every referenced id exists.** No dangling links anywhere.
- **Researcher ↔ project and researcher ↔ patent are symmetric**: the list on the profile equals the back-references (2,876 and 111 pairs).
- **Researcher ↔ publication is almost symmetric.** `researcher.publications` has 14,310 pairs. `authors[].researcher_id` has 14,300.
  The 10 extra pairs all belong to the four duplicate profiles below: the author record carries the other profile's id.
  Use `authors[].researcher_id` as the truth.
- **Join on ids only, never on names.** The author `name` on a linked author always equals the profile name,
  but name matching in any other direction picks up the wrong people (see [Name traps](#name-traps)).
- **There is no researcher ↔ company key.** That is the matching problem. Project `partners` are free text; only five strings
  name a dataset company, and two of those are a different organisation with the same name
  (`Agricultural Cooperative Zlatna Njiva`, Subotica/Sombor, is not C061 `Zlatna Njiva d.o.o.`, Zrenjanin).
  The only plausible existing ties: C139 Farmavita on SYN-PRJ-0921 and SYN-PRJ-1356, and C125 AquaVoj on SYN-PRJ-0860.
  C125's own `past_collaborations` does not mention that project, so verify before claiming it.
  `past_collaborations` names faculties, not people.
- **Co-authorship:** 3,269 researcher pairs share a publication. None of them crosses faculties.
  A cross-faculty team is a new proposal; never claim they have worked together.
- Cite with the dataset's own ids: `R0001`, `C001`, `C001-CH1`, `SYN-PUB-00001`, `SYN-PRJ-0001`, `SYN-PAT-001`.
  Company pages have no id; cite them as `company_id` + `kind` + `date` + `title`.

## Token budget

| Entity | Records | ~Tokens | Per record | Long text fields (avg / max chars) |
| --- | ---: | ---: | ---: | --- |
| Researchers | 1,047 | 745k | ~710 | `bio` 863 / 1,128 · `notes` 355 / 702 · `open_to` 336 / 652 · `industry_experience` 280 / 457 |
| Publications | 10,779 | 4.85M | ~450 | `abstract` 970 / 1,606 (2.6M tok in total) · `authors[].affiliation` adds 519k tok of repeated strings |
| Projects | 1,823 | 592k | ~325 | `summary` 754 / 1,230 |
| Patents | 111 | 26k | ~230 | `abstract` 646 / 886 |
| Companies | 153 | 293k | ~1,900 | `about` 1,317 / 1,621 · `challenges[].detail` 1,151 / 1,593 · `challenges[].text` 262 / 410 |
| Company pages | 917 | 419k | ~460 | `text` 1,670 / 2,486 |

Work units:

| Unit | Median | Max | All of them |
| --- | ---: | ---: | ---: |
| Researcher bundle: profile + own publications, projects, patents | 8.1k | 12.8k | 8.3M (co-authored papers counted per author) |
| Compact researcher card: profile without `bio`/`notes`, plus titles of own publications, projects, patents | 824 | 1,246 | 831k |
| Company bundle: profile + its pages | 4.7k | 5.6k | 711k |
| All 489 challenges (`text` + `detail`) | | | 178k |

So any single researcher or company fits easily in one call. All challenges fit in one large-context call.
The researcher side as a whole (~6.2M) does not fit anywhere, so that is where the fan-out is needed.

## Data quality

The dataset README promises messy records. These are the traps we found, with ids.

### Name traps

| Trap | Cases | What to do |
| --- | --- | --- |
| **One person, two profiles** | R0139 `Jeremić Mirjana` = R0539 `Mirjana Jeremić` (surname first) · R0556 `Јелена Марковић` = R0976 `Jelena Marković` (Cyrillic; its `notes` say "Imported from a second source (Cyrillic).") · R0614 `D. Radulović` = R0637 `Dijana Radulović` (initial) · R0894 `Наталија Мирковић` = R0929 `Natalija Mirković` (Cyrillic) | Merge into the second id of each pair. The shadow profiles have no bio, no `open_to`, no projects, and 1–3 publications that the main profile also has. Keep the shadow id as an alias. |
| **Two people, one name** | `Nina Mamužić`: R0128 (Technology, food encapsulation) and R0881 (Agriculture, horticulture, emerita) · `Vladan Dobanovački`: R0191 (Medicine, radiology) and R0435 (BioSense, sensors) | Always carry the id. The Critic checks the id and name together. |
| **Outside co-author with a researcher's name** | 875 unlinked author slots (about 420 names) have the exact name of a profile. Their topics do not fit: the unlinked `Ana Kovačević` writes on antibody kinetics, ergonomics and GNNs; R0771 works on LoRaWAN. | Treat them as different people. Only `researcher_id` links count. |
| **Company people with a researcher's name** | 12 researcher names appear 17 times in 15 companies' `about` and pages, as staff, customers or partners: e.g. `Jelena Marković` is Director of C139 Farmavita and hardware lead at C041; `Marko Filipović` works at C014; `Bojana Stanković` (R0434's name) is technical director at C063; `Attila Varga` at C138; `Dragan Popović` at C139 | Never infer that a researcher works at, or knows, a company from a name. |

### Missing and thin records

- 60 researchers have no `bio`. 3 have only keywords (the shadow profiles R0139, R0614, R0894).
- R0015 (Teaching Assistant) and R0607 (PhD student) have no publications. R0607 also has no `fields` and no `open_to`.
- 640 publications have no abstract. 75 have no keywords. None lacks both.
- SYN-PAT-001…004 have no abstract (title only).
- 10 companies have no past collaborations (`"None."`).

### Stale or unavailable people

- **20 Professors Emeritus.** Several say they will consult but will not lead projects or supervise.
- **R0068 left UNS in March 2026** and is now a postdoc abroad. R0068 is still the only participant on SYN-PRJ-1822.
- **14 researchers have limited availability for family reasons** (parental or maternity leave, young children). See [Sensitive data](#personal-and-sensitive-data).
- Some `notes` are out of date themselves, e.g. R0292 is "on parental leave until September 2024". Company pages are dated 2023–2024; profiles mention 2026.
- No profile is stale by publications alone: everyone's latest paper is from 2018 or later.

### Challenges that are not research problems

The README says some challenges are not research problems, or have no match at the university, and that the right answer says so.
A keyword pass for finance, hiring, legal, licensing, certification and sales (`shard.py`) flags **116 of 489**.
Reading the flagged lines suggests about 60 clear cases. Examples: raise a Series A (C006-CH2, C040-CH2, C140-CH4),
hire engineers (C045-CH2, C069-CH3, C115-CH4), get a licence or permit (C004-CH4, C074-CH4, C090-CH3), GDPR contract templates (C113-CH2, C130-CH3),
sales coaching (C064-CH3). They cluster at the end of each list: 57 of 129 CH3 and 24 of 59 CH4 are flagged, against 13 of 153 CH1.
Some flagged lines are real research with a business frame (e.g. C011-CH1, a recommendation engine), so do not filter by regex.
Let the Industry Analyst triage each challenge.

The "no good match" case can only be found by matching. The Matchmaker needs an explicit "no match" outcome with a reason.

### Label variants

| Field | Variants | Canonical |
| --- | --- | --- |
| `faculty` | 37 spellings (English, Serbian Latin, Serbian Cyrillic) | 16 faculties and institutes. Fold Cyrillic to Latin, strip diacritics, then map, e.g. `fakultet tehnickih nauka` and `Факултет техничких наука` → Faculty of Technical Sciences. The map is in `scripts/recon/shard.py` (`FACULTY`). |
| `institution` | 4 | University of Novi Sad |
| `title` | 26 | `redovni profesor`/`редовни професор` → Full Professor · `vanredni profesor`/`ванредни професор` → Associate Professor · `docent`/`доцент` → Assistant Professor · `naučni saradnik`/`научни сарадник` → Research Associate · `viši naučni saradnik`/`виши научни сарадник` → Senior Research Associate · `naučni savetnik`/`научни саветник` → Principal Research Fellow · `istraživač saradnik` → Research Assistant · `asistent` → Teaching Assistant · `student doktorskih studija`/`студент докторских студија` → PhD student |
| `programme` | 22 | Strip ` (synthetic)`. Fix typos such as `Republic of the Republic of Serbia` and `Republic of the Serbia`. |
| `participants[].role` | 7 | `work package lead` → work package leader. `researcher` and `academic partner` occur 3 times each. |
| `sector` | 64 free-text strings | Do not group by exact string. About 20 recurring families plus one-offs. |

### Languages and encoding

- All files are valid UTF-8 and NFC. No mojibake, no HTML.
- Cyrillic appears in 26 fields. Most often: author names and affiliations, publication keywords, researcher keywords and `open_to`.
- Serbian text: 82 researcher profiles (58 Latin, 24 Cyrillic), 26 companies (Latin, with a few Cyrillic passages), about 156 company pages, and about 290 abstracts (about 250 Latin, 40 Cyrillic). Department names are in English on every profile except R0556 (Cyrillic).
- The CSVs start with a UTF-8 BOM: read them with `encoding="utf-8-sig"`.
- C069 `about` has one soft hyphen (U+00AD) inside a word (`seče­njem`). One page email has a non-ASCII local part (`tilić@routewise.rs`).
- `years` uses an en dash (`2021–2024`).

## Recommendation: splitting the work

The two sides have very different sizes, so shard them differently. Matching itself is per challenge.

1. **Deterministic pre-pass (data layer, no LLM).** Normalise the labels above. Merge the four duplicate profiles. Flag status (emeritus, left, leave until a date).
   Triage nothing here, but build the compact researcher cards (831k tok in all) and the search index. This makes every later step cheaper, and every claim citeable.
2. **Industry Analysts × 4–6, sharded by company** (e.g. 25–40 companies each by id range; about 4.7k tok per company, one call each).
   For each challenge, the output is: a triage label (research / engineering service / not research, with the reason);
   an English, academic restatement (this also translates the 26 Serbian companies); 5–10 search terms;
   what the company brings (data, lab, line, money); constraints. The company side is small, so this finishes early.
3. **Retrieval (deterministic).** Each research challenge gets about 10 candidate researchers from the index.
4. **Research Profilers × N, sharded by department, not by faculty.** Faculties are far too uneven:
   Technical Sciences has 393 researchers and 3.2M tok (38%); the smallest has 5 researchers and 36k tok.
   The 76 (faculty, department) pairs pack into 12 balanced bins of about 680k tok each.
   Computing and Control Engineering alone is one bin (100 researchers, 800k tok). A Profiler that stays inside a few departments reads their vocabulary consistently.
   **Profile lazily:** only researchers that retrieval shortlists, one per call (about 8k tok), cached by id.
   Profiling all 1,047 up front would read about 8.3M tokens, most of them for researchers no challenge needs.
5. **Matchmaker per challenge** (or per sector batch): the analyst card plus about 10 candidate cards and their evidence, about 10–20k tok.
   It returns a pair with its evidence, or "no good match" with the reason.
6. **Critic.** First a lookup: does every cited id exist, and does the name match the id? Then a model check: does the cited record say what the claim says?
   It rejects identity by name, links to same-name co-authors or company staff, and anyone emeritus, departed or on leave named as PI or supervisor.

## Recommendation: what to index

BM25 is a good base, and the right fallback when there are no API keys. Index more than abstracts, and do not query with raw challenge text.

- **Documents, all keyed to `researcher_id` through the links:**
  publication (title + abstract + keywords; this covers the 640 without an abstract),
  project (title + summary), patent (title + abstract), and one profile document per researcher (fields, keywords, bio, `open_to`, `industry_experience`).
  Leave out author affiliations: 519k tok of repeated strings.
- **Aggregate per researcher with max or top-3 mean, not sum.** Publication counts range from 0 to 23. A sum rewards the most prolific people, which is close to ranking people by output.
- **Analyzer:** transliterate Cyrillic to Latin, strip diacritics, lowercase, English stemming. Then `Марковић` and `Markovic` match, and the Serbian abstracts become partly searchable.
- **Queries come from the Industry Analyst**, not from the challenge text. Companies write in business language, and 26 of them in Serbian. The academic restatement and search terms bridge that gap. This is where a model earns its place in retrieval.
- **If an embeddings key is available**, add a multilingual embedding index over the same documents (about 14k documents, about 4M tok, embedded once). Fuse it with BM25 by reciprocal rank fusion. It closes the vocabulary and language gaps that BM25 cannot. Keep BM25-only as the keyless or replay path.
- **Also index the 489 challenges** (`text` + `detail`). Then the reverse search in the brief works: a researcher's `open_to` and keywords find companies.

## Personal and sensitive data

Everything is synthetic, but the names are realistic and the faculties are real. Treat it as personal data. The README should say how the system handles each point:

1. **Pairs, not people.** The system ranks researcher–challenge pairs by fit to a stated problem, with evidence. It never outputs a list, score or ranking of people.
   Publication counts (0–23), titles and seniority are never a score. A shortlist is "candidates for this problem", not "the best researchers".
2. **Family and health.** 14 researchers' notes give parental or maternity leave or young children as the reason for limited availability:
   R0050, R0074, R0177, R0292, R0298, R0341, R0419, R0478, R0551, R0572, R0810, R0917, R0932, R1044.
   C120-CH3 names an employee who is going on maternity leave. Keep only the availability fact ("available from autumn 2026"). Never put the reason in a profile, proposal or email.
3. **Status.** 20 Professors Emeritus and R0068 (left in March 2026). Respect what `notes` and `open_to` say, e.g. consulting only. Do not propose them as PI or supervisor.
4. **Identity by id only.** The [name traps](#name-traps) mean that a name match can attach someone else's paper, job or company to a person. That is a false claim about a real-looking individual.
5. **Contact data.** Company pages hold 442 email addresses. About 50 of them are personal (`name.surname@company`), mostly in job ads and event pages. Do not extract them, store them, or use them for outreach. Address the company, or route introductions through EINSTEIN.
6. **`notes` read like private remarks** (teaching load, preferences, "prefers contract research"). Use them as constraints. Do not quote them.
7. **Topics are not attributes.** Ethnicity, religion and health appear as research topics (e.g. R0777 surveys ethnic Hungarian communities; Medicine has patient cohorts). Never infer a person's ethnicity, gender or religion from a name or pronoun, and never use them in matching.
8. **No name lookups in real APIs.** A search in OpenAlex or ORCID for a synthetic name (`Jelena Marković`) returns real people with that name. Use the real APIs only for things that are not people (calls, topics, venues), or by real ids.
9. **Patient data.** A proposal that uses clinical or patient data should name ethics approval and data protection (GDPR and the Serbian personal data law) as preconditions.

## Reproduce

Read-only scripts. Python 3.11, standard library only. Run them from the repo root:

| Script | What it prints |
| --- | --- |
| `python3 scripts/recon/schema.py` | Record counts, per-field coverage, types, lengths and token sums, including nested objects |
| `python3 scripts/recon/joins.py` | Id uniqueness, link integrity in both directions, value distributions, partner and name co-mentions |
| `python3 scripts/recon/quality.py` | Duplicates, missing fields, scripts and encodings, stale signals, personal-data terms |
| `python3 scripts/recon/probe.py` | Follow-ups: the duplicate pairs, same-name authors, company staff names, leave notes, non-research challenges, emails |
| `python3 scripts/recon/shard.py [data_dir] [n_shards]` | Bundle and card sizes, faculty and department totals, balanced shards, non-research flags, co-authorship |

`data/raw/.gitignore` lists `jury/` and `build.py`: the dataset's generator and a jury folder exist upstream but are not in the clone.
Expect the jury to check the traps the dataset README lists: duplicates, shared names, stale profiles, non-research challenges.
