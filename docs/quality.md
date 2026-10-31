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
  4 of them for dataset ids and "-based" words that are easy to leave out. A stricter form of it is now a code check (below).
- **Tried, not kept: each claim's own records listed under it** (id, kind, title), with the rule "check each claim only against the
  records listed with it". Each record's text still came once, under "Sources". Two evals before and two after, Sonnet alone: wrong
  claims caught 10, 11 → 7, 7 of 23, uncited details 2, 2 → 1, 0 of 7, false rejects 2, 2 → 2, 3 of 98. That is no gain, so it was
  reverted too.

## A shortlist of 2 with the SubQ screen

In 4 screened runs, 18 of 19 chosen pairs were the screen's rank 1 or 2. So we tried to profile only 2 candidates per challenge
(`--k 2`) and not 4. `SCREEN_WIDEN` sets how many candidates the screen rates, as a multiple of k: `--k 2` alone rates 4, and
`SCREEN_WIDEN=4` rates 8, as many as the default. Same 5 companies, `--screen --subq`, local Claude Code, one run each on 31 October.
The code changed after run 5, and #54 changed the availability regex during the first k 2 run. So we ran k 4 again on today's code
(`out/2026-10-31T10-53-09`) and ran the first k 2 setting again (`out/2026-10-31T11-15-19`). The three runs of 31 October below use the same code.

| | Run 5 (k 4, 8 rated) | k 4, 8 rated | k 2, 8 rated | k 2, 4 rated |
| --- | --- | --- | --- | --- |
| Run | `2026-10-30T16-13-38` | `2026-10-31T10-53-09` | `2026-10-31T10-38-09` | `2026-10-31T11-15-19` |
| Accepted / to a person | 3 / 2 | **5 / 0** | 4 / 1 | 3 / 2 |
| Companies with a chosen pair | 5 | 5 | 5 | 5 |
| Challenges with no match | 4 | 3 | 3 | 3 |
| Profiles / pairs | 34 / 18 | 40 / 19 | 22 / 14 | 22 / 16 |
| Mean fit of the 5 chosen pairs | 0.90 | 0.84 | 0.90 | 0.89 |
| Chosen pairs that are the screen's rank 1 | 5 of 5 | 4 of 5 | 5 of 5 | 4 of 5 (one rank 2) |
| Tokens | 2.63M | 2.96M | 2.22M (−25%) | 2.14M (−28%) |
| Cost at API prices | $9.05 | $9.97 | **$7.66 (−23%)** | **$7.47 (−25%)** |
| Time | 14.8 min | 22.0 min | 14.9 min | 14.4 min |

- **A shortlist of 2 costs about a quarter less.** The saving is in profiles, their critiques, matches and pair critiques: $6.84 at
  k 4, $4.58 and $4.23 at k 2. Proposals cost the same ($1.96–2.12). The screen calls are not priced in the budget.
- **The time gain is not clear.** Local Claude runs 6 sessions at once, so 40 profiles wait in a queue. At k 4 today, profiling ended
  at 18.3 min; at k 2 at 10.2–10.6 min. But run 5, also k 4, ended profiling at 9.5 min and the whole run at 14.8 min. So part of the
  22 minutes is load on the machine, not k.
- **The same researcher was chosen in all four runs for C001 (R1008), C009 (R0349) and C018 (R0948),** and for C012 (R0564) in three.
  The screen's probabilities are near 1 (0.996–0.9998) for most chosen pairs, so rank 1 and rank 2 are close to a tie.
- **What changed the result was the Critic, not k.** In each of the three runs on today's code the Critic dropped a strong pair or need:
  C005-CH1 × R0905 in the k 4 run and the k 2, 8 rated run, C012-CH1 × R0564 and the C005-CH1 need in the k 2, 4 rated run.
  At k 4 the Orchestrator then chose C005-CH1 × R0206, the screen's rank 3, at a fit of 0.54. At k 2 there was no second option on
  that challenge, so the company's pair came from its other challenge: C005-CH2 × R0057 at 0.93–0.95, and C012-CH2 × R1027 at 0.88.
  C012-CH1 had only one candidate over the screen's threshold of 0.2, so k 4 would not have kept a second one there.
- **Accepted against sent to a person** goes from 5 / 0 to 3 / 2 between runs of the same setting (run 5 and today's k 4 run). With
  one run each, the four settings do not differ on it.
- **k 2 with 8 rated is the better of the two k 2 settings.** It rates the same 8 candidates as the default, costs $0.19 more than
  4 rated, and had its chosen pairs all at the screen's rank 1. Two more runs of each setting follow below, and it is now the default.

### Two more runs of k 4 and k 2, and the new default

One run of each setting did not show if the accepted count was noise. So we ran k 4 and k 2 with 8 rated twice more, on commit
3a2098a, same 5 companies, `--screen --subq`, local Claude Code. In each round the two settings ran at the same time, so both had the
same load on the machine, and their times compare inside a round. With the two runs of 31 October above, each setting has 3 runs.

| | k 4, 8 rated | | | k 2, 8 rated | | |
| --- | --- | --- | --- | --- | --- | --- |
| Run | `10-53-09` | `11-37-26` | `11-55-10` | `10-38-09` | `11-37-31` | `11-55-14` |
| Accepted / to a person | 5 / 0 | 4 / 1 | 5 / 0 | 4 / 1 | 5 / 0 | 4 / 1 |
| Challenges with no match | 3 | 3 | 3 | 3 | 4 | 3 |
| Profiles / pairs | 40 / 19 | 35 / 23 | 38 / 13 | 22 / 14 | 22 / 13 | 22 / 17 |
| Mean fit of the 5 chosen pairs | 0.84 | 0.88 | 0.78 | 0.90 | 0.88 | 0.88 |
| Chosen pairs at the screen's rank 1 / 2 / 3 | 4 / 0 / 1 | 4 / 1 / 0 | 3 / 2 / 0 | 5 / 0 / 0 | 4 / 1 / 0 | 3 / 2 / 0 |
| Tokens | 2.96M | 2.80M | 2.96M | 2.22M | 2.06M | 2.09M |
| Cost at API prices | $9.97 | $9.40 | $10.13 | $7.66 | $6.97 | $7.23 |
| Time (profiling ended at) | 22.0 (18.3) min | 17.6 (14.2) min | 18.2 (14.9) min | 14.9 (10.6) min | 13.2 (9.5) min | 14.5 (9.9) min |

The runs are in `out/2026-10-31T…`. `11-37-26` ran with `11-37-31`, and `11-55-10` with `11-55-14`.

- **Over 3 runs each, k 4 had 14 accepted and 1 sent to a person, k 2 had 13 and 2.** The difference is one proposal, and it is not
  from k. Both k 2 runs that sent one to a person sent C009-CH1 × R0349. That pair was chosen in all 6 runs, and the Critic stopped it
  at the proposal, not at the pair. The k 4 runs accepted the same pair's proposal. In `11-37-26` (k 4) the Critic
  sent C012-CH1 × R0564 to a person the same way.
- **k 2 chose the same researcher for each company in all 3 runs:** R1008 (C001), R0905 or R0057 (C005), R0349 (C009), R0564 (C012)
  and R0948 (C018). k 4 chose all five in 1 of its 3 runs. In `10-53-09` it chose C005-CH1 × R0206 at 0.54 (see above). In
  `11-55-10` the Critic dropped 11 pairs after two revisions each, and every pair on C001-CH1 and C012-CH1 was one of them. So the
  Orchestrator chose C001-CH4 × R0833 at 0.55 and C012-CH2 × R0386 at 0.62. The mean fit of the chosen pairs is 0.83 at k 4 and 0.89 at k 2.
- **k 2 costs 26% less: $7.29 against $9.83 on average,** and uses 27% fewer tokens (2.12M against 2.91M).
- **k 2 is 20–25% faster in the same round:** 13.2 against 17.6 min, and 14.5 against 18.2 min. With a shortlist of 2, profiling ends
  4–5 minutes sooner.
- **The screen's rank 1 and 2 are close to a tie.** For C009-CH1, R0288, R0349 and R0925 are at 0.9985–0.9996 in each of the 4 new runs,
  and their order changes. R0349 was rank 1 or 2 in all 6 runs, so a shortlist of 2 kept it every time. A shortlist of 2 can lose a right
  researcher when the model puts them third. That did not occur in these 6 runs.

**The default is now k 2 with the screen on** (`SCREEN.k` in `config/models.ts`). With the screen off, k is still 4, and with
`--problem` it is 6. The screen rates at least 8 candidates (`SCREEN_RATED`), or `SCREEN_WIDEN` (default 2) times k if that is more.
So k 2 and k 4 rate 8, as in these runs, and the reverse search (k 6) still rates 12. `--k 4` gives the old shortlist, and
`SCREEN_RATED=4 --k 2` the "k 2, 4 rated" setting above.

## The Critic on the labelled claims (measured)

The hand-check above is now data. [`test/fixtures/critic-labels.json`](../test/fixtures/critic-labels.json) holds all 129 claims of
C001, C005 and C012 from both runs, each with its cited ids, a label and a note on why. The Critic had passed every one of them.
`npm run critic:eval` runs only the Critic on them, as on a proposal in a match: the code checks, then both reviewers. It sends the
claims and their records, with no free text. Measured on 30 October in three runs, with the settings in `.env`: Sonnet 4.6, and
subq-snap-1.1 as the second reviewer. Two ran at commit 146d0b3, one at 5555066 (the word-form fixes below, which change no code
result on these claims). Each run is 12 calls, 46–70 s and $0.31–0.35 at API prices. The table gives the lowest and the highest
count of the three runs. A claim that a code check rejects does not go to the reviewers.

| Label | Claims | Rejected | By code | Sonnet 4.6 alone | subq-snap-1.1 alone |
| --- | --- | --- | --- | --- | --- |
| Judgement added to a fact | 9 | 7–8 | 0 | 7–8 | 0 |
| Detail from an uncited record | 7 | 5–6 | 4 | 1–2 | 0 |
| Widened scope | 7 | 3–6 | 1 | 2–5 | 0 |
| **Wrong, all** | **23** | **17–19 (74–83%)** | 5 (22%) | 12–14 (52–61%) | 0 |
| Ok | 98 | **3–6 (3–6%)** | 0 | 3–6 | 0 |
| Borderline (not scored) | 8 | 2–3 | 0 | 2–3 | 0 |

**Until commit 33823c0 the eval reviewed only 102 of the 129 claims.** Two proposals share the id C012-CH1-R0564, the same pair in
the before and the after run. The second one overwrote the first on the blackboard before its review, so the 27 claims of the before
C012 proposal passed unread. Every earlier eval, the "Tried, not kept" ones above too, scored 16 wrong and 79 ok claims, not 23 and
98. On those 102 claims the two runs compare with the four earlier runs of the same prompt (one at commit 341e81d, three later):

| On the 102 claims the old eval reviewed | 4 runs before the code check | 2 runs with it |
| --- | --- | --- |
| Wrong claims caught, of 16 | 8–12 | 12–13 |
| Details from an uncited record caught, of 6 | 1–3 | 4–5 |
| Ok claims rejected, of 79 | 1–6 | 3–4 |

What the numbers show:
- **A code check now catches 4 of the 7 details from an uncited record, in every run and with no false reject:** "Nordic", "NTP",
  "over 72 hours" and "AWS". The prompt did not: Sonnet caught 0–2 of 7 in each of four runs, and two layouts that tie each claim to
  its own records did not help (see "Tried, not kept" above). The check looks at a claim's names (a capital inside a word or a
  sentence, letters with digits), numbers, and a number with the word after it. One that the claim's own records do not hold but
  another record of the artifact does is rejected as `uncited-detail`, and the reason names that record:
  `"AWS" is not in C005-CH2 but is in C005, which the claim does not cite.` The producer can cite C005 or leave the word out.
- **What the check leaves alone:** the researcher's and the company's own names, an acronym that the cited record spells out ("ICS"
  for "industrial control systems"), and a clause that says what is missing ("BACnet/IP does not appear in the listed works"). It
  also rejects one widened claim, for "BACnet/IP" where the cited records say only BACnet.
- **Plain words do not work as a code check.** A word that only one other record of the artifact holds flags 32 of the 98 ok claims.
  Two such words in a row flag 18. So the check misses "data partners" (C001-CH1-R1008) and "not a black-box score". Sonnet catches
  1–2 of those 3.
- **subq-snap-1.1 now catches nothing.** Its one catch in every earlier run was "AWS", which the code check now rejects first.
- **The before C012 proposal is reviewed for the first time.** Sonnet catches "the core engine for change detection between scan
  snapshots" and "matching the structured output requirement" in all three runs. The earlier text said it passed them in all four
  runs, but it never saw them. It passes "which requires reducing the initial engagement phase from four days to one day" in all three.
- **False rejects: 3–6 of 98, all by Sonnet, none by code.** Two are in the newly reviewed proposal and come back in all three runs.
  Sonnet calls "the pipeline must replace" and "should be scoped carefully against this constraint" editorial. On the 102 claims of the
  old eval it rejects 3–4 of 79 in the first two runs, in the range of the earlier runs. It also rejects "four days spent on
  reconnaissance" in all three runs: it reads "a few days" in CH1 and misses "from four days to one" further down the same record.

### The names-and-numbers check on real runs

The labels hold 129 claims. To see the check on many more, `checkByCode` ran again on every need, profile, pair and proposal in the
results of the 12 real runs of 30 October: 13,888 claims, with the records in each run's `sources.json`. All 12 runs are older than
the check, so each claim it rejects there is one that a run today would send back. No model runs, so this costs nothing and gives
the same answer each time.

| Form of the check | Claims it rejects, 12 runs | In the reference run (`out/golden`) | On the labels: wrong caught, ok rejected |
| --- | --- | --- | --- |
| A name or number in none of the claim's own records | 1,155 | 53 | 6 of 23, 2 of 98 |
| The same, names and single numbers only | 714 | 28 | 5 of 23, 0 of 98 |
| In none of its own records, but in another record of the artifact (146d0b3) | 431 | 22 | 5 of 23, 0 of 98 |
| The same, with the fixes below (5555066, kept) | **371** | **19** | **5 of 23, 0 of 98** |

- **"In none of its own records" rejects 2–3 times as many claims and catches no more details.** Its one extra catch on the labels is
  a judgement claim, for a stray "1 and" in "3:1 and". A number with the word after it adds most of its noise: "2022 experience",
  "18 month". A hand-check of the 40 extra rejects of the second form in three runs (`golden`, 15-09-14, 17-02-48) found one or two
  real ones ("South Slavic"). Most of the rest come from records written in Serbian: "Vojvodini" for Vojvodina, "340.000" for
  340,000, "maja" for May, "u prvom kvartalu" for Q1. Others were "Austria" for "Austrian", "Netherlands" for "Dutch", "Forty-seven"
  for 47, and the digits of page paths. So the rule stays: a detail counts only when another record of the artifact writes it as
  the claim does.
- **The fixes clear 60 claims and reject none that passed before.** A cited record may hold a name in another form: "Hungary" for
  "Hungarian", the Serbian "Vojvodini" for "Vojvodina", "STM32H7" for "STM32", "text-to-speech" for "TTS", "9.000" for 9,000. This
  applies to the claim's own records only. Another record is blamed only for the detail as written: its "manages" is not the
  claim's "Manager".
- **A number under 100 on its own no longer blames a paper.** 8 claims were rejected for a lone "10" that only papers of the
  researcher hold. In 4 of them the cited C017-CH1 writes it as "deset godina" (ten years). A company record, page or researcher record
  holding the number still counts: "20 engineers" from C020-CH1 on a claim that cites C020. One arguable catch is lost this way: a
  pair claim on a paper that names the company's "60-second latency budget".
- **A page path in a claim left numbers behind.** In "(C018/job/2024-03-10)" the id pattern took "C018" first and left "2024", "03"
  and "10", so "10" was blamed on a paper. It now takes the whole path.
- **What the 19 rejects in the reference run are:** 18 hold a detail that the cited records lack and another record has. Examples:
  "TCP/IP" where C001-CH1 says only "Modbus and BACnet", and "µA", "AFE" and "IC" from R0905 and C005 on claims that cite
  SYN-PUB-09637. One is chance: "2" in "2–4 minutes", where SYN-PUB-09983 says 2.1 and C018 holds "Tier-2".
- **Cost:** a run today sends back about 2.7% of the claims that these runs accepted, 19 in the reference run. The reason names the
  record that holds the detail, so the producer can cite it or drop the word.

Each run writes every claim with its verdict, and the reason for a reject, to `out/critic-eval/`. Run it again after a rubric change; `--mock` costs nothing.

## Where the cost goes, and what is left to cut

The k 2 default (above) made a run about a quarter cheaper. To find the next cut, we split the cost of the three k 2 runs
(`10-38-09`, `11-37-31`, `11-55-14`) by stage, from the `inference.completed` events in each `trace.jsonl`. Cost is at API
prices; these runs ran on local Claude Code.

| Stage | Model | Calls | Cost per run | Share |
| --- | --- | --- | --- | --- |
| Critic: pairs | Sonnet 4.6 | 39–48 | $1.25 | 17% |
| Critic: profiles | Sonnet 4.6 | 40–47 | $1.25 | 17% |
| Critic: proposals | Sonnet 4.6 | 25–28 | $1.08 | 15% |
| Critic: needs | Sonnet 4.6 | 31–37 | $0.63 | 9% |
| Matchmaker | Sonnet 4.6 | 36–42 | $1.35 | 19% |
| Writer | Sonnet 4.6 | 15 | $0.84 | 12% |
| Profilers | Haiku 4.5 | 41–47 | $0.52 | 7% |
| Analysts | Haiku 4.5 | 22–27 | $0.27 | 4% |
| Funding Scout | Haiku 4.5 | 10 | $0.08 | 1% |
| Screen and second Critic | subq-snap-1.1 | 26 | < $0.01 | 0% |
| **Run** | | | **$7.29** | |

- **Sonnet 4.6 is 88% of the cost, and the Critic alone is 58%.** Input and output cost about the same: about 1.1M input
  tokens ($3.40) and 0.2M output tokens ($3.00) per run.
- **Re-reviews are $1.89 per run (26%).** That is the Critic's rounds 1 and 2, after a send-back. They check only the claims
  that changed, but each one sends all the sources again. The fixes that the producers make cost more on top of that.

### A Haiku 4.5 Critic: measured, not kept

The Critic costs the most, so we ran `npm run critic:eval` with `MODEL_CRITIC=claude-haiku-4-5`. We did three runs on
31 October, with subq-snap-1.1 as the second reviewer as before, and three Sonnet 4.6 runs for comparison.

| | Haiku 4.5 (3 runs) | Sonnet 4.6 (3 runs) |
| --- | --- | --- |
| Wrong claims caught, of 23 (code checks and both reviewers) | 11, 11, 11 | 21, 15, 16 |
| The model alone | 6, 6, 6 | 16, 10, 11 |
| Ok claims rejected, of 98 | 2–4 | 7, 4, 6 |
| Cost, time | $0.09, 21 s | $0.32–0.35, 50–63 s |

A Haiku Critic would cost about $2.80 less per run (38%). But it catches 11 of 23 wrong claims where Sonnet catches 15 to 21 (16 on average), and the model alone catches 6
where Sonnet catches 10 to 16. Sonnet varies more between runs than Haiku does, so the first run (21) was the best case.
Haiku still misses nearly all the judgements and widened claims. That is the work the Critic is for, so the Critic stays on Sonnet 4.6.

### The other levers

| Lever | Saving per run | Effect on quality | Status |
| --- | --- | --- | --- |
| Shortlist of 2 with the screen | 26% | the same over 3 runs each | done, the default |
| subq-snap-1.1 as the second Critic, not Haiku 4.5 | about $1 | the same | done |
| Haiku 4.5 as the Critic | 38% | catches 11 of 23 wrong claims, not 15–21| measured, not kept |
| Sonnet 5.5 for Matchmaker, Writer and Critic ($2 / $10 per MTok, not $3 / $15) | about 29% | not measured | not now: the hackathon expects Sonnet 4.6 |
| Prompt caching of the system prompt on the Anthropic API | about 4–5% | none: the same tokens | not done (see below) |
| Sources before claims in the Critic's prompt, so that re-reviews read the sources from the cache | up to about 8% more | must be measured with `critic:eval` | not done |
| One send-back round, not two | about 15% | loses the artifacts that the second round saves | not kept |
| The Batch API (half price) | about 50% | none | not for live runs: answers can take hours, and Mozaik has no batch path |

- **Prompt caching helps only the Matchmaker and the Writer.** Their instructions are about 1,900 and 3,400 tokens. The
  Critic's instruction is about 800 tokens, under the 1,024 that Sonnet 4.6 needs before it caches a prefix. The Haiku 4.5
  roles are under its minimum of 4,096. Mozaik 4.1.0 sends the system prompt as one string with no `cache_control`, so this
  needs a wrapper on its Anthropic endpoint. The cost accounting must change too: Mozaik reports only the uncached input
  tokens when a cache is used. Local Claude Code runs already cache, and they bill the Claude login, not API prices.
- **The cost at API prices is an upper bound for local runs.** `claude-code-runner.ts` counts cached input tokens at the
  full price.
