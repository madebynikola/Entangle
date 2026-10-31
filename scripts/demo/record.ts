/**
 * Records the demo and pitch video: drives the web app in headless Chromium and writes an MP4.
 *
 *   npm run demo:record                       out/tmp/demo/entangle-demo.mp4
 *   npm run demo:record -- --keep-frames      keep the captured JPEG frames next to the video
 *   npm run demo:record -- --out PATH         write the video elsewhere
 *   npm run demo:record -- --from 4 --to 4    record only scenes 4 to 4
 *   npm run demo:record -- --preview          play it live in a Chromium window, with no recording or encoding
 *   npm run demo:record -- --remix            mix the music and sound effects onto the last recording again
 *   npm run demo:record -- --no-audio         a silent video
 *   npm run demo:record -- --voice X          add a Soniox voice-over in voice X (off by default)
 *
 * Sound: scripts/demo/audio/ holds the music and the sound effects (free to use, see CREDITS.md). The story logs a cue
 * at each moment that has a sound (a title, a face, a click, typing, a rejected claim); ffmpeg mixes them over the music.
 * The voice-over is off by default. With --voice it is Soniox text-to-speech (SONIOX_API_KEY): each line is fetched once
 * into out/tmp/demo/vo/ and the scenes wait for their line to end, so the video gets longer.
 *
 * Needs ffmpeg on PATH and Chromium for Playwright (`npx playwright install chromium`). No API key: it replays the two
 * committed runs, out/reverse-search/ and out/golden/. The storyboard and the voice-over are in docs/demo/storyboard.md.
 *
 * The app runs in an iframe inside scripts/demo/director.html, the camera. After the splash, the app's page is hidden
 * and only the component that matters floats on a backdrop (isolate()). Each agent is introduced beside the real
 * thing it made in the run. The director also draws titles, captions, the intros and a cursor. The app is not changed.
 *
 * How it records: Chrome's screencast sends a JPEG each time the page paints, with its time. The frames are joined
 * with those times and resampled to 30 fps, so the video keeps the real pace.
 *
 * Honest by design: "Find researchers" opens the committed reverse search instead of a new run, and the caption on
 * the Stage says it is that run replayed. Approve is answered in the browser and never writes to out/.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
		preview: { type: "boolean", default: false },
		remix: { type: "boolean", default: false },
		"no-audio": { type: "boolean", default: false },
		port: { type: "string", default: "4640" },
		from: { type: "string", default: "0" },
		to: { type: "string", default: "99" },
		out: { type: "string" },
		/** Another music file, to try a track with --remix. */
		music: { type: "string" },
		/** A Soniox voice for the voice-over, such as Brooke; none by default. Needs SONIOX_API_KEY the first time each line is spoken. */
		voice: { type: "string" },
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
type Shot = "full" | "frame" | "tilt" | { rect: Rect; box?: Rect; pad?: number; max?: number; min?: number; lift?: number }

let page: Page
let app: FrameLocator
let base = ""
let mouse = { x: VIEW.width / 2, y: VIEW.height / 2 }

const wait = (ms: number) => page.waitForTimeout(ms)

// ---------------------------------------------------------------------------------------------------------------
// Sound cues

type Sound = "whoosh" | "pop" | "click" | "typing" | "reject" | "fixed" | "success" | "tick"
type Cue = { sound: Sound | "vo"; at: number; gain: number; ms?: number; line?: Line }
const cues: Cue[] = []

// ---------------------------------------------------------------------------------------------------------------
// Voice-over

/**
 * What the voice says, scene by scene: a demo, not a documentary, so the delivery is marked. Soniox reads the
 * [bracketed] tags as direction (emotion, pace) and *stars* as stress; neither is spoken. The captions say the same in
 * short, for viewers with the sound off.
 */
const VO = {
	numbers: "[curious] EINSTEIN has one thousand and forty-seven researchers... and a hundred and fifty-three companies.",
	question: "So which researcher can solve which company's *problem*?",
	tokens: "That's seven *million* tokens. [playful] Way too much for one model.",
	team: "[excited] So we built a team of agents! It reads everything, cites every claim, and asks a person before anyone gets contacted.",
	dialog: "[warm] Here's a company, describing one problem in its own words: false alarms on wind turbine sensors, and faults missed in winter.",
	meet: "[excited] Meet the team! Nine roles, twenty agents, each one doing *one* job really well.",
	deneb: "[happy] This is Deneb, the Orchestrator. Deneb plans the run and hands out the work.",
	spica: "Spica reads the company's words, and turns them into a real research question.",
	libra: "[playful] Libra searches all one thousand and forty-seven researchers... and keeps just the six worth reading.",
	tycho: "[excited] Then six Tychos profile them at once, straight from their papers and projects.",
	fides: "[serious] Fides is the Critic. Every claim gets checked against its source. [playful] If Fides can't find it, it goes *right* back.",
	amity: "[warm] Amity pairs the company with a researcher, and explains why.",
	tinta: "Tinta writes the proposal, with every single fact sourced.",
	ceres: "[happy] And Ceres finds the EU calls that could fund it!",
	you: "[sincerely] But nobody gets contacted until a person approves.",
	bus: "[excited] They all talk on one Mozaik event bus. This is the real run! Five minutes, a dollar forty-six, played four times faster.",
	parallel: "[curious] But is it really parallel? Here's the eight-company run.",
	overlap: "Every bar is one model call... [excited] and look how they overlap! Profilers, the Matchmaker, the Writers and the Critic, all working at once.",
	stats: "Sixty-six researchers profiled. Thirty-two pairs. Four hundred and eighty-three claims rejected. [excited] And six proposals, with every fact sourced!",
	close: "[warm] Entangle. Sourced matches, approved by people.",
} as const
type Line = keyof typeof VO
const VO_DIR = join(OUT, "vo")
const voLength: Partial<Record<Line, number>> = {}

/** The file of one line in one voice; a new text or voice is a new file. */
function voFile(voice: string, line: Line) {
	const hash = createHash("sha1").update(`${voice}\n${VO[line]}`).digest("hex").slice(0, 10)
	return join(VO_DIR, `${voice}-${line}-${hash}.mp3`)
}

/** Fetch each line once from Soniox, and note its length. Without a key, lines already fetched still play. */
async function prepareVoice(voice: string) {
	mkdirSync(VO_DIR, { recursive: true })
	const key = process.env.SONIOX_API_KEY
	for (const line of Object.keys(VO) as Line[]) {
		const file = voFile(voice, line)
		if (!existsSync(file)) {
			if (!key) continue
			const response = await fetch("https://tts-rt.soniox.com/tts", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
				body: JSON.stringify({ model: "tts-rt-v2", language: "en", voice, audio_format: "mp3", sample_rate: 48000, bitrate: 192000, text: VO[line] }),
			})
			if (!response.ok) throw new Error(`Soniox could not speak "${line}": ${response.status} ${await response.text()}`)
			writeFileSync(file, Buffer.from(await response.arrayBuffer()))
		}
		const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" })
		voLength[line] = Number(probe.stdout.trim())
	}
	const missing = (Object.keys(VO) as Line[]).filter((line) => !voLength[line])
	if (missing.length) console.warn(`No voice-over for ${missing.join(", ")}: set SONIOX_API_KEY to fetch it.`)
}

/** Speak a line now; resolves when it ends, so a scene can wait for its words. */
function say(line: Line): Promise<void> {
	const seconds = voLength[line]
	if (!seconds) return Promise.resolve()
	cues.push({ sound: "vo", at: Date.now() / 1000, gain: 1, line })
	return wait(seconds * 1000 + 250)
}

/** A sound at this moment of the video. `ms` plays only that long (typing). */
function cue(sound: Sound, gain = 1, ms?: number) {
	cues.push({ sound, at: Date.now() / 1000, gain, ms })
}

/** Type with the sound of typing under it. */
async function type(text: string, delay: number) {
	const start = Date.now() / 1000
	await page.keyboard.type(text, { delay })
	cues.push({ sound: "typing", at: start, gain: 0.55, ms: Date.now() - start * 1000 })
}

/** Call `window.director[name](...args)` in the director page. */
function dir<T = void>(name: string, ...args: unknown[]): Promise<T> {
	return page.evaluate(([name, args]) => (window as any).director[name](...args), [name, args] as const) as Promise<T>
}

const camera = (shot: Shot, ms = 1100) => dir("camera", shot, ms)
const blur = (mode: "blur" | "soft" | "none", ms = 420) => dir("blur", mode, ms)
const caption = (kicker: string | null, html: string | null) => dir("caption", kicker, html)

/**
 * A title card, held at least `hold` ms and until its voice-over line ends. Only the start of a part has a sound, so
 * the sweep does not repeat on every card.
 */
async function title(
	spec: { kicker?: string; faces?: string[]; lines?: string[]; small?: boolean; sub?: string; code?: string; lockup?: boolean },
	hold: number,
	{ keep = false, sound, line }: { keep?: boolean; sound?: Sound; line?: Line } = {},
) {
	if (sound) cue(sound, 0.35)
	await dir("title", spec)
	await Promise.all([wait(hold), line ? say(line) : null])
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
	cue("click", 0.8)
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

const RS = "#/runs/reverse-search"
const PAIR = `${RS}/results/pairs/${encodeURIComponent("C999-CH1:R0822")}`
const PROPOSAL = `${RS}/results/proposals/C999-CH1-R0822`
/** Where an isolated component floats, beside an agent's introduction: the right part of the screen. */
const RIGHT = { x: 610, y: 48, w: 790, h: 680 }

const iso = (on: boolean) => dir("iso", on)
const stageTo = (mode: "gone" | "none", ms = 560) => dir("stage", mode, ms)

/** The innermost <section> whose heading is `name`. */
const block = (name: string | RegExp) =>
	app.getByRole("main").locator("section").filter({ has: app.locator("h3").filter({ hasText: name }) }).last()

/**
 * Float components of the app on the backdrop: route there unseen, mark them, and point the camera at them.
 * The stage must be "gone" first. `hide` marks parts of them to leave out, such as rows past the third.
 */
async function isolate(
	hash: string | null,
	targets: () => Locator[],
	opts: { box?: Rect; pad?: number; max?: number; card?: boolean; hide?: string[]; width?: number } = {},
) {
	await iso(false)
	await camera("full", 0)
	if (hash) await route(hash)
	const els = targets()
	try {
		for (const el of els) await el.waitFor({ state: "visible", timeout: 30_000 })
	} catch (error) {
		const where = await app.locator("body").evaluate(() => `${location.hash}: ${[...document.querySelectorAll("h2, h3")].map((h) => h.textContent).join(" | ")}`)
		await page.screenshot({ path: join(OUT, "isolate-failed.png") })
		throw new Error(`isolate: not found on ${where}`, { cause: error })
	}
	await wait(250)
	for (const el of els)
		await el.evaluate(
			(node, { card, hide, width }) => {
				node.setAttribute("data-iso", "")
				if (card) node.setAttribute("data-iso-card", "")
				// Narrower, so it wraps taller and the camera can come closer.
				if (width) (node as HTMLElement).style.maxWidth = `${width}px`
				for (const selector of hide) for (const part of node.querySelectorAll(selector)) part.setAttribute("data-iso-hide", "")
			},
			{ card: opts.card ?? true, hide: opts.hide ?? [], width: opts.width ?? 0 },
		)
	// Scroll after the marks change its size, and keep a margin: a card flush with its scroller's edge is cut off there.
	for (const el of els)
		await el.evaluate((node, alone) => {
			const html = node as HTMLElement
			html.style.scrollMargin = "48px"
			node.scrollIntoView({ block: alone && node.getBoundingClientRect().height < innerHeight - 160 ? "center" : "nearest" })
			// At the very top or left of its scroller it cannot scroll further: push it in, past the card's 21 px ring.
			let clip = node.parentElement
			while (clip && getComputedStyle(clip).overflow === "visible") clip = clip.parentElement
			const box = node.getBoundingClientRect()
			const edge = clip ? clip.getBoundingClientRect() : { top: 0, left: 0 }
			const ROOM = 26
			if (box.top - edge.top < ROOM) html.style.marginTop = `${parseFloat(getComputedStyle(node).marginTop) + ROOM - (box.top - edge.top)}px`
			if (box.left - edge.left < ROOM) html.style.marginLeft = `${parseFloat(getComputedStyle(node).marginLeft) + ROOM - (box.left - edge.left)}px`
		}, els.length === 1)
	// Measure before hiding the page: role lookups such as getByRole("main") no longer see it after.
	const box = await around(...els)
	await iso(true)
	await camera({ rect: box, box: opts.box ?? RIGHT, pad: opts.pad ?? 0.1, max: opts.max ?? 1.9 }, 0)
}

type Agent = {
	face: string
	name: string
	kicker: string
	job: string
	model: string
	color: string
	/** Put its component on the stage (unseen), or draw a panel instead. */
	show: () => Promise<void>
	/** What happens while it is on: moods and clicks. */
	act: () => Promise<void>
}

const HAIKU = "Claude Haiku 4.5"
const SONNET = "Claude Sonnet 4.6"

const mood = (state: string) => {
	if (state === "reject") cue("reject", 0.7)
	return dir("mood", state)
}

const AGENTS: Agent[] = [
	{
		face: "deneb",
		name: "Deneb",
		kicker: "01 · Orchestrator",
		job: "Plans the run and <b>hands out the work</b>. Each row is an agent, each bar a task it gave out.",
		model: HAIKU,
		color: "#a1a1a6",
		show: () => isolate(`${RS}/live`, () => [app.locator('section[data-slot="pane"]').filter({ hasText: "Agents at work" }).first()], { box: { x: 590, y: 40, w: 830, h: 700 }, pad: 0.03, max: 1.3, card: false }),
		act: async () => {
			await mood("working")
			await wait(3200)
			await mood("done")
			await wait(1400)
		},
	},
	{
		face: "spica",
		name: "Spica",
		kicker: "02 · Industry Analyst",
		job: "Reads the company's own words and <b>restates the problem</b> as a research question.",
		model: HAIKU,
		color: "#d9954a",
		show: () => isolate(`${PAIR}?tab=challenge`, () => [block("In the company's words"), block("As a research question")], { width: 500 }),
		act: async () => {
			await mood("working")
			await wait(3400)
			await mood("done")
			await wait(1400)
		},
	},
	{
		face: "libra",
		name: "Libra",
		kicker: "03 · Shortlist",
		job: "Searches <b>every researcher</b> on EINSTEIN and keeps the few worth reading in full.",
		model: "No model <span>· a search, in code</span>",
		color: "#8b9aab",
		// Nothing of the app: every page element hidden.
		show: async () => {
			await iso(false)
			await iso(true)
		},
		act: async () => {
			cue("tick", 0.5)
			setTimeout(() => cue("tick", 0.5), 1500)
			await dir("panel", { kind: "tally", box: RIGHT, from: 1047, fromLabel: "researchers on EINSTEIN", to: 6, toLabel: "to read, for this problem", color: "#8b9aab" })
			await mood("working")
			await wait(3200)
			await mood("done")
			await wait(1300)
			await dir("unpanel")
		},
	},
	{
		face: "tycho",
		name: "Tycho",
		kicker: "04 · Research Profiler",
		job: "Reads a researcher's papers and projects and writes a profile. <b>Six work at once.</b>",
		model: `${HAIKU} <span>· ×6</span>`,
		color: "#8b97f2",
		show: () => isolate(`${PAIR}?tab=researcher`, () => [block("Expertise")], { width: 500, hide: ["li:nth-child(n+4)"] }),
		act: async () => {
			await mood("working")
			await wait(3400)
			await mood("done")
			await wait(1500)
		},
	},
	{
		face: "fides",
		name: "Fides",
		kicker: "05 · Critic",
		job: "Checks <b>every claim</b> against the record it cites. What it cannot find goes back to its writer.",
		model: SONNET,
		color: "#f07a70",
		show: () =>
			isolate(`${PROPOSAL}?tab=review`, () => [app.getByRole("main").locator("li.rounded-md").filter({ has: app.locator(".line-through") }).first()], { width: 480 }),
		act: async () => {
			await mood("working")
			await wait(2200)
			await mood("reject")
			await wait(2200)
			cue("fixed", 0.7)
			await mood("done")
			await wait(1500)
		},
	},
	{
		face: "amity",
		name: "Amity",
		kicker: "06 · Matchmaker",
		job: "Pairs the problem with the researchers who passed, and <b>says why</b>, with a source for each reason.",
		model: SONNET,
		color: "#b48ae8",
		show: () => isolate(PAIR, () => [block("Why these two")], { width: 500, hide: ["li:nth-child(n+4)"] }),
		act: async () => {
			await mood("working")
			await wait(3600)
			await mood("done")
			await wait(1500)
		},
	},
	{
		face: "tinta",
		name: "Tinta",
		kicker: "07 · Proposal Writer",
		job: "Writes the <b>joint project</b> for the pair, in plain words, with every fact cited.",
		model: SONNET,
		color: "#3cbfb4",
		show: () => isolate(PROPOSAL, () => [app.getByRole("main").locator("section.scroll-mt-4").first()], { width: 520 }),
		act: async () => {
			await mood("working")
			await wait(3400)
			await mood("done")
			await wait(1600)
		},
	},
	{
		face: "ceres",
		name: "Ceres",
		kicker: "08 · Funding Scout",
		job: "Finds the <b>open EU calls</b> that could fund the pair, from the Funding &amp; Tenders portal.",
		model: HAIKU,
		color: "#a3c95a",
		show: () => isolate(PAIR, () => [block("Where to apply")], { width: 520, hide: ["li:nth-child(n+2)", ":scope > p"] }),
		act: async () => {
			await mood("working")
			await wait(3200)
			await mood("done")
			await wait(1500)
		},
	},
	{
		face: "you",
		name: "You",
		kicker: "09 · Human approver",
		job: "Nobody is contacted until <b>a person approves</b> the pair.",
		model: "A person <span>· the coordinator</span>",
		color: "#c7c7cc",
		show: () =>
			isolate(PROPOSAL, () => [app.getByRole("main").locator("header").filter({ has: app.getByRole("button", { name: "Approve", exact: true }) }).last()], {
				width: 560,
				pad: 0.14,
				hide: [":scope > div.mt-2"],
			}),
		act: async () => {
			await mood("working")
			await wait(900)
			await dir("showCursor", true)
			await click(app.getByRole("button", { name: "Approve", exact: true }), 1000)
			cue("success", 0.7)
			await mood("done")
			await wait(2200)
			await dir("showCursor", false)
		},
	},
]

/** 0. The app's own splash, full screen */
async function scene0() {
	await dir("load", `${base}/#/`)
	await untilSplashEnds()
	await wait(250)
}

/** 1. The problem */
async function scene1() {
	await blur("blur", 600)
	await title({ kicker: "The EINSTEIN challenge", lines: ["{1047} researchers.", "{153} companies."] }, 2100, { sound: "whoosh", line: "numbers" })
	await title({ lines: ["Which researcher can solve", "which company's *problem?*"] }, 2000, { line: "question" })
	await title({ lines: ["7 million tokens.", "Too much for *one* model."] }, 1900, { line: "tokens" })
	await title({ lockup: true, sub: "So we built a team of agents that reads it together, cites every claim, and asks a person before anyone is contacted." }, 3000, { sound: "whoosh", line: "team" })
	// Out of sight under the blur first, so nothing of the page shows when the blur lifts.
	await stageTo("gone", 700)
	await blur("none", 0)
}

/** 2. A company describes its problem: the dialog alone, on the backdrop */
async function scene2() {
	await iso(false)
	await camera("full", 0)
	await route("#/")
	await app.getByRole("button", { name: "Describe a problem" }).evaluate((el: HTMLElement) => el.click())
	const dialog = app.getByRole("dialog", { name: "Find researchers for a problem" })
	await dialog.waitFor()
	await wait(400)
	await dialog.evaluate((el) => el.setAttribute("data-iso", ""))
	await iso(true)
	await camera({ rect: await rect(dialog), box: { x: 120, y: 16, w: 1200, h: 676 }, pad: 0.06, max: 1.45 }, 0)
	const spoken = say("dialog")
	await stageTo("none", 700)
	await caption("Reverse search", "A company describes <b>one problem</b> in its own words.")
	await dir("showCursor", true)
	await click(dialog.getByLabel("The problem"))
	await type(PROBLEM, 8)
	await wait(250)
	await click(dialog.getByLabel(/^Sector/), 500)
	await type("Renewable energy", 35)
	const mock = dialog.getByRole("switch", { name: "Run on the mock model" })
	if ((await mock.getAttribute("aria-checked")) === "true" && (await mock.isEnabled())) await click(mock, 500)
	await wait(300)
	await spoken
	await click(dialog.getByRole("button", { name: "Find researchers" }), 600)
	await dir("showCursor", false)
	await caption(null, null)
	await stageTo("gone")
}

/** 3. Meet the team */
async function scene3() {
	await iso(false)
	await title(
		{ faces: ["deneb", "spica", "libra", "tycho", "fides", "amity", "tinta", "ceres", "you"], lines: ["Meet the *team.*"], small: true, sub: "Nine roles, twenty agents on one Mozaik event bus. Each does one job well." },
		3000,
		{ line: "meet" },
	)
}

/** 4. Each agent, alone, with the real thing it made in that run */
async function scene4() {
	await dir("roster", true)
	for (const agent of AGENTS) {
		await agent.show()
		let spoken: Promise<void> = Promise.resolve()
		await Promise.all([
			(cue("pop", 0.7), dir("meet", { face: agent.face, name: agent.name, kicker: agent.kicker, job: agent.job, model: agent.model, color: agent.color })),
			(async () => {
				await wait(250)
				spoken = say(agent.face as Line)
				await stageTo("none", 700)
			})(),
		])
		await Promise.all([agent.act(), spoken])
		await Promise.all([dir("unmeet"), stageTo("gone")])
	}
	await dir("roster", false)
}

/** 5. Together: the real run on the Stage, alone on the backdrop */
async function scene5() {
	const spoken = say("bus")
	await title({ kicker: "Together", lines: ["One event bus.", "Every agent *hears every event.*"], small: true }, 2200, { sound: "whoosh" })
	await iso(false)
	await camera("full", 0)
	await route(`${RS}/stage`)
	await app.getByRole("button", { name: "Watch the replay" }).evaluate((el: HTMLElement) => el.click())
	await wait(300)
	await seek(58_000, RS_MS)
	// Close the event log, so the ring of faces takes the whole width, then frame the faces themselves: the run's
	// header and replay bar float over the stage and push the ring off centre.
	const hideLog = app.getByRole("button", { name: "Hide the events" })
	if (await hideLog.count()) await hideLog.first().evaluate((el: HTMLElement) => el.click())
	await wait(900)
	const canvas = app.locator(".stage-canvas").first()
	const ring = await canvas.evaluate((el) => {
		const boxes = [...el.querySelectorAll("svg.ag")].map((face) => face.getBoundingClientRect()).filter((r) => r.width > 0)
		const x = Math.min(...boxes.map((r) => r.left))
		const y = Math.min(...boxes.map((r) => r.top))
		// Room for the names under the faces.
		return { x, y, w: Math.max(...boxes.map((r) => r.right)) - x, h: Math.max(...boxes.map((r) => r.bottom)) + 34 - y }
	})
	await canvas.evaluate((el) => {
		el.setAttribute("data-iso", "")
		for (const part of el.querySelectorAll(":scope > div[aria-hidden], :scope > .z-20")) part.setAttribute("data-iso-hide", "")
	})
	await iso(true)
	await camera({ rect: ring, box: { x: 0, y: 10, w: 1440, h: 680 }, pad: 0.16, max: 1.3 }, 0)
	await stageTo("none", 700)
	await caption("The real run", "That problem, run for real in <b>5 minutes</b> for $1.46. Here it plays 4× faster.")
	await wait(4800)
	await caption("The real run", "Profilers post, the Critic <b>sends back</b>, Amity pairs, Tinta writes.")
	await Promise.all([wait(4600), spoken])
	await caption(null, null)
	await stageTo("gone")
}

/** 6. Proof: the agents really run at once */
async function scene6() {
	const lanes = () => app.locator('section[data-slot="pane"]').filter({ hasText: "Agents at work" }).first()
	// The 66-minute run takes seconds to load: load it behind the title, and keep the title up until it is there.
	const asked = say("parallel")
	await title({ kicker: "Is it really parallel?", lines: ["The reference run:", "*8 companies*, 20 agents, 66 minutes."], small: true }, 0, { keep: true, sound: "whoosh" })
	await Promise.all([
		wait(2400),
		isolate(`#/runs/golden/live`, () => [lanes()], { box: { x: 40, y: 24, w: 1360, h: 666 }, pad: 0.02, max: 1.5, card: false }),
	])
	await asked
	await dir("untitle")
	await stageTo("none", 700)
	// Said once the bars are on screen: the run takes seconds to load, longer than the question.
	const spoken = say("overlap")
	await caption("The Timeline", "One row per agent, one bar per model call. <b>Bars that overlap</b> are agents working at the same time.")
	await wait(2400)
	const lanesBox = await rect(lanes())
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
	const rows = await around(app.getByText("profiler-1", { exact: true }).first(), app.getByText("writer-3", { exact: true }).first())
	await camera({ rect: { x: rows.x, y: rows.y - 10, w: lanesBox.x + lanesBox.w - rows.x, h: rows.h + 20 }, pad: 0.04, max: 1.9 }, 1500)
	await caption("The first 27 minutes", "Profilers, the Matchmaker, Writers and the Critic, <b>all in flight together</b>.")
	await Promise.all([wait(3400), spoken])
	await caption(null, null)
	await stageTo("gone")
	await iso(false)
}

/** 7. What the reference run made */
async function scene7() {
	for (let k = 0; k < 4; k++) setTimeout(() => cue("tick", 0.45), 300 + k * 110)
	await dir("panel", {
		kind: "stats",
		stats: [
			{ face: "tycho", n: 66, label: "researchers profiled" },
			{ face: "amity", n: 32, label: "pairs, each with its reasons" },
			{ face: "fides", n: 483, label: "claims the Critic rejected" },
			{ face: "tinta", n: 6, label: "proposals, every fact sourced" },
		],
	})
	await caption("The reference run", "8 companies in 66 minutes, for <b>$16.90</b> of Claude.")
	await Promise.all([wait(4200), say("stats")])
	await caption(null, null)
	await dir("unpanel")
}

/** 8. Close */
async function scene8() {
	await title(
		{
			lockup: true,
			lines: ["Sourced matches.", "Approved by *people.*"],
			small: true,
			code: "npm install &amp;&amp; npm run replay -- out/golden",
			sub: "No keys needed: the repo holds both runs, with every trace.",
		},
		5200,
		{ keep: true, sound: "whoosh", line: "close" },
	)
	await wait(400)
}

const SCENES = [scene0, scene1, scene2, scene3, scene4, scene5, scene6, scene7, scene8]

/** Where each scene starts, when the recording starts there (`--from N`). Every scene after 2 sets up its own page. */
async function setUp(from: number) {
	await dir("load", `${base}/#/`)
	await untilSplashEnds()
	await camera("full", 0)
	await stageTo("gone", 0)
	await wait(800)
}

async function story(from: number, to: number) {
	if (from > 0) await setUp(from)
	for (const scene of SCENES.slice(from, to + 1)) await scene()
}

// ---------------------------------------------------------------------------------------------------------------
// Capture and encode

async function main() {
	if (values.remix) return remix()
	const preview = values.preview!
	if (!preview && spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("ffmpeg is not on PATH. Install it (brew install ffmpeg) and run again.")
	rmSync(frameDir, { recursive: true, force: true })
	mkdirSync(frameDir, { recursive: true })

	if (!values["no-audio"] && values.voice) await prepareVoice(values.voice)
	base = await startServer(values.port!)
	// The scale comes from a Chrome flag, not from Playwright's emulation: only then does the screencast send device
	// pixels (1920×1080) instead of CSS pixels. A preview is a plain window on the screen.
	const browser = await chromium.launch(
		preview
			? { headless: false, args: [`--window-size=${VIEW.width},${VIEW.height + 90}`] }
			: { args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.width},${VIEW.height}`] },
	)
	const context = await browser.newContext({ viewport: preview ? VIEW : null, colorScheme: "dark" })
	page = await context.newPage()
	page.setDefaultTimeout(30_000)
	app = page.frameLocator("#app")

	// tsx compiles named inner functions with an `__name` helper that the page does not have.
	await context.addInitScript({ content: "globalThis.__name = (f) => f" })
	await context.addInitScript(() => {
		try {
			localStorage.setItem("entangle.theme", "dark")
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
		const agent = path.match(/^\/__demo\/agents\/(\w+)\.svg$/)
		if (agent) return req.fulfill({ contentType: "image/svg+xml", body: readFileSync(resolve(ROOT, "design/agents", `${agent[1]}.svg`)) })
		if (path === "/__demo/lockup.svg") return req.fulfill({ contentType: "image/svg+xml", body: readFileSync(resolve(ROOT, "docs/brand/entangle-lockup-animated-dark.svg")) })
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
	for (const hash of ["#/", "#/runs/reverse-search/stage", "#/runs/reverse-search/results", "#/runs/golden/live", "#/runs/golden/results", "#/runs/reverse-search/live", "#/"]) {
		await route(hash)
		const ready = hash === "#/" ? app.getByRole("button", { name: "Describe a problem" }) : app.getByRole("link", { name: "Timeline", exact: true })
		await ready.first().waitFor({ timeout: 120_000 })
		await wait(1200)
	}
	await page.goto(`${base}/__demo/director`)
	await page.evaluate(() => document.fonts.ready)
	await dir("ready")

	const frames: { file: string; at: number }[] = []
	const cdp = await context.newCDPSession(page)
	cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
		const file = join(frameDir, `${String(frames.length).padStart(6, "0")}.jpg`)
		writeFileSync(file, Buffer.from(data, "base64"))
		frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 })
		void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
	})
	if (!preview) await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 })

	try {
		await story(Number(values.from), Number(values.to))
	} finally {
		// A preview holds the last frame a moment before the window closes.
		if (preview) await wait(3000).catch(() => {})
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
			"-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", SILENT,
		],
		{ stdio: "inherit" },
	)
	if (result.status !== 0) throw new Error("ffmpeg failed")
	const seconds = end - frames[0].at
	// Kept, so --remix can mix the sound again without recording.
	writeFileSync(CUES, JSON.stringify({ seconds, cues: cues.map((c) => ({ ...c, at: c.at - frames[0].at })) }, null, 1))
	mix()
	console.log(`${output}  ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}  ${frames.length} frames`)
}

const AUDIO = resolve(import.meta.dirname, "audio")
const SILENT = join(OUT, "silent.mp4")
const CUES = join(OUT, "cues.json")
/** A filter on one sound: the swell under titles loses its hiss, so it does not cut like a blade. */
const SHAPE: Partial<Record<Sound, string>> = { whoosh: "lowpass=f=2600," }
/** The voice-over's level over the music and the effects. */
const VO_GAIN = 1.8
/** The music's loudness (LUFS), whatever the track: it sits under the sound effects. */
const MUSIC_LUFS = -24

async function remix() {
	if (!existsSync(SILENT) || !existsSync(CUES)) throw new Error(`Nothing to remix: record once first (${SILENT}).`)
	if (values.voice) await prepareVoice(values.voice)
	mix()
	console.log(output)
}

/** Music over the whole video, each cue's sound at its time, onto the silent video. */
function mix() {
	const music = values.music ? resolve(values.music) : join(AUDIO, "music.mp3")
	if (values["no-audio"] || !existsSync(music)) {
		if (!values["no-audio"]) console.warn(`No ${music}: the video is silent.`)
		copyFileSync(SILENT, output)
		return
	}
	const { seconds, cues } = JSON.parse(readFileSync(CUES, "utf8")) as { seconds: number; cues: Cue[] }
	const sounds = [...new Set(cues.map((c) => c.sound))].filter((sound) => existsSync(join(AUDIO, `${sound}.mp3`)))
	const inputs = ["-i", SILENT, "-stream_loop", "-1", "-i", music]
	for (const sound of sounds) inputs.push(...(sound === "typing" ? ["-stream_loop", "-1"] : []), "-i", join(AUDIO, `${sound}.mp3`))
	const played = cues.filter((c) => sounds.includes(c.sound) && c.at >= 0)
	const graph: string[] = [
		`[1:a]atrim=0:${seconds.toFixed(3)},loudnorm=I=${MUSIC_LUFS}:TP=-3:LRA=11,aresample=48000,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, seconds - 3).toFixed(3)}:d=3[music]`,
	]
	sounds.forEach((sound, k) => {
		const mine = played.filter((c) => c.sound === sound)
		if (mine.length) graph.push(`[${k + 2}:a]asplit=${mine.length}${mine.map((_, i) => `[${sound}${i}]`).join("")}`)
	})
	const labels: string[] = []
	const count: Record<string, number> = {}
	played.forEach((c, j) => {
		const i = (count[c.sound] = (count[c.sound] ?? -1) + 1)
		const length = c.ms ? `atrim=0:${(c.ms / 1000).toFixed(3)},afade=t=out:st=${Math.max(0, c.ms / 1000 - 0.15).toFixed(3)}:d=0.15,` : ""
		const delay = Math.round(c.at * 1000)
		graph.push(`[${c.sound}${i}]${length}${SHAPE[c.sound] ?? ""}volume=${c.gain},adelay=${delay}|${delay}[c${j}]`)
		labels.push(`[c${j}]`)
	})
	// The voice-over, one input per line, and the music ducks under it.
	const voice = values.voice
	const spoken = voice ? cues.filter((c) => c.sound === "vo" && c.line && c.at >= 0 && existsSync(voFile(voice, c.line))) : []
	let bed = "[music]"
	if (spoken.length) {
		spoken.forEach((c, j) => {
			inputs.push("-i", voFile(voice!, c.line!))
			const delay = Math.round(c.at * 1000)
			graph.push(`[${2 + sounds.length + j}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${VO_GAIN},adelay=${delay}|${delay}[v${j}]`)
		})
		const lines = spoken.map((_, j) => `[v${j}]`).join("")
		graph.push(`${lines}${spoken.length > 1 ? `amix=inputs=${spoken.length}:normalize=0,` : ""}asplit=2[voice][key]`)
		graph.push(`[music]aformat=channel_layouts=stereo[bed]`, `[bed][key]sidechaincompress=threshold=0.02:ratio=4:attack=40:release=600[ducked]`)
		bed = "[ducked]"
		labels.push("[voice]")
	}
	graph.push(`${bed}${labels.join("")}amix=inputs=${labels.length + 1}:normalize=0:duration=first,alimiter=limit=0.9[out]`)
	const result = spawnSync(
		"ffmpeg",
		["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph.join(";"), "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", seconds.toFixed(3), "-movflags", "+faststart", output],
		{ stdio: "inherit" },
	)
	if (result.status !== 0) throw new Error("ffmpeg could not mix the sound")
}

main().catch((error) => {
	console.error(error)
	server?.kill()
	process.exitCode = 1
})
