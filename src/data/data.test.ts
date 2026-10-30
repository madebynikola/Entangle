/**
 * Data layer tests. Fixture tests always run; full-dataset tests run when data/raw/ is present.
 *
 *   node --import tsx --test src/data/data.test.ts
 */
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it } from "node:test"
import {
	DATA_DIR,
	FIXTURE_DIR,
	createDataTools,
	findResearchersForNeed,
	fold,
	loadDataset,
	searchCompanies,
	searchPublications,
	shardCompanies,
	shardResearchers,
} from "./index"
import { analyze } from "./text"

describe("fixture", () => {
	const data = loadDataset(FIXTURE_DIR)

	it("has 5 companies and 30 researcher profiles (28 after merging 2 duplicates)", () => {
		assert.equal(data.companies.size, 5)
		assert.equal(data.researchers.size + data.aliases.size, 30)
		assert.deepEqual([...data.aliases.entries()], [["R0139", "R0539"], ["R0556", "R0976"]])
	})

	it("resolves a duplicate alias to the main profile and keeps both spellings", () => {
		assert.equal(data.sources.get("R0139")?.id, "R0539")
		const jelena = data.researcher("R0556")!
		assert.equal(jelena.id, "R0976")
		assert.ok(jelena.names.includes("Јелена Марковић"))
		assert.equal(jelena.name, "Jelena Marković")
	})

	it("keeps two people with one name apart", () => {
		const [a, b] = [data.researcher("R0128")!, data.researcher("R0881")!]
		assert.equal(a.name, b.name)
		assert.notEqual(a.faculty, b.faculty)
	})

	it("links records by id in both directions", () => {
		for (const p of data.publications.values()) {
			for (const id of p.researcherIds) assert.ok(data.researchers.get(id)!.publications.includes(p.id), `${id} → ${p.id}`)
		}
		for (const r of data.researchers.values()) {
			for (const id of [...r.publications, ...r.projects, ...r.patents]) assert.ok(data.sources.get(id)?.researcherIds.includes(r.id), `${r.id} → ${id}`)
		}
	})

	it("flags emeritus and departed researchers and keeps only availability facts", () => {
		assert.equal(data.researcher("R0068")!.status, "departed")
		assert.equal(data.researcher("R0068")!.canLead, false)
		assert.equal(data.researcher("R0079")!.status, "emeritus")
		const onLeave = data.researcher("R0341")!
		assert.equal(onLeave.canLead, true)
		assert.match(onLeave.availability ?? "", /until September 2026/)
	})

	it("never shows a personal reason for leave or an email address", () => {
		const personal = /maternity|paternity|parental leave|young children/i
		for (const id of [...data.researchers.keys(), ...data.challenges.keys(), ...data.companies.keys(), ...data.pages.keys()]) {
			const text = data.sources.get(id)!.text
			assert.doesNotMatch(text, personal, id)
			assert.doesNotMatch(text, /\S+@\S+\.\w{2,}/, id)
		}
		assert.match(data.challenges.get("C120-CH3")!.text, /going on leave/)
	})

	it("finds pages by full id and by a unique prefix", () => {
		const page = [...data.pages.values()][0]
		assert.equal(data.sources.get(page.id)?.kind, "page")
		assert.equal(data.sources.get(page.id.split("/").slice(0, 3).join("/"))?.id, page.id)
		assert.equal(data.sources.get("SYN-PUB-99999"), undefined)
	})

	it("finds researchers for a need, with evidence that resolves", () => {
		const matches = findResearchersForNeed(data, "tablet film coating thickness variability in pan coaters", 5)
		assert.equal(matches[0].researcherId, "R0701")
		assert.equal(matches[0].relevance, 1)
		for (const m of matches) for (const id of m.sourceIds) assert.ok(data.sources.has(id), id)
		assert.ok(findResearchersForNeed(data, "anything", 5, { activeOnly: true }).every((m) => m.canLead))
	})

	it("searches publications and companies", () => {
		const pubs = searchPublications(data, "anomaly detection Modbus industrial control", 3)
		assert.ok(pubs.length > 0)
		for (const p of pubs) assert.deepEqual(p.researchers.map((r) => r.id), data.publications.get(p.id)!.researcherIds)
		assert.equal(searchCompanies(data, "Modbus BACnet anomaly detection", 1)[0].id, "C001-CH1")
	})

	it("exposes the Mozaik tools", async () => {
		const tools = createDataTools(data)
		assert.deepEqual(tools.map((t) => t.name).sort(), [
			"find_researchers_for_need", "get_company", "get_researcher", "get_source", "search_companies", "search_publications",
		])
		const get = (name: string) => tools.find((t) => t.name === name)!
		assert.equal((await get("get_researcher").invoke({ id: "R0139" })).id, "R0539")
		assert.match((await get("get_source").invoke({ id: "nope" })).error, /No record/)
		assert.equal((await get("get_company").invoke({ id: "C001" })).challenges.length, 4)
		assert.equal(createDataTools(data, ["get_source"]).length, 1)
	})

	it("shards cover every id once and keep departments together", () => {
		const companies = shardCompanies(data, 2)
		assert.deepEqual(companies.flatMap((s) => s.ids).sort(), [...data.companies.keys()].sort())
		const researchers = shardResearchers(data, 3)
		assert.deepEqual(researchers.flatMap((s) => s.ids).sort(), [...data.researchers.keys()].sort())
		const shardOf = new Map(researchers.flatMap((s) => s.ids.map((id) => [id, s.index] as const)))
		const byDepartment = new Map<string, Set<number>>()
		for (const r of data.researchers.values()) {
			const key = `${r.faculty} / ${r.department}`
			byDepartment.set(key, (byDepartment.get(key) ?? new Set()).add(shardOf.get(r.id)!))
		}
		for (const [key, shards] of byDepartment) assert.equal(shards.size, 1, key)
	})
})

describe("text", () => {
	it("folds Cyrillic and diacritics", () => {
		assert.equal(fold("Јелена Марковић"), "jelena markovic")
		assert.deepEqual(analyze("Марковић"), analyze("Markovic"))
		assert.equal(fold("Đorđe"), "djordje")
	})

	it("stems English", () => {
		assert.deepEqual(analyze("detecting detection detected"), ["detect", "detect", "detect"])
		assert.deepEqual(analyze("networks network"), ["network", "network"])
	})
})

describe("full dataset", { skip: !existsSync(resolve(DATA_DIR, "researchers.json")) && "data/raw/ not present" }, () => {
	it("loads and searches in under 5 s", () => {
		const start = performance.now()
		const data = loadDataset(DATA_DIR)
		findResearchersForNeed(data, "anomaly detection in industrial networks", 10)
		assert.ok(performance.now() - start < 5000)
		assert.equal(data.researchers.size, 1043)
		assert.equal(data.challenges.size, 489)
		assert.equal(data.pages.size, 917)
	})

	it("sees no personal reason for leave anywhere agents read", () => {
		const data = loadDataset(DATA_DIR)
		for (const r of data.researchers.values()) assert.doesNotMatch(r.notes, /maternity|parental leave|young children/i, r.id)
		for (const ch of data.challenges.values()) assert.doesNotMatch(`${ch.text} ${ch.detail}`, /maternity/i, ch.id)
	})
})
