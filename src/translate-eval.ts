import { mkdirSync, writeFileSync } from "node:fs"
import { join as joinPath } from "node:path"
import { parseArgs } from "node:util"
import { createAgent } from "@mozaik-ai/core"
import { createTranslator } from "./agents/critic/translate"
import { join, localClaude, startRuntime, state } from "./runtime"
import type { SourceRecord } from "./types"

const USAGE = `Usage: npm run translate:eval -- [--local] [--tries 20] [--model claude-haiku-4-5 ...]

Runs only the record translation on the Serbian reverse search (out/reverse-searches/serbian), many times, and counts
how often "oštećenja kore" (damage to the fruit skin) comes out in the wrong sense ("bark", "crust"). Each try is a new
translator, as in a new run. The per-try result goes to out/translate-eval/.

  --local   Every model call as a local Claude Code session on your own login (same as LOCAL_CLAUDE=1).
  --tries   Tries per model (default 20).
  --model   The translating model; give it more than once to measure several (default: Haiku 4.5 and Sonnet 4.6).`

const KEY_VARS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]

/** The challenge record of the Serbian reverse search, as out/reverse-searches/serbian/sources.json has it. */
const SORTING = "Naša linija za sortiranje voća često pogrešno razvrstava jabuke sa sitnim oštećenjima kore i početnom truleži."
const RECORD: SourceRecord = {
	id: "C999-CH1",
	kind: "challenge",
	title: SORTING,
	text: `${SORTING}\n\nProbali smo kameru sa fiksnim pragovima boje, ali greška je i dalje oko 12% i kupci vraćaju robu. Imamo 40.000 označenih slika jabuka iz tri sezone berbe.`,
	researcherIds: [],
	companyId: "C999",
}

/** The sense of "kora" in the first line's English: the fruit's skin (right), a tree's bark or a crust (wrong), or none found. */
export function senseOf(english: string | undefined): "right" | "wrong" | "missing" {
	if (!english) return "missing"
	if (/\b(bark|crust|cortex)\b/i.test(english)) return "wrong"
	if (/\b(skin|peel|rind)\b/i.test(english)) return "right"
	return "missing"
}

interface Try {
	model: string
	try: number
	sense: ReturnType<typeof senseOf>
	english: string
	tokens: number
	costUsd: number
	ms: number
	/** Each translation task's model and answer, in order. */
	answers: Array<{ model?: string; output?: string }>
}

async function main(): Promise<void> {
	try {
		process.loadEnvFile()
	} catch {
		// No .env: keys come from the shell.
	}
	const { values } = parseArgs({
		options: {
			local: { type: "boolean", default: false },
			tries: { type: "string", default: "20" },
			model: { type: "string", multiple: true },
			help: { type: "boolean", short: "h", default: false },
		},
	})
	if (values.help) {
		console.log(USAGE)
		return
	}
	if (values.local) process.env.LOCAL_CLAUDE = "1"
	if (!localClaude() && !KEY_VARS.some((name) => process.env[name])) {
		throw new Error(`No API key set (${KEY_VARS.join(", ")}). Add one to .env, or run with --local.`)
	}
	const models = values.model?.length ? values.model : ["claude-haiku-4-5", "claude-sonnet-4-6"]
	const tries = Number(values.tries)
	const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
	const s = startRuntime({ runId, mock: false })

	const results: Try[] = []
	await Promise.all(
		models.flatMap((model) =>
			Array.from({ length: tries }, async (_, i) => {
				const asker = createAgent({ name: `translate-eval-${model}-${i + 1}`, capabilities: ["inference"], instruction: "", tools: [], handlers: [] })
				join(asker)
				const translator = createTranslator(model)
				const started = Date.now()
				const english = (await translator.of([RECORD], asker, RECORD.companyId ?? RECORD.id)).get(RECORD.id)?.[0]?.english ?? ""
				const tasks = [...state().tasks.values()].filter((task) => task.assignee === asker.getId())
				const result: Try = {
					model,
					try: i + 1,
					sense: senseOf(english),
					english,
					tokens: tasks.reduce((sum, task) => sum + task.tokens, 0),
					costUsd: tasks.reduce((sum, task) => sum + task.costUsd, 0),
					ms: Date.now() - started,
					answers: tasks.map((task) => ({ model: task.model, output: task.output })),
				}
				results.push(result)
				console.log(`${model} #${result.try}: ${result.sense.padEnd(7)} ${english}`)
			}),
		),
	)

	console.log(`\n${tries} tries per model, "oštećenja kore":`)
	for (const model of models) {
		const mine = results.filter((result) => result.model === model)
		const count = (sense: Try["sense"]) => mine.filter((result) => result.sense === sense).length
		const cost = mine.reduce((sum, result) => sum + result.costUsd, 0) / mine.length
		const tokens = mine.reduce((sum, result) => sum + result.tokens, 0) / mine.length
		const ms = mine.reduce((sum, result) => sum + result.ms, 0) / mine.length
		console.log(
			`  ${model}: wrong ${count("wrong")} of ${mine.length}, right ${count("right")}, missing ${count("missing")}; ` +
				`per record ${Math.round(tokens)} tokens, $${cost.toFixed(4)}, ${(ms / 1000).toFixed(1)} s`,
		)
	}
	const dir = "out/translate-eval"
	mkdirSync(dir, { recursive: true })
	const file = joinPath(dir, `${runId}.json`)
	writeFileSync(file, JSON.stringify({ runId, local: localClaude(), tries, models, results }, null, "\t"))
	console.log(`\nWrote ${file}. Run cost $${s.budget.costUsd.toFixed(3)} at API prices.`)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
