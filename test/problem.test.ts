import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Dataset, FIXTURE_DIR, readRaw } from "../src/data/dataset"
import { PROBLEM_CHALLENGE_ID, PROBLEM_COMPANY_ID, addProblem, problemCompany, problemError } from "../src/data/problem"

// Run: npx tsx --test test/problem.test.ts

const PROBLEM =
	"Our vibration sensors on wind turbine gearboxes raise false alarms in cold weather. We tried fixed thresholds per season, " +
	"but bearing faults are still missed in winter. We have two years of labelled vibration data from 40 turbines."

/** A fresh dataset per test: addProblem changes it, and loadDataset would share one across tests. */
const fixtures = () => new Dataset(FIXTURE_DIR, readRaw(FIXTURE_DIR))

describe("reverse search: a described problem", () => {
	test("its first sentence is the challenge and the rest, word for word, its detail", () => {
		const company = problemCompany({ text: `  ${PROBLEM}\n` })
		assert.equal(company.id, PROBLEM_COMPANY_ID)
		assert.deepEqual(
			company.challenges.map((ch) => ch.id),
			[PROBLEM_CHALLENGE_ID],
		)
		const [challenge] = company.challenges
		assert.equal(challenge.text, "Our vibration sensors on wind turbine gearboxes raise false alarms in cold weather.")
		assert.ok(challenge.detail.startsWith("We tried fixed thresholds per season"))
		assert.ok(challenge.detail.endsWith("from 40 turbines."))
	})

	test("a long first sentence is cut at a word, and nothing of the text is lost", () => {
		const long = `${"The sorting line drops parcels whose labels are wrinkled or wet ".repeat(5).trim()}, and nobody knows why`
		const [challenge] = problemCompany({ text: long }).challenges
		assert.ok(challenge.text.length <= 201, challenge.text)
		assert.ok(challenge.text.endsWith("…"))
		assert.equal(`${challenge.text.slice(0, -1)} ${challenge.detail}`.replace(/\s+/g, " "), long)
	})

	test("too short or too long is refused with a reason", () => {
		assert.match(problemError("Cracks in concrete.") ?? "", /at least 40 characters/)
		assert.match(problemError("x".repeat(6001)) ?? "", /under 6000/)
		assert.equal(problemError(PROBLEM), null)
		assert.throws(() => problemCompany({ text: "short" }), /at least 40/)
	})

	test("it becomes a citable record with only what was written: no size, year or sector invented", () => {
		const data = fixtures()
		const problem = addProblem(data, { text: PROBLEM })
		assert.deepEqual(problem, { companyId: "C999", challengeId: "C999-CH1", company: "Described problem", sector: undefined, text: PROBLEM })

		const challenge = data.sources.get("C999-CH1")
		assert.equal(challenge?.kind, "challenge")
		assert.equal(challenge?.companyId, "C999")
		assert.equal(challenge?.text.replace(/\s+/g, " "), PROBLEM)

		const company = data.sources.get("C999")
		assert.equal(company?.kind, "company")
		assert.equal(company?.year, undefined)
		assert.ok(company?.text.startsWith("Described problem (C999).\n"), company?.text)
		assert.doesNotMatch(company?.text ?? "", /employees|founded/)
	})

	test("a sector and a name, when given, are kept", () => {
		const data = fixtures()
		const problem = addProblem(data, { text: PROBLEM, sector: " Renewable energy ", company: "Vetar d.o.o." })
		assert.equal(problem.sector, "Renewable energy")
		assert.equal(data.sources.get("C999")?.text.split("\n")[0], "Vetar d.o.o. (C999): Renewable energy.")
	})

	test("a dataset company's record reads as before", () => {
		const data = fixtures()
		const [id] = data.companies.keys()
		const c = data.companies.get(id)!
		assert.equal(data.sources.get(id)?.text.split("\n")[0], `${c.name} (${c.id}): ${c.sector}, ${c.location}, ${c.employees} employees, founded ${c.founded}.`)
	})

	test("a second problem in one dataset is refused: one run, one problem", () => {
		const data = fixtures()
		addProblem(data, { text: PROBLEM })
		assert.throws(() => addProblem(data, { text: PROBLEM }), /already has C999/)
	})
})
