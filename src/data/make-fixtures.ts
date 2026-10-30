/**
 * Build test/fixtures/data/ from the full dataset: 5 companies, 30 researchers and their records,
 * in the dataset's own file format, so `loadDataset(FIXTURE_DIR)` works like the real thing.
 *
 *   npx tsx src/data/make-fixtures.ts
 *
 * Deterministic: the same dataset gives the same fixture.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { DATA_DIR, FIXTURE_DIR, loadDataset, readRaw } from "./dataset"
import { findResearchersForNeed } from "./search"

/** Picked for coverage: research challenges, a non-research one, Serbian text, a name trap, a personal detail. */
const COMPANIES = ["C001", "C006", "C054", "C120", "C139"]

/** Trap cases from docs/dataset.md, kept whatever retrieval finds. */
const TRAPS = [
	"R0139", "R0539", // one person, two profiles (surname first)
	"R0556", "R0976", // one person, two profiles (Cyrillic); also the name of C139's director
	"R0128", "R0881", // two people, one name (Nina Mamužić)
	"R0068", // left the university in March 2026
	"R0079", // professor emeritus, consulting only
	"R0341", // on leave until September 2026 (personal reason in the raw notes)
]

const RESEARCHERS = 30

function main(): void {
	const data = loadDataset(DATA_DIR)
	const raw = readRaw(DATA_DIR)

	const picked = new Set(TRAPS)
	const rankings = COMPANIES.flatMap((id) => data.companies.get(id)!.challenges).map((chId) => {
		const ch = data.challenges.get(chId)!
		return findResearchersForNeed(data, `${ch.text} ${ch.detail}`, RESEARCHERS, { activeOnly: true }).map((m) => m.researcherId)
	})
	// Round-robin over the challenges, so each one gets its best candidates in.
	for (let rank = 0; picked.size < RESEARCHERS && rank < RESEARCHERS; rank++) {
		for (const ranking of rankings) {
			if (picked.size >= RESEARCHERS) break
			if (ranking[rank]) picked.add(ranking[rank])
		}
	}

	const researchers = raw.researchers.filter((r) => picked.has(r.id))
	const publications = raw.publications
		.filter((p) => p.authors.some((a) => a.researcher_id && picked.has(a.researcher_id)))
		// Links to researchers outside the fixture become outside co-authors, so every referenced id exists.
		.map((p) => ({ ...p, authors: p.authors.map((a) => ({ ...a, researcher_id: a.researcher_id && picked.has(a.researcher_id) ? a.researcher_id : null })) }))
	const projects = raw.projects
		.filter((p) => p.participants.some((x) => picked.has(x.researcher_id)))
		.map((p) => ({ ...p, participants: p.participants.filter((x) => picked.has(x.researcher_id)) }))
	const patents = raw.patents.filter((p) => p.inventors.some((x) => picked.has(x.researcher_id)))
	const ids = (list: Array<{ id: string }>) => new Set(list.map((x) => x.id))
	const [pubIds, prjIds, patIds] = [ids(publications), ids(projects), ids(patents)]
	for (const r of researchers) {
		r.publications = r.publications.filter((id) => pubIds.has(id))
		r.projects = r.projects.filter((id) => prjIds.has(id))
		r.patents = r.patents.filter((id) => patIds.has(id))
	}
	const companies = raw.companies.filter((c) => COMPANIES.includes(c.id))
	const pages = raw.pages.filter((p) => COMPANIES.includes(p.company_id))

	const note = "Fixture subset of jigjoy-ai/einstein-matchmaker-data v2.0, built by src/data/make-fixtures.ts. Synthetic data."
	const wrap = (key: string, records: unknown[]) => JSON.stringify({ name: `einstein-fixture-${key}`, version: "2.0", note, [key]: records }, null, 1) + "\n"
	const lines = (records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n") + "\n"

	mkdirSync(FIXTURE_DIR, { recursive: true })
	writeFileSync(resolve(FIXTURE_DIR, "researchers.json"), wrap("researchers", researchers))
	writeFileSync(resolve(FIXTURE_DIR, "publications.jsonl"), lines(publications))
	writeFileSync(resolve(FIXTURE_DIR, "projects.json"), wrap("projects", projects))
	writeFileSync(resolve(FIXTURE_DIR, "patents.json"), wrap("patents", patents))
	writeFileSync(resolve(FIXTURE_DIR, "companies.json"), wrap("companies", companies))
	writeFileSync(resolve(FIXTURE_DIR, "company-pages.jsonl"), lines(pages))

	console.log(`fixture in ${FIXTURE_DIR}`)
	console.log(`  companies ${companies.map((c) => c.id).join(" ")}`)
	console.log(`  researchers (${researchers.length}) ${researchers.map((r) => r.id).join(" ")}`)
	console.log(`  publications ${publications.length}, projects ${projects.length}, patents ${patents.length}, pages ${pages.length}`)
}

main()
