# Entangle web app

The web app for the EINSTEIN matchmaker: a live view of the agents at work and the results they produce.
Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui (restyled) + Motion. The look follows Kanbix
(`docs/design/README.md`): grey canvas, sidebar on the grey, one white panel inset with a large radius.

```sh
npm run dev                       # server + app with hot reload: http://localhost:4317 (or the next free port)
npm run replay -- out/<run>       # open any run folder and play it back; no API keys needed
npm run build                     # static build in web/dist with the finished, non-mock runs (or: -- out/golden)
npm start                         # serve web/dist plus the API
```

## Who owns what

| Path | Owner |
| --- | --- |
| `web/src/screens/live/` | #20: live run view (now a working stub) |
| `web/src/screens/results/` | #21: results view (now a working stub) |
| everything else in `web/`, and `src/server/` | #12: shell, design system, routing, run data, server |

Need something in a shared file (a token, a component, a field on the run view)? Ask on #12's card, or add it
in your own folder first. Pull components from shadcn registries into `components/ui/` only if no screen owns them.

## Reading a run

A run is open while you are under `#/runs/:runId/…`. Everything comes from one store (`web/src/run/`):

```tsx
import { useRun, useRunView, useRunClock, useResults } from "@/run/hooks"

const view = useRunView()          // fold of the trace up to the playhead: agents, loops, tasks, totals, feed
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
  `restart`, `goLive`. The shell already shows the replay bar and handles Space, ← → and L.
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
| Surfaces | `bg-canvas` (window), `bg-panel` (white panel), `bg-sunken` (lanes, columns), `bg-card`, `bg-hover` |
| Text | `text-ink`, `text-ink-muted`, `text-ink-subtle` |
| Lines | `border-hairline`, `border-strong` |
| The one interactive colour | `text-primary`, `bg-primary`, `bg-primary-soft` (tabs, links, focus, primary button) |
| Status (dot plus text) | `working` green, `needs` orange (needs you, sent back), `info` blue, `idle` grey, `failed` red |
| Agent roles | `role-orchestrator`, `role-analyst`, `role-profiler`, `role-matchmaker`, `role-writer`, `role-critic` |

Round dots mean status; small squares mean roles. `ROLE_CLASS`, `roleColor(role)` and `ROLE_INFO` are in `lib/roles.ts`.
For SVG, use `var(--role-critic)` and `color-mix(in oklab, var(--role-critic) 16%, transparent)` for soft fills.

Type: system font. Body is `text-base` (14 px). Steps: `text-xs` 12, `text-sm` 13, `text-md` 15, `text-lg` 17,
`text-xl` 20 (page titles), `text-2xl` 24. Titles are regular or medium weight, never bold. Use `font-mono` only for ids,
traces and code. Use `tabular` on numbers that change in place.

Radii by rank: chips `rounded-sm`, cards and buttons `rounded-md`, lanes `rounded-lg`, the panel `rounded-xl`.
Only floating layers get a shadow (`shadow-float`): the replay bar, popovers, the palette and toasts.

Motion: small and quick (120–240 ms, `ease-out`). Status changes animate; layout does not jump.
`MotionConfig reducedMotion="user"` is set, and CSS animations stop under `prefers-reduced-motion`.

### Components

| Import | What |
| --- | --- |
| `ui/button` | `Button`: `outline` (default), `primary`, `ghost`, `quiet`, `danger`; sizes `sm`, `md`, `lg`, `icon`, `icon-sm` |
| `ui/chip` | `Chip`: outlined pill with an icon and a `count`; `asChild` for a clickable chip; `mono` for ids |
| `ui/status` | `Status` (dot plus coloured text) and `StatusDot`; `pulse` for things happening now |
| `ui/role` | `RoleSquare`, `RoleTag` (square plus name) |
| `ui/card` | `Card`, `CardId`, `CardTitle`, `CardMeta`, `Lane` (grey column with a title and count), `Meta` (one muted line joined by ·) |
| `ui/tabs` | `Tabs` (state) and `RouteTabs` (links): underlined, with counts |
| `ui/segmented` | `Segmented` control |
| `ui/empty`, `ui/skeleton` | `EmptyState`, `Skeleton`, `Spinner`, `LoadingState` |
| `ui/dialog`, `ui/popover`, `ui/tooltip` | `Dialog`, `SheetContent` (right panel), `Popover`, `HoverCard`, `Tooltip` |
| `ui/toaster` | `toast.success("Approved", { description })`: say what happened, in the button's words |
| `ui/markdown` | `Markdown`: proposal markdown, with `[SYN-PUB-…]` citations shown as source chips |
| `ui/switch`, `ui/input`, `ui/kbd`, `ui/command` | the rest |
| `shell/source` | `SourceChip` (hover shows the record), `ClaimText` (claim plus its sources), `SourceView`, `openSource(id)` |
| `shell/command-palette` | `useCommands(owner, commands)`: add your screen's commands to ⌘K while it is mounted |

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
