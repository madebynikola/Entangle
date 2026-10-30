import { createAgent, type Agent } from "@mozaik-ai/core"
import type { Dataset, Researcher } from "../../data"
import { createTask, join, modelFor, runTask, state } from "../../runtime"
import type { Claim, RejectedClaim, ResearcherProfile, SentBack, Task } from "../../types"
import { SentBackToMe, describeRejections, postArtifact, sentBackTask } from "../critic/protocol"
import { EventOfType, applyClaimFixes, emit, parseJson, registerMockResponder, type ClaimFix } from "../matchmaker/shared"
import { profilerResponder } from "./mock"
import {
	PROFILER_INSTRUCTION,
	PROFILE_FIX_SCHEMA,
	PROFILE_SCHEMA,
	profileFixMessage,
	profileMessage,
	researcherBundle,
	type ProfileAnswer,
	type ProfileFixInput,
} from "./prompt"
import { ClaimFilter, clip, firstSentence, reportCleaned, retryOrFail } from "./shared"

export interface ProfilerOptions {
	data: Dataset
	/** Default: the role's model from config/models.ts, picked per task (spread over the providers with a key). */
	model?: string
	/** Participant name; give each one its own (`profiler-1`, `profiler-2`, ...). */
	name?: string
	/** Default: 4000 for a profile, 2000 for a fix. */
	maxOutputTokens?: number
	/** Mock runs only: plant one invented claim in the first profile, so a mock trace shows the Critic's send-back. */
	mockPlantFakeClaim?: boolean
}

export interface Profiler {
	agent: Agent
	/**
	 * Read one researcher's profile, publications, projects and patents in one loop and write a ResearcherProfile
	 * to `state.profiles` under the canonical id. It is posted to the Critic as it lands.
	 */
	profile(researcherId: string): Task
	/** Fix the rejected claims of a profile without the Critic's send-back (e.g. in a test). Null for an unknown profile. */
	fix(researcherId: string, rejected: RejectedClaim[]): Task | null
}

type Job =
	| { type: "profile"; researcherId: string; message: string }
	| { type: "fix"; input: ProfileFixInput; message: string }

/** Words that give a reason for limited availability. The availability claim states timing only. */
const PERSONAL = /parental|maternity|paternity|family|child|baby|pregnan|health|illness|sick|medical|personal/i

const PLANTED: Omit<Claim, "sourceIds"> = { text: "Holds three patents on quantum battery chemistry for satellites." }

/**
 * Create one Research Profiler and join it. It answers `critic.sent_back` for its own profiles by itself.
 * Identity (id, name, title, department, canLead) comes from the data, never from the model.
 * In a mock run it registers its canned answers on the mock runner.
 */
export function createProfiler(options: ProfilerOptions): Profiler {
	const { data } = options
	const jobs = new Map<string, Job>()
	let planted = false
	const agent = createAgent({
		name: options.name ?? "profiler",
		capabilities: ["inference", "profiler"],
		instruction: PROFILER_INSTRUCTION,
		tools: [],
		handlers: [
			{
				specification: new EventOfType("task.completed"),
				processor: { apply: ({ event }) => completed((event.payload as { taskId: string }).taskId) },
			},
			{
				specification: new SentBackToMe(),
				processor: { apply: ({ event }) => sentBack(event.payload as SentBack) },
			},
		],
	})
	join(agent)
	if (state().mock) registerMockResponder(profilerResponder)

	const run = (task: Task, job: Job, note = "") => {
		jobs.set(task.id, job)
		const structuredOutput = job.type === "profile" ? PROFILE_SCHEMA : PROFILE_FIX_SCHEMA
		const maxOutputTokens = options.maxOutputTokens ?? (job.type === "profile" ? 4000 : 2000)
		runTask(task, job.message + note, { model: options.model ?? modelFor("profiler"), structuredOutput, maxOutputTokens })
	}

	function profile(researcherId: string): Task {
		const id = data.canonicalId(researcherId)
		const message = profileMessage(researcherBundle(data, id))
		const task = createTask("profile", agent, id)
		run(task, { type: "profile", researcherId: id, message })
		return task
	}

	function fix(researcherId: string, rejected: RejectedClaim[]): Task | null {
		return startFix(createTask("profile", agent, researcherId), researcherId, rejected)
	}

	function sentBack(payload: SentBack): void {
		if (payload.kind !== "profile") return
		startFix(sentBackTask(payload), payload.id, payload.rejected, describeRejections(payload))
	}

	function startFix(task: Task, researcherId: string, rejected: RejectedClaim[], critique = ""): Task | null {
		const current = state().profiles.get(researcherId)
		if (!current) return null
		const input: ProfileFixInput = { profile: current, rejected, records: researcherBundle(data, current.researcherId) }
		run(task, { type: "fix", input, message: profileFixMessage(input) + (critique && `\n\n${critique}`) })
		return task
	}

	function completed(taskId: string): void {
		const job = jobs.get(taskId)
		const task = state().tasks.get(taskId)
		if (!job || !task) return
		jobs.delete(taskId)
		try {
			if (job.type === "profile") applyProfile(task, job.researcherId, parseJson<ProfileAnswer>(task.output))
			else applyFix(task, job.input, parseJson<{ fixes: ClaimFix[] }>(task.output).fixes)
		} catch (error) {
			retryOrFail(agent.getId(), task, error instanceof Error ? error.message : String(error), (note) => run(task, job, note))
		}
	}

	/** Only this researcher's records count: the profile (or an alias of it) and the linked papers, projects, patents. */
	function researcherRecord(researcherId: string, id: string): string | undefined {
		if (data.canonicalId(id) === researcherId) return researcherId
		const record = data.publications.get(id) ?? data.projects.get(id) ?? data.patents.get(id)
		return record?.researcherIds.includes(researcherId) ? id : undefined
	}

	function applyProfile(task: Task, researcherId: string, answer: ProfileAnswer): void {
		const s = state()
		const r = data.researcher(researcherId)!
		if (!answer || typeof answer !== "object") throw new Error("the answer is not an object")
		const filter = new ClaimFilter((id) => researcherRecord(r.id, id))
		const expertise = filter.list(answer.expertise)
		// A profile with no backed skill is useless to the Matchmaker; ask again, then keep what there is.
		if (!expertise.length && (r.publications.length || r.projects.length) && task.attempts < s.budget.maxAttempts) {
			throw new Error("expertise has no claim backed by this researcher's records")
		}
		const profile: ResearcherProfile = {
			...identityOf(r),
			expertise,
			industryFit: filter.list(answer.industryFit),
			availability: availabilityOf(r, answer.availability),
		}
		if (s.mock && options.mockPlantFakeClaim && !planted) {
			planted = true
			profile.expertise.push({ ...PLANTED, sourceIds: [r.id] })
		}
		reportCleaned(agent.getId(), task, r.id, filter)
		s.profiles.set(r.id, profile)
		postArtifact("profile", r.id, agent.getId(), task.id)
	}

	function applyFix(task: Task, input: ProfileFixInput, fixes: ClaimFix[]): void {
		const s = state()
		if (!Array.isArray(fixes)) throw new Error("fixes is not a list")
		const { researcherId } = input.profile
		// The Critic may have dropped the profile meanwhile.
		const current = s.profiles.get(researcherId)
		if (!current) return
		const expertise = [...current.expertise]
		const industryFit = [...current.industryFit]
		const availability = current.availability ? [current.availability] : []
		const missing = applyClaimFixes([expertise, industryFit, availability], input.rejected, fixes)
		if (missing.length) emit(agent.getId(), "fix.unmatched", { taskId: task.id, id: researcherId, rejected: missing })

		const filter = new ClaimFilter((id) => researcherRecord(researcherId, id))
		const fixed = filter.one(availability[0])
		const profile: ResearcherProfile = {
			...current,
			expertise: filter.list(expertise),
			industryFit: filter.list(industryFit),
			availability: fixed && !PERSONAL.test(fixed.text) ? fixed : null,
		}
		reportCleaned(agent.getId(), task, researcherId, filter)
		s.profiles.set(researcherId, profile)
		postArtifact("profile", researcherId, agent.getId(), task.id)
	}

	return { agent, profile, fix }
}

function identityOf(r: Researcher): Pick<ResearcherProfile, "researcherId" | "aliases" | "name" | "title" | "faculty" | "department" | "canLead"> {
	return { researcherId: r.id, aliases: r.aliases, name: r.name, title: r.title, faculty: r.faculty, department: r.department, canLead: r.canLead }
}

/**
 * Availability is a fact of the data, not of the model: none when the data has no limit. The model's sentence is
 * kept when it gives timing only; else the data's own (already redacted) first sentence.
 */
function availabilityOf(r: Researcher, written: unknown): Claim | null {
	if (!r.availability) return null
	const text = typeof written === "string" ? written.replace(/\s+/g, " ").trim() : ""
	const safe = text && !PERSONAL.test(text) ? text : clip(firstSentence(r.availability), 240)
	return { text: safe, sourceIds: [r.id] }
}
