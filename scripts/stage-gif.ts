/**
 * Records the README's Stage GIFs: the Stage tab replaying the reference run (out/golden/) at 1×, its first minute
 * and then its last half minute, in the light and the dark theme.
 *
 *   npm run stage:gif                        docs/brand/entangle-stage-light.gif and entangle-stage-dark.gif
 *   npm run stage:gif -- --theme dark        only one theme
 *   npm run stage:gif -- --head 60 --tail 30 seconds of run time from the start and before the end
 *
 * Needs ffmpeg on PATH and Chromium for Playwright (`npx playwright install chromium`). No key, no network: it starts
 * the app on a free port and replays the committed run. The app is not changed: it is driven with its own buttons and
 * keys (Replay from the start, End on the playhead, ← to step back 5 s, Space to play).
 *
 * How it records: Chrome's screencast sends a frame each time the page paints, with its time. The frames of the two
 * parts are joined with those times, cropped to the run panel and turned into a GIF with its own palette.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { chromium, type Page } from "playwright"

const ROOT = resolve(import.meta.dirname, "..")
const TMP = resolve(ROOT, "out/tmp/stage-gif")
/** The panel is 1184×806 in this window; with 4 px of the canvas round it, it scales to 760×519. */
const VIEW = { width: 1440, height: 822 }
const PAD = 4
const WIDTH = 760
/** 7 cs a frame, the finest a GIF delay keeps exactly. */
const FPS = "100/7"
/** How long the last frame holds before the GIF loops. */
const HOLD_MS = 1600

const { values } = parseArgs({
	options: {
		theme: { type: "string" },
		head: { type: "string", default: "60" },
		tail: { type: "string", default: "30" },
		port: { type: "string", default: "4660" },
	},
})
const themes = values.theme ? [values.theme as "light" | "dark"] : (["light", "dark"] as const)
const headMs = Number(values.head) * 1000
const tailMs = Number(values.tail) * 1000

let server: ChildProcess | undefined
let base = ""

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

type Frame = { file: string; at: number }

async function record(page: Page, theme: "light" | "dark") {
	const dir = join(TMP, theme)
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(dir, { recursive: true })

	await page.goto(`${base}/#/runs/golden/stage?speed=1`)
	// The boot splash covers the window until the run has loaded and its pass has ended.
	await page.locator('[aria-label="Playhead"]').waitFor({ timeout: 30_000 })
	await page.getByRole("status", { name: "Loading Entangle" }).waitFor({ state: "detached", timeout: 30_000 })
	await page.waitForTimeout(1500)
	await page.mouse.move(8, VIEW.height - 8)

	const panel = (await page.locator("main").first().boundingBox())!
	const crop = { x: Math.round(panel.x) - PAD, y: Math.round(panel.y) - PAD, w: Math.round(panel.width) + PAD * 2, h: Math.round(panel.height) + PAD * 2 }

	const cdp = await page.context().newCDPSession(page)
	const frames: Frame[] = []
	cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
		const file = join(dir, `${String(frames.length).padStart(6, "0")}.jpg`)
		writeFileSync(file, Buffer.from(data, "base64"))
		frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 })
		void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
	})
	// JPEG, not PNG: writing PNGs this large falls behind the page and stretches the waits below.
	await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, everyNthFrame: 1 })
	const now = async () => (await cdp.send("Runtime.evaluate", { expression: "Date.now() / 1000", returnByValue: true })).result.value as number

	// The first minute, from the start.
	await page.getByRole("button", { name: "Replay from the start" }).evaluate((button: HTMLButtonElement) => button.click())
	const headFrom = await now()
	await page.waitForTimeout(headMs)
	const headTo = await now()

	// The last half minute: the playhead to the end, then back in 5 s steps, then play.
	await page.locator('[aria-label="Playhead"] [role="slider"]').focus()
	await page.keyboard.press("End")
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
	for (let i = 0; i < tailMs / 5000; i++) await page.keyboard.press("ArrowLeft")
	await page.keyboard.press(" ")
	await page.waitForTimeout(300)
	const tailFrom = await now()
	await page.waitForTimeout(tailMs + HOLD_MS)
	const tailTo = await now()

	await cdp.send("Page.stopScreencast")
	await page.waitForTimeout(200)

	const parts = [slice(frames, headFrom, headTo), slice(frames, tailFrom, tailTo)]
	const list = parts
		.flat()
		.map((f) => `file '${f.file}'\nduration ${f.duration.toFixed(4)}`)
		.join("\n")
	const listFile = join(dir, "frames.txt")
	writeFileSync(listFile, `${list}\nfile '${parts[1].at(-1)!.file}'\n`)

	const out = join(ROOT, `docs/brand/entangle-stage-${theme}.gif`)
	const filter =
		`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[a][b];` +
		`[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`
	const ffmpeg = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-filter_complex", filter, "-loop", "0", out], {
		stdio: "inherit",
	})
	if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed for ${theme}`)
	rmSync(dir, { recursive: true, force: true })
	console.log(`${out}: ${(headTo - headFrom + tailTo - tailFrom).toFixed(1)} s`)
}

/** The frames shown between two times, each lasting until the next one (or the end); the frame on screen at `from` starts it. */
function slice(frames: Frame[], from: number, to: number) {
	const start = Math.max(0, frames.findLastIndex((f) => f.at <= from))
	const kept = frames.slice(start).filter((f, i) => i === 0 || f.at < to)
	return kept.map((f, i) => ({ file: f.file, duration: Math.max(0.001, (kept[i + 1]?.at ?? to) - Math.max(f.at, from)) }))
}

try {
	base = await startServer(values.port!)
	const browser = await chromium.launch()
	for (const theme of themes) {
		const context = await browser.newContext({ viewport: VIEW, colorScheme: theme })
		await record(await context.newPage(), theme)
		await context.close()
	}
	await browser.close()
} finally {
	server?.kill()
}
