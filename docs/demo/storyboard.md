# Demo video: storyboard

A pitch video for the presentation, about 2 minutes 40 seconds, 1920×1080. `npm run demo:record` records it from the
app into `out/tmp/demo/entangle-demo.mp4` (gitignored). It needs ffmpeg and no API key: it replays the two committed runs.

The app runs in an iframe inside `scripts/demo/director.html`, which is the camera. After the app's own splash, the
app's page is hidden: only the component that matters floats on a soft backdrop, cut out of the real app with nothing
around it. Each agent is introduced on its own, with its face from the brand kit, its role, its model, and the real
thing it made in the reverse-search run. The video uses the app's dark theme. Music runs under it, with sound effects
on titles, faces, clicks, typing, the Critic's rejections and fixes, and the approval (scripts/demo/audio/, free to use, see
CREDITS.md). Captions make it work with the sound off. The voice-over below follows the same
beats, if we record one over it.

| # | Screen | On screen | Voice-over |
| --- | --- | --- | --- |
| 0 | The app's boot splash: the faces become the Entangle mark | — | — |
| 1 | Title cards over the blurred app | 1,047 researchers. 153 companies. · Which researcher can solve which company's problem? · 7 million tokens. Too much for one model. · Entangle | EINSTEIN has a thousand researchers and a hundred and fifty companies. Which researcher can solve which company's problem? That is seven million tokens, too much for one model. So we built a team. |
| 2 | The "Describe a problem" dialog alone on the backdrop, typed into | A company describes one problem in its own words. | A company writes its problem in its own words: false alarms on wind-turbine sensors. |
| 3 | The nine faces pop in | Meet the team. | Meet the team. |
| 4 | One agent at a time: face, name, role, model on the left; its real output on the right; the roster of faces below | Deneb, the Timeline of tasks · Spica, the company's words and her research question · Libra, 1,047 → 6 · Tycho, a profile with sources · Fides, a struck claim and its fix · Amity, why these two · Tinta, the proposal · Ceres, an EU call · You, Approve | Deneb plans and hands out the work. Spica restates the problem as a research question. Libra searches every researcher and keeps six. Six Tychos profile them at once. Fides checks every claim against its record and sends back what it cannot find. Amity pairs and says why. Tinta writes the proposal. Ceres finds the EU calls. And nobody is contacted until you approve. |
| 5 | The Stage alone, the real run at 4× | One event bus. Every agent hears every event. · 5 minutes, $1.46 | All of them on one Mozaik event bus. This is the real run, four times faster. |
| 6 | The Timeline of the reference run alone: drag-zoom to 27 minutes | 8 companies, 20 agents, 66 minutes. · Bars that overlap are agents working at the same time. | Is it really parallel? This is the eight-company run. Every bar is a model call, and the overlap is real. |
| 7 | Four numbers with faces | 66 profiles · 32 pairs · 483 claims rejected · 6 proposals · $16.90 | Sixty-six profiles, thirty-two pairs, four hundred and eighty-three claims rejected, six sourced proposals. |
| 8 | End card | Sourced matches. Approved by people. `npm install && npm run replay -- out/golden` | Entangle. Sourced matches, approved by people. |

Models on screen are the ones the runs used: Claude Haiku 4.5 for Deneb, Spica, Tycho and Ceres; Claude Sonnet 4.6
for Fides, Amity and Tinta. Libra is a search in code, and You is a person.

## Choices made

- **Components, not screens.** `isolate()` in `record.ts` marks elements with `data-iso`; the director hides the rest of
  the page (`visibility: hidden`) and the camera fits them into a part of the screen. `width` narrows a component so it
  wraps taller and the camera can come closer; `hide` drops parts of it, such as rows past the third.
- **A replay, not a live run.** "Find researchers" opens the committed reverse search (`out/reverse-search/`).
- **Only the two committed runs show** in the Runs list. The recorder filters the list in the browser; the app is not changed.
- **Approve is answered in the browser.** The recorder returns what the server would, so recording never writes to `out/`.
- **No toasts.**
- **No snaps.** The camera moves frame by frame, and the faces grow in size rather than scale, so the page is drawn
  sharp at every frame. A CSS scale is drawn sharp again only when it stops, which showed as a snap at the end.
- **Sound is mixed after recording.** The story logs a cue at each sound; `--remix` mixes them again onto the last
  recording in seconds, to tune the sound without recording again; `--music FILE` tries another track. The music
  is set to one loudness, whatever the track. `--preview` plays the story live, with no render.

## Re-recording

The story is in `scripts/demo/record.ts`: one function per scene (`scene0` … `scene8`), and the agents in `AGENTS`.
The camera, isolation, intros, titles, captions and cursor are in `scripts/demo/director.html`. `--from N --to M`
records only scenes N to M. `--keep-frames` keeps the JPEG frames, `--out PATH` writes elsewhere. A full recording
takes about 5 minutes: it warms up the dev server first, then records in real time.
