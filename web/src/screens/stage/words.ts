import type { RunResults } from "@shared/server/api"
import { ROLE_INFO, roleOf } from "@/lib/roles"
import type { Act, Artifact, Line } from "./derive"

/**
 * How the faces say things: names in place of ids, and a few ways to say each thing, so the same verdict does not
 * read the same fifty times. The choice of wording follows the item, so a replay says the same lines every time.
 */

export interface Names {
	company: Map<string, string>
	researcher: Map<string, string>
}

export function namesOf(results: RunResults | null): Names {
	const company = new Map<string, string>()
	const researcher = new Map<string, string>()
	for (const need of results?.needs ?? []) {
		if (need.companyName) company.set(need.companyId, need.companyName)
	}
	for (const profile of results?.profiles ?? []) {
		if (profile.name) researcher.set(profile.researcherId, profile.name)
	}
	return { company, researcher }
}

/** `C010` or `C010-CH1` → Kredo Fintech; `R0801` → Branislav Žarković; `C010-CH1:R0801` → Kredo Fintech and Branislav Žarković. */
export function nameOf(id: string | undefined, names: Names): string {
	if (!id) return "it"
	const pair = id.match(/^(C\d{3})(?:-CH\d+)?[:-](R\d{3,4})$/)
	if (pair) return `${names.company.get(pair[1]) ?? pair[1]} and ${names.researcher.get(pair[2]) ?? pair[2]}`
	const company = id.match(/^(C\d{3})(?:-CH\d+)?$/)
	if (company) return names.company.get(company[1]) ?? id
	if (/^R\d{3,4}$/.test(id)) return names.researcher.get(id) ?? id
	return id
}

/** `analyst-2` → Spica 2; `matchmaker` → Amity. */
export function agentName(name: string | undefined): string {
	if (!name) return "someone"
	const info = ROLE_INFO[roleOf(name)]
	if (!info.name) return name
	const n = name.match(/-(\d+)$/)?.[1]
	return n ? `${info.name} ${n}` : info.name
}

const NOUN: Record<Artifact, [string, string]> = {
	need: ["need", "needs"],
	profile: ["profile", "profiles"],
	pair: ["pair", "pairs"],
	proposal: ["proposal", "proposals"],
}

function noun(artifact: Artifact | undefined, n: number): string {
	const [one, many] = artifact ? NOUN[artifact] : ["item", "items"]
	return n === 1 ? one : many
}

/** A stable pick from a few wordings. */
function pick<T>(seed: string, options: T[]): T {
	let hash = 0
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
	return options[Math.abs(hash) % options.length]
}

/** What a cited record is, in words: a page id names its kind, a dataset id its type. */
const RECORD: [RegExp, string][] = [
	[/\bC\d{3}\/website\/[^\s,;)\]]*/g, "their website"],
	[/\bC\d{3}\/news\/[^\s,;)\]]*/g, "a news page"],
	[/\bC\d{3}\/jobs?\/[^\s,;)\]]*/g, "a job ad"],
	[/\bC\d{3}\/[a-z-]+\/[^\s,;)\]]*/g, "a company page"],
	[/\bSYN-PUB-\d+/g, "a paper"],
	[/\bSYN-PRJ-\d+/g, "a project"],
	[/\bSYN-PAT-\d+/g, "a patent"],
	[/\bW\d{6,}\b/g, "published work"],
]

/** The first sentence of a Critic reason, with ids as names, short enough for a bubble. */
function brief(reason: string | undefined, names: Names, max = 84): string {
	if (!reason) return ""
	let text = reason.replace(/\s+/g, " ").trim()
	for (const [pattern, words] of RECORD) text = text.replace(pattern, words)
	text = text.replace(/\[|\]/g, "").replace(/\b(?:C\d{3}(?:-CH\d+)?|R\d{3,4})\b/g, (id) => nameOf(id, names))
	// A sentence ends at a full stop after a word, not after "d.o.o." or "a.d.".
	const first = text.split(/(?<=[a-z0-9)]{2}\.)\s(?=[A-Z])/)[0]
	return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
}

/** "Kredo Fintech, AutomVoj and 3 more". */
function some(ids: (string | undefined)[], names: Names): string {
	const unique = [...new Set(ids.map((id) => nameOf(id, names)))]
	if (unique.length <= 2) return unique.join(" and ")
	return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`
}

const TASK: Record<string, string> = { analyze: "read", profile: "profile", match: "match", write: "write up", critique: "check", translate: "translate" }

/** A name that ends in a full stop ("TloCare d.o.o.") does not get a second one. */
function tidy(text: string): string {
	return text.replace(/\.\.(?!\.)/g, ".").replace(/\s+/g, " ").trim()
}

/**
 * What one line says, alone. A bubble stays short; the log (`detail`) adds the Critic's reason.
 */
export function sayOne(line: Line, names: Names, detail = false): string {
	return tidy(sayRaw(line, names, detail))
}

function sayRaw(line: Line, names: Names, detail: boolean): string {
	const x = nameOf(line.id, names)
	const seed = `${line.act}${line.id ?? line.key}`
	switch (line.act) {
		case "plan":
			return `${line.totals?.companies ?? 0} companies, ${line.totals?.challenges ?? 0} challenges. Let's find pairs.`
		case "assign":
			return `${agentName(line.assignee)}, ${TASK[line.task ?? ""] ?? "take"} ${x}.`
		case "shortlist":
			if (!line.count) return `Search found nobody for ${x}.`
			return pick(seed, [
				`Search found ${line.count} people for ${x}. Tycho, over to you.`,
				`${line.count} researchers might fit ${x}. Tycho, profile them.`,
			])
		case "post":
			switch (line.artifact) {
				case "need":
					return pick(seed, [`Read ${x}. Their need is up.`, `${x} has a real research problem. Posted.`, `Posted what ${x} needs.`])
				case "profile":
					return pick(seed, [`${x} is profiled.`, `Read ${x}'s work. Profile posted.`, `Here is what ${x} has done.`])
				case "pair":
					return pick(seed, [`${x}. A good fit.`, `I would put ${x} together.`, `Matched ${x}.`])
				case "proposal":
					return pick(seed, [`Wrote the proposal for ${x}.`, `Draft is done: ${x}.`, `Proposal for ${x}, ready to check.`])
				default:
					return `Posted ${x}.`
			}
		case "pass":
			return pick(seed, [`${x} checks out.`, `Every claim on ${x} has a source.`, `${x}: sourced. Passed.`, `Read ${x} against the records. Fine.`])
		case "send-back": {
			if (detail) return `Sent back ${x}. ${brief(line.reason, names, 160)}`
			const claims = line.count && line.count > 1 ? `${line.count} claims have no source` : "a claim has no source"
			return pick(seed, [`Sending back ${x}: ${claims}.`, `Not yet, ${x}. ${claims[0].toUpperCase()}${claims.slice(1)}.`, `${x} goes back: ${claims}.`])
		}
		case "escalate":
			return pick(seed, [`${x} needs a person to decide.`, `I cannot clear ${x}. Over to you.`])
		case "drop":
			return `Dropped ${x}. It cannot be fixed.`
		case "no-match":
			return pick(seed, [`No good match for ${x}.`, `Nobody fits ${x} well enough. I will not force it.`])
		case "pair-dropped":
			return `Dropped ${x}. Nothing held up after the fix.`
		case "decide":
			return pick(seed, [`Tinta, write up ${x}.`, `${x} it is. Tinta, your turn.`])
		case "funding":
			if (!line.count) return `No open EU call fits ${x}.`
			return pick(seed, [
				`${line.count} open EU call${line.count === 1 ? "" : "s"} fit ${x}.`,
				`Found ${line.count} EU call${line.count === 1 ? "" : "s"} for ${x}. Tinta, they go at the end.`,
			])
		case "done":
			return `Done. ${line.totals?.proposals ?? 0} proposals from ${line.totals?.pairs ?? 0} pairs.`
		case "fail": {
			const limit = limitOf(line.error)
			if (limit) return `${line.id ?? "A task"} stopped at the ${LIMIT[limit]} limit.`
			return `${line.id ?? "A task"} failed. Trying again.`
		}
	}
}

/** The run limit a task error names, or null when the task failed for another reason. See budgetExceeded in src/runtime/state.ts and stopOverdue in the orchestrator. */
export type Limit = "time" | "token" | "cost"

const LIMIT: Record<Limit, string> = { time: "time", token: "token", cost: "cost" }

export function limitOf(error: string | undefined): Limit | null {
	if (!error) return null
	if (/^(timeout: )?wall clock/.test(error)) return "time"
	if (/^tokens /.test(error)) return "token"
	if (/^cost /.test(error)) return "cost"
	return null
}

/** The verb the log shows beside the face's name: a task the limit stopped did not fail. */
export function verbOf(line: Line): string {
	return line.act === "fail" && limitOf(line.error) ? "stopped" : VERB[line.act]
}

/** Lines in log order, with each run of tasks stopped by the same limit as one entry. */
export function groupLog(lines: Line[]): Line[][] {
	const groups: Line[][] = []
	for (const line of lines) {
		const last = groups.at(-1)
		const limit = line.act === "fail" ? limitOf(line.error) : null
		if (last && limit && last[0].act === "fail" && limitOf(last[0].error) === limit) last.push(line)
		else groups.push([line])
	}
	return groups
}

const cap = (text: string) => text[0].toUpperCase() + text.slice(1)

/** What a group of the same act says together: one line for a burst. */
export function sayMany(lines: Line[], names: Names): string {
	return lines.length === 1 ? sayOne(lines[0], names) : tidy(sayGroup(lines, names))
}

function sayGroup(lines: Line[], names: Names): string {
	const { act, artifact } = lines[0]
	const n = lines.length
	const items = some(
		lines.map((line) => line.id),
		names,
	)
	const seed = `${act}${lines[0].key}`
	switch (act) {
		case "assign":
			return pick(seed, [`Handing out ${n} tasks.`, `${n} new tasks. Go.`])
		case "shortlist":
			return `Shortlists ready for ${items}. Tycho, over to you.`
		case "post":
			return artifact === "profile"
				? `Profiled ${items}.`
				: artifact === "need"
					? `Posted needs from ${items}.`
					: `Posted ${n} ${noun(artifact, n)}: ${items}.`
		case "pass":
			return pick(seed, [`Checked ${n} ${noun(artifact, n)}. All sourced.`, `${n} ${noun(artifact, n)} passed.`])
		case "send-back":
			return pick(seed, [`Sent back ${n} ${noun(artifact, n)}. Some claims have no source.`, `${n} ${noun(artifact, n)} go back for fixes.`])
		case "escalate":
			return `${n} ${noun(artifact, n)} need a person to decide.`
		case "no-match":
			return `No good match for ${items}.`
		case "decide":
			return `Picked ${n} pairs to write up.`
		case "funding":
			return `Scouted EU calls for ${items}.`
		case "fail": {
			const limit = limitOf(lines[0].error)
			if (limit && lines.every((line) => limitOf(line.error) === limit)) return `${cap(LIMIT[limit])} limit reached. ${n} open tasks stopped.`
			return sayOne(lines.at(-1)!, names)
		}
		default:
			return sayOne(lines.at(-1)!, names)
	}
}

/** The verb the log shows beside the face's name. */
export const VERB: Record<Act, string> = {
	plan: "planned the run",
	assign: "assigned",
	shortlist: "shortlisted",
	post: "posted",
	pass: "passed",
	"send-back": "sent back",
	escalate: "asked for a person",
	drop: "dropped",
	"no-match": "found no match",
	"pair-dropped": "dropped a pair",
	decide: "chose a pair",
	funding: "scouted EU calls",
	done: "finished",
	fail: "failed",
}
