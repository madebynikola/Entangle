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
import { availabilityOf } from "./normalize"
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

describe("availability", () => {
	it("catches soft capacity limits in researcher notes", () => {
		assert.match(availabilityOf("She has limited capacity for new large commitments until mid-2026.") ?? "", /mid-2026/)
		assert.match(availabilityOf("She is currently at full teaching load and cannot take on projects requiring more than 30% of her time.") ?? "", /full teaching load/)
		assert.match(availabilityOf("He is on sabbatical during the spring semester of 2026.") ?? "", /sabbatical/)
		assert.match(availabilityOf("Supervising two students, which limits capacity for new commitments before 2026.") ?? "", /limits capacity/)
	})

	it("catches limits that SubQ found and the regex missed (scripts/audit-availability.ts)", () => {
		for (const s of [
			"Currently supervising two PhD students, which limits availability for large new commitments until mid-2026.",
			"Her fieldwork schedule constrains availability for intensive collaboration during those periods.",
			"The conference will place some constraints on her availability for new project commitments.",
			"He has limited bandwidth for projects outside his dissertation scope until mid-2026.",
			"Supervision bandwidth is currently limited for a second PhD candidate.",
			"Availability for larger project commitments may be limited until the dissertation is defended.",
			"She has moderate availability for new collaborations until mid-2026.",
			"Research group capacity is limited to one concurrent externally funded project.",
			"He is currently at near-full capacity due to project obligations through late 2025.",
			"She is currently fully committed to the project until the end of 2026.",
			"His clinical workload is high and he has limited time for projects.",
			"Workload at the Clinical Centre is high during the academic year.",
			"She teaches a heavy undergraduate load in the spring semester.",
			"The project occupies a substantial share of her research time until 2026.",
			"She has roughly 30–40% of her time available for external collaborations.",
			"He is cautious about taking on additional coordination responsibilities before mid-2026.",
			"He is unlikely to take on a third student before 2027.",
			"She is not seeking large consortium leadership roles in the next two years.",
			"She prefers projects that do not require more than 20 percent time allocation.",
			"Commitments that would require more than two days per week are not possible.",
			"Trenutno vodi jedan projekat, pa je kapacitet za nove veće projekte ograničen do 2026.",
			"Predaje na dva predmeta, što ograničava dostupnost za konsultacije.",
			"Nije dostupan za nove angažmane u prvom kvartalu 2026.",
			"Тренутно нема капацитета за велике нове пројекте пре краја 2025. године.",
			"Доступност за дуже боравке ван факултета је ограничена у периоду фебруар–јун.",
		])
			assert.ok(availabilityOf(s), s)
	})

	it("does not read a limit into open capacity, a moderate load or a shared instrument", () => {
		for (const s of [
			"He has capacity for one additional industrial PhD candidate from autumn 2026.",
			"His teaching load is moderate.",
			"Workload is substantial but not limiting for new collaborations with clearly defined scope.",
			"The pilot ohmic heating unit is available for external use; capacity is limited to campaigns of up to two weeks.",
			"He wants casting and refining facilities not available at the university scale.",
			"She wants proprietary credit data not available through public registries.",
			"He is available for consulting engagements and welcomes contact from NTP companies.",
			"Laboratorijska oprema je dostupna u ograničenom kapacitetu.",
		])
			assert.equal(availabilityOf(s), null, s)
	})

	it("ignores negated sabbaticals and leave", () => {
		for (const s of [
			"No planned sabbatical.",
			"He is not currently on sabbatical and has a moderate teaching load.",
			"She has no current sabbatical plans.",
			"He is not on sabbatical and has no planned leave through 2027.",
		])
			assert.equal(availabilityOf(s), null, s)
	})

	it("ignores equipment, data and capabilities that are not available", () => {
		for (const s of [
			"She wants access to an industrial press, a capability not available at the faculty.",
			"He wants datasets that are otherwise unavailable for research.",
			"The lab has limited availability of the evaluation kits.",
			"His laboratory capacity for contract testing is limited.",
		])
			assert.equal(availabilityOf(s), null, s)
	})

	it("keeps a real limit in a sentence that also has a negated sabbatical", () => {
		assert.match(availabilityOf("He is not on sabbatical but has limited capacity until 2027.") ?? "", /limited capacity/)
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

	it("has an availability claim for soft capacity limits and none for negated or non-person ones", () => {
		const data = loadDataset(DATA_DIR)
		const claim = (id: string) => data.researcher(id)!.availability
		assert.match(claim("R0030") ?? "", /limited capacity/)
		assert.match(claim("R0031") ?? "", /full teaching load/)
		assert.match(claim("R0042") ?? "", /limited capacity/)
		assert.equal(claim("R0005")?.includes("sabbatical") ?? false, false)
		assert.match(claim("R0005") ?? "", /limited until mid-2026/)
		assert.equal(claim("R0140"), null)
	})

	it("sees no personal reason for leave anywhere agents read", () => {
		const data = loadDataset(DATA_DIR)
		for (const r of data.researchers.values()) assert.doesNotMatch(r.notes, /maternity|parental leave|young children/i, r.id)
		for (const ch of data.challenges.values()) assert.doesNotMatch(`${ch.text} ${ch.detail}`, /maternity/i, ch.id)
	})
})
