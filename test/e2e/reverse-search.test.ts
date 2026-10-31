import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { rmSync } from "node:fs"
import { resolve } from "node:path"
import { after, before, describe, test } from "node:test"
import { chromium, type Browser, type Page } from "playwright"
import type { RunInfo } from "../../src/server/api"

// Run: npm run test:web   (the first time on a machine: npx playwright install chromium)
//
// Opens the web app the way a person does: it starts the local server, loads the app in headless Chromium,
// describes a problem in the "Describe a problem" box and follows the mock run it starts to its proposal.
// No API key and no network beyond localhost: the run is on the mock model.

const ROOT = resolve(import.meta.dirname, "../..")
const PROBLEM_START = "Our vibration sensors on wind turbine gearboxes"

let server: ChildProcess | undefined
let browser: Browser | undefined
let page: Page
let base = ""
/** The run the test starts. Removed at the end; mock runs are gitignored anyway. */
let runId: string | undefined

/** Start `src/server/main.ts dev` on a free port and resolve with its URL once it prints it. */
function startServer(): Promise<string> {
	return new Promise((resolveUrl, reject) => {
		const child = spawn(process.execPath, ["--import", "tsx", "src/server/main.ts", "dev", "--no-open", "--port", "4610"], {
			cwd: ROOT,
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
			stdio: ["ignore", "pipe", "pipe"],
		})
		server = child
		let output = ""
		const timer = setTimeout(() => reject(new Error(`The server did not start within 60 s.\n${output}`)), 60_000)
		const onData = (chunk: Buffer) => {
			output += chunk.toString().replace(/\x1b\[[0-9;]*m/g, "")
			const match = output.match(/http:\/\/localhost:(\d+)\//)
			if (!match) return
			clearTimeout(timer)
			resolveUrl(`http://localhost:${match[1]}`)
		}
		child.stdout!.on("data", onData)
		child.stderr!.on("data", onData)
		child.on("exit", (code) => reject(new Error(`The server exited with code ${code}.\n${output}`)))
	})
}

async function runInfo(id: string): Promise<RunInfo> {
	const response = await fetch(`${base}/api/runs/${encodeURIComponent(id)}`)
	assert.ok(response.ok, `GET /api/runs/${id}: ${response.status}`)
	return (await response.json()) as RunInfo
}

async function waitForEnd(id: string, ms: number): Promise<RunInfo> {
	const deadline = Date.now() + ms
	for (;;) {
		const info = await runInfo(id)
		if (info.status !== "live") return info
		if (Date.now() > deadline) throw new Error(`Run ${id} is still live after ${ms / 1000} s`)
		await new Promise((done) => setTimeout(done, 1000))
	}
}

describe("web app: reverse search from the Runs screen", { timeout: 240_000 }, () => {
	before(async () => {
		base = await startServer()
		browser = await chromium.launch()
		page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
		page.setDefaultTimeout(30_000)
	})

	after(async () => {
		await browser?.close()
		server?.kill()
		if (runId) rmSync(resolve(ROOT, "out", runId), { recursive: true, force: true })
	})

	test("the server refuses a problem too short to search on", async () => {
		const response = await fetch(`${base}/api/runs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mock: true, problem: "Cracks in concrete." }),
		})
		assert.equal(response.status, 400)
		assert.match(((await response.json()) as { error: string }).error, /at least 40 characters/)
	})

	test("the box opens, waits for a real description, and starts a mock run on the Stage", async () => {
		await page.goto(`${base}/`)
		await page.getByRole("button", { name: "Describe a problem" }).click()

		const dialog = page.getByRole("dialog", { name: "Find researchers for a problem" })
		await dialog.waitFor()
		const submit = dialog.getByRole("button", { name: "Find researchers" })
		assert.equal(await submit.isDisabled(), true, "nothing written yet")

		await dialog.getByLabel("The problem").fill("Cracks in concrete.")
		assert.equal(await submit.isDisabled(), true, "too short to search on")
		await dialog.getByText(/more characters to start/).waitFor()

		await dialog.getByRole("button", { name: "Use an example" }).click()
		assert.match(await dialog.getByLabel("The problem").inputValue(), new RegExp(`^${PROBLEM_START}`))
		await dialog.getByLabel(/^Sector/).fill("Renewable energy")
		assert.equal(await dialog.getByRole("switch", { name: "Run on the mock model" }).getAttribute("aria-checked"), "true")
		assert.equal(await submit.isDisabled(), false)

		await submit.click()
		await page.waitForURL(/#\/runs\/[^/]+\/stage/)
		runId = decodeURIComponent(page.url().match(/#\/runs\/([^/]+)\/stage/)![1])
		assert.match(runId, /-mock$/, "the box starts a mock run by default")
		await dialog.waitFor({ state: "hidden" })
	})

	test("the run ends with a proposal for the described problem, and Results shows it", async () => {
		assert.ok(runId, "the previous test started a run")
		const info = await waitForEnd(runId, 150_000)
		assert.equal(info.status, "ended")
		assert.ok(info.problem?.startsWith(PROBLEM_START), "the run carries the problem it was started with")
		assert.equal(info.tasks.failed, 0)

		const results = (await (await fetch(`${base}/api/runs/${encodeURIComponent(runId)}/results`)).json()) as {
			needs: Array<{ challengeId: string; sector: string }>
			proposals: Array<{ title: string; pairId: string }>
		}
		assert.deepEqual(
			results.needs.map((need) => need.challengeId),
			["C999-CH1"],
		)
		assert.equal(results.needs[0].sector, "Renewable energy")
		assert.ok(results.proposals.length >= 1, "at least one proposal passed the Critic")

		await page.goto(`${base}/#/runs/${encodeURIComponent(runId)}/results`)
		await page.getByText(results.proposals[0].title).first().waitFor()
		await page.getByText("C999-CH1").first().waitFor()
	})

	test("the Runs screen marks it as a reverse search and shows the problem", async () => {
		assert.ok(runId)
		await page.goto(`${base}/`)
		await page.getByRole("tab", { name: /Mock/ }).click()
		const row = page.locator(`a[href="#/runs/${encodeURIComponent(runId)}"]`)
		await row.getByText("Reverse search").waitFor()
		await row.getByText(new RegExp(`^${PROBLEM_START}`)).waitFor()
	})
})
