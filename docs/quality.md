# Proposal quality: before and after

A quality pass on 30 October. We read five proposals from the 20-company run (`out/2026-10-30T13-37-34`) next to the brief's
[example PhD topic](brief/example-industrial-phd-topic.md). We then checked every claim of three of them by hand against the dataset.
Then we changed the Matchmaker, the Writer and the Critic, and ran the same five companies again.

## Before: what a company or a researcher would object to

The five proposals: C001-CH1 (ArmaturaSec × Krisztina Kiss), C005-CH1 (Kardiolink × Maja Popović), C009-CH1 (LinguaBot × Stefan Dragić),
C012-CH1 (Sentinel Byte × Árpád Nagy), C018-CH1 (DriveLogic × Mirjana Vidaković).

They did some things well. Each one used the company's own numbers (18 mAh a day, 3,200 files per project, an 18% miss rate on 12,000 queries).
Each research question had a measurement, and the first steps could start on Monday. The objections:

| Objection | Where |
| --- | --- |
| **Too long.** Each one is headed "joint project, one page", but runs to about 1,800 words: 4 times the example. "What the faculty brings" is a block of 7 to 10 claims. | all five |
| **Breaks the company's hard limit.** The company says the sampling rate "cannot drop below 250 Hz". The plan tests 125–250 Hz and runs the patch at a lower rate when the patient rests. | C005 |
| **Wrong core difficulty.** The company asks for someone who knows the power budget: radio duty cycling, ADC settings, memory access. The researcher works on ECG signal quality: same domain, other problem. The Matchmaker saw the gap and still gave a fit of 0.62. | C005 |
| **Facts that exist nowhere.** "500+ hours of existing recordings", an accelerometer the patch does not have, "six months of historical scan pairs", a false-positive baseline "in production" from a classifier the company never deployed. | C001, C005, C012 |
| **Says what a side lacks, against the data.** "The researcher has no access to real Modbus traffic" (the researcher's projects ran on a substation and four pilot sites). "The company lacks signal-processing know-how" (it writes its own signal-processing algorithms). | C001, C005, C012 |
| **Who does the work, for what money.** A 10-month project with a full professor's group on a budget of 3,000–5,000 euros, and no student or engineer named for the day-to-day work. | C009, C012 |
| **Weak risks.** "No availability information is provided", the same budget risk twice, a resource listed as a risk, the joint problem repeated as a risk. Real risks are missing, such as autoencoders vs. a plain-language explanation for plant managers. | C001, C005, C012, C018 |
| **Researcher facts in the company's problem**, and a menu of every method the researcher has used in place of the two the problem needs. | C001, C012 |

## Hand-check: what the Critic missed

Every claim of C001, C005 and C012 (76 claims), checked against the full text of the records each one cites. The Critic had passed all of them.

| | C001 | C005 | C012 | All |
| --- | --- | --- | --- | --- |
| Claims | 25 | 24 | 27 | 76 |
| Wrong, missed by the Critic | 4 | 4 | 7 | **15 (20%)** |
| Borderline | 3 | 2 | 1 | 6 |
| Free-text sentences with an invented or contradicted fact | 7 | 6 | 7 | **20** |

No claim was invented outright: the Critic catches those. What it missed falls in three groups:

- **A judgement added to a fact (7).** "Kiss co-authored a publication on beta-mixture threshold calibration, *directly addressing ArmaturaSec's
  false positive rate problem*." The paper says nothing about ArmaturaSec. The Critic's rule "a claim about what the pair could do together is
  supported when the skills and needs it rests on are in the cited text" let these through.
- **A detail from a record the claim does not cite (4).** "Paid pilot assessments for NTP Novi Sad companies" cites the project, which says
  "pilot assessments for two industry partners"; "paid" and "NTP" are only in the uncited profile. "Nordic nRF52840" is only in an uncited job ad.
- **A widened scope (4).** "Two municipalities and a medical supply company are requesting continuous or monthly testing": they asked for
  retests after patches, and one of them for monthly checks. "Clinical validation under MDR 2017/745" merges two separate parts of a book chapter.

The larger gap was the free text. The Critic read only claims, so the research questions, approach, plan and the reasoning under
"Why this pair" were never checked. That is where all 20 invented facts and the 250 Hz breach were.

## What we changed

**Matchmaker** (`src/agents/matchmaker/prompt.ts`, `matchmaker.ts`)
- It writes the core difficulty and the hard limits first (`coreDifficulty`), then judges each candidate against them, not against the topic.
- Same domain is not same problem: a candidate who covers only a side issue, a constraint or the application area gets a fit below 0.5.
  Code now drops any pair under 0.5 (`match.dropped`, "fit below 0.5"). A pair that only works by breaking a hard limit is no pair.
- Risks are 1 to 3 things that could make the pair fail. No "nothing is known" filler, no resources, no repeat of the problem. Duplicate claims after a fix are removed.

**Writer** (`src/agents/writer/prompt.ts`)
- One page for a joint project (about 600 words), two for an industrial PhD, with a cap on claims per section. Each fact is said once.
- It writes a hidden `brief` first: the core difficulty, every hard limit, the two or three works that meet it. No question, method or plan row may break a limit.
- Free text may propose new work and data, but never present as existing what no claim states, and never say what a side lacks.
  "Neither could do it alone" is said as what each side brings. The plan uses only data a claim says the company has.
- It says who does the work (candidate, student, postdoc, company engineer) and sizes the plan to the budget the company states.

**Claim rules** (shared by the Matchmaker and the Writer): no judgement in a claim; every word from a cited record; no widened lists.

**Critic** (`src/agents/critic/prompt.ts`, `checks.ts`, `critic.ts`)
- The rubric now rejects a judgement on how a record fits the other side, a word taken from an uncited record, a widened list and a merged point.
  It reads each qualifier ("paid", "all", "led", "data partner") as a fact.
- **Free-text check.** Each proposal gets one more critique task: the first reviewer reads the free text with every cited record. It quotes
  each sentence that states as true what no claim or source states, says what a side lacks against the data, or breaks a company limit.
  It also checks that every dataset the plan uses as existing is one a claim says the company has. Each quote goes back to the
  Writer as a `free-text` reject beside the rejected claims. The Writer rewrites the sentence as a proposal, or removes it.
  The check sees each claim as `⟨claim N⟩`, so it cannot quote one, and it runs again only when the free text changed.

**Fix rounds** (`src/agents/matchmaker/shared.ts`, `src/agents/critic/protocol.ts`, every fix prompt). The first re-run found a bug that
had been there all along. A producer fixes rejected claims by their index in the rejected list. The send-back text numbered them from 1,
the JSON list from 0, and models often used the claim's place in the artifact. In the 20-company run, **112 of 364 fix answers (31%)**
gave an index outside the list. 132 of 779 rejected claims (17%) were dropped when they should have been rewritten, and a fix counted
from 1 went to the next claim. One of these drops cost C005 its best pair: Knežević, with work on energy budgets for coin-cell nodes,
at a fit of 0.76. Each rejected claim now carries its index in the prompt, and a fix whose words do not fit its index goes to the
rejected claim it reads like.

## After: the same five companies again

Same 5 companies, same models (Sonnet 4.6 for Matchmaker, Writer and Critic; Haiku 4.5 for the workers), local Claude Code,
no SubQ and no shortlist filter, as in the baseline. Run 1 (`out/2026-10-30T14-48-45`) had the prompt and Critic changes but not the
fix-index repair. Run 2 (`out/2026-10-30T15-09-14`) had both. The proposals are in [`quality/before/`](quality/before/) and
[`quality/after/`](quality/after/).

| | Before | Run 1 | Run 2 |
| --- | --- | --- | --- |
| Proposals accepted | 5 of 5 | 2 of 5 (3 to a person) | **5 of 5** |
| Words per proposal (mean) | 1,798 | 1,289 | **1,273** |
| Claims per proposal (mean) | 25.6 | 18.5 | **17.2** |
| Free-text sentences sent back and fixed | not checked | 18 | 8 |
| Fix answers with an index outside the list | 31% (20-company run) | 25% | **0 of 111** |
| Filler risks ("no availability information") | 1 | 0 | 0 |
| Kind | 5 joint projects | 2 joint projects | 4 joint projects, 1 industrial PhD |
| Time, cost at API prices | (part of a 20-company run) | 14 min, $9.47 | 12.7 min, $9.15 |

The same hand-check on three run-2 proposals of the same companies (C001, C005, C012):

| | Before | After |
| --- | --- | --- |
| Claims | 76 | 53 |
| Wrong, missed by the Critic | 15 (20%) | 8 (15%) |
| Substantive invented facts in the free text | 20 | 6 |
| Plans that break a company limit | 1 | 0 |

What changed in the content:
- **C005** kept the 250 Hz floor in every question and plan row. In run 2 the Matchmaker paired Kardiolink's battery challenge with
  Mijatović (R0905): duty-cycled radio scheduling for body-area networks (radio duty cycle 6.4% → 1.8%), BLE for ECG streaming and
  energy budgets for medical devices, at a fit of 0.88. The risks name the gaps: nRF52840 ADC registers and FreeRTOS task scheduling.
- **C009** fits the company's 8,000 EUR and six months: a master's student supervised by the researcher, with the company's linguists.
- Risks now name a part of the core difficulty the researcher's records do not cover, instead of filler.

What is still open:
- **Length.** About 1,270 words, twice the 600 the prompt asks for.
- **Two fix rounds per proposal.** The Writer's first drafts still put judgement into claims: 9 of the 11 claims rejected in C001's
  first review. The Critic catches them, so each proposal now takes two fix rounds and more critique calls.
- **More drops upstream.** The stricter rubric dropped 14 needs, profiles or pairs in run 2, against 5 in run 1. Addressed after
  run 2 by cutting a claim instead of dropping the artifact (see below).
- **C012 still plans on a scan archive no record mentions** (5 of the 6 substantive facts after). The rule on "data the company is not
  shown to have" came after run 2. In a one-off check of the stored proposals it flags all 8 of those sentences in C012, and nothing in C009.
- 15 minor free-text items remain in the three proposals, such as "a master's student" as if one already exists, or a dataset's
  sampling rate that no record gives.

## A Critic rejection and its fix in the trace

Every run's `trace.jsonl` has `critic.verdict` events with the rejected claims and the reason for each, `critic.sent_back` with the
fix task, and the producer's fixed artifact as a new `artifact.posted`. Run 2, proposal C001-CH1-R1015 (ArmaturaSec × Vuk Đukić):

1. `artifact.posted` by writer-3 (task write-329), 10 min 3 s into the run.
2. `critic.verdict` **send-back** (critique-350). 11 claims and 2 free-text sentences rejected. For example:
   - claim: "Vuk Đukić co-authored a paper on autoencoder-based anomaly detection for Modbus traffic in industrial control systems,
     *which is the core unsupervised method the project builds on*." Reason: "SYN-PUB-10523 confirms … but the claim adds that it
     'is the core unsupervised method the project builds on', which is a judgment".
   - free text: "the researcher cannot validate on real production traffic or test on the actual target hardware without the
     company's data and bench". Reason: "Neither R1015 nor any cited publication states that Đukić lacks access to real production ICS
     traffic … SYN-PUB-10523 in fact describes evaluation on a real-world PLC testbed."
3. Fix task write-366: each claim is rewritten without the judgement ("Vuk Đukić co-authored a paper on autoencoder-based anomaly
   detection for Modbus traffic in industrial control systems."), with the right index for all 13 items. The new draft is posted again.
4. `critic.verdict` **send-back** (critique-369). One claim left; the Writer drops it (write-380).
5. `critic.verdict` **accept** (critique-381), 12 min 9 s into the run.

To list a run's interventions: `grep '"kind":"critic.verdict"' out/<run>/trace.jsonl`. The web app shows the same history per
proposal under Results.

## SubQ, and the last fixes

Run 2 had SubQ off. Three more runs on the same 5 companies, all with `SUBQ=1` and `SCREEN=1` (the second Critic and the shortlist
filter on subq-snap-1.1), each after one more fix. Run 5 also has #33's OpenAlex prior-work step.

| | Run 2 (SubQ off) | Run 3 (SubQ on) | Run 4 | Run 5 |
| --- | --- | --- | --- | --- |
| Code | as above | + SubQ criteria updated | + cut instead of drop, re-check changed sentences only | + joint problem judged as a proposal |
| Accepted / to a person | 5 / 0 | 1 / 3 | 2 / 1 | 3 / 2 |
| Companies with no pair | 0 | 1 | 2 | **0** |
| Pairs | 11 | 10 | 13 | 18 |
| Needs, profiles or pairs dropped / kept after a cut | 14 / – | 12 / – | 10 / 5 | 7 / 8 |
| Time, cost at API prices | 12.7 min, $9.15 | 11.9 min, $7.78 | 12.1 min, $8.11 | 14.8 min, $9.05 |

- **SubQ changes little either way.** As the second Critic, subq-snap rejected 1 proposal claim on its own in run 3, and Haiku 4.5
  2 in run 2. The first Critic (Sonnet 4.6) made 27–45 such rejects in each run. With SubQ the run costs about $1 less. Its
  criteria now include the new rules: "same domain is not same problem" for the filter, judgement and uncited words for the reviewer.
- **A drop cost a whole artifact for one sentence.** All 42 drops in the runs of 30 October had exactly one claim left. The Critic
  now cuts that claim and keeps the rest (`critic.trimmed`), unless it is core: a need's restatement, a pair's problem, a profile's
  availability. Run 5 kept 8 artifacts this way.
- **The free-text check re-judged old sentences.** Each round it flagged sentences it had passed before, so a proposal could fail on
  text that never changed. After the first round it now checks only new or changed sentences, as the claim check does.
- **A rule clash lost every pair of C012 in run 4.** The Matchmaker's "problem" claim says what the two would do. The new rubric
  wanted every word of it in a record. The planned work is now a proposal, and only the facts it gives about either side are checked.
- **The last escalations had one claim left each:** "self-directed" reading (C001), "ARXML files" for "AUTOSAR software component
  configuration files" (C018). A proposal now gets the same cut, in its claims and its Markdown. Its header, its last problem
  claim and its last "why this pair" claim are core, and so is a free-text sentence. On the two stored escalations of run 5, the cut
  leaves proposals of 17 and 16 claims. This came after run 5, so no full run has it yet.
- **Tried, not kept:** marking each source with the claims that cite it ("cited by claims 2, 5"), for the blind spot that
  `npm run critic:eval` found (below). One eval before and after: uncited details caught 2 → 1 of 7, wrong claims 8 → 7 of 23,
  false rejects 6 → 3 of 98. That is no gain, so it was reverted. A check without a model looks better on the same labels: names and
  numbers in a claim that its own records do not contain catch 3 of the 7 ("Nordic", "NTP", "AWS"). It flags 6 of 98 good claims,
  4 of them for dataset ids and "-based" words that are easy to leave out.
- **Tried, not kept: each claim's own records listed under it** (id, kind, title), with the rule "check each claim only against the
  records listed with it". Each record's text still came once, under "Sources". Two evals before and two after, Sonnet alone: wrong
  claims caught 10, 11 → 7, 7 of 23, uncited details 2, 2 → 1, 0 of 7, false rejects 2, 2 → 2, 3 of 98. That is no gain, so it was
  reverted too.

## The Critic on the labelled claims (measured)

The hand-check above is now data. [`test/fixtures/critic-labels.json`](../test/fixtures/critic-labels.json) holds all 129 claims of
C001, C005 and C012 from both runs, each with its cited ids, a label and a note on why. The Critic had passed every one of them.
`npm run critic:eval` runs only the Critic on them, as on a proposal in a match: the code checks, then both reviewers. It sends the
claims and their records, with no free text. Measured on 30 October in four runs of the same prompt (one at commit 341e81d, three
later), with the settings in `.env`: Sonnet 4.6, and subq-snap-1.1 as the second reviewer. Each run is 12 calls, 51–72 s and
$0.32–0.36 at API prices. The table gives the lowest and the highest count of the four runs.

| Label | Claims | Rejected | Sonnet 4.6 alone | subq-snap-1.1 alone |
| --- | --- | --- | --- | --- |
| Judgement added to a fact | 9 | 4–5 | 4–5 | 0 |
| Detail from an uncited record | 7 | 1–3 | 0–2 | 1 |
| Widened scope | 7 | 2–4 | 2–4 | 0 |
| **Wrong, all** | **23** | **8–12 (35–52%)** | 7–11 (30–48%) | 1 (4%) |
| Ok | 98 | **1–6 (1–6%)** | 1–6 | 0 |
| Borderline (not scored) | 8 | 1–2 | 1–2 | 0 |

Of the 15 wrong claims from the before run, the Critic now rejects 4–7. The old rubric rejected none. Of the 8 from the after run,
it rejects 4–5, although nearly the same rubric passed all 8 in run 2. The same prompt catches 8 to 12 wrong claims from one run to
the next, so a change must do better than that spread to show in one or two runs.

What the numbers show:
- **Details from an uncited record are the blind spot: Sonnet caught 0–2 of 7.** The two it catches are always the "data partners"
  claims of C001-CH1-R1008. subq-snap-1.1 catches "AWS" in every run. The other four pass in every run: "Nordic", "paid" and "NTP",
  "alerts" with "not a black-box score", and "over 72 hours". In all 7, the record that holds the word is in the same prompt, because
  another claim of the proposal cites it. Two layouts that tie each claim to its own records did not help (see "Tried, not kept"
  above). "Nordic" may not even come from the prompt: the cited C005 names the nRF52840 chip, which Nordic makes. The eval keeps no
  reason for a claim that passes, so why the other three pass is not known.
- **Judgement and widened scope: 6–9 of 16.** The rubric now catches "directly addressing ArmaturaSec's false positive rate problem"
  and "would address the clinical constraint". In all four runs it passes "the core engine for change detection between scan
  snapshots" and "matching the structured output requirement".
- **subq-snap-1.1 adds one catch in every run** ("AWS", which only the uncited company record names) and no false reject.
- **False rejects: 1–6 of 98, 2 in a typical run.** Two come back in three of the four runs. The Critic calls "making the automation
  unreliable" a judgement, where the hand-check took it as following from the blog's "fragile". It also rejects that the Bash scripts
  "break when Nessus changes its output format": it finds the scripts in CH1 and the format changes in the blog, but no text that
  ties the two.

Each run writes every claim with its verdict, and the reason for a reject, to `out/critic-eval/`. Run it again after a rubric change; `--mock` costs nothing.
