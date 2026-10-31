/**
 * Records the demo and pitch video: drives the web app in headless Chromium and writes an MP4.
 *
 *   npm run demo:record                       out/tmp/demo/entangle-demo.mp4
 *   npm run demo:record -- --keep-frames      keep the captured JPEG frames next to the video
 *   npm run demo:record -- --out PATH         write the video elsewhere
 *
 * Needs ffmpeg on PATH and Chromium for Playwright (`npx playwright install chromium`). No API key: it replays the two
 * committed runs, out/reverse-search/ and out/golden/. The storyboard and the voice-over are in docs/demo/storyboard.md.
 *
 * The app runs in an iframe inside scripts/demo/director.html, the camera: it frames the app as a floating window,
 * zooms into the moment that matters, blurs between scenes and lays titles, captions and a cursor over it.
 * The app itself is not changed.
 *
 * How it records: Chrome's screencast sends a JPEG each time the page paints, with its time. The frames are joined
 * with those times and resampled to 30 fps, so the video keeps the real pace.
 *
 * Honest by design: "Find researchers" opens the committed reverse search instead of a new run, and the caption on
 * the Stage says it is that run replayed. Approve is answered in the browser and never writes to out/.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { chromium, type FrameLocator, type Locator, type Page } from "playwright"

const ROOT = resolve(import.meta.dirname, "../..")
const OUT = resolve(ROOT, "out/tmp/demo")
const KEEP = ["reverse-search", "golden"]
/** CSS px of the window; Chrome renders it at 4/3, so frames are 1920×1080. */
const VIEW = { width: 1440, height: 810 }
const SCALE = 4 / 3
const FPS = 30
/** The committed reverse search: 311.7 s of run time. */
const RS_MS = 311_730

const { values } = parseArgs({
	options: {
		"keep-frames": { type: "boolean", default: false },
		port: { type: "string", default: "4640" },
		from: { type: "string", default: "0" },
		out: { type: "string" },
	},
})
const output = resolve(values.out ?? join(OUT, "entangle-demo.mp4"))
const frameDir = join(OUT, "frames")
const PROBLEM = (JSON.parse(readFileSync(resolve(ROOT, "out/reverse-search/problem.json"), "utf8")) as { text: string }).text

// ---------------------------------------------------------------------------------------------------------------
// Server

let server: ChildProcess | undefined

function startServer(port: string): Promise<string> {
	return new Promise((done, fail) => {
		const child = spawn(process.execPath, ["--import", "tsx", "src/server/main.ts", "dev", "--no-open", "--port", port], {
			cwd: ROOT,
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
			stdio: ["ignore", "pipe", "pipe"],
		})
		server = child
		let log = ""
		const timer = setTimeout(() => fail(new Error(`The server did not start within 60 s.\n${log}`)), 60_000)
		const onData = (chunk: Buffer) => {
			log += chunk.toString()
			const match = log.match(/http:\/\/localhost:(\d+)\//)
			if (!match) return
			clearTimeout(timer)
			done(`http://localhost:${match[1]}`)
		}
		child.stdout!.on("data", onData)
		child.stderr!.on("data", onData)
		child.on("exit", (code) => fail(new Error(`The server exited with code ${code}.\n${log}`)))
	})
}

// ---------------------------------------------------------------------------------------------------------------
// Directing

type Rect = { x: number; y: number; w: number; h: number }
type Shot = "full" | "frame" | "tilt" | { rect: Rect; pad?: number; max?: number; min?: number; lift?: number }

let page: Page
let app: FrameLocator
let base = ""
let mouse = { x: VIEW.width / 2, y: VIEW.height / 2 }

const wait = (ms: number) => page.waitForTimeout(ms)

/** Call `window.director[name](...args)` in the director page. */
function dir<T = void>(name: string, ...args: unknown[]): Promise<T> {
	return page.evaluate(([name, args]) => (window as any).director[name](...args), [name, args] as const) as Promise<T>
}

const camera = (shot: Shot, ms = 1100) => dir("camera", shot, ms)
const blur = (mode: "blur" | "soft" | "none", ms = 420) => dir("blur", mode, ms)
const caption = (kicker: string | null, html: string | null) => dir("caption", kicker, html)

async function title(spec: { kicker?: string; lines?: string[]; small?: boolean; sub?: string; code?: string; lockup?: boolean }, hold: number, keep = false) {
	await dir("title", spec)
	await wait(hold)
	if (!keep) await dir("untitle")
}

/** The box of an element in the app, in app px. */
async function rect(target: Locator): Promise<Rect> {
	await target.waitFor({ state: "visible" })
	return target.evaluate((el) => {
		const r = el.getBoundingClientRect()
		return { x: r.x, y: r.y, w: r.width, h: r.height }
	})
}

/** The smallest box around several elements, in app px. */
async function around(...targets: Locator[]): Promise<Rect> {
	const boxes = await Promise.all(targets.map(rect))
	const x = Math.min(...boxes.map((b) => b.x))
	const y = Math.min(...boxes.map((b) => b.y))
	const r = Math.max(...boxes.map((b) => b.x + b.w))
	const b = Math.max(...boxes.map((b) => b.y + b.h))
	return { x, y, w: r - x, h: b - y }
}

async function screenOf(target: Locator) {
	const box = await rect(target)
	return dir<{ x: number; y: number }>("toScreen", box.x + box.w / 2, box.y + box.h / 2)
}

/** Move the cursor with an ease, the way a hand moves a mouse. */
async function glide(x: number, y: number, ms = 700) {
	const from = { ...mouse }
	const steps = Math.max(8, Math.round(ms / 20))
	for (let i = 1; i <= steps; i++) {
		const t = i / steps
		const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
		const p = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e }
		await page.mouse.move(p.x, p.y)
		await dir("cursor", p.x, p.y)
	}
	mouse = { x, y }
}

async function hover(target: Locator, ms = 700) {
	const { x, y } = await screenOf(target)
	await glide(x, y, ms)
}

async function click(target: Locator, ms = 700) {
	await hover(target, ms)
	await wait(140)
	await dir("press", true)
	await page.mouse.down()
	await wait(110)
	await page.mouse.up()
	await dir("press", false)
}

/** A click nobody sees: for cuts, while the stage is blurred. */
async function quietClick(x: number, y: number) {
	await page.mouse.click(x, y)
	mouse = { x, y }
	await dir("cursor", x, y)
}

/** Go to a route of the app without a reload (hash routing). */
async function route(hash: string) {
	await app.locator("body").evaluate((_, hash) => {
		window.location.hash = hash
	}, hash)
}

/** Seek the replay to `ms` of run time with a click on the scrubber. Call it with the camera on "full". */
async function seek(ms: number, total: number) {
	const track = await rect(app.locator('[aria-label="Playhead"]').first())
	await quietClick(track.x + (track.w * ms) / total, track.y + track.h / 2)
}

/** Blur, change what is under the blur, unblur. */
async function cut(change: () => Promise<void>, ms = 380) {
	await dir("showCursor", false)
	await blur("blur", ms)
	await change()
	await blur("none", ms + 80)
}

async function untilSplashEnds() {
	await app.getByRole("status", { name: "Loading Entangle" }).waitFor({ state: "hidden", timeout: 30_000 })
}

// ---------------------------------------------------------------------------------------------------------------
// The story

const face = (role: string) => app.getByRole("main").getByText(role, { exact: true }).first()
const bus = () => app.getByRole("main").getByText("event bus", { exact: true })

/** 0. The app's own splash, full screen */
async function scene0() {
	await dir("load", `${base}/#/`)
	await untilSplashEnds()
	await wait(250)
}

/** 1. The problem */
async function scene1() {
	await blur("blur", 600)
	await title({ kicker: "The EINSTEIN challenge", lines: ["{1047} researchers.", "{153} companies."] }, 2300)
	await title({ lines: ["Which researcher can solve", "which company's *problem?*"] }, 2200)
	await title({ lines: ["7 million tokens.", "Too much for *one* model."], small: false }, 2000)
	await title({ lockup: true, sub: "So we built a team of agents that reads it together, cites every claim, and asks a person before anyone is contacted." }, 3200)
}

/** 2. A company describes its problem */
async function scene2() {
	await camera("tilt", 0)
	await blur("none", 700)
	await camera("frame", 1500)
	await caption("Reverse search", "A company describes <b>one problem</b> in its own words.")
	await dir("showCursor", true)
	await click(app.getByRole("button", { name: "Describe a problem" }))
	const dialog = app.getByRole("dialog", { name: "Find researchers for a problem" })
	await dialog.waitFor()
	await wait(350)
	await camera({ rect: await rect(dialog), pad: 0.08, max: 1.55 }, 1100)
	await click(dialog.getByLabel("The problem"))
	await page.keyboard.type(PROBLEM, { delay: 11 })
	await wait(300)
	await click(dialog.getByLabel(/^Sector/), 500)
	await page.keyboard.type("Renewable energy", { delay: 35 })
	const mock = dialog.getByRole("switch", { name: "Run on the mock model" })
	if ((await mock.getAttribute("aria-checked")) === "true" && (await mock.isEnabled())) await click(mock, 500)
	await wait(300)
	await click(dialog.getByRole("button", { name: "Find researchers" }), 600)
	await caption(null, null)
}

/** 3. The team: the real run of that problem, on the Stage */
async function scene3() {
	await app.locator("body").evaluate(() => new Promise((done) => setTimeout(done, 0)))
	const watch = app.getByRole("button", { name: "Watch the replay" })
	await watch.waitFor()
	await dir("showCursor", false)
	await camera("full", 1200)
	await caption("The real run", "This is that problem, run for real: <b>5 minutes</b> on Sonnet 4.6 and Haiku 4.5. Here it is 4× faster.")
	await wait(2600)
	await dir("showCursor", true)
	await click(watch, 800)
	await dir("showCursor", false)
	// Hold the first second while the camera meets the team.
	await app.getByRole("button", { name: "Pause", exact: true }).evaluate((el: HTMLElement) => el.click())
	await caption("The team", "Nine roles, <b>twenty agents</b>, one Mozaik event bus. Each one sees every event.")
	await camera({ rect: await around(face("Industry Analyst"), face("Shortlist"), face("Orchestrator")), pad: 0.35, max: 2 }, 1300)
	await wait(1300)
	await camera({ rect: await around(face("Research Profiler"), face("Critic"), face("Orchestrator")), pad: 0.35, max: 2 }, 1300)
	await wait(1300)
	await camera({ rect: await around(face("Matchmaker"), face("Proposal Writer"), face("Funding Scout"), face("Human approver")), pad: 0.25, max: 2 }, 1300)
	await wait(1400)
}

/** 4. The run, in four moments */
async function scene4() {
	const total = RS_MS
	const moment = async (from: number, shot: Shot, kicker: string, text: string, hold: number) => {
		await cut(async () => {
			await camera("full", 0)
			await seek(from, total)
			await camera(shot, 0)
		})
		await caption(kicker, text)
		await wait(hold)
	}
	await camera("full", 900)
	await app.getByRole("button", { name: "Play", exact: true }).evaluate((el: HTMLElement) => el.click())
	await caption("In parallel", "Libra shortlists six researchers. <b>Six Profilers</b> read them at the same time.")
	await wait(1200)
	await camera({ rect: await around(face("Research Profiler"), bus(), face("Critic")), pad: 0.3, max: 1.9 }, 1400)
	await wait(2600)
	await moment(
		40_000,
		{ rect: await around(face("Critic"), bus(), face("Research Profiler")), pad: 0.3, max: 1.9 },
		"The Critic",
		"Fides checks every claim against the record it cites, and <b>sends back</b> what it cannot find.",
		4200,
	)
	await moment(
		94_000,
		{ rect: await around(face("Matchmaker"), bus(), face("Research Profiler")), pad: 0.2, max: 1.6 },
		"The match",
		"Amity pairs the problem with the researchers who passed, and says <b>why</b> each pair fits.",
		4600,
	)
	await moment(
		158_000,
		{ rect: await around(face("Proposal Writer"), face("Funding Scout"), bus()), pad: 0.25, max: 1.8 },
		"The proposal",
		"Tinta writes the proposal while Ceres finds <b>open EU calls</b> that could fund it.",
		4400,
	)
	await moment(
		292_000,
		{ rect: await around(face("Human approver"), bus(), face("Proposal Writer"), face("Funding Scout")), pad: 0.25, max: 1.7 },
		"Five minutes later",
		"One proposal, sent back twice, now <b>sourced</b>. It waits for a person.",
		5200,
	)
	await caption(null, null)
}

/** 5. Proof: the agents really run at once */
async function scene5() {
	await blur("blur", 500)
	await route(`#/runs/golden/live`)
	await title({ kicker: "Is it really parallel?", lines: ["The reference run:", "*8 companies*, 20 agents, 66 minutes."], small: true }, 2600)
	await camera("frame", 0)
	await blur("none", 600)
	const lanesBox = await rect(app.locator('section[data-slot="pane"]').filter({ hasText: "Agents at work" }).first())
	await camera({ rect: lanesBox, pad: 0.04, max: 1.5 }, 1400)
	await caption("The Timeline", "One row per agent, one bar per model call. <b>Bars that overlap</b> are agents working at the same time.")
	await wait(2600)
	const [zero, half, row] = await Promise.all([
		screenOf(app.getByText("0:00", { exact: true }).first()),
		screenOf(app.getByText("30:00", { exact: true }).first()),
		screenOf(app.getByText("profiler-3", { exact: true }).first()),
	])
	await dir("showCursor", true)
	await glide(zero.x - 4, row.y, 700)
	await dir("press", true)
	await page.mouse.down()
	await glide(zero.x + (half.x - zero.x) * 0.9, row.y + 60, 1300)
	await page.mouse.up()
	await dir("press", false)
	await dir("showCursor", false)
	await wait(500)
	const profilers = await around(app.getByText("profiler-1", { exact: true }).first(), app.getByText("writer-3", { exact: true }).first())
	await camera({ rect: { x: profilers.x, y: profilers.y - 10, w: lanesBox.x + lanesBox.w - profilers.x, h: profilers.h + 20 }, pad: 0.04, max: 1.9 }, 1500)
	await caption("The first 27 minutes", "Profilers, the Matchmaker, Writers and the Critic, <b>all in flight together</b>.")
	await wait(3600)
	await caption(null, null)
}

/** 6. Trust: every claim has a source */
async function scene6() {
	await blur("blur", 500)
	await route(`#/runs/reverse-search/results/proposals/C999-CH1-R0822`)
	await title({ kicker: "No source, no claim", lines: ["In the reference run the Critic", "rejected *{483}* claims."], small: true, sub: "Every fact that reaches a proposal cites the record it comes from." }, 3000)
	await camera("frame", 0)
	await blur("none", 600)
	const reader = app.getByRole("main")
	const head = reader.getByRole("heading", { name: /Adaptive Threshold/ }).first()
	const chips = reader.getByText(/Passed review after/).first()
	await camera({ rect: await around(head, chips), pad: 0.25, max: 2 }, 1300)
	await caption("The proposal", "Passed the Critic after two fixes, with <b>two EU calls</b> that fit.")
	await wait(2400)
	const chip = reader.getByRole("button", { name: /C999-CH1/ }).first()
	await camera({ rect: await around(reader.getByRole("heading", { name: "The problem" }).first(), chip), pad: 0.3, max: 2 }, 1200)
	await dir("showCursor", true)
	await click(chip, 700)
	await wait(400)
	const sheet = app.getByRole("dialog").first()
	if (await sheet.isVisible().catch(() => false)) await camera({ rect: await rect(sheet), pad: 0.1, max: 1.6 }, 1000)
	await caption("Sources", "Click any source to read <b>the record itself</b>.")
	await wait(2800)
	await page.keyboard.press("Escape")
	await dir("showCursor", false)
	await camera("full", 900)
	await caption(null, null)
	const review = app.getByRole("tab", { name: /^Critic review/ })
	await dir("showCursor", true)
	await click(review, 700)
	await wait(400)
	const struck = reader.locator(".line-through").first()
	const reviewBox = await around(struck, reader.getByText(/^critic:/).first()).catch(() => rect(struck))
	await dir("showCursor", false)
	await camera({ rect: reviewBox, pad: 0.25, max: 2 }, 1200)
	await caption("The review", "What the Critic struck out, and <b>why</b>: here, a detail the company never wrote.")
	await wait(3600)
	await caption(null, null)
}

/** 7. A person decides */
async function scene7() {
	const approve = app.getByRole("button", { name: "Approve", exact: true })
	const head = app.getByRole("main").getByRole("heading", { name: /Adaptive Threshold/ }).first()
	await camera({ rect: await around(head, approve), pad: 0.2, max: 1.8 }, 1200)
	await caption("A person decides", "Nobody is contacted until a coordinator <b>approves the pair</b>.")
	await dir("showCursor", true)
	await wait(900)
	await click(approve, 900)
	await wait(2400)
	await dir("showCursor", false)
	await caption(null, null)
}

/** 8. Close */
async function scene8() {
	await camera("frame", 1200)
	await blur("blur", 600)
	await title(
		{
			lockup: true,
			lines: ["Sourced matches.", "Approved by *people.*"],
			small: true,
			code: "npm install &amp;&amp; npm run replay -- out/golden",
			sub: "No keys needed: the repo holds both runs, with every trace.",
		},
		5200,
		true,
	)
	await wait(400)
}

const SCENES = [scene0, scene1, scene2, scene3, scene4, scene5, scene6, scene7, scene8]

/** Where each scene starts, when the recording starts there (`--from N`). */
async function setUp(from: number) {
	await dir("load", `${base}/#/`)
	await untilSplashEnds()
	await camera("full", 0)
	if (from === 3 || from === 4) await route("#/runs/reverse-search/stage")
	if (from === 4) {
		await app.getByRole("button", { name: "Watch the replay" }).evaluate((el: HTMLElement) => el.click())
		await app.getByRole("button", { name: "Pause", exact: true }).evaluate((el: HTMLElement) => el.click())
	}
	if (from === 7) await route("#/runs/reverse-search/results/proposals/C999-CH1-R0822")
	await wait(800)
}

async function story(from: number) {
	if (from > 0) await setUp(from)
	for (const scene of SCENES.slice(from)) await scene()
}

// ---------------------------------------------------------------------------------------------------------------
// Capture and encode

async function main() {
	if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("ffmpeg is not on PATH. Install it (brew install ffmpeg) and run again.")
	rmSync(frameDir, { recursive: true, force: true })
	mkdirSync(frameDir, { recursive: true })

	base = await startServer(values.port!)
	// The scale comes from a Chrome flag, not from Playwright's emulation: only then does the screencast send device
	// pixels (1920×1080) instead of CSS pixels.
	const browser = await chromium.launch({
		args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.width},${VIEW.height}`],
	})
	const context = await browser.newContext({ viewport: null, colorScheme: "light" })
	page = await context.newPage()
	page.setDefaultTimeout(30_000)
	app = page.frameLocator("#app")

	// tsx compiles named inner functions with an `__name` helper that the page does not have.
	await context.addInitScript({ content: "globalThis.__name = (f) => f" })
	await context.addInitScript(() => {
		try {
			localStorage.setItem("entangle.theme", "light")
		} catch {}
		// No toasts: "Reverse search started" would say a run started when this is a replay.
		document.addEventListener("DOMContentLoaded", () => {
			const style = document.createElement("style")
			style.textContent = "[data-sonner-toaster] { display: none !important; }"
			document.head.append(style)
		})
	})

	// The director page, its fonts and the lockup.
	const fonts = resolve(ROOT, "node_modules/@fontsource-variable")
	await page.route("**/__demo/**", (req) => {
		const path = new URL(req.request().url()).pathname
		if (path === "/__demo/director") return req.fulfill({ contentType: "text/html", body: readFileSync(resolve(import.meta.dirname, "director.html")) })
		if (path === "/__demo/lockup.svg") return req.fulfill({ contentType: "image/svg+xml", body: readFileSync(resolve(ROOT, "docs/brand/entangle-lockup-animated-light.svg")) })
		const font = path.match(/^\/__demo\/fonts\/((inter|source-serif-4)-[\w-]+\.woff2)$/)
		if (font) return req.fulfill({ contentType: "font/woff2", body: readFileSync(join(fonts, font[2] === "inter" ? "inter" : "source-serif-4", "files", font[1])) })
		return req.fulfill({ status: 404 })
	})
	// Only the two committed runs in the list; "Find researchers" opens the committed reverse search.
	await page.route("**/api/runs", async (req) => {
		try {
			if (req.request().method() === "POST") return await req.fulfill({ json: { runId: "reverse-search" } })
			const response = await req.fetch()
			const runs = (await response.json()) as { id: string }[]
			await req.fulfill({ response, json: runs.filter((run) => KEEP.includes(run.id)) })
		} catch {
			await req.abort().catch(() => {})
		}
	})
	// Approve answers as the server would, without writing approvals.json.
	await page.route("**/api/runs/*/approvals", async (req) => {
		if (req.request().method() !== "POST") return req.fulfill({ json: {} })
		const body = req.request().postDataJSON() as { pairId: string; decision: string | null; note?: string }
		const approvals = body.decision ? { [body.pairId]: { pairId: body.pairId, decision: body.decision, decidedAt: new Date().toISOString() } } : {}
		return req.fulfill({ json: approvals })
	})

	// Warm up before recording: the dev server builds each screen on its first visit.
	await page.goto(`${base}/__demo/director`)
	await dir("load", `${base}/#/`)
	for (const hash of ["#/", "#/runs/reverse-search/stage", "#/runs/reverse-search/results", "#/runs/golden/live", "#/runs/golden/results", "#/"]) {
		await route(hash)
		const ready = hash === "#/" ? app.getByRole("button", { name: "Describe a problem" }) : app.getByRole("link", { name: "Timeline", exact: true })
		await ready.first().waitFor({ timeout: 120_000 })
		await wait(1200)
	}
	await page.goto(`${base}/__demo/director`)
	await page.evaluate(() => document.fonts.ready)

	const frames: { file: string; at: number }[] = []
	const cdp = await context.newCDPSession(page)
	cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
		const file = join(frameDir, `${String(frames.length).padStart(6, "0")}.jpg`)
		writeFileSync(file, Buffer.from(data, "base64"))
		frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 })
		void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
	})
	await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 })

	try {
		await story(Number(values.from))
	} finally {
		await cdp.send("Page.stopScreencast").catch(() => {})
		const end = Date.now() / 1000
		await browser.close()
		server?.kill()
		if (frames.length > 1) encode(frames, end)
		if (!values["keep-frames"]) rmSync(frameDir, { recursive: true, force: true })
	}
}

function encode(frames: { file: string; at: number }[], end: number) {
	const list = frames
		.map((frame, i) => `file '${frame.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.at ?? end) - frame.at).toFixed(4)}`)
		.join("\n")
	const listFile = join(frameDir, "frames.txt")
	writeFileSync(listFile, `${list}\nfile '${frames.at(-1)!.file}'\n`)
	mkdirSync(resolve(output, ".."), { recursive: true })
	const result = spawnSync(
		"ffmpeg",
		[
			"-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
			"-vf", `fps=${FPS},scale=1920:1080:flags=lanczos,format=yuv420p`,
			"-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", output,
		],
		{ stdio: "inherit" },
	)
	if (result.status !== 0) throw new Error("ffmpeg failed")
	const seconds = end - frames[0].at
	console.log(`${output}  ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}  ${frames.length} frames`)
}

main().catch((error) => {
	console.error(error)
	server?.kill()
	process.exitCode = 1
})
