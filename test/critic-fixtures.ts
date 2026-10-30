import { FakeSourceStore } from "../src/agents/critic"
import type { Claim, CompanyNeed, PairCandidate, Proposal, ResearcherProfile, SourceRecord } from "../src/types"

/** A tiny dataset in the shape of the real one: two researchers, two companies, their records. */
export const RECORDS: SourceRecord[] = [
	{
		id: "R0001",
		kind: "researcher",
		title: "Natalija Fejsa",
		text:
			"Assistant Professor, Faculty of Sciences, Department of Mathematics and Informatics. Fields: formal methods and " +
			"program verification. Keywords: proof assistants, certified compilation, Coq, register allocation. Open to joint " +
			"projects with companies that need formal correctness guarantees for safety-critical embedded software.",
		researcherIds: ["R0001"],
	},
	{
		id: "R0002",
		kind: "researcher",
		title: "Marko Ilić",
		text: "Associate Professor, Faculty of Technical Sciences. Fields: wireless sensor networks. Keywords: LoRaWAN, energy-aware routing.",
		researcherIds: ["R0002"],
	},
	{
		id: "SYN-PUB-00001",
		kind: "publication",
		title: "A Coq Formalization of a Simple Register-Allocation Pass for a Subset of C",
		text:
			"Register allocation is a well-known compiler phase whose bugs silently corrupt programs. We formalize a graph-colouring " +
			"register allocation pass for a subset of C in the Coq proof assistant and prove that it preserves program semantics. " +
			"The verified pass is extracted to OCaml and integrated into a certified compilation toolchain for embedded controllers.",
		researcherIds: ["R0001"],
		year: 2013,
	},
	{
		id: "SYN-PRJ-0001",
		kind: "project",
		title: "CERTSAFE: Certified Code Generation for Safety-Critical Embedded Controllers",
		text:
			"CERTSAFE builds a verified code generator for embedded controllers in industrial automation. It proves in Coq that " +
			"generated C code matches the controller model, and tests the toolchain on programmable logic controllers.",
		researcherIds: ["R0001"],
		year: 2021,
	},
	{
		id: "SYN-PUB-00002",
		kind: "publication",
		title: "Energy-Aware Routing for Dense LoRaWAN Deployments",
		text: "We propose an energy-aware routing scheme for dense LoRaWAN sensor deployments and evaluate battery lifetime in field trials.",
		researcherIds: ["R0002"],
		year: 2022,
	},
	{
		id: "C001",
		kind: "company",
		title: "ArmaturaSec d.o.o.",
		text:
			"ArmaturaSec has built network security hardware in Zrenjanin since 2008. Products: NetGuard-OT, a network access " +
			"control appliance for industrial Ethernet segments. Tech: embedded Linux (custom Yocto build), C firmware.",
		researcherIds: [],
		companyId: "C001",
	},
	{
		id: "C001-CH1",
		kind: "challenge",
		title: "Firmware correctness for the NetGuard-OT packet filter",
		text:
			"Our NetGuard-OT packet filter firmware is written in C and runs on industrial Ethernet segments. A bug in the filter " +
			"can stop a production line. We need stronger guarantees than testing that the filter firmware is correct, and we " +
			"have the full firmware source and a hardware test bench.",
		researcherIds: [],
		companyId: "C001",
	},
	{
		id: "C001/job/2024-02-05/Firmware Engineer",
		kind: "page",
		title: "Firmware Engineer — Network Protocols (Zrenjanin)",
		text: "ArmaturaSec is looking for a firmware engineer for C firmware on embedded Linux. Experience with formal verification is a plus.",
		researcherIds: [],
		companyId: "C001",
		year: 2024,
	},
	{
		id: "C002",
		kind: "company",
		title: "Zlatna Njiva d.o.o.",
		text: "Zlatna Njiva grows vegetables near Zrenjanin and runs drip irrigation on 400 hectares.",
		researcherIds: [],
		companyId: "C002",
	},
]

export const store = new FakeSourceStore(RECORDS)

// ---------------------------------------------------------------------------
// Claims: true ones, and the planted fakes the Critic must catch
// ---------------------------------------------------------------------------

export const TRUE_CLAIMS = {
	coq: { text: "Formalized a register allocation pass in the Coq proof assistant and proved it preserves program semantics.", sourceIds: ["SYN-PUB-00001"] },
	certsafe: { text: "Works on certified code generation for safety-critical embedded controllers.", sourceIds: ["SYN-PRJ-0001"] },
	openTo: { text: "Open to joint projects with companies that need formal correctness guarantees for embedded software.", sourceIds: ["R0001"] },
	firmware: { text: "The company needs guarantees beyond testing that its C packet filter firmware is correct.", sourceIds: ["C001-CH1"] },
	testBench: { text: "The company has the full firmware source and a hardware test bench.", sourceIds: ["C001-CH1"] },
	hiring: { text: "The company is hiring a firmware engineer for C firmware on embedded Linux.", sourceIds: ["C001/job/2024-02-05/Firmware Engineer"] },
} satisfies Record<string, Claim>

export const FAKE_CLAIMS = {
	/** An invented paper: the id does not exist. */
	inventedPaper: { text: "Published a verified TLS stack for embedded devices.", sourceIds: ["SYN-PUB-99999"] },
	/** An invented skill: the id exists but says nothing like it. */
	inventedPatent: { text: "Holds a patent on solid-state battery electrolytes for electric vehicles.", sourceIds: ["SYN-PUB-00001"] },
	/** Another researcher's paper. */
	someoneElsesPaper: { text: "Designed energy-aware routing for dense LoRaWAN deployments.", sourceIds: ["SYN-PUB-00002"] },
	/** No source at all. */
	noSource: { text: "Is the leading expert on compiler verification in the region.", sourceIds: [] },
} satisfies Record<string, Claim>

export function profile(expertise: Claim[], overrides: Partial<ResearcherProfile> = {}): ResearcherProfile {
	return {
		researcherId: "R0001",
		aliases: [],
		name: "Natalija Fejsa",
		title: "Assistant Professor",
		faculty: "Faculty of Sciences",
		department: "Department of Mathematics and Informatics",
		expertise,
		industryFit: [TRUE_CLAIMS.openTo],
		availability: null,
		canLead: true,
		...overrides,
	}
}

export function need(overrides: Partial<CompanyNeed> = {}): CompanyNeed {
	return {
		challengeId: "C001-CH1",
		companyId: "C001",
		companyName: "ArmaturaSec d.o.o.",
		sector: "Cybersecurity",
		triage: "research",
		triageReason: "Proving firmware correctness is an open verification problem.",
		restatement: TRUE_CLAIMS.firmware,
		searchTerms: ["formal verification", "C firmware", "packet filter"],
		assets: [TRUE_CLAIMS.testBench],
		constraints: [],
		...overrides,
	}
}

export function pair(why: Claim[]): PairCandidate {
	return {
		id: "C001-CH1:R0001",
		challengeId: "C001-CH1",
		companyId: "C001",
		researcherId: "R0001",
		fit: 0.8,
		why,
		problem: TRUE_CLAIMS.firmware,
		risks: [],
	}
}

export function proposal(claims: Claim[], markdown: string): Proposal {
	return { id: "P-C001-CH1-R0001", pairId: "C001-CH1:R0001", kind: "industrial-phd", title: "Verified packet filtering", markdown, claims, revision: 0 }
}
