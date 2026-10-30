# EINSTEIN Matchmaker: synthetic dataset

Data for the EINSTEIN track of the NTP Novi Sad Hackathon (30–31 October 2026): researchers at the University of Novi Sad and companies around NTP Novi Sad, for a system of agents that finds researcher–company pairs worth a joint project or an industrial PhD.

**Everything here is invented.** The people, companies, publications, projects and patents don't exist; any resemblance to real ones is a coincidence. The faculties are real and only set the scene. Real public data (ORCID, OpenAlex, CORDIS, Google Patents, Lens) is allowed too.

## It's big on purpose

About **7 million tokens** (32 MB): several times what fits in any model's context window. You can't paste it into one prompt and ask for the best pairs. Split the work: profile researchers, read companies, search, shortlist, check, write. That is what the track is about.

| | |
| --- | --- |
| Researchers | 1,047, across 16 faculties and institutes |
| Publications | 10,779, almost all with an abstract |
| Projects | 1,823 |
| Patents | 111 |
| Companies | 153, with 489 challenges |
| Company pages | 917: website text, job ads, news and blog posts |

## Files

| File | What's in it |
| --- | --- |
| `data/researchers.json` | Profiles: title, faculty, department, fields, keywords, bio, ids of their publications, projects and patents, what they're open to (`open_to`), industry experience, notes |
| `data/publications.jsonl` | One publication per line: title, abstract, year, venue, type, keywords, authors (with `researcher_id` when the author has a profile here) |
| `data/projects.json` | Projects: programme, years, summary, partners, participants (`researcher_id`, role) |
| `data/patents.json` | Patents: status, abstract, inventors |
| `data/companies.json` | Companies: sector, size, what they do, products, tech, **challenges** (each with an id, a one-line `text` and a longer `detail`), plans, R&D capacity, past collaborations |
| `data/company-pages.jsonl` | One page per line, by `company_id`: their website, job ads, news, blog posts, events |
| `data/researchers.csv`, `data/companies.csv` | Profiles flattened for a spreadsheet (UTF-8) |
| `docs/apis.md` | Open APIs for real data (OpenAlex, ORCID, CORDIS, EU calls, patents), with examples |
| `docs/example-industrial-phd-topic.md` | What a good industrial PhD proposal looks like |

Everything has an id: researchers `R0001`, companies `C001`, challenges `C001-CH1`, publications `SYN-PUB-00001`, projects `SYN-PRJ-0001`, patents `SYN-PAT-001`. Cite them in your proposals and traces, so a reviewer can check each claim.

```python
import json
researchers = json.load(open("data/researchers.json", encoding="utf-8"))["researchers"]
companies = json.load(open("data/companies.json", encoding="utf-8"))["companies"]
publications = {p["id"]: p for p in map(json.loads, open("data/publications.jsonl", encoding="utf-8"))}
```

## Like real data

The records aren't clean:

- Some are incomplete: no bio, a publication without an abstract, a profile with keywords only.
- A few people and companies write in Serbian, in Latin or Cyrillic script.
- One person can turn up in two sources, under a different spelling of their name.
- Two different people can share a name.
- Profiles go stale: someone retired, or left the university.
- Companies describe problems in business language; researchers describe their work in academic language. The same word can mean different things in different fields.
- Some challenges have no good match at the university, and some aren't research problems at all. When that's the case, the right answer says so.

## Rules

- The system proposes collaborations. It doesn't score or rank people by their worth.
- A claim about a person (a publication, a skill, a patent) must come from the data or a public source you cite.
