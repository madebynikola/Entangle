# Open APIs for the Matchmaker

All of these are public. Checked on 28 October 2026. Request a key or access today where it's needed, because some take a day to be approved.

| Source | What you get | Key | Limits |
| --- | --- | --- | --- |
| [OpenAlex](https://developers.openalex.org) | Works, authors, institutions, topics, citations | Free key, from [openalex.org/settings/api](https://openalex.org/settings/api) | About 1,000 list calls a day without a key; 10× that with one. Get a key per team, since a shared IP runs out fast. |
| [ORCID](https://info.orcid.org/documentation/api-tutorials/) | A researcher's affiliations, works and funding, as they entered them | None for public reads | Be gentle: a few requests a second |
| [CORDIS](https://cordis.europa.eu/projects) | EU-funded projects and their participants | None for search and bulk files | Bulk files are tens of MB |
| [EU Funding & Tenders](https://ec.europa.eu/info/funding-tenders/opportunities/portal/) | Open calls (for a Funding Scout) | `apiKey=SEDIA`, which is public | — |
| [Lens](https://docs.api.lens.org/getting-started.html) | Patents and scholarly works | Access by request, then a token | Approval can take a working day |
| [Espacenet OPS](https://developers.epo.org) | European patents | Free registration | Weekly data quota |

## Examples

**OpenAlex.** The University of Novi Sad is `I170726198` (ROR `00xa57a59`).

```sh
# The institution
curl "https://api.openalex.org/institutions/I170726198?api_key=$OPENALEX_KEY"
# Its works on a topic (each work lists its authors). Author search matches names, not topics.
curl "https://api.openalex.org/works?filter=institutions.id:I170726198&search=remote%20sensing&api_key=$OPENALEX_KEY"
# Its authors
curl "https://api.openalex.org/authors?filter=last_known_institutions.id:I170726198&api_key=$OPENALEX_KEY"
# An author's recent works
curl "https://api.openalex.org/works?filter=author.id:A123456789,from_publication_date:2021-01-01&sort=publication_date:desc&api_key=$OPENALEX_KEY"
```

**ORCID.** Search, then read one record. Send `Accept: application/json`.

```sh
curl -H "Accept: application/json" "https://pub.orcid.org/v3.0/expanded-search/?q=affiliation-org-name:%22University%20of%20Novi%20Sad%22%20AND%20keyword:hydrology&rows=10"
curl -H "Accept: application/json" "https://pub.orcid.org/v3.0/0000-0000-0000-0000/record"
```

**CORDIS.** Search projects (JSON), or download all Horizon Europe projects at once.

```sh
curl "https://cordis.europa.eu/search?q=contenttype%3D%27project%27%20AND%20%27Novi%20Sad%27&p=1&num=10&srt=Relevance:decreasing&format=json"
curl -O "https://cordis.europa.eu/data/cordis-HORIZONprojects-json.zip"   # ~35 MB
```

**EU calls** (for a Funding Scout). The search mixes calls with FAQ pages, so filter on `type`. Then check each result's `deadlineDate`, since closed calls come back too.

```sh
curl -X POST "https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=irrigation&pageSize=10&pageNumber=1" \
  -F 'query={"bool":{"must":[{"terms":{"type":["1","2","8"]}}]}};type=application/json' \
  -F 'languages=["en"];type=application/json'
```

Serbia's Innovation Fund ([inovacionifond.rs](https://www.inovacionifond.rs)) has no API. Its calls are on the website.

## Good manners

- Cache what you fetch. The same researcher shouldn't cost a call per agent.
- Keep each fact's source (a URL or an id) next to it, so your Critic can check it.
- Real people are in these sources. Propose collaborations; never score people.
