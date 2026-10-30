import type { RunInfo, RunResults } from "@shared/server/api"
import type {
	Claim,
	CompanyNeed,
	CriticVerdict,
	PairCandidate,
	Proposal,
	ResearcherProfile,
	SourceRecord,
	TraceRecord,
} from "@shared/types"

/**
 * A built-in sample run with invented data, so the live and results screens have something rich to show
 * before a real run exists. Works in every mode (dev server, static build) as run id "sample".
 *
 * Shape: 1 orchestrator, 4 analysts, 6 profilers, 1 matchmaker, 3 writers, 1 critic, about 40 s.
 * The Critic rejects one claim in proposal p-3; writer-3 fixes it on a second attempt.
 * Custom events use the payloads real runs write (30 Oct): `artifact.posted`, `critic.reviewing`,
 * `critic.verdict` and `critic.sent_back` (see src/agents/critic/).
 */

export const SAMPLE_ID = "sample"
const START = Date.parse("2026-10-30T14:00:00.000Z")
const HAIKU = "claude-haiku-4-5"
const SONNET = "claude-sonnet-5-5"
const PRICE: Record<string, [number, number]> = { [HAIKU]: [1, 5], [SONNET]: [3, 15] }

// ---------------------------------------------------------------------------
// Results: what the run found
// ---------------------------------------------------------------------------

const c = (text: string, ...sourceIds: string[]): Claim => ({ text, sourceIds })

const needs: CompanyNeed[] = [
	{
		challengeId: "C014-CH1",
		companyId: "C014",
		companyName: "Agrodron d.o.o.",
		sector: "Agriculture technology",
		triage: "research",
		triageReason: "Needs a new detection method; no product does this for sunflower at field scale.",
		restatement: c(
			"Detect early water and nutrient stress in sunflower from multispectral drone images, 7–10 days before it is visible.",
			"C014-CH1",
		),
		searchTerms: ["multispectral imaging", "crop stress detection", "UAV remote sensing", "sunflower"],
		assets: [c("Four seasons of multispectral flights over 1,200 ha, with yield maps.", "C014-CH1", "C014/job/2026-03-02/Data engineer")],
		constraints: [c("Models must run on the drone's edge computer during flight.", "C014-CH1")],
	},
	{
		challengeId: "C027-CH2",
		companyId: "C027",
		companyName: "Vodovod Plus",
		sector: "Water utilities",
		triage: "research",
		triageReason: "Leak localisation from sparse pressure data is an open signal-processing problem.",
		restatement: c("Locate leaks in a city water network from 40 pressure sensors, to within one street block.", "C027-CH2"),
		searchTerms: ["leak localisation", "pressure transients", "water distribution network", "graph signal processing"],
		assets: [c("Two years of pressure data at 1 Hz and a log of 310 confirmed leaks.", "C027-CH2")],
		constraints: [c("No new sensors in the first year.", "C027-CH2")],
	},
	{
		challengeId: "C051-CH1",
		companyId: "C051",
		companyName: "Linija Robotics",
		sector: "Industrial automation",
		triage: "research",
		triageReason: "Grasping mixed, reflective parts from a bin is beyond current off-the-shelf vision.",
		restatement: c("Cut grasp failures of a robot arm picking mixed metal parts from a bin from 12% to under 2%.", "C051-CH1"),
		searchTerms: ["bin picking", "robotic grasping", "reflective objects", "6-DoF pose estimation"],
		assets: [c("A test cell with the production robot and 40,000 logged grasp attempts.", "C051-CH1")],
		constraints: [c("Cycle time must stay under 4 seconds per part.", "C051-CH1")],
	},
	{
		challengeId: "C088-CH1",
		companyId: "C088",
		companyName: "Kancelarija 360",
		sector: "Office services",
		triage: "engineering-service",
		triageReason: "A web shop with a CRM is a software build, not a research question.",
		restatement: c("Build a web shop with a customer database for an office-supplies business.", "C088-CH1"),
		searchTerms: ["e-commerce", "CRM"],
		assets: [],
		constraints: [],
	},
]

const profiles: ResearcherProfile[] = [
	{
		researcherId: "R0112",
		aliases: [],
		name: "Milica Ranković",
		title: "Associate Professor",
		faculty: "Faculty of Technical Sciences",
		department: "Department of Computing and Control Engineering",
		expertise: [
			c("Multispectral image analysis for crop monitoring from drones.", "SYN-PUB-02211", "SYN-PUB-02240"),
			c("Few-shot learning for plant disease detection.", "SYN-PUB-02263"),
		],
		industryFit: [c("Open to supervising industrial PhD students.", "R0112"), c("Led a regional precision-farming project.", "SYN-PRJ-0412")],
		availability: c("Can take a new doctoral student from autumn 2026.", "R0112"),
		canLead: true,
	},
	{
		researcherId: "R0347",
		aliases: [],
		name: "Dušan Perišić",
		title: "Full Professor",
		faculty: "Faculty of Technical Sciences",
		department: "Department of Power, Electronic and Telecommunication Engineering",
		expertise: [
			c("Transient analysis in pressurised pipe networks.", "SYN-PUB-04102", "SYN-PUB-04117"),
			c("Graph signal processing for sensor networks.", "SYN-PUB-04130"),
		],
		industryFit: [c("Consulted for two municipal utilities.", "R0347")],
		availability: null,
		canLead: true,
	},
	{
		researcherId: "R0539",
		aliases: ["R0139"],
		name: "Ivana Stojkov",
		title: "Assistant Professor",
		faculty: "Faculty of Technical Sciences",
		department: "Department of Industrial Engineering and Management",
		expertise: [
			c("Learning-based grasp planning for cluttered bins.", "SYN-PUB-06021", "SYN-PUB-06044"),
			c("Pose estimation of reflective metal parts.", "SYN-PUB-06058"),
		],
		industryFit: [c("Built a sorting rig with an automotive supplier.", "SYN-PAT-041", "SYN-PRJ-0977")],
		availability: c("Teaching load is lighter from spring 2027.", "R0539"),
		canLead: true,
	},
	{
		researcherId: "R0718",
		aliases: [],
		name: "Nemanja Lalić",
		title: "Associate Professor",
		faculty: "Faculty of Agriculture",
		department: "Department of Field and Vegetable Crops",
		expertise: [c("Drought response of sunflower hybrids.", "SYN-PUB-07702", "SYN-PUB-07715")],
		industryFit: [c("Open to joint projects with seed and agritech companies.", "R0718")],
		availability: null,
		canLead: true,
	},
	{
		researcherId: "R0861",
		aliases: [],
		name: "Tamara Vujić",
		title: "Research Associate",
		faculty: "Faculty of Sciences",
		department: "Department of Physics",
		expertise: [c("Hyperspectral sensor calibration.", "SYN-PUB-08610")],
		industryFit: [],
		availability: null,
		canLead: false,
	},
	{
		researcherId: "R0904",
		aliases: [],
		name: "Bojan Šarac",
		title: "Professor Emeritus",
		faculty: "Faculty of Technical Sciences",
		department: "Department of Mechanics",
		expertise: [c("Industrial manipulator dynamics.", "SYN-PUB-09041")],
		industryFit: [],
		availability: c("Emeritus: cannot lead a new project.", "R0904"),
		canLead: false,
	},
]

const pairs: PairCandidate[] = [
	{
		id: "C014-CH1:R0112",
		challengeId: "C014-CH1",
		companyId: "C014",
		researcherId: "R0112",
		fit: 0.86,
		why: [
			c("The company has four seasons of multispectral flights with yield maps.", "C014-CH1"),
			c("Her group detects plant stress from multispectral drone images.", "SYN-PUB-02211", "SYN-PUB-02240"),
		],
		problem: c("Find the earliest spectral signs of stress in sunflower, and run the model on the drone.", "C014-CH1"),
		risks: [c("Labels for early stress exist for only two of the four seasons.", "C014-CH1")],
	},
	{
		id: "C027-CH2:R0347",
		challengeId: "C027-CH2",
		companyId: "C027",
		researcherId: "R0347",
		fit: 0.78,
		why: [
			c("The utility logged 310 confirmed leaks next to its pressure data.", "C027-CH2"),
			c("He models pressure transients in pipe networks.", "SYN-PUB-04102", "SYN-PUB-04117"),
		],
		problem: c("Localise leaks from 40 sensors with graph signal processing.", "C027-CH2", "SYN-PUB-04130"),
		risks: [c("Sensor placement is fixed for the first year.", "C027-CH2")],
	},
	{
		id: "C051-CH1:R0539",
		challengeId: "C051-CH1",
		companyId: "C051",
		researcherId: "R0539",
		fit: 0.81,
		why: [
			c("The company logged 40,000 grasp attempts in a test cell.", "C051-CH1"),
			c("Her work learns grasps for cluttered bins and reflective parts.", "SYN-PUB-06021", "SYN-PUB-06058"),
		],
		problem: c("Learn grasps for reflective mixed parts that keep the cycle under 4 s.", "C051-CH1"),
		risks: [c("Her teaching load is high until spring 2027.", "R0539")],
	},
	{
		id: "C014-CH1:R0718",
		challengeId: "C014-CH1",
		companyId: "C014",
		researcherId: "R0718",
		fit: 0.64,
		why: [c("He studies drought response in sunflower hybrids.", "SYN-PUB-07702")],
		problem: c("Ground-truth stress labels from field physiology.", "C014-CH1", "SYN-PUB-07715"),
		risks: [c("No imaging or machine-learning work of his own.", "R0718")],
	},
]

const proposals: Proposal[] = [
	{
		id: "p-1",
		pairId: "C014-CH1:R0112",
		kind: "industrial-phd",
		title: "Seeing drought before the leaves do: early stress detection in sunflower from drone imagery",
		revision: 0,
		claims: [pairs[0].why[0], pairs[0].why[1], needs[0].constraints[0]],
		markdown: `## Seeing drought before the leaves do

**Company:** Agrodron d.o.o. (C014). **Faculty:** Faculty of Technical Sciences, Computing and Control Engineering.
**Supervisors:** Milica Ranković (R0112) and the company's head of agronomy.

### The problem
Stress in sunflower shows to the eye 7–10 days too late to act [C014-CH1]. The company already flies multispectral drones over 1,200 ha and keeps yield maps for four seasons [C014-CH1].

### Research questions
1. Which spectral bands change first under water or nitrogen stress?
2. Can a model small enough for the drone's edge computer detect it in flight [C014-CH1]?

### Plan
| Year | Work | Result |
| --- | --- | --- |
| 1 | Label early stress on two seasons; baseline models | A dataset paper |
| 2 | Few-shot models for new hybrids [SYN-PUB-02263] | A journal paper |
| 3 | In-flight trial over one season | The thesis; a decision on rollout |

### Why this pair
Her group detects plant stress from multispectral drone images [SYN-PUB-02211, SYN-PUB-02240]. The company has the flights and the yield data. Neither could do it alone.`,
	},
	{
		id: "p-2",
		pairId: "C027-CH2:R0347",
		kind: "joint-project",
		title: "Finding leaks by listening to pressure: a one-year joint project",
		revision: 0,
		claims: [pairs[1].why[0], pairs[1].why[1], pairs[1].problem],
		markdown: `## Finding leaks by listening to pressure

**Company:** Vodovod Plus (C027). **Lead:** Dušan Perišić (R0347).

### The problem
Leaks are found by crews walking the network. The utility has 40 pressure sensors and a log of 310 confirmed leaks [C027-CH2].

### Approach
Model the network as a graph and look for the pressure transient a leak leaves behind [SYN-PUB-04102, SYN-PUB-04130].

### First 6 months
- Align the leak log with the pressure data.
- Rebuild 50 past leaks in a network model and test localisation.`,
	},
	{
		id: "p-3",
		pairId: "C051-CH1:R0539",
		kind: "industrial-phd",
		title: "Grasping what shines: learning to pick reflective parts from a bin",
		revision: 1,
		claims: [pairs[2].why[0], pairs[2].why[1], c("She built a sorting rig with an automotive supplier.", "SYN-PRJ-0977")],
		markdown: `## Grasping what shines

**Company:** Linija Robotics (C051). **Faculty:** Faculty of Technical Sciences.
**Supervisors:** Ivana Stojkov (R0539) and the company's lead automation engineer.

### The problem
12% of grasps fail when the arm picks mixed metal parts from a bin [C051-CH1]. The company has logged 40,000 attempts [C051-CH1].

### Why this pair
Her work learns grasps for cluttered bins and reflective parts [SYN-PUB-06021, SYN-PUB-06058]. She built a sorting rig with an automotive supplier [SYN-PRJ-0977].`,
	},
]

const rejected = c("She holds a patent on a vacuum gripper for metal parts.", "SYN-PAT-041")

const verdicts: CriticVerdict[] = [
	{ proposalId: "p-1", revision: 0, ok: true, rejected: [] },
	{ proposalId: "p-2", revision: 0, ok: true, rejected: [] },
	{
		proposalId: "p-3",
		revision: 0,
		ok: false,
		rejected: [{ claim: rejected, reason: "SYN-PAT-041 is a conveyor sorting rig, not a vacuum gripper. The source does not support the claim." }],
	},
	{ proposalId: "p-3", revision: 1, ok: true, rejected: [] },
]

const results: RunResults = {
	needs,
	profiles,
	pairs,
	noMatches: [{ challengeId: "C088-CH1", reason: "Not a research problem: a web shop with a CRM is a software build. A software vendor fits better." }],
	proposals,
	verdicts,
	approvals: {},
}

// ---------------------------------------------------------------------------
// Sources: the records the claims cite
// ---------------------------------------------------------------------------

const src = (id: string, kind: SourceRecord["kind"], title: string, text: string, researcherIds: string[] = [], extra: Partial<SourceRecord> = {}): SourceRecord => ({
	id,
	kind,
	title,
	text,
	researcherIds,
	...extra,
})

const sources: Record<string, SourceRecord> = Object.fromEntries(
	[
		src("C014", "company", "Agrodron d.o.o.", "Drone services for precision agriculture in Bačka. 45 employees.", [], { companyId: "C014" }),
		src("C014-CH1", "challenge", "Early crop stress from drone images", "We fly multispectral drones over 1,200 ha of sunflower and keep yield maps for four seasons. Stress shows to the eye 7–10 days too late. We want to see it earlier, on the drone's edge computer during flight.", [], { companyId: "C014" }),
		src("C014/job/2026-03-02/Data engineer", "page", "Job ad: Data engineer", "Maintain our archive of multispectral flights and yield maps.", [], { companyId: "C014", year: 2026 }),
		src("C027", "company", "Vodovod Plus", "Water network services for three municipalities.", [], { companyId: "C027" }),
		src("C027-CH2", "challenge", "Leak localisation from pressure data", "40 pressure sensors at 1 Hz for two years and a log of 310 confirmed leaks. No new sensors in the first year.", [], { companyId: "C027" }),
		src("C051", "company", "Linija Robotics", "Robot cells for metal-part handling.", [], { companyId: "C051" }),
		src("C051-CH1", "challenge", "Bin picking of mixed metal parts", "12% of grasps fail on mixed, reflective parts. 40,000 logged attempts. Cycle time must stay under 4 s.", [], { companyId: "C051" }),
		src("C088", "company", "Kancelarija 360", "Office supplies and services.", [], { companyId: "C088" }),
		src("C088-CH1", "challenge", "Web shop with CRM", "We need a web shop and a customer database.", [], { companyId: "C088" }),
		src("R0112", "researcher", "Milica Ranković", "Associate Professor, computer vision for agriculture. Open to supervising industrial PhD students. Can take a new doctoral student from autumn 2026.", ["R0112"]),
		src("R0347", "researcher", "Dušan Perišić", "Full Professor, hydraulic transients. Consulted for two municipal utilities.", ["R0347"]),
		src("R0539", "researcher", "Ivana Stojkov", "Assistant Professor, robotic grasping. Teaching load is lighter from spring 2027.", ["R0539"]),
		src("R0718", "researcher", "Nemanja Lalić", "Associate Professor, crop physiology. Open to joint projects with seed and agritech companies.", ["R0718"]),
		src("R0904", "researcher", "Bojan Šarac", "Professor Emeritus, manipulator dynamics.", ["R0904"]),
		src("SYN-PUB-02211", "publication", "Early water-stress detection in sunflower from UAV multispectral imagery", "We show that red-edge indices from drone flights detect water stress 8 days before visible symptoms.", ["R0112"], { year: 2023 }),
		src("SYN-PUB-02240", "publication", "Nitrogen status mapping with multispectral drones", "Field-scale nitrogen maps from five-band drone imagery.", ["R0112"], { year: 2024 }),
		src("SYN-PUB-02263", "publication", "Few-shot plant disease detection", "Prototype networks reach 90% accuracy with 20 labelled images per class.", ["R0112"], { year: 2025 }),
		src("SYN-PRJ-0412", "project", "Precision farming for Vojvodina", "Regional project on drone monitoring of field crops.", ["R0112"], { year: 2022 }),
		src("SYN-PUB-04102", "publication", "Pressure transients in looped water networks", "A transient model for leak signatures in looped networks.", ["R0347"], { year: 2021 }),
		src("SYN-PUB-04117", "publication", "Leak signatures in sparse sensor data", "Leak effects remain detectable with one sensor per 2 km of pipe.", ["R0347"], { year: 2023 }),
		src("SYN-PUB-04130", "publication", "Graph signal processing for sensor networks", "Graph filters localise anomalies in sparse sensor networks.", ["R0347"], { year: 2024 }),
		src("SYN-PUB-06021", "publication", "Learning grasps in cluttered bins", "A grasp network trained on 30,000 attempts in clutter.", ["R0539"], { year: 2022 }),
		src("SYN-PUB-06044", "publication", "Sim-to-real transfer for bin picking", "Domain randomisation for grasp learning.", ["R0539"], { year: 2023 }),
		src("SYN-PUB-06058", "publication", "Pose estimation of reflective metal parts", "Polarisation cues improve pose estimation on shiny parts.", ["R0539"], { year: 2025 }),
		src("SYN-PAT-041", "patent", "Conveyor sorting rig for stamped parts", "A conveyor rig that sorts stamped parts by camera. Developed with an automotive supplier.", ["R0539"], { year: 2020 }),
		src("SYN-PRJ-0977", "project", "Automated sorting with an automotive supplier", "Joint project that built a camera-based sorting rig.", ["R0539"], { year: 2020 }),
		src("SYN-PUB-07702", "publication", "Drought response of sunflower hybrids", "Field trials of 12 hybrids under controlled drought.", ["R0718"], { year: 2022 }),
		src("SYN-PUB-07715", "publication", "Leaf water potential as an early stress marker", "Leaf water potential drops 6–9 days before wilting.", ["R0718"], { year: 2024 }),
	].map((record) => [record.id, record]),
)

// ---------------------------------------------------------------------------
// The trace: the Mozaik events of the run
// ---------------------------------------------------------------------------

interface Step {
	/** Inference time in ms. */
	think: number
	tool?: { name: string; ms: number; args?: string }
}

class TraceBuilder {
	readonly records: TraceRecord[] = []
	private readonly ids = new Map<string, string>()
	private loops = 0

	id(name: string): string {
		let id = this.ids.get(name)
		if (!id) {
			id = `sample-${name}`
			this.ids.set(name, id)
		}
		return id
	}

	push(ms: number, kind: string, agent: string, extra: Partial<TraceRecord> = {}): void {
		this.records.push({ t: new Date(START + ms).toISOString(), ms, runId: SAMPLE_ID, kind, agentId: this.id(agent), agent, ...extra })
	}

	join(ms: number, agent: string): void {
		this.push(ms, "participant.joined", agent, { data: { name: agent, role: "agent", capabilities: ["inference"] } })
	}

	/** One loop: optional task.started, then inference ⇄ tool steps, then model.answer and task.completed. */
	loop(
		agent: string,
		start: number,
		options: { taskId?: string; kind?: string; attempt?: number; model: string; message: string; steps: Step[]; output: unknown; tokens: [number, number] },
	): number {
		const loopId = `loop-${++this.loops}`
		const { taskId, model } = options
		let ms = start
		if (taskId) this.push(ms, "task.started", agent, { taskId, data: { taskId, kind: options.kind, attempt: options.attempt ?? 1 } })
		this.push(ms + 1, "message_received.started", agent, { loopId, taskId, data: { message: options.message } })
		this.push(ms + 2, "message_received.completed", agent, { loopId, taskId })
		ms += 3
		const [inputPerStep, output] = options.tokens
		options.steps.forEach((step, i) => {
			this.push(ms, "inference.started", agent, { loopId, taskId, model, data: { contextItems: 2 + i * 2, tools: step.tool ? [step.tool.name] : [] } })
			ms += step.think
			const input = inputPerStep + i * 900
			const out = step.tool ? 120 : output
			const [pin, pout] = PRICE[model]
			this.push(ms, "inference.completed", agent, {
				loopId,
				taskId,
				model,
				tokens: { input, output: out, total: input + out },
				costUsd: (input * pin + out * pout) / 1e6,
				data: { items: step.tool ? ["function_call"] : ["model_message"] },
			})
			if (step.tool) {
				this.push(ms + 1, "function_call.started", agent, { loopId, taskId, model, data: { name: step.tool.name, args: step.tool.args } })
				ms += step.tool.ms
				this.push(ms, "function_call.completed", agent, { loopId, taskId, model, data: { callId: `call-${loopId}-${i}`, output: "…" } })
				ms += 2
			}
		})
		const text = JSON.stringify(options.output)
		this.push(ms, "model.answer", agent, { loopId, taskId, model, data: { text } })
		if (taskId) this.push(ms + 1, "task.completed", agent, { taskId, data: { taskId, kind: options.kind, output: text } })
		return ms + 1
	}
}

function buildTrace(): TraceRecord[] {
	const b = new TraceBuilder()
	const roster = [
		"orchestrator-1",
		...[1, 2, 3, 4].map((n) => `analyst-${n}`),
		...[1, 2, 3, 4, 5, 6].map((n) => `profiler-${n}`),
		"matchmaker-1",
		...[1, 2, 3].map((n) => `writer-${n}`),
		"critic-1",
	]
	roster.forEach((agent, i) => b.join(i, agent))
	let task = 0
	const nextTask = (kind: string) => `${kind}-${++task}`

	/** An artifact lands on the blackboard: `artifact.posted { kind, id, taskId }`. */
	const posted = (ms: number, agent: string, kind: string, id: string, taskId: string) =>
		b.push(ms, "artifact.posted", agent, { taskId, data: { kind, id, taskId } })

	/** The Critic reviews one artifact: `critic.reviewing`, a critique loop, then `critic.verdict` (and `critic.sent_back`). */
	const review = (
		start: number,
		artifact: { kind: string; id: string; producerTaskId: string; producerId: string; revision: number; claims: Claim[] },
		verdict: { ok: boolean; rejected: CriticVerdict["rejected"] },
		steps: Step[],
	): number => {
		const taskId = nextTask("critique")
		const { kind, id, producerTaskId } = artifact
		b.push(start, "critic.reviewing", "critic-1", {
			taskId,
			data: { taskId, kind, id, round: artifact.revision, claims: artifact.claims.length, producerTaskId, reviewer: "critic-1", model: SONNET },
		})
		const end = b.loop("critic-1", start + 1, {
			taskId,
			kind: "critique",
			model: SONNET,
			message: `Check every claim of ${kind} ${id} against its sources.`,
			steps,
			output: verdict,
			tokens: [2400 + artifact.claims.length * 700, 260],
		})
		const action = verdict.ok ? "accept" : "send_back"
		const producerId = b.id(artifact.producerId)
		b.push(end + 1, "critic.verdict", "critic-1", {
			taskId,
			data: { taskId, kind, id, revision: artifact.revision, ok: verdict.ok, action, producerId, producerTaskId, rejected: verdict.rejected },
		})
		if (!verdict.ok) {
			b.push(end + 2, "critic.sent_back", "critic-1", {
				taskId: producerTaskId,
				data: { taskId: producerTaskId, kind, id, producerId, attempt: artifact.revision + 1, maxAttempts: 2, rejected: verdict.rejected },
			})
		}
		return end + 2
	}

	// The orchestrator plans the run.
	b.loop("orchestrator-1", 20, {
		model: HAIKU,
		message: "Plan the run for companies C014, C027, C051, C088.",
		steps: [{ think: 700 }],
		output: { companies: ["C014", "C027", "C051", "C088"] },
		tokens: [900, 160],
	})

	// Analysts, one per company, in parallel. The Critic reviews each need as it lands.
	const needEnds: number[] = []
	needs.forEach((need, i) => {
		const agent = `analyst-${i + 1}`
		const taskId = nextTask("analyze")
		const end = b.loop(agent, 760 + i * 45, {
			taskId,
			kind: "analyze",
			model: HAIKU,
			message: `Read company ${need.companyId} and write its needs.`,
			steps: [
				{ think: 1900 + i * 230, tool: { name: "get_company", ms: 140, args: `{"id":"${need.companyId}"}` } },
				{ think: 1600 + i * 120, tool: { name: "search_publications", ms: 210, args: `{"query":"${need.searchTerms[0]}","k":10}` } },
				{ think: 2300 + i * 310 },
			],
			output: need,
			tokens: [3200, 640],
		})
		posted(end + 1, agent, "need", need.challengeId, taskId)
		needEnds.push(end)
		review(
			end + 40,
			{ kind: "need", id: need.challengeId, producerTaskId: taskId, producerId: agent, revision: 0, claims: [need.restatement, ...need.assets, ...need.constraints] },
			{ ok: true, rejected: [] },
			[{ think: 900, tool: { name: "get_source", ms: 60, args: `{"id":"${need.challengeId}"}` } }, { think: 1100 }],
		)
	})

	// Profilers start as soon as the first needs land, so they overlap with the last analysts.
	const profileEnds = new Map<string, number>()
	profiles.forEach((profile, i) => {
		const agent = `profiler-${i + 1}`
		const taskId = nextTask("profile")
		const end = b.loop(agent, Math.min(...needEnds) + 120 + i * 260, {
			taskId,
			kind: "profile",
			model: HAIKU,
			message: `Profile researcher ${profile.researcherId}.`,
			steps: [
				{ think: 1500 + (i % 3) * 400, tool: { name: "get_researcher", ms: 120, args: `{"id":"${profile.researcherId}"}` } },
				{ think: 1800 + (i % 2) * 600, tool: { name: "search_publications", ms: 240, args: `{"author":"${profile.researcherId}"}` } },
				{ think: 2400 + i * 180 },
			],
			output: profile,
			tokens: [4100, 820],
		})
		posted(end + 1, agent, "profile", profile.researcherId, taskId)
		profileEnds.set(profile.researcherId, end)
	})

	// The Matchmaker pairs per challenge as its researchers' profiles land.
	const pairEnds = new Map<string, number>()
	const challenges = ["C014-CH1", "C027-CH2", "C051-CH1", "C088-CH1"]
	challenges.forEach((challengeId, i) => {
		const own = pairs.filter((pair) => pair.challengeId === challengeId)
		const ready = Math.max(...own.map((pair) => profileEnds.get(pair.researcherId) ?? 0), needEnds[i])
		const taskId = nextTask("match")
		const end = b.loop("matchmaker-1", ready + 80 + i * 30, {
			taskId,
			kind: "match",
			model: SONNET,
			message: `Pair researchers with challenge ${challengeId}.`,
			steps: [{ think: 1400, tool: { name: "find_researchers_for_need", ms: 180, args: `{"challengeId":"${challengeId}","k":10}` } }, { think: 2100 }],
			output: own.length ? own : { challengeId, noMatch: results.noMatches[0].reason },
			tokens: [5200, 900],
		})
		if (!own.length) posted(end + 1, "matchmaker-1", "no-match", challengeId, taskId)
		for (const pair of own) {
			posted(end + 1, "matchmaker-1", "pair", pair.id, taskId)
			pairEnds.set(pair.id, end)
		}
	})

	// Writers, one per chosen pair, in parallel. The Critic sends p-3 back once.
	proposals.forEach((proposal, i) => {
		const agent = `writer-${i + 1}`
		const taskId = nextTask("write")
		const claims = i === 2 ? [...proposal.claims.slice(0, 2), rejected] : proposal.claims
		const end = b.loop(agent, (pairEnds.get(proposal.pairId) ?? 0) + 100, {
			taskId,
			kind: "write",
			model: SONNET,
			message: `Write a proposal for pair ${proposal.pairId}.`,
			steps: [
				{ think: 2600, tool: { name: "get_source", ms: 90, args: `{"id":"${proposal.claims[0].sourceIds[0]}"}` } },
				{ think: 4200 + i * 500 },
			],
			output: { id: proposal.id, title: proposal.title, revision: 0 },
			tokens: [6800, 1900],
		})
		posted(end + 1, agent, "proposal", proposal.id, taskId)
		const first = verdicts.find((v) => v.proposalId === proposal.id && v.revision === 0)!
		const reviewed = review(
			end + 60,
			{ kind: "proposal", id: proposal.id, producerTaskId: taskId, producerId: agent, revision: 0, claims },
			first,
			[{ think: 1200, tool: { name: "get_source", ms: 70, args: `{"id":"${claims.at(-1)!.sourceIds[0]}"}` } }, { think: 1500 }],
		)
		if (first.ok) return

		// Sent back: the same task runs again and fixes only the rejected claim.
		const fixed = b.loop(agent, reviewed + 220, {
			taskId,
			kind: "write",
			attempt: 2,
			model: SONNET,
			message: `Fix the rejected claim in ${proposal.id}: ${first.rejected[0].reason}`,
			steps: [{ think: 1800, tool: { name: "get_source", ms: 80, args: `{"id":"SYN-PRJ-0977"}` } }, { think: 2200 }],
			output: { id: proposal.id, title: proposal.title, revision: 1 },
			tokens: [7400, 1100],
		})
		posted(fixed + 1, agent, "proposal", proposal.id, taskId)
		const final = verdicts.find((v) => v.proposalId === proposal.id && v.revision === 1)!
		review(
			fixed + 50,
			{ kind: "proposal", id: proposal.id, producerTaskId: taskId, producerId: agent, revision: 1, claims: proposal.claims },
			final,
			[{ think: 1300 }],
		)
	})

	return b.records.sort((a, z) => a.ms - z.ms)
}

const trace = buildTrace()

function info(): RunInfo {
	let tokens = 0
	let costUsd = 0
	const tasks = new Map<string, string>()
	for (const record of trace) {
		tokens += record.tokens?.total ?? 0
		costUsd += record.costUsd ?? 0
		if (record.kind === "task.started" || record.kind === "task.completed") tasks.set(record.taskId!, record.kind)
	}
	return {
		id: SAMPLE_ID,
		status: "ended",
		mock: true,
		startedAt: new Date(START).toISOString(),
		durationMs: trace.at(-1)!.ms,
		tokens,
		costUsd,
		tasks: { total: tasks.size, done: [...tasks.values()].filter((kind) => kind === "task.completed").length, failed: 0 },
		has: { summary: true, results: true, sources: true },
		sample: true,
	}
}

export const sampleRun = { info: info(), trace, results, sources }
