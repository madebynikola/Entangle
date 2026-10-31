import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { rmSync } from "node:fs"
import { resolve } from "node:path"
import { after, before, describe, test } from "node:test"
import { chromium, type Browser, type Page } from "playwright"
import type { DatasetInfo, RunInfo } from "../../src/server/api"

// Run: npm run test:web   (the first time on a machine: npx playwright install chromium)
//
// Your own data, the way a person brings it: the New run screen, "Add your own data" with a CSV of researchers and a
// JSON of companies whose ids are not the dataset's, then a mock run on one of those companies. It checks that the
// upload got the dataset's id shapes, that the run read the upload and not the EINSTEIN data, and that the Runs
// screen says so. No API key and no network beyond localhost.

const ROOT = resolve(import.meta.dirname, "../..")
const NAME = `E2E lab ${Date.now()}`

const RESEARCHERS = [
	"id,name,title,faculty,fields,keywords,bio",
	'jdoe,Jane Doe,Associate Professor,Faculty of Engineering,"Control Engineering; Robotics","model predictive control; drones; wind gusts","Jane works on drones that hold their line in wind."',
	'mili,Milica Ilić,Assistant Professor,Faculty of Sciences,Electrochemistry,"lithium batteries; cold temperature; battery heating","Milica studies how batteries lose capacity in the cold."',
].join("\n")

const COMPANIES = JSON.stringify({
	companies: [
		{
			id: "ACME",
			name: "Acme Drones d.o.o.",
			sector: "Drones",
			challenges: [{ text: "Our drone batteries lose half their capacity in winter flights.", detail: "We fly at -15 °C. Insulating the packs did not help." }],
		},
	],
})

let server: ChildProcess | undefined
let browser: Browser | undefined
let page: Page
let base = ""
let datasetId: string | undefined
let runId: string | undefined

function startServer(): Promise<string> {
	return new Promise((resolveUrl, reject) => {
		const child = spawn(process.execPath, ["--import", "tsx", "src/server/main.ts", "dev", "--no-open", "--port", "4620"], {
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

async function get<T>(path: string): Promise<T> {
	const response = await fetch(`${base}${path}`)
	assert.ok(response.ok, `GET ${path}: ${response.status}`)
	return (await response.json()) as T
}

describe("web app: a run on your own data from the New run screen", { timeout: 240_000 }, () => {
	before(async () => {
		base = await startServer()
		browser = await chromium.launch()
		page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
		page.setDefaultTimeout(30_000)
	})

	after(async () => {
		await browser?.close()
		if (datasetId) await fetch(`${base}/api/datasets/${datasetId}`, { method: "DELETE" }).catch(() => {})
		server?.kill()
		if (runId) rmSync(resolve(ROOT, "out", runId), { recursive: true, force: true })
	})

	test("the upload reads a CSV and a JSON, and gives their ids the dataset's shape", async () => {
		await page.goto(`${base}/#/new?mode=companies`)
		await page.getByRole("button", { name: "Add your own data" }).click()
		const dialog = page.getByRole("dialog", { name: "Add your own data" })
		await dialog.getByLabel("Name").fill(NAME)
		await dialog.getByLabel("Choose files").setInputFiles([
			{ name: "researchers.csv", mimeType: "text/csv", buffer: Buffer.from(RESEARCHERS) },
			{ name: "companies.json", mimeType: "application/json", buffer: Buffer.from(COMPANIES) },
		])
		await dialog.getByText("Researchers", { exact: true }).waitFor()
		await dialog.getByRole("button", { name: "Add data" }).click()
		await dialog.waitFor({ state: "hidden" })

		const datasets = await get<DatasetInfo[]>("/api/datasets")
		const upload = datasets.find((d) => d.name === NAME)
		assert.ok(upload, "the upload is listed")
		datasetId = upload.id
		assert.equal(upload.kind, "upload")
		assert.equal(upload.counts.researchers, 2)
		assert.equal(upload.counts.challenges, 1)
		assert.deepEqual(upload.renamed, { jdoe: "R0001", mili: "R0002", ACME: "C001" })

		// The new data is selected, and its one company is ticked.
		await page.getByRole("radio", { name: new RegExp(NAME) }).and(page.locator("[aria-checked=true]")).waitFor()
		await page.getByRole("checkbox", { name: /Acme Drones/ }).and(page.locator("[aria-checked=true]")).waitFor()
	})

	test("a mock run on the upload's company reads the upload and ends with its own records", async () => {
		await page.getByRole("button", { name: "Start the run" }).click()
		await page.waitForURL(/#\/runs\/[^/]+\/stage/)
		runId = decodeURIComponent(page.url().match(/#\/runs\/([^/]+)\/stage/)![1])
		assert.match(runId, /-mock$/)

		const deadline = Date.now() + 150_000
		let info: RunInfo
		for (;;) {
			info = await get<RunInfo>(`/api/runs/${encodeURIComponent(runId)}`)
			if (info.status !== "live") break
			assert.ok(Date.now() < deadline, "the run ends within 150 s")
			await new Promise((done) => setTimeout(done, 1000))
		}
		assert.equal(info.status, "ended")
		assert.equal(info.tasks.failed, 0)
		assert.deepEqual(info.dataset, { kind: "upload", name: NAME })

		const results = await get<{ needs: { challengeId: string; companyId: string }[] }>(`/api/runs/${encodeURIComponent(runId)}/results`)
		assert.deepEqual(
			results.needs.map((need) => need.challengeId),
			["C001-CH1"],
		)
		// R0001 is Jane Doe in this upload, and someone else in the EINSTEIN data: lookups for this run use the upload.
		const source = await get<{ title: string }>(`/api/sources/R0001?run=${encodeURIComponent(runId)}`)
		assert.equal(source.title, "Jane Doe")
	})

	test("the Runs screen marks the run as one on your data", async () => {
		assert.ok(runId)
		await page.goto(`${base}/`)
		await page.getByRole("tab", { name: /Mock/ }).click()
		const row = page.locator(`a[href="#/runs/${encodeURIComponent(runId)}"]`)
		await row.getByText(NAME).waitFor()
	})
})
