/**
 * Offline audit of availabilityOf() (src/data/normalize.ts). Not part of a match run.
 *
 * Asks subq-snap-1.1 one yes/no question per researcher note: "Does this note limit the person's time for a new
 * project?" and lists the notes where its answer differs from the regex. Check the list by hand, then add regex
 * and data.test.ts cases for the real misses.
 *
 *   npx tsx scripts/audit-availability.ts [--refresh] [--threshold 0.5]
 *
 * Answers are cached in out/availability-audit/answers.json, so a second run costs nothing; --refresh asks again.
 * The report goes to out/availability-audit/disagreements.md. Needs SUBQ_API_KEY (.env or the shell).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { DECISION_PROVIDERS, SUBQ } from "../config/models"
import { availabilityOf, redactPersonal } from "../src/data/normalize"

const OUT = resolve("out/availability-audit")
const CACHE = resolve(OUT, "answers.json")
/** Questions per call: the API takes 1–128. */
const BATCH = 100
/** subq-snap-1.1 input price, USD per million tokens (src/runtime/pricing.ts). */
const USD_PER_MTOK = 0.04

const LIMITS =
	"The note says something that reduces the person's time for a new project: leave or a sabbatical, a full or heavy " +
	"workload, students or duties that take their time, no spare capacity, a limit on how much they can commit, " +
	"or that they are retired, away or not available."
const NO_LIMIT =
	"The note says nothing about the person's time, or says they have room: an open collaboration, a moderate load, " +
	"no planned leave. Shortage of equipment, data, a lab or a facility is not a limit on the person's time."

interface Answer {
	yes: number
}

interface Note {
	id: string
	name: string
	text: string
	regex: string | null
}

async function main(): Promise<void> {
	try {
		process.loadEnvFile()
	} catch {
		// No .env: the key comes from the shell.
	}
	const { values } = parseArgs({
		options: {
			refresh: { type: "boolean", default: false },
			threshold: { type: "string", default: String(SUBQ.threshold) },
		},
	})
	const threshold = Number(values.threshold)

	const raw = JSON.parse(readFileSync(resolve("data/raw/data/researchers.json"), "utf8")).researchers as {
		id: string
		name: string
		notes: string | null
	}[]
	// The text the dataset gives availabilityOf(): redacted notes.
	const notes: Note[] = raw
		.filter((r) => r.notes?.trim())
		.map((r) => {
			const text = redactPersonal(r.notes!)
			return { id: r.id, name: r.name, text, regex: availabilityOf(text) }
		})

	mkdirSync(OUT, { recursive: true })
	const cached: Record<string, Answer> = !values.refresh && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {}
	const todo = notes.filter((n) => !cached[n.id])
	let tokens = 0
	for (let i = 0; i < todo.length; i += BATCH) {
		const batch = todo.slice(i, i + BATCH)
		const { answers, inputTokens } = await ask(batch)
		tokens += inputTokens
		for (const n of batch) if (answers[n.id]) cached[n.id] = answers[n.id]
		writeFileSync(CACHE, JSON.stringify(cached, null, "\t"))
		console.log(`asked ${Math.min(i + BATCH, todo.length)} of ${todo.length}`)
	}
	if (todo.length) console.log(`${tokens} input tokens, about $${((tokens * USD_PER_MTOK) / 1e6).toFixed(4)}`)

	const missing = notes.filter((n) => !cached[n.id])
	const subq = (n: Note) => cached[n.id].yes >= threshold
	const answered = notes.filter((n) => cached[n.id])
	const regexOnly = answered.filter((n) => n.regex && !subq(n)).sort((a, b) => cached[a.id].yes - cached[b.id].yes)
	const subqOnly = answered.filter((n) => !n.regex && subq(n)).sort((a, b) => cached[b.id].yes - cached[a.id].yes)
	const both = answered.filter((n) => n.regex && subq(n)).length

	const lines = [
		`# availabilityOf() against ${SUBQ.model}`,
		"",
		`${notes.length} notes, threshold ${threshold}. Both say limit: ${both}. Regex only: ${regexOnly.length}. SubQ only: ${subqOnly.length}.` +
			(missing.length ? ` No answer for ${missing.length}.` : ""),
		"",
		"## SubQ says limit, the regex does not (possible regex misses)",
		"",
		...subqOnly.map((n) => `- ${n.id} (${pct(cached[n.id].yes)}) ${n.text}`),
		"",
		"## The regex says limit, SubQ does not (possible false positives)",
		"",
		...regexOnly.map((n) => `- ${n.id} (${pct(cached[n.id].yes)}) matched: ${n.regex}\n  note: ${n.text}`),
		"",
	]
	writeFileSync(resolve(OUT, "disagreements.md"), lines.join("\n"))
	console.log(lines.slice(2, 3)[0])
	console.log(`Report: ${resolve(OUT, "disagreements.md")}`)
}

const pct = (p: number) => `${Math.round(p * 100)}%`

async function ask(batch: Note[]): Promise<{ answers: Record<string, Answer>; inputTokens: number }> {
	const provider = DECISION_PROVIDERS.subq
	const apiKey = process.env[provider.key]
	if (!apiKey) throw new Error(`${provider.key} is not set`)
	const model = process.env.SUBQ_MODEL || SUBQ.model
	const state: Record<string, string> = {}
	const questions: Record<string, unknown> = {}
	batch.forEach((n, i) => {
		state[`note_${i + 1}`] = n.text
		questions[`note_${i + 1}`] = {
			type: "noul",
			instructions: `Does note_${i + 1} limit the person's time for a new project?`,
			criteria: { true: LIMITS, false: NO_LIMIT },
		}
	})
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(`${provider.baseUrl}/systemone`, {
			method: "POST",
			headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
			body: JSON.stringify({ model, state, questions }),
			signal: AbortSignal.timeout(SUBQ.timeoutMs),
		})
		const body = (await response.json().catch(() => undefined)) as
			| { answers?: Record<string, { noul?: number }>; usage?: { input_tokens?: number }; detail?: unknown }
			| undefined
		if (response.ok && body?.answers) {
			const answers: Record<string, Answer> = {}
			batch.forEach((n, i) => {
				const yes = body.answers![`note_${i + 1}`]?.noul
				if (typeof yes === "number") answers[n.id] = { yes }
			})
			return { answers, inputTokens: body.usage?.input_tokens ?? 0 }
		}
		const retry = response.status === 429 || response.status >= 500
		if (!retry || attempt >= 4) throw new Error(`${response.status} ${JSON.stringify(body?.detail ?? response.statusText)}`)
		await new Promise((done) => setTimeout(done, 2000 * 2 ** attempt))
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
