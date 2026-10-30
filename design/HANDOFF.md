# Entangle: brand and agent handoff

Entangle is our entry for the EINSTEIN track (science-to-business matchmaking) of the JigJoy Mozaik hackathon: a team of Mozaik agents that reads a researcher and company dataset, pairs researchers with company problems, and writes a sourced industrial PhD proposal for each pair, with a Critic checking every claim.

This folder is the visual layer: logo, brand tokens, seven animated agent characters, and a scripted simulation showing them working together. It is self-contained, needs no build step and has no dependencies beyond Node (for regenerating) and a browser.

Open these first:
1. `agents/simulation.html`: a full run, live (about 50 s, loops; Pause, Restart, 2×).
2. `agents/preview.html`: every agent in every state (buttons per agent and for all).
3. `brand/brand.html`: palette, type and usage.

Use Chrome or Safari, opened straight from disk. All pages are single files.

## Folder map

| Path | What it is |
|---|---|
| `logo/entangle.svg` | The still mark: 3×3 grid, empty centre, indigo tile top-right. |
| `logo/entangle-animated.svg` | Chosen logo motion ("Hop"): the indigo tile walks clockwise round the 8 outer slots, hopping over each tile while it slides under, then rests. 7.2 s loop. |
| `logo/reserve/entangle-animated-nudge.svg` | Backup motion ("Nudge"). |
| `logo/README.md` | Logo rules. |
| `brand/tokens.css` | Colours, type and agent colours as CSS variables. The source of truth. |
| `brand/brand.html` | The brand sheet: palette with contrast checks, type scale, examples. Has a font switcher; the choice is Inter + Source Serif 4. |
| `agents/*.svg` | One file per agent, with all states inside. |
| `agents/preview.html` | All agents and states side by side. Generated. |
| `agents/simulation.html` | The live run. Generated from `tools/simulation.html`. |
| `naming/naming.html` | Naming research: 542 scored candidates, the chosen set, the Serbian variant. Generated. |
| `tools/` | Generators (plain Node, no packages). See "Regenerating". |

## Brand

- **Logo:** ink `#1D1D1F` with one indigo tile `#4C5BD4`. In dark mode it switches by itself to `#F5F5F7` and `#8B97F2`. The animated SVGs are CSS inside the file, so they animate as a plain `<img>`. With reduced motion, they show the still mark.
- **Palette:** see `brand/tokens.css`.
  - Indigo is the brand accent and also means **Science**.
  - Amber `#A46719` means **Industry**.
  - Critic verdicts: green `#1D8557` accepted, amber `#A86500` revise, red `#C8463D` rejected.
  - Every colour used for text passes WCAG AA on white.
- **Type:** Inter for the interface, Source Serif 4 for proposal body text, so proposals read like academic documents. **No monospace anywhere.** Dataset ids use Inter with `font-variant-numeric: tabular-nums slashed-zero`.

## The agents

Names are international, chosen after web-searching 27 candidates for existing AI products. 20 were taken, often by agents doing the same job. Details are in `naming/naming.html`.

| id | Name | Role | Shape | Colour | Working | Done | Reject |
|---|---|---|---|---|---|---|---|
| `deneb` | Deneb | Orchestrator | rounded triangle | ink | conducts with a baton, eyes on the beat | takes a bow | a clock pops up, its hand spinning (time pressure) |
| `spica` | Spica | Industry Analyst | cloud | amber | magnifier passes over each eye, then a lightbulb ("aha") | the bulb glows | lens fogs, then wipes clear |
| `tycho` | Tycho | Research Profiler | clover | indigo | reads an open book, pages flip | shuts the book and drops it on a stack | sweat drop |
| `amity` | Amity | Matchmaker | two-lobed bean | violet | checks two papers; a thread draws between them and knots; the match pulls together; wink | holds the finished match | no match: papers drift apart, she shrugs |
| `tinta` | Tinta | Proposal Writer | ink drop | teal | writes a page line by line | page becomes a paper plane and flies off | crumples the page, tosses it, starts again |
| `fides` | Fides | Critic | scalloped seal | red | reads the claim; a red pen underlines what he checks | **APPROVE stamp** (green ring and tick) | **REJECT stamp** (red ring and cross), angry V eyes, head shake |
| `you` | You | Human approver | pill | grey | types on a little keyboard | thumbs up and a nod | thumbs down |

Shared behaviour:
- Faces have **no mouths**; all expression is in the eyes. Eyes are upright pills; only Fides's reject tilts them.
- On reject, everyone except Fides and You also gets a **sweat drop**.
- **Idle:**
  - All agents: out-of-sync blinks and an occasional glance.
  - Rare quirks every 15 to 18 s: Deneb taps his baton, Spica polishes the lens, Tycho flips a page, Amity hums with a music note, Tinta clicks her pen.
- **Done:** happy squinting arcs and a gentle bob, unless the agent has its own move.

### Using an agent in an app

States are switched with one attribute on the root `<svg>`:

```html
<svg class="ag ag-fides" data-state="idle" ...>   <!-- idle | working | reject | done -->
```

- **Inline the SVG markup** (or fetch it and inject it) to control the state from code: `el.setAttribute("data-state", "reject")`. As an `<img>` it plays only its idle state.
- Each SVG's CSS is scoped by its class (`.ag-fides`), so all seven can sit on one page. Keyframe names are shared (`ag-…`) and identical across files, so inlining several is safe.
- **Dark mode:** follows `prefers-color-scheme`, or any ancestor with class `dark`.
- **Reduced motion:** all animation stops, and the face shows its resting pose.

### Mapping Mozaik events to faces

Suggested wiring for the trace viewer. The event names are the ones the simulation uses; match them to your own.

| Event | Face reaction |
|---|---|
| an agent's `inference.started` … `inference.completed` | that agent `working` (the simulation also shows thinking dots beside it) |
| agent publishes its result (`needs.ready`, `profile.ready`, `pairs.ready`, `proposal.draft`) | that agent briefly `idle` and talking (eyes bob); others glance at it |
| `claim.rejected` (targetId X) | `fides` → `reject` (REJECT stamp); X → `reject` (sweat or own reaction) |
| `claim.accepted` / `proposal.accepted` | `fides` → `done` (APPROVE stamp); author → `done` |
| `approval.requested` | `you` → `working` (typing) |
| `approval.granted` / `approval.denied` | `you` → `done` (thumb up) / `reject` (thumb down) |
| `run.done` | everyone → `done` |

### The simulation

`agents/simulation.html` plays one scripted run:
- **The event bus in the centre:** each event travels from the agent that published it into the bus and out to every agent (strong lines to the agents it's addressed to), the way Mozaik delivers events.
- **Faces react:** agents glance at whoever is speaking, show message bubbles with a tail and thinking dots, and Fides's stamps land on the agent being judged.
- **Amity's match line** links the matched company and researcher.
- **An event log** runs alongside.

The run is the `SCRIPT` array in `tools/simulation.html`. Every step has `t` (seconds) and either:
- `work: id, dur`, for a model call, or
- `from, ev, to, say`, for a published event,

with optional `stamp`, `flinch`, `mood`, `link`, `finale`. To replay a real run, generate that array from the run's `trace.jsonl`. Effects run on the simulation's own clock, so Pause freezes everything.

## Regenerating

From this folder, with any recent Node:

```sh
node tools/agents.mjs agents     # rewrites agents/*.svg, agents/preview.html, agents/simulation.html
node tools/names.mjs naming      # rewrites naming/naming.html
node tools/names.mjs             # prints the top-scored names per role
node tools/matrix-lap.mjs <dir>  # writes all 10 logo-motion variants to <dir>; copy hop/nudge into logo/
```

To change an agent, edit its entry in `AGENTS` in `tools/agents.mjs`:
- `shape`, `color`, `eyes` (left x, right x, y), `eye` (width, height);
- `props` (the SVG for its objects);
- `motion(R)` (all its state CSS).

Shapes are generated from short formulas in `SHAPES`. Keyframes live in `KEYFRAMES`.

## Decisions to keep (they were argued over)

- **Look:**
  - Flat fills only: no gradients, no shadows.
  - Blob silhouettes, white features, upright eyes, no mouths.
  - Spring easing (iOS/Telegram feel): quick start, small overshoot, long rest.
- **Fides's stamp is a verdict, not part of working.** Working is reading and marking up. Done stamps approve, reject stamps reject.
- **The gladiator thumb belongs to the human**, not the Critic.
- **Names are international**, not Serbian. The Serbian-word set (Takt, Lupa, Oko, Spona, Tinta, Sito, Ti) is kept as a localisation variant.
- **No monospace.** Ids use Inter's tabular, slashed-zero figures.
- **Tycho has no glasses or beard; Spica has no moustache.** All were tried and dropped; a moustache reads as a mouth.

## Implementation gotchas (learned the hard way)

- **A transform on a masked or clipped element also transforms its mask or clip.** Put the mask or clip on a wrapping `<g>`.
- **The browser only restarts a CSS animation whose name changes.** That's why reject uses `ag-slam-no` and `ag-thumb-no` (copies of the done animations): so done → reject replays the stamp and thumb.
- **Each eye has three transform layers:** `.eye` (blink) > `.tilt` (state angle) > `.pupil` (role animation), so they never fight over one `transform`.
- **Props are hidden by default** (`.prop { opacity: 0 }`); each state's animation or rule reveals them.
- **Don't name a prop the same as a page class.** A prop once called `card` collided with the preview page's `.card` tiles.

## Known limits

- The simulation is scripted, not wired to a live run yet.
- Idle quirks were not watched over their full 15 to 18 s cycle in testing; every other state was checked in a browser.
- Name searches were web searches for AI products, not a trademark check.
- Browser previews opened from disk can block relative files in some embedded viewers. Opened normally in Chrome or Safari, everything works.
