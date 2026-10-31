/**
 * Records the demo video: drives the web app through the story in headless Chromium and writes an MP4.
 *
 *   npm run demo:record                       out/tmp/demo/entangle-demo.mp4
 *   npm run demo:record -- --theme dark       the same in the dark theme
 *   npm run demo:record -- --keep-frames      keep the captured JPEG frames next to the video
 *
 * Needs ffmpeg on PATH and Chromium for Playwright (`npx playwright install chromium`). No API key: it replays the two
 * committed runs, out/reverse-search/ and out/golden/. The storyboard and the voice-over are in docs/demo/storyboard.md.
 *
 * How it records: Chrome's screencast sends a JPEG each time the page paints, with its time. The frames are joined
 * with those times and resampled to 30 fps, so the video keeps the app's real pace. Captions, the chapter cards and
 * the cursor are a layer the script adds over the app; the app itself is not changed.
 *
 * Honest by design: "Describe a problem" is answered with the committed reverse search instead of a new run, and the
 * caption on the Stage says so. The Runs list shows only the two committed runs.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { chromium, type Locator, type Page } from "playwright"

const ROOT = resolve(import.meta.dirname, "../..")
const OUT = resolve(ROOT, "out/tmp/demo")
const KEEP = ["reverse-search", "golden"]
/** CSS px. With a scale of 4/3 the frames are 1920×1080. */
const VIEW = { width: 1440, height: 810 }
const SCALE = 4 / 3
const FPS = 30

const { values } = parseArgs({
	options: {
		theme: { type: "string", default: "light" },
		"keep-frames": { type: "boolean", default: false },
		port: { type: "string", default: "4640" },
		out: { type: "string" },
	},
})
const theme = values.theme === "dark" ? "dark" : "light"
const output = resolve(values.out ?? join(OUT, theme === "dark" ? "entangle-demo-dark.mp4" : "entangle-demo.mp4"))
const frameDir = join(OUT, `frames-${theme}`)

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
// The layer over the app: captions, chapter cards, cursor

/** Runs in the page, before the app. Adds `window.demo` with caption(), card() and the cursor. */
function overlay({ lockup, theme }: { lockup: string; theme: string }) {
	const dark = theme === "dark"
	const css = `
		#demo-layer { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: "Inter Variable", Inter, system-ui, sans-serif; }
		#demo-caption { position: absolute; left: 50%; bottom: 92px; transform: translate(-50%, 8px); max-width: 860px; padding: 12px 20px;
			border-radius: 14px; font-size: 19px; line-height: 1.45; letter-spacing: -0.01em; text-align: center; opacity: 0;
			transition: opacity 380ms ease, transform 380ms ease; backdrop-filter: blur(12px);
			background: ${dark ? "rgba(24,24,27,0.92)" : "rgba(255,255,255,0.94)"}; color: ${dark ? "#fafafa" : "#18181b"};
			box-shadow: 0 0 0 1px ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}, 0 12px 32px ${dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.12)"}; }
		#demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
		#demo-caption b { font-weight: 600; }
		#demo-card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px;
			background: ${dark ? "#09090b" : "#fafafa"}; color: ${dark ? "#fafafa" : "#18181b"}; opacity: 0; transition: opacity 520ms ease; }
		#demo-card.on { opacity: 1; }
		#demo-card .lockup img { display: block; width: 420px; height: auto; }
		[data-sonner-toaster] { display: none !important; }
		#demo-caption.top { top: 22px; bottom: auto; transform: translate(-50%, -8px); }
		#demo-caption.top.on { transform: translate(-50%, 0); }
		#demo-card h1 { margin: 0; max-width: 900px; text-align: center; font-family: "Source Serif 4 Variable", "Source Serif 4", Georgia, serif;
			font-weight: 500; font-size: 40px; line-height: 1.2; letter-spacing: -0.02em; }
		#demo-card p { margin: 0; max-width: 760px; text-align: center; font-size: 19px; line-height: 1.5; color: ${dark ? "#a1a1aa" : "#52525b"}; }
		#demo-card code { font-family: inherit; font-size: 17px; padding: 6px 12px; border-radius: 8px;
			background: ${dark ? "#18181b" : "#f0f0f2"}; color: ${dark ? "#fafafa" : "#18181b"}; }
		#demo-cursor { position: absolute; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
			background: ${dark ? "rgba(250,250,250,0.9)" : "rgba(24,24,27,0.85)"}; box-shadow: 0 0 0 3px ${dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.8)"};
			opacity: 0; transition: opacity 200ms ease, scale 160ms ease; }
		#demo-cursor.on { opacity: 1; }
		#demo-cursor.down { scale: 0.7; }
	`
	const install = () => {
		if (document.getElementById("demo-layer")) return
		const style = document.createElement("style")
		style.textContent = css
		document.head.append(style)
		const layer = document.createElement("div")
		layer.id = "demo-layer"
		layer.innerHTML = `<div id="demo-caption"></div><div id="demo-card"></div><div id="demo-cursor"></div>`
		document.body.append(layer)
		const cursor = layer.querySelector<HTMLElement>("#demo-cursor")!
		window.addEventListener("mousemove", (event) => {
			cursor.style.translate = `${event.clientX}px ${event.clientY}px`
		}, true)
		window.addEventListener("mousedown", () => cursor.classList.add("down"), true)
		window.addEventListener("mouseup", () => cursor.classList.remove("down"), true)
	}
	const caption = layerPart("demo-caption")
	const card = layerPart("demo-card")
	function layerPart(id: string) {
		return () => document.getElementById(id)!
	}
	;(window as unknown as { demo: unknown }).demo = {
		install,
		caption(html: string | null) {
			const el = caption()
			if (!html) return el.classList.remove("on")
			if (el.classList.contains("on") && el.innerHTML !== html) {
				el.classList.remove("on")
				setTimeout(() => {
					el.innerHTML = html
					el.classList.add("on")
				}, 260)
			} else {
				el.innerHTML = html
				el.classList.add("on")
			}
		},
		card(spec: { lockup?: boolean; title?: string; text?: string; code?: string } | null) {
			const el = card()
			if (!spec) return el.classList.remove("on")
			el.innerHTML = [
				spec.lockup ? `<div class="lockup"><img alt="" src="${lockup}"></div>` : "",
				spec.title ? `<h1>${spec.title}</h1>` : "",
				spec.text ? `<p>${spec.text}</p>` : "",
				spec.code ? `<code>${spec.code}</code>` : "",
			].join("")
			el.classList.add("on")
		},
		cursor(on: boolean) {
			document.getElementById("demo-cursor")!.classList.toggle("on", on)
		},
		place(at: "top" | "bottom") {
			caption().classList.toggle("top", at === "top")
		},
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install)
	else install()
}

interface Demo {
	install(): void
	caption(html: string | null): void
	card(spec: { lockup?: boolean; title?: string; text?: string; code?: string } | null): void
	cursor(on: boolean): void
	/** Top on the Stage, where a caption at the bottom would cover the faces. */
	place(at: "top" | "bottom"): void
}

// ---------------------------------------------------------------------------------------------------------------
// Directing

let page: Page
let mouse = { x: VIEW.width / 2, y: VIEW.height / 2 }

const wait = (ms: number) => page.waitForTimeout(ms)
const demo = <K extends keyof Demo>(name: K, ...args: Parameters<Demo[K]>) =>
	page.evaluate(([name, args]) => (window as unknown as { demo: Record<string, (...a: unknown[]) => void> }).demo[name](...args), [
		name,
		args,
	] as const)

async function caption(html: string | null, hold = 0) {
	await demo("caption", html)
	if (hold) await wait(hold)
}

async function card(spec: Parameters<Demo["card"]>[0], hold = 0) {
	await demo("card", spec)
	if (hold) await wait(hold)
}

/** Move the cursor with an ease, the way a hand moves a mouse. */
async function glide(x: number, y: number, ms = 650) {
	const from = { ...mouse }
	const steps = Math.max(8, Math.round(ms / 16))
	for (let i = 1; i <= steps; i++) {
		const t = i / steps
		const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
		await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e)
		await wait(16)
	}
	mouse = { x, y }
}

async function center(target: Locator) {
	await target.waitFor({ state: "visible" })
	const box = (await target.boundingBox())!
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function hover(target: Locator, ms = 650) {
	const { x, y } = await center(target)
	await glide(x, y, ms)
}

async function click(target: Locator, ms = 650) {
	await hover(target, ms)
	await wait(180)
	await page.mouse.down()
	await wait(90)
	await page.mouse.up()
}

/** Scroll the element under the cursor smoothly by `dy` px. */
async function scroll(dy: number, ms = 1200) {
	const steps = Math.round(ms / 16)
	for (let i = 0; i < steps; i++) {
		await page.mouse.wheel(0, dy / steps)
		await wait(16)
	}
}

// ---------------------------------------------------------------------------------------------------------------
// The story. Timings are on the wall clock; the Stage replays at 4×, so run time t shows at t / 4.

const TITLE_CARD = {
	lockup: true,
	title: "A team of AI agents that pairs researchers with company problems",
	text: "Built on Mozaik for the EINSTEIN matchmaker track. Every claim is sourced, and a person approves every pair.",
}

/** Starts with the title card already up (see main), so the video opens on it, not on the app. */
async function story() {
	await wait(5200)
	await card(null)
	await demo("cursor", true)

	// 1. The problem
	await caption(
		"EINSTEIN holds <b>1,047 researchers</b> and <b>153 companies</b>: about 7 million tokens, too much for one model to read. So Entangle splits the work across agents that run at the same time.",
		6500,
	)
	await caption("A company that is not in the dataset can describe one problem in its own words.")
	await click(page.getByRole("button", { name: "Describe a problem" }))
	const dialog = page.getByRole("dialog", { name: "Find researchers for a problem" })
	await dialog.waitFor()
	await wait(700)
	await click(dialog.getByRole("button", { name: "Use an example" }))
	await wait(1200)
	await click(dialog.getByLabel(/^Sector/))
	await page.keyboard.type("Renewable energy", { delay: 55 })
	await wait(500)
	const mock = dialog.getByRole("switch", { name: "Run on the mock model" })
	if ((await mock.getAttribute("aria-checked")) === "true" && (await mock.isEnabled())) await click(mock)
	await wait(900)
	await click(dialog.getByRole("button", { name: "Find researchers" }))
	await page.waitForURL(/#\/runs\/reverse-search\/stage/)
	await caption(null)
	await glide(VIEW.width - 260, 150, 700)

	// 2. The Stage: the real run of that problem
	const watch = page.getByRole("button", { name: "Watch the replay" })
	await watch.waitFor()
	await caption("This is the real run of that problem: <b>5 minutes</b> on Sonnet 4.6 and Haiku 4.5, replayed <b>4× faster</b>.", 3800)
	await caption(null, 400)
	await click(watch)
	await demo("place", "top")
	await glide(VIEW.width - 120, VIEW.height - 40, 900)
	const started = Date.now()
	const at = async (runSeconds: number) => {
		const ms = (runSeconds * 1000) / 4 - (Date.now() - started)
		if (ms > 0) await wait(ms)
	}
	const cues: [number, string][] = [
		[0, "Each face is a role. Every event goes over the <b>Mozaik event bus</b> in the middle, and every agent sees it."],
		[9, "Libra shortlists 6 researchers from the dataset index, and <b>six Profilers</b> read them at the same time."],
		[40, "Fides, the <b>Critic</b>, checks each claim against the record it cites. A claim it cannot find goes back to its author."],
		[96, "Amity, the Matchmaker, pairs the problem with the profiles that passed, and says why each pair fits."],
		[162, "Ceres scouts <b>open EU calls</b> for the pair, while Tinta writes the proposal with prior work from OpenAlex."],
		[240, "The Critic sent the proposal back <b>twice</b> before every claim had a source."],
		[306, "Done: one proposal and two researchers, waiting for a person to approve."],
	]
	for (const [t, text] of cues) {
		await at(t)
		await caption(text)
	}
	await at(318)
	await wait(1500)
	await caption(null, 400)
	await demo("place", "bottom")

	// 3. The result: the proposal, its sources and its review
	await click(page.getByRole("link", { name: /^Results/ }))
	await caption("The proposal. Every sentence that states a fact cites the dataset record it comes from.", 1200)
	const body = page.getByRole("main").getByRole("heading", { name: "The problem" })
	await hover(body)
	await wait(1600)
	const chip = page.getByRole("main").getByRole("button", { name: /C999-CH1/ }).first()
	if (await chip.isVisible().catch(() => false)) {
		await click(chip)
		await caption("Click a source to read the record itself.", 3200)
		await page.keyboard.press("Escape")
		await wait(500)
	}
	await hover(body)
	await scroll(900, 2400)
	await wait(1400)
	await caption("Each proposal ends with the EU calls that fit the pair and the EU projects on the same problem.")
	await scroll(2600, 4200)
	await wait(1800)
	await click(page.getByRole("tab", { name: /^Critic review/ }))
	await caption("The Critic's review: what it sent back, and why.", 4200)
	await hover(page.getByRole("button", { name: "Approve" }), 900)
	await caption("Nobody is contacted until a person <b>approves the pair</b>.", 3800)
	await caption(null)

	// 4. The Timeline: the agents really run at once
	await click(page.getByRole("link", { name: /^golden/ }))
	await page.waitForURL(/#\/runs\/golden/)
	await click(page.getByRole("link", { name: "Timeline", exact: true }))
	await caption(
		"The reference run: <b>8 companies</b>, 20 agents, 66 minutes. One row per agent, one bar per model call. Bars that overlap are agents working at the same time.",
	)
	await wait(4800)
	const zero = page.getByText("0:00", { exact: true }).first()
	const half = page.getByText("30:00", { exact: true }).first()
	const lane = page.getByText("profiler-3", { exact: true }).first()
	const [from, to, row] = await Promise.all([center(zero), center(half), center(lane)])
	await glide(from.x - 6, row.y, 800)
	await page.mouse.down()
	await glide(from.x + (to.x - from.x) * 0.9, row.y + 40, 1400)
	await page.mouse.up()
	await caption("Zoomed to the first 27 minutes: Analysts, Profilers, the Matchmaker, Writers and the Critic, all in flight together.", 5200)
	await caption(null)
	await click(page.getByRole("link", { name: /^Results/ }))
	await caption("Seven proposals from that run, each with its fit, its review and its EU calls.", 4600)
	await caption(null)
	await demo("cursor", false)

	// 5. End card
	await card({
		lockup: true,
		title: "Try it with no keys",
		text: "The repo holds both runs, with their full traces. Clone it and replay them in the app.",
		code: "npm install &amp;&amp; npm run replay -- out/golden",
	})
	await wait(6500)
}

// ---------------------------------------------------------------------------------------------------------------
// Capture and encode

async function main() {
	if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("ffmpeg is not on PATH. Install it (brew install ffmpeg) and run again.")
	rmSync(frameDir, { recursive: true, force: true })
	mkdirSync(frameDir, { recursive: true })

	const base = await startServer(values.port!)
	// The scale comes from a Chrome flag, not from Playwright's emulation: only then does the screencast send device
	// pixels (1920×1080) instead of CSS pixels.
	const browser = await chromium.launch({
		args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.width},${VIEW.height}`],
	})
	const context = await browser.newContext({ viewport: null, colorScheme: theme })
	page = await context.newPage()
	page.setDefaultTimeout(30_000)

	// As an image, not inline: inline, the app's CSS reaches into the SVG and breaks the mark.
	const svg = readFileSync(resolve(ROOT, `docs/brand/entangle-lockup-animated-${theme}.svg`))
	const lockup = `data:image/svg+xml;base64,${svg.toString("base64")}`
	// tsx compiles named inner functions with an `__name` helper that the page does not have.
	await page.addInitScript({ content: "globalThis.__name = (f) => f" })
	await page.addInitScript(overlay, { lockup, theme })
	await page.addInitScript((theme) => {
		try {
			localStorage.setItem("entangle.theme", theme)
		} catch {}
	}, theme)

	// Only the two committed runs in the list; "Find researchers" opens the committed reverse search.
	await page.route("**/api/runs", async (route) => {
		try {
			if (route.request().method() === "POST") return await route.fulfill({ json: { runId: "reverse-search" } })
			const response = await route.fetch()
			const runs = (await response.json()) as { id: string }[]
			await route.fulfill({ response, json: runs.filter((run) => KEEP.includes(run.id)) })
		} catch {
			await route.abort().catch(() => {})
		}
	})
	await page.route("**/api/runs/*/approvals", (route) => route.fulfill({ status: 403, json: { error: "Read-only while recording." } }))

	// Warm up before recording: the dev server builds each screen on its first visit.
	for (const path of ["", "runs/reverse-search/stage", "runs/reverse-search/results", "runs/golden/live", "runs/golden/results", ""]) {
		await page.goto(`${base}/#/${path}`)
		const ready = path ? page.getByRole("link", { name: "Timeline", exact: true }) : page.getByRole("button", { name: "Describe a problem" })
		await ready.first().waitFor({ timeout: 120_000 })
		await page.waitForTimeout(1500)
	}
	await page.getByRole("button", { name: "Describe a problem" }).waitFor({ timeout: 60_000 })
	await card(TITLE_CARD, 900)

	const frames: { file: string; at: number }[] = []
	const cdp = await context.newCDPSession(page)
	cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
		const file = join(frameDir, `${String(frames.length).padStart(6, "0")}.jpg`)
		writeFileSync(file, Buffer.from(data, "base64"))
		frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 })
		void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
	})
	await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })

	try {
		await story()
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
