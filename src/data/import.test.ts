/**
 * Your own data: the importer reads files leniently and writes a folder the data layer loads like the dataset.
 *
 *   node --import tsx --test src/data/import.test.ts
 */
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { after, describe, it } from "node:test"
import { Dataset, FIXTURE_DIR, readRaw } from "./dataset"
import { importFiles, parseCsv, writeRaw } from "./import"

const tmp = mkdtempSync(join(tmpdir(), "entangle-import-"))
after(() => rmSync(tmp, { recursive: true, force: true }))

function load(name: string, files: { name: string; text: string }[]) {
	const result = importFiles(files)
	const dir = join(tmp, name)
	writeRaw(dir, result.raw, "test")
	return { ...result, data: new Dataset(dir, readRaw(dir)) }
}

describe("import", () => {
	it("reads the fixture's own files back unchanged", () => {
		const names = ["researchers.json", "publications.jsonl", "projects.json", "patents.json", "companies.json", "company-pages.jsonl"]
		const { data, renamed, warnings } = load("fixture", names.map((name) => ({ name, text: readFileSync(resolve(FIXTURE_DIR, name), "utf8") })))
		const original = new Dataset(FIXTURE_DIR, readRaw(FIXTURE_DIR))
		assert.deepEqual(data.stats(), original.stats())
		assert.deepEqual(renamed, {})
		assert.deepEqual(warnings, [])
	})

	it("gives other ids the dataset's shape, links both sides and keeps C999 for the reverse search", () => {
		const csv = '﻿id,name,fields,publications\njdoe,Jane Doe,"Control; Robotics",p1; p2\nX9,"Marko ""Mare"" Ilić",Chemistry,\n'
		const publications = JSON.stringify([
			{ id: "p1", title: "MPC for quadrotors", year: "2021" },
			{ id: "p2", title: "Robust MPC", authors: ["Someone Else"] },
			{ id: "p3", title: "Catalysts", researcher_ids: ["X9"] },
		])
		const companies = JSON.stringify({
			companies: [
				{ id: "ACME", name: "Acme", challenges: ["Drones drift in gusts.", { text: "Batteries die in the cold." }] },
				{ id: "C999", name: "Clash", challenges: [{ id: "C999-CH1", text: "Something." }] },
			],
		})
		const { data, renamed, warnings } = load("own", [
			{ name: "my researchers.csv", text: csv },
			{ name: "papers.json", text: publications },
			{ name: "companies.json", text: companies },
			{ name: "notes.txt", text: "not data" },
		])
		assert.equal(renamed.jdoe, "R0001")
		assert.equal(renamed.p3, "SYN-PUB-00003")
		assert.equal(renamed.ACME, "C001")
		assert.equal(renamed.C999, "C002", "C999 is the described problem's id")
		assert.deepEqual(data.researcher("R0001")?.publications, ["SYN-PUB-00001", "SYN-PUB-00002"])
		assert.deepEqual(data.researcher("R0002")?.publications, ["SYN-PUB-00003"], "a publication's researcher_ids link it to the researcher")
		assert.equal(data.researcher("R0002")?.name, 'Marko "Mare" Ilić')
		assert.deepEqual([...data.challenges.keys()], ["C001-CH1", "C001-CH2", "C002-CH1"])
		assert.match(warnings.join(" "), /notes\.txt/)
		assert.ok(data.sources.get("SYN-PUB-00001")?.researcherIds.includes("R0001"), "the Critic sees who wrote it")
	})

	it("does not merge two people because their ids match the dataset's known duplicates", () => {
		const researchers = JSON.stringify([
			{ id: "R0139", name: "Ana Prva" },
			{ id: "R0539", name: "Bojan Drugi" },
		])
		const { data } = load("dupes", [{ name: "researchers.json", text: researchers }])
		assert.equal(data.researchers.size, 2)
		assert.equal(data.aliases.size, 0)
	})

	it("refuses data with no researchers, and a named file that is not valid", () => {
		assert.throws(() => importFiles([{ name: "companies.json", text: "[]" }]), /No researchers/)
		assert.throws(() => importFiles([{ name: "researchers.json", text: "{ nope" }]), /researchers\.json: not valid JSON/)
	})

	it("parses quoted CSV fields with commas, quotes and line breaks", () => {
		assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n'), [{ a: "x, y", b: 'say "hi"\nthere' }])
	})
})
