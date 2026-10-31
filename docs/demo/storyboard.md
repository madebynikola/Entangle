# Demo video: storyboard

A pitch video for the presentation, about 2 minutes 20 seconds, 1920×1080. `npm run demo:record` records it from the
app into `out/tmp/demo/entangle-demo.mp4` (gitignored). It needs ffmpeg and no API key: it replays the two committed runs.

The app runs in an iframe inside `scripts/demo/director.html`, which is the camera. It opens on the app's own splash.
The app then floats in a frame on a soft backdrop, and the camera zooms into each moment. Blurred cuts skip the slow
parts of the replay, and animated title cards carry the story between scenes. Captions make it work with no sound. The
voice-over below follows the same beats, if we record one over it.

| # | Time | Screen | On screen | Voice-over |
| --- | --- | --- | --- | --- |
| 0 | 0:00 | The app's boot splash: the faces become the Entangle mark | — | — |
| 1 | 0:05 | Title cards over the blurred app | 1,047 researchers. 153 companies. · Which researcher can solve which company's problem? · 7 million tokens. Too much for one model. · Entangle: a team of agents that reads it together | EINSTEIN has a thousand researchers and a hundred and fifty companies. Which researcher can solve which company's problem? That is seven million tokens, too much for one model. So we built a team. |
| 2 | 0:20 | The window tilts in. "Describe a problem": the camera follows the typing | A company describes one problem in its own words. | A company writes its problem in its own words: false alarms on wind-turbine sensors. |
| 3 | 0:38 | The Stage. The camera pans across the faces | The real run, 5 minutes, 4× faster · Nine roles, twenty agents, one Mozaik event bus. | This is that problem, run for real. Nine roles, twenty agents, one event bus. Each agent sees every event. |
| 4 | 0:52 | Four moments of the run, joined by blurred cuts | Six Profilers at the same time · The Critic sends back what it cannot find · Amity pairs and says why · Tinta writes, Ceres finds EU calls · One proposal, waiting for a person | Six Profilers read researchers in parallel. The Critic checks every claim against its source and sends back what it cannot find. The Matchmaker pairs the problem with the researchers who passed. The Writer drafts while the Funding Scout finds EU calls. Five minutes later: one sourced proposal, waiting for a person. |
| 5 | 1:20 | Title, then the Timeline of the reference run: drag-zoom to 27 minutes, camera on the lanes | Is it really parallel? 8 companies, 20 agents, 66 minutes. · Bars that overlap are agents working at the same time. | Is it really parallel? This is the eight-company run. Every bar is a model call, and the overlap is real. |
| 6 | 1:40 | Title, then the proposal: header, a source opened, the Critic's review | The Critic rejected 483 claims. · Click any source to read the record itself. · What the Critic struck out, and why. | No source, no claim. Every fact links to its record, and you can see what the Critic struck out. |
| 7 | 2:05 | Approve is clicked; the proposal shows Approved | Nobody is contacted until a coordinator approves the pair. | And nobody is contacted until a person approves the pair. |
| 8 | 2:12 | End card | Sourced matches. Approved by people. `npm install && npm run replay -- out/golden` | Entangle. Sourced matches, approved by people. |

## Choices made

- **A replay, not a live run.** A live run takes 5 minutes or more and costs money. "Find researchers" opens the
  committed reverse search (`out/reverse-search/`), and the caption on the Stage says it is that run, 4× faster.
- **Only the two committed runs show** in the Runs list. The recorder filters the list in the browser; the app is not changed.
- **Approve is answered in the browser.** The recorder returns what the server would, so recording never writes to `out/`.
- **No toasts.** "Reverse search started" would say a run started when it is a replay.

## Re-recording

The story is in `scripts/demo/record.ts`, one function per scene (`scene0` … `scene8`). The camera, titles, captions
and cursor are in `scripts/demo/director.html`. `--from N` starts at scene N, to check one part without the rest.
`--keep-frames` keeps the JPEG frames, `--out PATH` writes elsewhere. A full recording takes about 4 minutes: it
warms up the dev server first, then records in real time.
