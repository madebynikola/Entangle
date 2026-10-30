import type { CompanyNeed, ResearcherProfile } from "../../types"

/**
 * Hand-made blackboard input for the Matchmaker and Writer until the Profiler and Analyst (#13) land.
 * Every id and title is real dataset data, so the Critic can check these claims against the SourceStore.
 * Traps on purpose: C002-CH3 is not research; R0400 works on soil "compression", not signal compression;
 * R0292's availability note is stale and its reason must never reach a proposal; R0288 has a thin profile.
 */

export const FIXTURE_NEEDS: CompanyNeed[] = [
	{
		challengeId: "C001-CH1",
		companyId: "C001",
		companyName: "ArmaturaSec d.o.o.",
		sector: "Cybersecurity",
		triage: "research",
		triageReason: "No labelled attacks exist, so the detection method itself is an open research question.",
		restatement: {
			text: "Anomaly detection on Modbus and BACnet traffic that learns what normal looks like on each site from normal captures only, with no attack examples, and that can be explained to a plant manager.",
			sourceIds: ["C001-CH1"],
		},
		searchTerms: ["anomaly detection", "industrial control systems", "Modbus", "SCADA", "one-class classification", "baseline modelling", "intrusion detection"],
		assets: [
			{ text: "Several terabytes of normal Modbus and BACnet captures from consenting clients, collected over three years.", sourceIds: ["C001-CH1"] },
			{ text: "One to two engineers part-time, the traffic archives, a hardware bench and the firmware codebase under NDA.", sourceIds: ["C001"] },
		],
		constraints: [
			{ text: "No confirmed attack traffic exists; a supervised classifier trained on public ICS data gave too many false positives in real deployments.", sourceIds: ["C001-CH1"] },
			{ text: "The company has the hardware to run inference on the device.", sourceIds: ["C001-CH1"] },
		],
	},
	{
		challengeId: "C005-CH2",
		companyId: "C005",
		companyName: "Kardiolink a.d.",
		sector: "Medtech and digital health",
		triage: "research",
		triageReason: "Beating 3:1 lossless on wearable ECG needs a new signal model, not a configuration change.",
		restatement: {
			text: "Lossless compression of three-channel 250 Hz wearable ECG that exploits quasi-periodicity, baseline wander and electrode noise to beat a 3:1 ratio.",
			sourceIds: ["C005-CH2"],
		},
		searchTerms: ["ECG compression", "lossless compression", "entropy coding", "physiological signals", "quasi-periodic signals", "embedded compression"],
		assets: [
			{ text: "A labelled dataset of about 140,000 30-minute ECG segments, shared under NDA.", sourceIds: ["C005-CH2"] },
			{ text: "Twelve people in hardware, firmware and algorithms, and a lab for prototyping and signal acquisition testing.", sourceIds: ["C005"] },
		],
		constraints: [
			{ text: "The regulatory submission is built around lossless compression; lossy would need a new clinical validation study.", sourceIds: ["C005-CH2"] },
			{ text: "About 2 TB of ECG per month costs €7,400 in cloud storage, and volume may nearly double by Q2 next year.", sourceIds: ["C005-CH2"] },
		],
	},
	{
		challengeId: "C003-CH1",
		companyId: "C003",
		companyName: "AutomVoj a.d.",
		sector: "Robotics and industrial automation",
		triage: "research",
		triageReason: "The failure mechanism under combined cold, condensation and vibration is unknown and cannot be reproduced at room temperature.",
		restatement: {
			text: "Welded joints of mild-steel hollow-section conveyor frames crack after about 18 months in cold stores at 2–6 °C; the company suspects thermal cycling, condensation and vibration.",
			sourceIds: ["C003-CH1"],
		},
		searchTerms: ["fatigue crack growth", "welded joints", "low temperature fatigue", "thermal cycling", "residual stress", "fracture mechanics"],
		assets: [
			{ text: "Photos and measurements of cracked joints from site visits, and two failed frame sections in storage.", sourceIds: ["C003-CH1"] },
			{ text: "A chief engineer and two senior automation engineers who split time between projects and improvement work.", sourceIds: ["C003"] },
		],
		constraints: [
			{ text: "Fourteen frame assemblies were replaced under warranty this year.", sourceIds: ["C003-CH1"] },
			{ text: "The company has no equipment to test at low temperature under cyclic load.", sourceIds: ["C003-CH1"] },
		],
	},
	{
		challengeId: "C009-CH1",
		companyId: "C009",
		companyName: "LinguaBot d.o.o.",
		sector: "Conversational AI",
		triage: "research",
		triageReason: "Accurate lemmatisation for Serbian with mixed Latin and Cyrillic script is not solved by an off-the-shelf stemmer.",
		restatement: {
			text: "Morphology-aware retrieval for Serbian support queries: lemmatisation or indexing that handles inflection and mixed Latin/Cyrillic script, and can absorb new vocabulary without a full re-index.",
			sourceIds: ["C009-CH1"],
		},
		searchTerms: ["Serbian morphology", "lemmatization", "information retrieval", "script normalisation", "inflected languages", "computational morphology"],
		assets: [
			{ text: "A labelled set of about 85,000 query-response pairs, and two in-house linguists who can annotate.", sourceIds: ["C009-CH1"] },
			{ text: "Four ML engineers.", sourceIds: ["C009"] },
		],
		constraints: [
			{ text: "About 18% of 12,000 sampled support queries returned no useful result; the target is below 5%.", sourceIds: ["C009-CH1"] },
			{ text: "The budget is about 8,000 EUR and the result must be testable within six months.", sourceIds: ["C009-CH1"] },
		],
	},
	{
		challengeId: "C002-CH3",
		companyId: "C002",
		companyName: "Zrenjanin Game Works d.o.o.",
		sector: "Game development",
		triage: "not-research",
		triageReason: "Grant paperwork and administrative capacity: a support-service need, not a research problem.",
		restatement: {
			text: "Administrative support for Innovation Fund voucher applications.",
			sourceIds: ["C002-CH3"],
		},
		searchTerms: ["grant administration"],
		assets: [],
		constraints: [],
	},
]

const p = (
	researcherId: string,
	name: string,
	title: string,
	faculty: string,
	department: string,
	expertise: ResearcherProfile["expertise"],
	industryFit: ResearcherProfile["industryFit"],
	availability: ResearcherProfile["availability"] = null,
	canLead = true,
): ResearcherProfile => ({ researcherId, aliases: [], name, title, faculty, department, expertise, industryFit, availability, canLead })

const FTN = "Faculty of Technical Sciences"
const PMF = "Faculty of Sciences"
const FF = "Faculty of Philosophy"

export const FIXTURE_PROFILES: ResearcherProfile[] = [
	// C001-CH1 candidates
	p("R1008", "Krisztina Kiss", "Full Professor", FTN, "Department of Computing and Control Engineering",
		[
			{ text: "Statistical baseline modelling of Modbus/TCP traffic in a substation automation network.", sourceIds: ["SYN-PUB-10472"] },
			{ text: "One-class SVM for detecting anomalous DNP3 command sequences in water treatment control systems.", sourceIds: ["SYN-PUB-10473"] },
			{ text: "Protocol-agnostic anomaly detection from byte-level features of ICS application payloads.", sourceIds: ["SYN-PUB-10483"] },
			{ text: "Principal investigator of ICAROS, calibrated anomaly recognition for operational SCADA systems (2021–2024).", sourceIds: ["SYN-PRJ-0511"] },
			{ text: "Coordinator of FEDICS, federated anomaly detection across distributed ICS sites (2022–2025).", sourceIds: ["SYN-PRJ-0512"] },
		],
		[
			{ text: "Open to industrial PhD supervision for candidates from automation and critical-infrastructure companies.", sourceIds: ["R1008"] },
			{ text: "Offers access to an ICS testbed and long-term traffic capture infrastructure.", sourceIds: ["R1008"] },
			{ text: "Has validated methods with an energy distributor and a water utility as monitoring data partners.", sourceIds: ["R1008"] },
		]),
	p("R1015", "Vuk Đukić", "Associate Professor", FTN, "Department of Computing and Control Engineering",
		[
			{ text: "Unsupervised anomaly detection on Modbus traffic.", sourceIds: ["SYN-PUB-10523"] },
			{ text: "A comparative study of intrusion detection architectures for SCADA networks.", sourceIds: ["SYN-PUB-10525"] },
			{ text: "Intrusion detection on resource-constrained IoT devices with lightweight recurrent models.", sourceIds: ["SYN-PUB-10531"] },
		],
		[{ text: "Open to industrial PhD supervision and joint projects.", sourceIds: ["R1015"] }]),
	p("R0738", "Igor Starčević", "Assistant Professor", FTN, "Department of Computing and Control Engineering",
		[
			{ text: "Threshold selection strategies for operational anomaly detection pipelines in industrial SCADA environments.", sourceIds: ["SYN-PUB-08186"] },
			{ text: "Benchmarking time-series foundation models against classical methods for anomaly detection in energy SCADA telemetry.", sourceIds: ["SYN-PUB-08188"] },
			{ text: "Principal investigator of DIASOLAR, diagnostic analytics for solar asset performance (2021–2024).", sourceIds: ["SYN-PRJ-0311"] },
		],
		[{ text: "Open to contract research on anomaly detection pipeline development and validation.", sourceIds: ["R0738"] }],
		{ text: "Capacity to coordinate new projects is limited until 2027; work-package or contract research roles fit sooner.", sourceIds: ["R0738"] }),

	// C005-CH2 candidates, R0400 is the "compression" false friend
	p("R0057", "Lazar Šarić", "Assistant Professor", PMF, "Department of Mathematics and Informatics",
		[
			{ text: "Learned entropy models for ECG compression using recurrent context prediction.", sourceIds: ["SYN-PUB-00761"] },
			{ text: "Rate-distortion analysis of beat-aligned versus free-running frames for ECG entropy coding.", sourceIds: ["SYN-PUB-00760"] },
			{ text: "A survey of transform, sparse and learned approaches to embedded coding of physiological signals.", sourceIds: ["SYN-PUB-00762"] },
			{ text: "Principal investigator of PHYCOMP, physiological signal compression for low-power telemetry in remote patient monitoring (2022–2025).", sourceIds: ["SYN-PRJ-0213"] },
		],
		[
			{ text: "Open to contract research on codec design and evaluation for medical device manufacturers, and to industrial PhD supervision.", sourceIds: ["R0057"] },
			{ text: "Advised a Novi Sad medical device startup on an ECG compression module for Holter recorder firmware in 2022.", sourceIds: ["R0057"] },
		]),
	p("R0641", "Branislav Stojanović", "Full Professor", FTN, "Department of Computing and Control Engineering",
		[
			{ text: "Embedded wavelet lifting for ECG compression on wearable Cortex-M0 nodes.", sourceIds: ["SYN-PUB-03183"] },
			{ text: "TENT, a tiny entropy-coded transform for ultra-low-power microcontrollers.", sourceIds: ["SYN-PUB-07303"] },
			{ text: "Inventor on a pending patent for anomaly-preserving adaptive bit allocation in compressed sensor data streams.", sourceIds: ["SYN-PAT-009"] },
		],
		[{ text: "Open to joint projects, contract research, industrial PhD supervision and equipment access.", sourceIds: ["R0641"] }]),
	p("R0019", "Petar Hadžić", "Assistant Professor", PMF, "Department of Mathematics and Informatics",
		[
			{ text: "Predicting compressibility of sensor blocks from lightweight signal statistics.", sourceIds: ["SYN-PUB-00224"] },
			{ text: "Compression-aware query planning for time-bounded window aggregations.", sourceIds: ["SYN-PUB-00221"] },
			{ text: "Team member on CROTIMED, cross-border telemedicine data infrastructure for cardiac monitoring (2021–2023).", sourceIds: ["SYN-PRJ-0214"] },
		],
		[{ text: "Open to joint projects with companies generating high-frequency sensor data.", sourceIds: ["R0019"] }],
		{ text: "Has capacity for one more industrial PhD candidate from late 2025.", sourceIds: ["R0019"] }),
	p("R0400", "Saša Jokić", "Full Professor", "Faculty of Civil Engineering Subotica", "Department of Geotechnics",
		[
			{ text: "Primary consolidation parameters of Vojvodina organic clays from incremental loading oedometer tests.", sourceIds: ["SYN-PUB-04836"] },
			{ text: "Creep behaviour of fibrous peat under sustained vertical stress.", sourceIds: ["SYN-PUB-02892"] },
		],
		[{ text: "Open to contract research involving laboratory consolidation and creep testing.", sourceIds: ["R0400"] }]),

	// C003-CH1 candidates
	p("R0365", "Bojan Erić", "Associate Professor", FTN, "Department of Mechanical Engineering (Machine Design and Mechanics)",
		[
			{ text: "Fatigue life of weld-toe-ground S460NL joints at −40 °C, with a fracture-mechanics interpretation.", sourceIds: ["SYN-PUB-04483"] },
			{ text: "Interaction of mechanical cyclic loading and thermal cycling on the fatigue life of butt-welded structural steel plates.", sourceIds: ["SYN-PUB-04475"] },
			{ text: "Weld residual stress relaxation under cyclic loading in S355 cruciform joints.", sourceIds: ["SYN-PUB-04478"] },
			{ text: "Principal investigator of FATCOLD, fatigue reliability of welded steel structures under combined mechanical and thermal cyclic loads (2021–2024).", sourceIds: ["SYN-PRJ-0388"] },
		],
		[
			{ text: "Offers a servo-hydraulic fatigue machine, a climate chamber down to −60 °C and a DIC setup.", sourceIds: ["R0365"] },
			{ text: "Open to industrial PhD supervision for companies dealing with steel structures.", sourceIds: ["R0365"] },
		],
		{ text: "The climate chamber and fatigue machine are shared with two other groups; long test campaigns need advance scheduling.", sourceIds: ["R0365"] }),
	p("R0445", "Valentina Simić", "Associate Professor", FTN, "Department of Production Engineering",
		[
			{ text: "Convolutional neural network classification of weld pool images for defect precursor detection in GMAW.", sourceIds: ["SYN-PUB-05329"] },
			{ text: "Principal investigator of THERMARC, thermal state estimation and adaptive parameter control for robotic arc welding (2021–2024).", sourceIds: ["SYN-PRJ-0412"] },
			{ text: "Inventor on a granted patent for real-time wire feed speed adjustment in GMAW from infrared pool width.", sourceIds: ["SYN-PAT-042"] },
		],
		[{ text: "Open to joint projects with companies needing adaptive welding control.", sourceIds: ["R0445"] }]),
	p("R0279", "Vladan Uzelac", "Assistant Professor", FTN, "Department of Civil Engineering and Geodesy",
		[
			{ text: "Calibration of Paris–Erdogan crack growth parameters for S355 weld toes under variable amplitude loading.", sourceIds: ["SYN-PUB-03485"] },
			{ text: "Principal investigator of FATIGUEBRIDGE, fatigue life of aging steel road bridges (2021–2024).", sourceIds: ["SYN-PRJ-0872"] },
		],
		[{ text: "Open to consulting on fatigue assessment of welded steel structures.", sourceIds: ["R0279"] }],
		{ text: "Fatigue lab capacity was partly booked until the end of 2025.", sourceIds: ["R0279"] }),

	// C009-CH1 candidates
	p("R0288", "Katarina Nikolić", "Associate Professor", FF, "Department of Serbian Language and Linguistics",
		[
			{ text: "A lemmatizer for Serbian that handles both scripts.", sourceIds: ["SYN-PUB-03588"] },
			{ text: "Inflection and search: why Serbian queries miss relevant documents.", sourceIds: ["SYN-PUB-03589"] },
			{ text: "Principal investigator of KORPUS-NS, a reference corpus of contemporary Serbian (2020–2024).", sourceIds: ["SYN-PRJ-0013"] },
		],
		[{ text: "Open to industrial PhD supervision and joint projects.", sourceIds: ["R0288"] }]),
	p("R0160", "Srđan Rajić", "Assistant Professor", FF, "Department of Serbian Language and Linguistics",
		[
			{ text: "A lexicon of informal Serbian morphological variants for NLP applications.", sourceIds: ["SYN-PUB-02080"] },
			{ text: "Principal investigator of INFORSRB, annotation infrastructure and tagger development for informal Serbian in digital service domains (2021–2024).", sourceIds: ["SYN-PRJ-0110"] },
		],
		[
			{ text: "Coordinated data-sharing agreements with four domestic companies for pseudonymised customer text.", sourceIds: ["R0160"] },
			{ text: "Prefers projects where the company shares text data for annotation and evaluation over delivering production software.", sourceIds: ["R0160"] },
		]),
	p("R0292", "Đurđica Kuzmanović", "Associate Professor", FF, "Department of Serbian Language and Linguistics",
		[
			{ text: "Morphological disambiguation in Serbian with a maximum entropy approach.", sourceIds: ["SYN-PUB-03633"] },
			{ text: "Principal investigator of VoiLaRes, computational infrastructure for minority languages in Vojvodina (2021–2024).", sourceIds: ["SYN-PRJ-0544"] },
		],
		[{ text: "Open to consulting on NLP pipelines for South Slavic language inputs.", sourceIds: ["R0292"] }],
		{ text: "Works at reduced capacity, according to the profile notes; confirm current availability.", sourceIds: ["R0292"] }),
]

/** Fixture candidates per challenge, as the shortlist (#8 `find_researchers_for_need`) would give them. */
export const FIXTURE_SHORTLISTS: Record<string, string[]> = {
	"C001-CH1": ["R1008", "R1015", "R0738"],
	"C005-CH2": ["R0057", "R0641", "R0019", "R0400"],
	"C003-CH1": ["R0365", "R0445", "R0279"],
	"C009-CH1": ["R0288", "R0160", "R0292"],
	"C002-CH3": [],
}
