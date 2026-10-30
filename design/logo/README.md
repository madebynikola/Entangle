# Entangle logo

| File | Use |
|---|---|
| `entangle.svg` | The mark: 3×3 grid, empty centre, indigo tile top-right. Use everywhere a still image is needed. |
| `entangle-animated.svg` | Chosen motion, "Hop": the indigo tile walks clockwise round the 8 outer slots, lifting over each tile while it slides under, then rests at home. 7.2 s loop. |
| `reserve/entangle-animated-nudge.svg` | Backup motion, "Nudge": same lap, flat slides, and each displaced tile dips and springs back. |

Both animations are CSS inside the SVG, so they play as a plain `<img>` (README, slides, site). With reduced motion turned on, they show the still mark. Colours switch for dark mode on their own.

Colours: ink `#1D1D1F` / indigo `#4C5BD4` (dark mode: `#F5F5F7` / `#8B97F2`).

The motion rules: clockwise, one slot per step, never through the centre, ending where it started, so the first and last frames equal the still mark.

To change timing or springs, edit `../tools/matrix-lap.mjs` (the `hop` and `nudge` entries) and, from the handoff root, run `node tools/matrix-lap.mjs <scratch dir>`. It writes all 10 lap variants plus `lap-preview.html` there; copy `entangle-lap-hop.svg` over `entangle-animated.svg` and `entangle-lap-nudge.svg` over `reserve/entangle-animated-nudge.svg`.
