// Ten variants of one principle: the indigo tile walks clockwise round the 8 outer slots and home again.
// Usage: node matrix-lap.mjs <outDir>
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });

function spring(zeta, samples = 40) {
  const w = 6.5 / zeta, wd = w * Math.sqrt(1 - zeta * zeta);
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    pts.push(+(1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t))).toFixed(4));
  }
  pts[samples] = 1;
  return `linear(${pts.join(",")})`;
}
const SOFT = spring(0.78), BOUNCY = spring(0.5);
const GLIDE = "cubic-bezier(.65,0,.35,1)", SNAP = "cubic-bezier(.3,0,.1,1)";

// Slot top-left corners; RING is the clockwise walk starting at the indigo's home (top-right).
const XY = { TL: [19, 19], TM: [41, 19], TR: [63, 19], ML: [19, 41], MR: [63, 41], BL: [19, 63], BM: [41, 63], BR: [63, 63] };
const RING = ["TR", "MR", "BR", "BM", "BL", "ML", "TL", "TM"];
const at = (k) => XY[RING[((k % 8) + 8) % 8]];
const rel = (k, home) => { const [x, y] = at(k), [hx, hy] = at(home); return `translate(${x - hx}px,${y - hy}px)`; };

// Lap-time segments: each moves the indigo from ring index `from` to `to`.
const even = (move) => Array.from({ length: 8 }, (_, k) => ({ a: k / 8, b: k / 8 + move / 8, from: k, to: k + 1 }));
const contiguous = (bounds) => bounds.slice(0, -1).map((a, k) => ({ a, b: bounds[k + 1], from: k, to: k + 1 }));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const inv = (f, y) => { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; f(m) < y ? (lo = m) : (hi = m); } return (lo + hi) / 2; };

const V = [
  { id: "hop", name: "Hop", desc: "Lifts over each tile while that tile slides under it. Even steps, soft spring landings.",
    L: 5.6, R: 1.6, segs: even(0.6), ease: SOFT, lift: 1.14, swap: true },
  { id: "slide", name: "Slide", desc: "Flat, no lift: the two tiles glide past each other. Calm, like a sliding puzzle.",
    L: 5.6, R: 1.6, segs: even(0.55), ease: GLIDE, swap: true },
  { id: "stepon", name: "Step on", desc: "Hops onto each tile in turn; the tile dips like a pressed key. Home stays empty until it returns.",
    L: 6, R: 1.4, segs: even(0.5), ease: SOFT, lift: 1.12, swap: false },
  { id: "tick", name: "Tick", desc: "Quick moves, equal pauses: a second hand going round the clock.",
    L: 5.2, R: 1.2, segs: even(0.24), ease: SNAP, swap: true },
  { id: "gesture", name: "Gesture", desc: "One continuous lap that starts slow, speeds through the far side and slows into home.",
    L: 4.2, R: 2, segs: contiguous(Array.from({ length: 9 }, (_, k) => inv(easeInOut, k / 8))), ease: "linear", swap: true },
  { id: "trail", name: "Trail", desc: "Like Hop, but every tile it passes keeps a fading indigo glow, showing where it has been.",
    L: 5.6, R: 1.6, segs: even(0.6), ease: SOFT, lift: 1.14, swap: true, trail: 0.9 },
  { id: "conveyor", name: "Conveyor", desc: "Constant speed, no pauses: the whole ring rotates steadily, then rests.",
    L: 4, R: 1.8, segs: contiguous(Array.from({ length: 9 }, (_, k) => k / 8)), ease: "linear", swap: true },
  { id: "bounce", name: "Bounce", desc: "Telegram-style: a bouncier hop with a small squash on every landing.",
    L: 5.6, R: 1.6, segs: even(0.6), ease: BOUNCY, lift: 1.16, swap: true, squash: true },
  { id: "nudge", name: "Nudge", desc: "Slides, and each tile it displaces dips and springs back, as if bumped.",
    L: 5.6, R: 1.6, segs: even(0.55), ease: GLIDE, swap: true, dip: 0.84 },
  { id: "corners", name: "Corners", desc: "Four beats instead of eight: it glides a whole edge at a time and pauses only at corners.",
    L: 4.8, R: 1.6, segs: Array.from({ length: 4 }, (_, k) => ({ a: k / 4, b: k / 4 + 0.6 / 4, from: 2 * k, to: 2 * k + 2 })), ease: SOFT, lift: 1.14, swap: true },
];

const pct = (t) => `${(Math.min(Math.max(t, 0), 1) * 100).toFixed(3)}%`;
// Frames are [t (0..1 of the full loop), declaration, easing?]; same-time frames merge, later wins.
function keyframes(name, frames) {
  const m = new Map();
  for (const [t, d, e] of frames.sort((x, y) => x[0] - y[0])) {
    const k = pct(t), prev = m.get(k);
    m.set(k, { d, e: e ?? prev?.e });
  }
  return `@keyframes ${name}{${[...m].map(([k, { d, e }]) => `${k}{${d}${e ? `;animation-timing-function:${e}` : ""}}`).join("")}}`;
}

function build(v, p) {
  const T = v.L + v.R, s = (x) => (x * v.L) / T, sec = (x) => x / T;
  const segs = v.segs.map((g) => ({ ...g, a: s(g.a), b: s(g.b) }));
  const css = [], anim = (cls, name) => css.push(`.${cls}{animation:${name} ${T}s infinite both}`);

  // Indigo position.
  const pos = [[0, `transform:${rel(0, 0)}`]];
  for (const g of segs) pos.push([g.a, `transform:${rel(g.from, 0)}`, v.ease], [g.b, `transform:${rel(g.to, 0)}`]);
  pos.push([1, `transform:${rel(segs.at(-1).to, 0)}`]);
  css.push(keyframes(`${p}ip`, pos)); anim(`${p}ip`, `${p}ip`);

  // Indigo scale: hop lift, landing squash, and Step-on's smaller "standing on a tile" size.
  const sc = [[0, "transform:scale(1)"]], seat = v.swap ? 1 : 0.78;
  segs.forEach((g, i) => {
    const from = v.swap || i === 0 ? 1 : seat, to = v.swap || i === segs.length - 1 ? 1 : seat, mid = (g.a + g.b) / 2;
    const fromS = v.swap ? 1 : (i === 0 ? 1 : seat);
    sc.push([g.a, `transform:scale(${fromS})`, "ease-out"]);
    if (v.lift) sc.push([mid, `transform:scale(${(v.lift * Math.max(from, to)).toFixed(3)})`, "ease-in"]);
    if (v.squash) sc.push([g.b, "transform:scale(1.12,.88)", BOUNCY], [g.b + sec(0.35), "transform:scale(1)"]);
    else sc.push([g.b, `transform:scale(${to})`]);
  });
  sc.push([1, "transform:scale(1)"]);
  css.push(keyframes(`${p}is`, sc)); anim(`${p}is`, `${p}is`);

  // Dark tiles. Simulate occupancy so every swap moves whichever tile is really in the way.
  const tiles = RING.slice(1).map((_, j) => ({ id: j + 1, home: j + 1, moves: [] }));
  if (v.swap) {
    const occ = new Map(tiles.map((t) => [t.home, t]));
    for (const g of segs) {
      for (let k = g.from; k < g.to; k++) {
        const target = (k + 1) % 8, t = occ.get(target);
        if (!t) continue;
        occ.delete(target); occ.set(k % 8, t);
        const last = t.moves.at(-1);
        if (last && last.g === g) last.to = k; else t.moves.push({ g, from: target, to: k });
      }
    }
  }
  const body = [];
  for (const t of tiles) {
    const outer = `${p}t${t.id}`, inner = `${p}u${t.id}`;
    if (t.moves.length) {
      const fr = [[0, `transform:${rel(t.home, t.home)}`]];
      for (const m of t.moves) fr.push([m.g.a, `transform:${rel(m.from, t.home)}`, v.ease], [m.g.b, `transform:${rel(m.to, t.home)}`]);
      fr.push([1, `transform:${rel(t.moves.at(-1).to, t.home)}`]);
      css.push(keyframes(outer, fr)); anim(outer, outer);
    }
    const inn = [];
    if (v.dip) for (const m of t.moves) inn.push([m.g.a, "transform:scale(1)", "ease-out"], [(m.g.a + m.g.b) / 2, `transform:scale(${v.dip})`, SOFT], [m.g.b + sec(0.3), "transform:scale(1)"]);
    if (!v.swap) {
      const arrive = segs[t.home - 1].b, leave = segs[t.home].a;
      inn.push([arrive, "transform:scale(1)", SOFT], [arrive + sec(0.3), "transform:scale(.88)"], [leave, "transform:scale(.88)", SOFT], [leave + sec(0.35), "transform:scale(1)"]);
    }
    if (inn.length) { css.push(keyframes(inner, [[0, "transform:scale(1)"], ...inn, [1, "transform:scale(1)"]])); anim(inner, inner); }
    if (v.trail) {
      const fill = [[0, "fill:var(--p)"]];
      for (const m of t.moves) fill.push([m.g.b - sec(0.05), "fill:var(--p)"], [m.g.b, "fill:var(--s)", "ease-out"], [m.g.b + sec(v.trail), "fill:var(--p)"]);
      fill.push([1, "fill:var(--p)"]);
      css.push(keyframes(`${p}f${t.id}`, fill));
      css.push(`.${p}u${t.id}.${p}f{animation:${inn.length ? `${inner} ${T}s infinite both,` : ""}${p}f${t.id} ${T}s infinite both}`);
    }
    const [x, y] = at(t.home);
    body.push(`<g class="${outer}"><rect x="${x}" y="${y}" width="18" height="18" rx="4" class="P ${inner}${v.trail ? ` ${p}f` : ""}"/></g>`);
  }
  const [hx, hy] = at(0);
  body.push(`<g class="${p}ip"><rect x="${hx}" y="${hy}" width="18" height="18" rx="4" class="S ${p}is"/></g>`);
  css.push(`.${p}is,[class*="${p}u"]{transform-box:fill-box;transform-origin:center}`);
  return { css: css.join(""), body: body.join("") };
}

const COLORS = `svg{--p:#1D1D1F;--s:#4C5BD4}.P{fill:var(--p)}.S{fill:var(--s)}@media (prefers-color-scheme:dark){svg{--p:#F5F5F7;--s:#8B97F2}}`;
const RM = `@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;
const svgFor = (v, p, attrs) => { const b = build(v, p); return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Entangle" ${attrs}><style>${COLORS}${b.css}${RM}</style>${b.body}</svg>`; };

for (const v of V) fs.writeFileSync(path.join(out, `entangle-lap-${v.id}.svg`), svgFor(v, "a", 'width="240" height="240"') + "\n");

const cards = V.map((v, i) => `
<div class="card">
  ${svgFor(v, `v${i}`, 'width="170" height="170"')}
  <div class="row"><div class="mini">${svgFor(v, `m${i}`, 'width="40" height="40"')}</div><div class="mini dk">${svgFor(v, `k${i}`, 'width="40" height="40"')}</div></div>
  <div class="n">${i + 1}. ${v.name} <span class="t">${(v.L + v.R).toFixed(1)} s loop</span></div>
  <div class="d">${v.desc}</div>
</div>`).join("");

fs.writeFileSync(path.join(out, "lap-preview.html"), `<!doctype html>
<meta charset="utf-8">
<title>Entangle lap variants</title>
<style>
  body{margin:0;padding:20px;font:13px -apple-system,"Segoe UI",sans-serif;background:#fff;color:#1d1d1f}
  .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
  .card{background:#f5f5f7;border-radius:18px;padding:14px;display:flex;flex-direction:column;align-items:center;gap:8px}
  .card>svg{--p:#1D1D1F;--s:#4C5BD4}
  .row{display:flex;gap:8px}
  .mini{background:#fff;border-radius:9px;padding:4px;display:flex}
  .mini svg{--p:#1D1D1F;--s:#4C5BD4}
  .mini.dk{background:#1d1d1f}
  .mini.dk svg{--p:#F5F5F7;--s:#8B97F2}
  .n{font-weight:600}.t{font-weight:400;color:#6e6e73;font-size:11px}
  .d{color:#6e6e73;text-align:center;line-height:1.4;font-size:12px}
</style>
<div class="grid">${cards}</div>
`);
console.log("wrote", V.length, "variants");
