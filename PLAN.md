# JigJoy hackathon: concurrent agents as a chaotic group chat

Prep notes, written 29 Oct 2026, before kickoff. No project code yet, on purpose:
the rules say "the substance of the work must happen during the event".

## Working rules (for every build card)

Several Claude sessions build this repo at the same time. These rules keep them out of each other's way.

- **Own only your folders.** A card's "Owns:" line lists the paths it may change. If you need a change somewhere else,
  comment on the card that owns it (or ask on your own card). Do not edit it yourself.
- **`src/types.ts` only grows.** Add fields (optional ones where you can). Never rename or remove a field or a type.
- **One Mozaik runtime.** Import from `src/runtime`; never call `defineRuntime` again. Start work with
  `createTask(kind, agent, subjectId)` + `runTask(task, message, { model, structuredOutput })` and wait with `whenSettled(ids)`.
  Each task runs as its own loop with a fresh context, so the trace can tie every event to a task.
- **Shared state lives on `MatchState`** (`profiles`, `needs`, `candidates`, `noMatches`, `proposals`, `verdicts`, `tasks`, `budget`),
  keyed by dataset id. Agents talk through Mozaik events (`sendEvent`) and this state, not through direct calls.
- **Every fact is a `Claim { text, sourceIds }`** with dataset ids (`R0001`, `C001-CH1`, `SYN-PUB-00001`, ...). Join on ids, never on names.
- **Mock first.** `npm run match -- --mock` must run with no keys. Give your agent canned answers with a
  `MockInferenceRunner` responder; with no responder, the mock fills `structuredOutput.schema` with placeholder values.
- **Trace.** Every Mozaik event goes to `out/<run-id>/trace.jsonl`. Custom events are written whole, so keep their payloads
  small and put a `taskId` in them. Mock runs (`out/*-mock/`) are not committed.
- **Before Review:** `npm run typecheck` and `npm run match -- --mock` both pass.

| Folder | What goes there |
| --- | --- |
| `src/types.ts` | Shared contracts (Claim, profiles, needs, pairs, proposals, verdicts, tasks, trace records) |
| `src/runtime/` | Mozaik runtime, `MatchState` blackboard, tasks, mock runner, pricing, budget |
| `src/trace/` | Trace observer (`trace.jsonl`) |
| `src/data/` | Dataset loading, normalisation, duplicate merge, search index (no LLM) |
| `src/agents/<role>/` | One folder per role: `profiler`, `analyst`, `matchmaker`, `writer`, `critic`, `orchestrator` |
| `src/cli.ts` | `npm run match -- [--mock] [--companies N]` |
| `web/` | Live run view and results view |
| `docs/` | Dataset notes, brief, architecture diagram |
| `out/` | Runs: `out/<run-id>/trace.jsonl` + `summary.json` |

## 0. Update from the kickoff email (30 Oct, 10:16)

Some of the prep notes below are out of date. The kickoff email and the track briefs change these:

- **Deadline is Sat 31 Oct, 20:00 CET**, not 18:00 or 14:00. Resubmit as often as you like; the last entry counts.
- **Three tracks, one per team, chosen at submit.** Each entry is scored out of 100 on its own track's criteria.
  The top three overall win ($500 / $300 / $200), whatever the track.
- **The jury judges from the repo.** No video needed; demos (Sat 17:00) are optional.
  So the README, a run from the README, and a trace committed to the repo count more than a live URL.

| Track | Scoring | Fit for us |
| --- | --- | --- |
| 01 Software Factory: spec.md → TS CLI/API with passing tests | Hidden task tests, fewest human steps 35 · architecture 25 · self-recovery 15 · trace with time and cost per task 15 · README 10 | 35 points ride on one 2-hour window (Sat 18:00–20:00) against unknown acceptance tests. Most crowded idea; JigJoy's own Baro is the baseline. |
| 02 EINSTEIN matchmaker: researcher–company pairs + proposals | Architecture and review loops 30 · proposal quality 25 · sources, trace, no hallucinations 20 · real use in EINSTEIN 15 · responsible data 10 | Dataset (~7M tokens) is too big for one model, so fan-out is necessary, not staged. Our Skeptic is their Critic; our swimlane is their trace. Extra deliverables: diagram, trace showing the Critic, 3+ proposals, README answer on EINSTEIN / EINSTEIN Stars. |
| 03 Freestyle: anything on Mozaik | Useful and original 30 · Mozaik parallel + shared state 30 · runs from README 25 · README 15 | The War Room fits here, but "useful and original" (30) is its weak spot: a multi-agent debate room is a common idea. |

**Recommendation: track 02 (EINSTEIN), built on the War Room engine.** Keep the mechanics in section 3
(concurrent loops, budget, rate-limit runner, Critic/Skeptic, swimlane trace) and point them at the dataset:
Profilers ×N on shards in parallel, Industry Analyst ×N, Matchmaker, Writer, Critic that sends claims back.
It is a partner track with a concrete, judgeable output, and the parallelism has a real reason to exist.

Things to settle at the 11:00 intro:
- Which Mozaik version they expect (we pinned 4.1.0; `latest` is a 4.2 beta with a different API).
- Dataset format and size; download it first thing.
- Whether judges have API keys. If not, ship a mock / replay mode so "run it from the README" works without keys.
- Data rule for track 02: rank *pairs* by fit, never people by worth. Say so in the README.

## 1. Rules that matter (build.jigjoy.ai/rules)

- **Dates:** 30–31 Oct 2026, NTP Novi Sad + online. Intro Mozaik stream is **today, 29 Oct**.
- **Deadline:** submissions close **Sat 31 Oct, 18:00 CET**. You can resubmit until then; the last one counts.
  (Dejan said "do 14h u subotu". Check this at the intro stream. Plan for 14h, use 18h as buffer.)
- **Hard requirement:** must use **Mozaik (`@mozaik-ai/core`)** and run **2+ concurrent agents**. Single agent = disqualified.
- **Allowed in advance:** existing frameworks, libraries, boilerplate. Not the project itself.
- **Team:** up to 4 people, one entry.
- **Submit:** name, repo the judges can open, description, **explanation of how the agents run concurrently**.
  Demo video, live deployment and screenshots are optional but "strongly recommended".
  If judges can't open, run or verify it, they may exclude it.
- **Judging:** "genuine concurrency" first, then technical execution, creativity, clarity.
- **Prizes:** $500 / $300 / $200 via Upwork, plus 6-month Mozaik Cloud Premium.

## 2. Mozaik: what I verified

**Pin `@mozaik-ai/core@4.1.0`.** Do not run plain `npm install @mozaik-ai/core`.
The `latest` tag points to `4.2.0-beta.18`, and its API is different from the README:
`defineRuntime()` there returns `createSpace` / `join(spaceId, p)` / `sendMessage(spaceId, id, msg)`,
and agents come from a separate `defineAgentModule` with `RuleBook` loops.
`4.1.0` (2 Oct) matches the README: `createAgent`, `createHuman`, `join(p)`, `sendMessage(msg, senderId)`, `runLoop(...)`.

Model mental model (4.1.0):

- `defineRuntime<State>()` → `initializeRuntime`, `join`, `leave`, `sendMessage`, `sendEvent`, `runLoop`, `resolveRuntime`.
- One event bus. **Every event goes to every joined participant.** Fan-out does not await handlers.
- A participant = manifest + **situation handlers** (`SituationSpecification.isSatisfiedBy` + `SituationProcessor.apply`).
- `runLoop(agentId, msg, { model, context, tools, streaming?, structuredOutput? }, interception?)` is fire-and-forget.
  Each call is its own loop with its own `loopId`. Loop: `message_received → inference ⇄ function_call → model_message → idle`.
- Events you get for free: `message.sent`, `participant.joined/left`, `inference.started/completed` (with `tokenUsage`),
  `function_call.started/completed`, `model.answer`, `interception.started/finished`, `inference.stream`.
- `InterceptionHandler` can inspect or rewrite the next loop step before it runs (e.g. drop a stale answer, swap a tool input).
- `initializeRuntime({ state, inferenceRunnerConfig: { runner } })` lets you plug in **your own `InferenceRunner`**.
  This is the hook for rate limiting, retries, and a mock model.
- Models in 4.1.0 include `claude-haiku-4-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `gpt-5.4-mini`, `gpt-5.5`,
  `gemini-3.5-flash`, `deepseek-v4-flash`. Keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`.
- Mozaik Cloud telemetry turns on with `MOZAIK_API_KEY` or `npx @mozaik-ai/cloud-sdk pair`. Could be a free
  "look, it's concurrent" view for the judges. Ask about it at the intro stream.

**Smoke test (throwaway, outside this folder):** 3 agents, mock runner with 1 s latency, one human message.
All three loops started within 2 ms. All three answers arrived at ~1006 ms. So the loops really run in parallel.
Trick worth reusing at the event: a mock runner lets you build and demo the UI with no API cost and no rate limits.

## 3. Concept: "War Room" research group chat

The user drops a question into a group chat. 4–6 agents with different roles are all in the room.
Each one sees every message and **decides for itself** whether to speak, research, object or summarize.
Nobody orchestrates. The chaos is the product. The engineering is in **keeping the chaos bounded**,
and the demo shows that live.

Example roster (each a Mozaik agent, different model where it helps):

| Agent | Job | Tools |
| --- | --- | --- |
| Scout ×2 | Find sources, post findings with links | web search / fetch |
| Skeptic | Attacks weak claims, asks for sources | none |
| Quant | Checks numbers, does quick math | calculator / code |
| Scribe | Keeps a live draft answer in shared state, calls for a vote when ready | edit-draft |
| Moderator (observer) | Enforces budget, mutes spammers, closes the room | none, or a cheap model |

The user can jump in mid-run ("focus on Europe") and the agents react without a restart.

### The failure modes Dejan named, and the fix for each

| Problem | Fix |
| --- | --- |
| **Never ends** (infinite steps) | Global budget in `RuntimeState`: max messages, max tokens (sum `inference.completed.tokenUsage`), wall clock. Scribe calls a vote. Room closes on quorum or budget. Moderator can force close. |
| **Ping-pong** (agents answer each other forever, "who serves whom") | Each message carries `replyDepth`. Hard cap on depth. Per-agent cooldown. **"Should I speak?" gate**: a cheap structured-output call (haiku / flash-lite) before the full loop. `@mentions` mean "you must answer"; everything else is optional. |
| **Rate limits** | Custom `InferenceRunner` that wraps `DefaultInferenceRunner`: global semaphore (max N in flight), per-provider token bucket, retry with backoff on 429. Spread agents across providers. |
| **Stale answers** (agent replies to a message that is already outdated) | `InterceptionHandler` before `model_message`: if the room moved on (state version changed by X), drop or rewrite the answer. |
| **Agents can't see the whole chat** | An agent's memory only has messages it reacted to. Keep the transcript in `RuntimeState` and put the last K messages into each new loop's prompt. |

### Demo view (this is what wins "genuine concurrency")

Web page, two panes:

- **Left:** the group chat (Slack/WhatsApp style), messages streaming in (`inference.stream`).
- **Right:** a live **swimlane timeline**, one row per agent, a bar per loop from `inference.started` to `inference.completed`,
  tool calls as dots. Overlapping bars = concurrency the judges can see.
- **Top bar:** budget meters (messages, tokens, time), in-flight count, 429 retries, depth cap hits.
- A "chaos" slider (more agents, lower gate threshold) to show the system bends and does not break.

Backend: Node + Mozaik runtime; one observer participant forwards every `SpaceEvent` over WebSocket/SSE to the page.

## 4. Two-day plan (track 02, on the Kanbix board)

The work is split into cards that parallel Claude sessions can take. Each card names the folders it owns.
Dependencies are set as "blocked by", so a card starts by itself when its blockers are Done.

| When | Cards | In parallel |
| --- | --- | --- |
| Fri 10:45–12:00 (you) | #3 intro answers · #4 dataset download · #5 keys + GitHub repo | — |
| Fri ~12:00–13:00 | #6 skeleton + shared types (after #3) · #7 dataset recon (after #4) | 2 sessions |
| Fri 13:30–19:00 | #8 data layer · #9 runtime hardening · #10 Critic · #11 Matchmaker + Writer · #12 web app base, then #13 Profiler + Analyst (after #8) and #20 live run view + #21 results view (after #12) | up to 5–7 sessions |
| Fri 19:00–late | #14 Orchestrator + first real run (after #5, #9, #10, #11, #13) | 1 session + UI cards |
| Sat 10:00–14:00 | #15 proposal quality + Critic stress test · #16 README + diagram | 2 sessions |
| Sat 14:00–16:30 | #17 golden run, fresh-clone test, hosted replay, push · #19 stretch (backlog) | 1–2 sessions |
| Sat 17:00 / 19:30 (you) | #18 first submit, then final submit | — |

Critical path: #3 → #6 → #8 → #13 → #14 → #15 → #17 → #18. The UI track (#12 → #20, #21) runs beside it and only joins at #17.
If time slips, cut #19, then PDF export in #21, then the fancy Critic animation in #20. Never cut replay: it is how the jury sees a run without keys.

## 5. Prep you can do now (allowed)

- [ ] Watch the intro stream today. Confirm the deadline (14:00 or 18:00) and ask if the Mozaik Cloud view counts as evidence.
- [ ] API keys: none are set in this shell. Get Anthropic + one of OpenAI/Gemini, with enough rate limit and credit.
- [ ] Create an empty GitHub repo and make sure the judges can open it (public, or invite).
- [ ] Pick a deploy target (Vercel/Render/Fly) and log in. Needs a long-running Node process + WebSocket/SSE.
- [ ] Pick a web search API for the Scouts (Tavily / Brave / Exa) and get a key.
- [ ] Agree on the concept and roles with Dejan (see open questions).

## 6. Open questions for the team

- Is "research war room" the story, or do you want a different domain (e.g. a newsroom, an incident response channel, a startup board meeting)? The mechanics are the same.
- Web UI or terminal UI? Web is better for the demo video and the live URL. Terminal is faster to build.
- TypeScript or plain JS? Mozaik is TS-first; TS costs little with `tsx`.
