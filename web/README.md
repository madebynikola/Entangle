# Entangle web app

The web app for the EINSTEIN matchmaker: what a run did, the agents at work, and the results they produce.
Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui (restyled) + Motion, set in Inter, with proposals in Source Serif 4.
The look is calm, in the spirit of Vercel: one question per screen, colour only where it means something.
The brand (logo, palette, type, agent faces) comes from the kit in [`design/`](../design/HANDOFF.md).

## Layout

- `#/`: the runs, as one table. Real runs by default; mock runs and unfinished dev runs are a click away.
  With no real runs, an intro points at the sample run.
- `#/runs/:id/overview`: what happened. The five steps, model calls in flight over time, what the Critic caught, the proposals.
- `#/runs/:id/live`: the **Timeline** (the tab says "Live" with a green dot while the run is running).
- `#/runs/:id/stage`: the **Stage**. The seven agent faces sit round the event bus. Each event travels from its author
  through the bus to everyone, the author says it in a bubble, and the Critic stamps what it checks ("Passed", "Sent back").
  Click an event in the log to move the playhead there. The Timeline and the Stage are the tabs with the replay bar.
  The run clock says what happened; a director (`screens/stage/director.ts`) shows it at a human pace at any speed,
  merging bursts into one line ("Checked 6 profiles. All sourced."). A seek jumps there still. Wording is in `words.ts`.
- `#/runs/:id/results`: pairs and proposals, as a list and a detail side by side. Deep links:
  `results/proposals/:id` (add `?tab=review` for the Critic history), `results/pairs/:pairId`, `results/challenges/:id`.

**The frame.** A sidebar on the grey canvas, and one white panel inset beside it (the Kanbix frame).
The sidebar has search (⌘K), the runs worth opening (live, finished real runs, the sample; "All runs" for the rest),
the open run's agents by role (a pip per agent lights up while it works), and the server state and theme.
⌘B hides it. Below 1024 px it is a drawer, and the panel fills the window.

**The window never scrolls.** Inside the panel, `PageHeader` (shell/page-header) draws the title, one line of facts,
actions and tabs. A run's header holds its totals: state, time, agents, tokens, cost. The screen gets the rest of the
panel: a box with a fixed height, edge to edge, no padding. So:

- Make the screen's root `h-full` (`flex h-full min-h-0 flex-col`, or a grid with `minmax(0,1fr)` rows) and add your own padding (`p-5`).
- Put `overflow-y-auto scrollbar-thin` only on the parts that hold lists or long text. Use `Pane` for tiles that share the height.
- On the Timeline the replay bar docks at the bottom of the panel, below your screen. It covers nothing.
- The box scrolls only as a fallback, and below 1024 px, where panes stack into one column (`lg:` for the fitted layout).

**Nothing moves unless asked.** A finished run opens at its end, still. "Watch the replay" (or `?replay`) plays it from the start.
Leaving the Timeline pauses a replay, so Overview and Results never change under the reader.

```sh
npm run dev                       # server + app with hot reload: http://localhost:4317 (or the next free port)
npm run replay -- out/<run>       # open any run folder and play it back; no API keys needed
npm run build                     # static build in web/dist with the finished, non-mock runs (or: -- out/golden)
npm start                         # serve web/dist plus the API
```

## Who owns what

| Path | Owner |
| --- | --- |
| `web/src/screens/live/` | #20: the Timeline |
| `web/src/screens/stage/` | #30: the Stage |
| `design/` | The brand kit, as handed over. Regenerate with its `tools/` (see `design/HANDOFF.md`); do not edit the SVGs by hand |
| `web/src/screens/results/` | #21: the results view |
| everything else in `web/` (incl. `screens/overview`, `screens/home`), and `src/server/` | #12: shell, design system, routing, run data, server |

Need something in a shared file (a token, a component, a field on the run view)? Ask on #12's card, or add it
in your own folder first. Pull components from shadcn registries into `components/ui/` only if no screen owns them.

## Reading a run

A run is open while you are under `#/runs/:runId/…`. Everything comes from one store (`web/src/run/`):

```tsx
import { useRun, useRunView, useRunClock, useResults } from "@/run/hooks"

const view = useRunView()          // fold of the trace up to the playhead: agents, loops, tasks, totals, feed
const full = useFullView()         // the whole run as far as known, whatever the playhead shows (for summaries)
const clock = useRunClock()        // run ms now; re-renders every frame while live or playing
const { results } = useResults()   // needs, profiles, pairs, noMatches, proposals, verdicts, approvals
const records = useRun((s) => s.records) // every trace record loaded so far (TraceRecord from src/types.ts)
```

- `view.loops`: one per Mozaik loop (one task attempt), with `inferences` (spans) and `calls` (tool calls).
  A span with no `endMs` is still open: draw it up to `clock`. Bars then grow in real time, in replay too.
  `dispatchedMs` is when the hardened runner sent the call; the time before it is a rate-limit wait.
- `view.agents`: `role` (from the name: `profiler-3` → profiler), `activity` (idle, thinking, tool),
  `openLoops`, `tokens`, `costUsd`, `sentBack`.
- `view.feed`: every record that is not loop plumbing, oldest first. Real runs write `artifact.posted`
  `{ kind, id, taskId }`, `critic.reviewing`, `critic.verdict` `{ kind, id, revision, ok, action, producerTaskId, rejected }`,
  `critic.sent_back` and `task.completed` / `task.failed`. The sample run writes the same shapes.
- Player: `useRunStore.getState()` has `play`, `pause`, `toggle`, `seek(ms)`, `setSpeed(1 | 4 | "instant")`,
  `restart`, `goLive`. On the Timeline the shell shows the replay bar and handles Space, ← → and L.
- Approvals: `useRunStore.getState().approve(pairId, "approved" | "rejected" | null, note)`. On the server it writes
  `out/<run>/approvals.json`. In a static build it stays in the browser.
- For a smooth 50-agent view, call `useRunClock()` once near the top and pass the value down, or read
  `runClock()` in your own `requestAnimationFrame` loop.

The **sample run** (`#/runs/sample/live`) is built in (`fixtures/sample-run.ts`): 16 agents over 35 s, with one
Critic send-back and its fix. Use it while real runs are thin. Replaying a real run works too:
`npm run replay -- out/tmp/2026-10-30T11-23-50-try` (4 proposals, 31 Critic reviews).

## Design system

Tokens are in `src/styles.css`, with light and dark values. Use the Tailwind names, never raw colours:

| Use | Classes |
| --- | --- |
| Surfaces | `bg-canvas` (window, sidebar), `bg-panel` / `bg-card` (the panel, cards, tables), `bg-sunken` (wells: charts, code), `bg-hover` |
| Text | `text-ink`, `text-ink-muted`, `text-ink-subtle` |
| Lines | `border-hairline`, `border-strong`; `shadow-card` (a whisper, light mode only), `shadow-float` (floating layers) |
| Actions | `bg-primary` is ink: the one primary button per view. `text-link` is the logo's indigo: links, focus rings, ids |
| Status (dot plus text) | `working` green, `needs` amber (needs you, sent back), `info` blue, `idle` grey, `failed` red |
| Agent roles | `role-orchestrator`, `role-analyst`, `role-profiler`, `role-matchmaker`, `role-writer`, `role-critic` |

Round dots mean status; small squares mean roles. `ROLE_CLASS`, `roleColor(role)` and `ROLE_INFO` are in `lib/roles.ts`.
Each role is a character from the kit, with its colour, name and face: Deneb (orchestrator, ink), Spica (analyst, amber),
Tycho (profiler, indigo), Amity (matchmaker, violet), Tinta (writer, teal), Fides (critic, red). You, the approver, is grey.
`ROLE_INFO[role].name` and `.face` give them. Status uses the kit's Critic verdict colours.
For SVG, use `var(--role-critic)` and `color-mix(in oklab, var(--role-critic) 16%, transparent)` for soft fills.

Type: Inter for the interface, Source Serif 4 for proposal text (`Markdown`, the PDF export), both self-hosted.
There is no monospace: `font-mono` is Inter with tabular, slashed-zero figures, for ids. Body is `text-base` (14 px). Steps: `text-xs` 12, `text-sm` 13, `text-md` 15,
`text-lg` 16, `text-xl` 20, `text-2xl` 24 (page titles), `text-3xl` 32 (big numbers). Page and section titles are `font-semibold`;
headings get tight tracking. Use `font-mono` only for ids, traces and code. Use `tabular` on numbers that change in place.

Radii: buttons and inputs `rounded-md`, cards and tables `rounded-lg`, floating layers `rounded-xl`, chips `rounded-full`.
A screen is a few `Pane`s that share the panel's height (title, one short line, optional action, then a body that can scroll).
`Section` (a titled block with no frame) is for content that sits in a scrolling pane.

Motion: small and quick (120–240 ms, `ease-out`). Status changes animate; layout does not jump.
The faces are the one exception: they blink and glance while idle, as the kit designs them.
`MotionConfig reducedMotion="user"` is set, and CSS animations stop under `prefers-reduced-motion`.

### Components

| Import | What |
| --- | --- |
| `ui/button` | `Button`: `outline` (default), `primary` (ink), `ghost`, `quiet`, `danger`; sizes `sm`, `md`, `lg`, `icon`, `icon-sm` |
| `ui/chip` | `Chip`: small pill with an icon and a `count`; tones; `asChild` for a clickable chip; `mono` for ids |
| `ui/status` | `Status` (dot plus coloured text), `StatusLabel` (dot plus ink text: a run's state), `StatusDot`; `pulse` for now |
| `ui/role` | `RoleSquare`, `RoleTag` (square plus name) |
| `ui/face` | `AgentFace` (a face from `design/agents`: `state` idle, working, reject or done; `gaze` turns the eyes), `RoleFace` |
| `ui/card` | `Pane` (titled tile that fills and scrolls), `Card`, `Section` (titled block), `Stat`, `CardId`, `CardTitle`, `CardMeta`, `Lane`, `Meta` |
| `ui/tabs` | `Tabs` (state) and `RouteTabs` (links): underlined, with counts |
| `ui/segmented` | `Segmented` control |
| `ui/empty`, `ui/skeleton` | `EmptyState`, `Skeleton`, `Spinner`, `LoadingState` |
| `ui/dialog`, `ui/popover`, `ui/tooltip` | `Dialog`, `SheetContent` (right panel), `Popover`, `HoverCard`, `Tooltip` |
| `ui/toaster` | `toast.success("Approved", { description })`: say what happened, in the button's words |
| `ui/markdown` | `Markdown`: proposal markdown, with `[SYN-PUB-…]` citations shown as source chips |
| `ui/switch`, `ui/input`, `ui/kbd`, `ui/command` | the rest |
| `shell/source` | `SourceChip` (hover shows the record, click opens it), `ClaimText` (claim plus its sources), `SourceView`, `openSource(id)` |
| `shell/command-palette` | `useCommands(owner, commands)`: add your screen's commands to ⌘K while it is mounted |
| `shell/page-header` | `PageHeader`: title, `meta` line, `actions`, `tabs`. Routes outside a run use it; RunLayout draws the run's one |
| `run/metrics` | `concurrency(records, duration)` (calls in flight over time, and the peak) and `pipeline(...)` (the five steps) |

### Wording

Plain words and sentence case. A button says what it does ("Approve"), and its toast uses the same word ("Approved").
Pairs are ranked by fit, never people by worth: write "fit of this pair", and never show a score for a person.
An empty state says what is missing and what to do next.

## Server

`src/server/` serves the app and the API (`src/server/api.ts` lists every endpoint and type). It reads run folders in
`out/`. It streams `trace.jsonl` over SSE as the trace grows, so any run started with `npm run match` shows live.
For results it reads `out/<run>/results.json` (shape `RunResults`). Without that file, it uses `pairs.json`,
`proposals.json` or `proposals/*.md`, and the Critic verdicts in the trace. Sources come from the run's `sources.json`
first, then from the dataset when `data/raw/` is present. `npm run build` writes `sources.json` into the run folder, so a
committed run can be replayed without the dataset.
