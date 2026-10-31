# Demo video: storyboard

About 3 minutes 10 seconds, 1920×1080, light theme. Times below are approximate. `npm run demo:record` records it from the app into
`out/tmp/demo/entangle-demo.mp4` (gitignored). It needs ffmpeg and no API key: it replays the two committed runs.

The video has on-screen captions, so it works with no sound. The voice-over below follows the same beats, if we
record one over it. Each line fits the time its scene is on screen at a calm pace.

| # | Time | Screen | Caption (on screen) | Voice-over |
| --- | --- | --- | --- | --- |
| 1 | 0:00 | Title card: Entangle lockup | A team of AI agents that pairs researchers with company problems | This is Entangle, built on Mozaik for the EINSTEIN matchmaker track. |
| 2 | 0:06 | Runs screen | EINSTEIN holds 1,047 researchers and 153 companies: about 7 million tokens. | That is far too much for one model to read. So Entangle splits the work across agents that run at the same time. |
| 3 | 0:13 | "Describe a problem" dialog: the wind-turbine example, sector "Renewable energy" | A company that is not in the dataset can describe one problem in its own words. | Say a company has false alarms on its wind-turbine sensors. It writes the problem in its own words and asks for researchers. |
| 4 | 0:24 | Stage, still | This is the real run of that problem: 5 minutes on Sonnet 4.6 and Haiku 4.5, replayed 4× faster. | Here is the real run of exactly that problem. |
| 5 | 0:28 | Stage, playing | Each face is a role. Every event goes over the Mozaik event bus. | Each face is a role. Every event goes over the Mozaik bus, and every agent sees it. |
| 6 | 0:30 | Stage: Libra, six Tychos | Libra shortlists 6 researchers, and six Profilers read them at the same time. | The shortlist picks six researchers, and six Profilers read them in parallel. |
| 7 | 0:38 | Stage: Fides stamps | Fides, the Critic, checks each claim against the record it cites. | The Critic checks every claim against the record it cites. If it cannot find the source, the work goes back. |
| 8 | 0:52 | Stage: Amity links the two sides | Amity, the Matchmaker, pairs the problem with the profiles that passed. | The Matchmaker pairs the problem with the researchers who passed, and says why each pair fits. |
| 9 | 1:09 | Stage: Ceres, Tinta | Ceres scouts open EU calls, while Tinta writes the proposal. | In parallel, the Funding Scout finds open EU calls, and a Writer drafts the proposal with prior work from OpenAlex. |
| 10 | 1:28 | Stage | The Critic sent the proposal back twice before every claim had a source. | The proposal went back twice before it passed. |
| 11 | 1:45 | Stage, end | Done: one proposal and two researchers, waiting for a person to approve. | Five minutes, one proposal, and nothing is sent yet. |
| 12 | 1:52 | Results: the proposal, a source opened, scroll to EU calls, Critic review, Approve | Every sentence that states a fact cites the record it comes from. … Nobody is contacted until a person approves the pair. | Every fact in the proposal links to its source. It ends with EU calls that fit. And a person approves the pair before anyone is contacted. |
| 13 | 2:30 | Timeline of the reference run, zoomed to its first 27 minutes | 8 companies, 20 agents, 66 minutes. Bars that overlap are agents working at the same time. | This is the bigger reference run: eight companies, twenty agents. Every bar is a model call, and the overlap is real concurrency. |
| 14 | 2:52 | Results list of the reference run | Seven proposals from that run, each with its fit, its review and its EU calls. | It produced seven proposals, each reviewed and sourced. |
| 15 | 3:00 | End card | Try it with no keys: `npm install && npm run replay -- out/golden` | Both runs are in the repo. Clone it and replay them, no keys needed. |

## Choices made

- **A replay, not a live run.** A live run takes 5 minutes or more and costs money. "Find researchers" opens the
  committed reverse search (`out/reverse-search/`), and the caption on the Stage says it is the recorded run, sped up.
- **Only the two committed runs show** in the Runs list. The recorder filters the list in the browser; the app is not changed.
- **Approve is not clicked.** The recorder blocks approvals, so recording never writes to `out/`.
- **No toasts.** The recorder hides them: "Reverse search started" would say a run started when it is a replay.
- **Captions sit at the top on the Stage**, so they do not cover the faces; elsewhere they sit at the bottom.

## Re-recording

Captions, cues and timings are in `scripts/demo/record.ts` (`story()`). The Stage cues are in run seconds.
`--theme dark` records the dark theme, `--keep-frames` keeps the JPEG frames, `--out PATH` writes elsewhere.
A recording takes about 5 minutes: it warms up the dev server first, then records in real time.
