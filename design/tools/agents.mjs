// Generates the Entangle agent faces (style A, "refined flat"): one SVG per agent, four states switched by
// data-state on the root (idle | working | reject | done), plus a preview page.
// Usage: node tools/agents.mjs <outDir>
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });

function spring(zeta, samples = 32) {
  const w = 6.5 / zeta, wd = w * Math.sqrt(1 - zeta * zeta), pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    pts.push(+(1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t))).toFixed(4));
  }
  pts[samples] = 1;
  return `linear(${pts.join(",")})`;
}
const SOFT = spring(0.78);
const EASE = "cubic-bezier(.45,0,.2,1)";


// True rounded corners: cut each vertex back by r and curve through it.
function roundPoly(pts, r) {
  const n = pts.length, P = (i) => pts[(i + n) % n];
  const cut = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return [a[0] + dx * r / L, a[1] + dy * r / L]; };
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = cut(P(i), P(i - 1)), b = cut(P(i), P(i + 1));
    d += `${i ? "L" : "M"}${a[0].toFixed(2)} ${a[1].toFixed(2)}Q${P(i)[0].toFixed(2)} ${P(i)[1].toFixed(2)} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
  }
  return d + "Z";
}
// Blob outlines as a radius that varies with angle, sampled finely enough to read as one smooth curve.
function polar(r, cx = 50, cy = 50, n = 240) {
  let d = "";
  for (let i = 0; i <= n; i++) {
    const t = i / n * 2 * Math.PI, R = r(t);
    d += `${i ? "L" : "M"}${(cx + R * Math.cos(t)).toFixed(2)} ${(cy + R * Math.sin(t)).toFixed(2)}`;
  }
  return d + "Z";
}

const SHAPES = {
  triangle: roundPoly([[50, 8], [94, 86], [6, 86]], 24),
  cloud: polar((t) => 38 + 3.6 * Math.cos(5 * t + .6) + 1.8 * Math.cos(3 * t)),
  // Four soft lobes on the diagonals.
  clover: polar((t) => 37 - 6.5 * Math.cos(4 * t)),
  // Two lobes joined at a soft waist: a pair that has become one shape.
  bean: polar((t) => 23 + 19 * Math.cos(t) ** 2, 50, 52),
  drop: "M47.6 9.2Q50 5.6 52.4 9.2C62 22 83 42 83 60A33 33 0 0 1 17 60C17 42 38 22 47.6 9.2Z",
  // A scalloped seal, like a stamp of approval.
  seal: polar((t) => 40 + 2.4 * Math.cos(9 * t)),
  pill: "M36 22H64A28 28 0 0 1 64 78H36A28 28 0 0 1 36 22Z",
};

// Happy squint, as wide as the open eye.
const happy = (x, y, w) => { const h = Math.max(w, 9) * .55; return `M${x - h} ${y + 2}Q${x} ${y - h} ${x + h} ${y + 2}`; };

// Shared small props: a sweat drop (shown to whoever Fides rejects) and a four-point sparkle.
const SWEAT = "M0 -5C2.5 -1 4 1.5 4 3A4 4 0 0 1 -4 3C-4 1.5 -2.5 -1 0 -5Z";
const spark = (x, y, s = 1) => `<path d="M${x} ${y - 6 * s}Q${x + s} ${y - s} ${x + 6 * s} ${y}Q${x + s} ${y + s} ${x} ${y + 6 * s}Q${x - s} ${y + s} ${x - 6 * s} ${y}Q${x - s} ${y - s} ${x} ${y - 6 * s}Z" fill="#fff"/>`;

// No mouths: each agent's personality is in its eyes. eye = [width, height]; eyes stay upright.
// motion(R) holds every state's CSS for that agent: working, done, reject and a rare idle quirk.
const AGENTS = [
  {
    id: "deneb", name: "Deneb", role: "Orchestrator", color: "#1D1D1F", dark: "#48484A", shape: "triangle", blink: [5.2, 0.4],
    eyes: [39, 61, 62], eye: [12.5, 19.5], sweat: [62, 38],
    // Conducts with a baton; bows when done; checks a clock when the run is held up.
    props: `<g class="prop baton"><path d="M72 74L89 50" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="72" cy="74" r="3.6" fill="#fff"/></g>
<g class="prop clock"><circle cx="20" cy="30" r="9" fill="#fff"/><path d="M20 30V24.5" stroke="#1D1D1F" stroke-width="2" stroke-linecap="round"/><path class="minute" d="M20 30H25.5" stroke="#1D1D1F" stroke-width="2" stroke-linecap="round"/></g>`,
    motion: (R) => `${R} .baton{transform-box:view-box;transform-origin:72px 74px}
${R} .clock{transform-box:fill-box;transform-origin:center}
${R} .minute{transform-box:view-box;transform-origin:20px 30px}
${R}[data-state=working] .baton{opacity:1;animation:ag-baton 1.8s ease-in-out infinite}
${R}[data-state=working] .eyes{animation:ag-beat 1.8s ease-in-out infinite}
${R}[data-state=done] .head{transform-box:fill-box;transform-origin:50% 100%;animation:ag-bow 2.6s infinite}
${R}[data-state=reject] .clock{animation:ag-pop .5s both}
${R}[data-state=reject] .minute{animation:ag-spin 1.2s linear infinite}
${R}[data-state=reject] .eyes{transform:translate(-4px,-3px)}
${R}[data-state=idle] .baton{animation:ag-q-baton 16s 4s infinite}`,
  },
  {
    id: "spica", name: "Spica", role: "Industry Analyst", color: "#A46719", shape: "cloud", blink: [4.6, 1.3],
    eyes: [39, 61, 52], eye: [12.5, 20], sweat: [76, 30],
    // Magnifier pass, then a lightbulb: the real need is found. Rejected: the lens fogs, then wipes clear.
    props: `<g class="prop lens"><circle class="fog" r="10" fill="#fff"/><circle r="11.5" fill="#fff" fill-opacity=".18" stroke="#fff" stroke-width="3.2"/><path d="M8.4 8.4L15.5 15.5" stroke="#fff" stroke-width="5" stroke-linecap="round"/></g>
<g class="prop bulb"><g transform="translate(80 18) scale(1.35) translate(-80 -18)"><g class="rays" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M80 6V2.5M89 10L91.5 7.5M71 10L68.5 7.5M93 18H96.5M67 18H63.5"/></g><circle cx="80" cy="18" r="7" fill="#fff"/><rect x="76.5" y="24" width="7" height="5" rx="1.5" fill="#fff"/><path d="M77.5 18.5L80 21L82.5 18.5" stroke="#A46719" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>`,
    motion: (R) => `${R} .bulb,${R} .rays{transform-box:fill-box;transform-origin:center}
${R} .fog{opacity:0}
${R}[data-state=working] .lens{animation:ag-lens 3.8s infinite}
${R}[data-state=working] .eR .pupil{animation:ag-magR 3.8s infinite}
${R}[data-state=working] .eL .pupil{animation:ag-magL 3.8s infinite}
${R}[data-state=working] .bulb{animation:ag-aha 3.8s infinite}
${R}[data-state=done] .bulb{opacity:1}
${R}[data-state=done] .rays{animation:ag-glow 1.1s ease-in-out infinite}
${R}[data-state=reject] .lens{opacity:1;transform:translate(61px,52px)}
${R}[data-state=reject] .fog{animation:ag-fog 2.6s infinite}
${R}[data-state=idle] .lens{animation:ag-q-lens 17s 6s infinite}`,
  },
  {
    id: "tycho", name: "Tycho", role: "Research Profiler", color: "#4C5BD4", shape: "clover", blink: [5.8, 2.1],
    eyes: [39, 61, 48], eye: [12.5, 20], sweat: [76, 26],
    // Reads an open book, flipping pages; when done he shuts it and drops it onto his stack: one more researcher profiled.
    props: `<g class="prop book"><path class="pageL" d="M50 70Q41 66 32 68V85Q41 83 50 87Z" fill="#fff"/><path d="M50 70Q59 66 68 68V85Q59 83 50 87Z" fill="#fff"/>
<path d="M36 73.5Q42 72.5 47 74M36 77.5Q42 76.5 47 78M53 74Q58 72.5 64 73.5M53 78Q58 76.5 64 77.5" stroke="#4C5BD4" stroke-opacity=".4" stroke-width="1.4" fill="none" stroke-linecap="round"/>
<path class="leaf" d="M50 70Q59 66 68 68V85Q59 83 50 87Z" fill="#E6E9FB"/></g>
<g class="prop stack"><rect x="33" y="88" width="34" height="6" rx="1.6" fill="#fff"/><rect x="35.5" y="82" width="30" height="6" rx="1.6" fill="#fff"/>
<path d="M37 91H64M39.5 85H62.5" stroke="#4C5BD4" stroke-opacity=".35" stroke-width="1.2" stroke-linecap="round"/></g>
<g class="prop topbook"><rect x="34" y="76" width="32" height="6" rx="1.6" fill="#fff"/><path d="M38 79H63" stroke="#4C5BD4" stroke-opacity=".35" stroke-width="1.2" stroke-linecap="round"/></g>`,
    motion: (R) => `${R} .leaf,${R} .pageL{transform-box:view-box;transform-origin:50px 78px}
${R} .leaf{opacity:0}
${R} .stack{transform-box:fill-box;transform-origin:center}
${R}[data-state=working] .book{opacity:1}
${R}[data-state=working] .eyes{animation:ag-readbook 4.2s infinite}
${R}[data-state=working] .leaf{animation:ag-leaf 4.2s infinite}
${R}[data-state=done] .book{animation:ag-shut 1.8s both}
${R}[data-state=done] .pageL{animation:ag-fold 1.8s both}
${R}[data-state=done] .stack{animation:ag-stackin 1.8s both}
${R}[data-state=done] .topbook{animation:ag-drop 1.8s both}
${R}[data-state=idle] .book{animation:ag-q-book 18s 9s infinite}
${R}[data-state=idle] .leaf{animation:ag-q-leaf 18s 9s infinite}`,
  },
  {
    id: "amity", name: "Amity", role: "Matchmaker", color: "#8447C2", shape: "bean", blink: [4.9, 0.9],
    eyes: [37, 63, 52], eye: [13, 20], sweat: [80, 36],
    // One sequence: she checks both papers, follows the thread as it draws from one to the other, sees the knot tie,
    // and the whole match pulls together before she winks. Done holds the finished match. No match: they drift apart.
    props: `<g class="match">${[["pL", 2], ["pR", 84]].map(([c, x]) =>
      `<g class="prop ${c}"><rect x="${x}" y="36" width="14" height="18" rx="2.5" fill="#fff"/><path d="M${x + 3.5} 42H${x + 10.5}M${x + 3.5} 46H${x + 10.5}M${x + 3.5} 50H${x + 8}" stroke="#8447C2" stroke-width="1.6" stroke-linecap="round"/></g>`).join("")}
<path class="prop thread" d="M16 44Q50 18 84 44" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" pathLength="100" stroke-dasharray="100"/>
<g class="prop knot"><circle cx="50" cy="31" r="3.6" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M47 34L44.5 38M53 34L55.5 38" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g></g>
<g class="prop note"><circle cx="84" cy="26" r="3.2" fill="#fff"/><path d="M87 26V14L92 16" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`,
    motion: (R) => `${R} .knot,${R} .note,${R} .pL,${R} .pR{transform-box:fill-box;transform-origin:center}
${R} .match{transform-box:view-box;transform-origin:50px 45px}
${R} .head{transform-box:fill-box;transform-origin:50% 100%}
${R}[data-state=working] .match{animation:ag-pull 4.6s infinite}
${R}[data-state=working] .pL,${R}[data-state=working] .pR{animation:ag-in 4.6s infinite}
${R}[data-state=working] .thread{animation:ag-thread 4.6s infinite}
${R}[data-state=working] .knot{animation:ag-knot 4.6s infinite}
${R}[data-state=working] .eyes{animation:ag-amityeyes 4.6s infinite}
${R}[data-state=working] .eR .pupil{animation:ag-wink 4.6s infinite}
${R}[data-state=done] .pL,${R}[data-state=done] .pR,${R}[data-state=done] .thread,${R}[data-state=done] .knot{opacity:1}
${R}[data-state=done] .match{transform:scaleX(.72);transition:transform .6s ${SOFT}}
${R}[data-state=reject] .pL{animation:ag-apartL 2.6s infinite}
${R}[data-state=reject] .pR{animation:ag-apartR 2.6s infinite}
${R}[data-state=reject] .eyes{animation:ag-shrugeyes 2.6s infinite}
${R}[data-state=reject] .head{animation:ag-shrug 2.6s infinite}
${R}[data-state=idle] .head{animation:ag-q-hum 15s 3s infinite}
${R}[data-state=idle] .note{animation:ag-q-note 15s 3s infinite}`,
  },
  {
    id: "tinta", name: "Tinta", role: "Proposal Writer", color: "#13807A", shape: "drop", blink: [5.4, 1.7],
    eyes: [40, 60, 57], eye: [12, 18.5], sweat: [64, 34],
    // Writes a page line by line; done folds it into a paper plane that flies off; rejected crumples it and starts again.
    props: `<g class="prop page"><rect x="23" y="73" width="36" height="20" rx="3" fill="#fff"/>
<path class="ln l1" d="M28 78.5q3 -2 6 0t6 0t6 0t6 0" pathLength="40" stroke-dasharray="40"/><path class="ln l2" d="M28 83.5q3 -2 6 0t6 0t6 0t6 0" pathLength="40" stroke-dasharray="40"/><path class="ln l3" d="M28 88.5q3 -2 6 0t6 0t6 0" pathLength="40" stroke-dasharray="40"/></g>
<g class="prop plane"><path d="M30 84L62 70L46 90L44 81Z" fill="#fff"/><path d="M44 81L62 70" stroke="#13807A" stroke-width="1.2" fill="none"/></g>
<circle class="prop ball" cx="41" cy="83" r="5.5" fill="#fff"/>
<g class="prop hand"><path d="M28 78.5L40 63" stroke="#FFD27A" stroke-width="3.2" stroke-linecap="round"/><path d="M28 78.5L30.4 75.4" stroke="#1D1D1F" stroke-width="3.2" stroke-linecap="round"/><ellipse cx="36.5" cy="71" rx="5.6" ry="4.6" fill="#fff"/></g>`,
    motion: (R) => `${R} .ln{fill:none;stroke:#13807A;stroke-width:1.8;stroke-linecap:round}
${R} .page,${R} .ball,${R} .plane{transform-box:fill-box;transform-origin:center}
${R}[data-state=working] .page{opacity:1}
${R}[data-state=working] .l1{animation:ag-l1 4.6s infinite}
${R}[data-state=working] .l2{animation:ag-l2 4.6s infinite}
${R}[data-state=working] .l3{animation:ag-l3 4.6s infinite}
${R}[data-state=working] .hand{animation:ag-write 4.6s infinite}
${R}[data-state=working] .eyes{animation:ag-follow3 4.6s infinite}
${R}[data-state=done] .page{animation:ag-foldpage 2.4s infinite}
${R}[data-state=done] .plane{animation:ag-fly 2.4s infinite}
${R}[data-state=reject] .page{animation:ag-crumple 3s infinite}
${R}[data-state=reject] .ball{animation:ag-toss 3s infinite}
${R}[data-state=idle] .hand{animation:ag-q-click 16s 7s infinite}`,
  },
  {
    id: "fides", name: "Fides", role: "Critic", color: "#C8463D", shape: "seal", blink: [6.2, 2.6],
    // Flat dashes: the sceptic. On reject they close into an angry V (the only time any eye tilts).
    eyes: [38.5, 61.5, 46], eye: [18, 8.5],
    // Working: he reads the claim and a red pen underlines what he checks. The verdict is a stamp:
    // done thumps an approval (green ring and tick), reject thumps a rejection (red ring and cross).
    props: `<g class="prop paper"><rect x="33" y="59" width="34" height="27" rx="3.5" fill="#fff"/>
<path d="M38.5 66H61.5M38.5 71H61.5M38.5 76H55" stroke="#C8463D" stroke-opacity=".35" stroke-width="1.8" stroke-linecap="round"/>
<path class="ul ul1" d="M38.5 68.6H56" pathLength="20" stroke-dasharray="20"/><path class="ul ul2" d="M38.5 78.6H50" pathLength="20" stroke-dasharray="20"/>
<g class="mark ok" fill="none" stroke="#1D8557" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="50" cy="72.5" r="8.5" fill="#fff"/><path d="M46 72.5L49 75.5L54.5 69.5"/></g>
<g class="mark no" fill="none" stroke="#C8463D" stroke-width="2.4" stroke-linecap="round"><circle cx="50" cy="72.5" r="8.5" fill="#fff"/><path d="M46.5 69L53.5 76M53.5 69L46.5 76"/></g></g>
<g class="prop pen"><path d="M38.5 68.6L47 58" stroke="#2B2B2E" stroke-width="2.6" stroke-linecap="round"/><path d="M38.5 68.6L40.2 66.5" stroke="#C8463D" stroke-width="2.6" stroke-linecap="round"/></g>
<g class="prop stamp"><rect x="40.5" y="65" width="19" height="6" rx="1.8" fill="#2B2B2E"/><rect x="46.5" y="53" width="7" height="13" rx="2.5" fill="#E2C49A"/><ellipse cx="50" cy="52.5" rx="6.5" ry="3.8" fill="#E2C49A"/></g>`,
    motion: (R) => `${R} .paper,${R} .mark,${R} .stamp{transform-box:fill-box;transform-origin:center}
${R} .ul{fill:none;stroke:#C8463D;stroke-width:1.6;stroke-linecap:round}
${R} .mark{opacity:0}
${R}[data-state=working] .paper,${R}[data-state=done] .paper,${R}[data-state=reject] .paper{opacity:1}
${R}[data-state=working] .ul1{animation:ag-ul1 4.4s infinite}
${R}[data-state=working] .ul2{animation:ag-ul2 4.4s infinite}
${R}[data-state=working] .pen{animation:ag-markup 4.4s infinite}
${R}[data-state=working] .eyes{animation:ag-proof 4.4s infinite}
${R}[data-state=done] .stamp{animation:ag-slam 1.3s both}
${R}[data-state=reject] .stamp{animation:ag-slam-no 1.3s both}
${R}[data-state=done] .ok,${R}[data-state=reject] .no{animation:ag-markin .25s .72s both}
${R}[data-state=reject] .eyes{transform:none}
${R}[data-state=reject] .eL .tilt{transform:rotate(22deg)}
${R}[data-state=reject] .eR .tilt{transform:rotate(-22deg)}
${R}[data-state=reject] .head{animation:ag-shake 2.6s infinite}`,
  },
  {
    id: "you", name: "You", role: "Human approver", color: "#C7C7CC", dark: "#3A3A3C", fg: "#1D1D1F", darkFg: "#FFFFFF", shape: "pill", blink: [5, 3],
    eyes: [39, 61, 48], eye: [12.5, 19.5],
    // Types on a small keyboard. The verdict is the gladiator's thumb: up on done (approve), down on reject.
    props: `<g class="prop kb"><rect x="27" y="62" width="46" height="13" rx="3" fill="#fff"/>
${[0, 1].map((r) => Array.from({ length: 7 }, (_, i) => `<rect x="${30.5 + i * 5.7 + r * 2}" y="${65 + r * 4.6}" width="4" height="3" rx="1" fill="#D2D2D7"/>`).join("")).join("")}
<ellipse class="hl" cx="40" cy="64" rx="5.5" ry="4" fill="#8E8E93"/><ellipse class="hr" cx="60" cy="64" rx="5.5" ry="4" fill="#8E8E93"/></g>
<g transform="translate(82 36)"><g class="prop thumb"><g class="flip">
<rect x="-8" y="-3" width="16" height="14" rx="4.5" fill="#fff" stroke="#8E8E93" stroke-width="1.2"/><rect x="-6.5" y="-14.5" width="6.2" height="13.5" rx="3.1" fill="#fff" stroke="#8E8E93" stroke-width="1.2"/>
<path d="M-4.5 2.5H5.5M-4.5 6.5H5.5" stroke="#8E8E93" stroke-width="1.4" stroke-linecap="round"/></g></g></g>`,
    motion: (R) => `${R} .hl,${R} .hr,${R} .thumb,${R} .flip{transform-box:fill-box;transform-origin:center}
${R}[data-state=working] .kb{opacity:1}
${R}[data-state=working] .hl{animation:ag-tap .32s ease-in-out infinite alternate}
${R}[data-state=working] .hr{animation:ag-tap .32s .16s ease-in-out infinite alternate}
${R}[data-state=working] .eyes{transform:translateY(3px)}
${R}[data-state=done] .thumb{opacity:1;animation:ag-thumb .6s both,ag-wag 1.8s .6s infinite}
${R}[data-state=reject] .thumb{opacity:1;animation:ag-thumb-no .6s both,ag-wag 1.8s .6s infinite}
${R}[data-state=reject] .flip{transform:rotate(180deg)}
${R}[data-state=done] .head{transform-box:fill-box;transform-origin:50% 100%;animation:ag-nod 1.6s infinite}`,
  },
];

const KEYFRAMES = `
@keyframes ag-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
@keyframes ag-glance{0%,62%,100%{transform:translate(0,0);animation-timing-function:${EASE}}67%,80%{transform:translate(4px,-1.5px);animation-timing-function:${EASE}}86%{transform:translate(0,0)}}
@keyframes ag-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes ag-shake{0%,44%,100%{transform:translateX(0)}8%{transform:translateX(-3px)}16%{transform:translateX(3px)}24%{transform:translateX(-2px)}32%{transform:translateX(1.5px)}}
@keyframes ag-lens{0%{transform:translate(84px,88px);opacity:0;animation-timing-function:${SOFT}}14%,40%{transform:translate(61px,52px);opacity:1;animation-timing-function:${SOFT}}54%,76%{transform:translate(39px,52px);opacity:1;animation-timing-function:${EASE}}90%,100%{transform:translate(16px,88px);opacity:0}}
@keyframes ag-magR{0%,12%{transform:scale(1)}18%,38%{transform:scale(1.45)}46%,100%{transform:scale(1)}}
@keyframes ag-magL{0%,52%{transform:scale(1)}58%,74%{transform:scale(1.45)}82%,100%{transform:scale(1)}}
@keyframes ag-wink{0%,74%,86%,100%{transform:scaleY(1)}78%,82%{transform:scaleY(.1)}}
@keyframes ag-proof{0%,8%{transform:translate(0,0);animation-timing-function:${EASE}}12%{transform:translate(-3px,3px);animation-timing-function:linear}22%{transform:translate(3px,3px)}25%{transform:translate(-3px,5px);animation-timing-function:linear}35%{transform:translate(3px,5px)}38%{transform:translate(-3px,7px);animation-timing-function:linear}46%{transform:translate(3px,7px);animation-timing-function:${EASE}}52%,86%{transform:translate(0,5px);animation-timing-function:${EASE}}94%,100%{transform:translate(0,0)}}
@keyframes ag-thumb{0%{transform:scale(.3);opacity:0;animation-timing-function:${SOFT}}100%{transform:scale(1);opacity:1}}
@keyframes ag-thumb-no{0%{transform:scale(.3);opacity:0;animation-timing-function:${SOFT}}100%{transform:scale(1);opacity:1}}
@keyframes ag-wag{0%,60%,100%{transform:rotate(0)}70%{transform:rotate(-10deg)}80%{transform:rotate(8deg)}90%{transform:rotate(-4deg)}}
@keyframes ag-pop{0%{opacity:0;transform:scale(.4);animation-timing-function:${SOFT}}100%{opacity:1;transform:scale(1)}}
@keyframes ag-sweat{0%{opacity:0;transform:translateY(-3px)}15%{opacity:1;transform:none}70%{opacity:1;transform:translateY(6px)}85%,100%{opacity:0;transform:translateY(8px)}}
@keyframes ag-baton{0%,100%{transform:rotate(-24deg)}25%{transform:rotate(12deg)}50%{transform:rotate(-6deg)}75%{transform:rotate(16deg)}}
@keyframes ag-beat{0%,100%{transform:translate(2px,-3px)}25%{transform:translate(5px,0)}50%{transform:translate(3px,-2px)}75%{transform:translate(5px,-1px)}}
@keyframes ag-bow{0%,55%,100%{transform:none}15%,35%{transform:translateY(3px) scaleY(.9) rotate(-4deg)}}
@keyframes ag-spin{to{transform:rotate(360deg)}}
@keyframes ag-q-baton{0%,88%{opacity:0;transform:rotate(-10deg)}90%{opacity:1;transform:rotate(-10deg)}92%{transform:rotate(12deg)}94%{transform:rotate(-10deg)}96%{opacity:1;transform:rotate(12deg)}98%,100%{opacity:0}}
@keyframes ag-aha{0%,80%{opacity:0;transform:scale(.4)}85%{opacity:1;transform:scale(1.15)}90%,97%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1)}}
@keyframes ag-glow{0%,100%{opacity:.35;transform:scale(.9)}50%{opacity:1;transform:scale(1.1)}}
@keyframes ag-fog{0%,35%{opacity:.85}60%,100%{opacity:0}}
@keyframes ag-q-lens{0%,86%{opacity:0;transform:translate(61px,52px)}88%{opacity:1;transform:translate(61px,52px)}90%{transform:translate(63px,50px)}92%{transform:translate(59px,54px)}94%{transform:translate(63px,50px)}96%{opacity:1;transform:translate(61px,52px)}98%,100%{opacity:0;transform:translate(61px,52px)}}
@keyframes ag-readbook{0%{transform:translate(-3px,2px);animation-timing-function:linear}24%{transform:translate(3px,2px)}28%{transform:translate(-3px,4px);animation-timing-function:linear}52%{transform:translate(3px,4px)}56%{transform:translate(-3px,6px);animation-timing-function:linear}80%{transform:translate(3px,6px);animation-timing-function:${EASE}}88%,100%{transform:translate(0,3px)}}
@keyframes ag-leaf{0%,84%{opacity:0;transform:none}86%{opacity:1;transform:none}94%{opacity:1;transform:scaleX(-1)}96%,100%{opacity:0;transform:scaleX(-1)}}
@keyframes ag-fold{0%,4%{transform:none}28%,100%{transform:scaleX(-1)}}
@keyframes ag-shut{0%,30%{opacity:1;transform:none}42%,100%{opacity:0;transform:translateY(-4px)}}
@keyframes ag-stackin{0%,38%{opacity:0;transform:translateY(6px);animation-timing-function:${SOFT}}52%,100%{opacity:1;transform:none}}
@keyframes ag-drop{0%,48%{opacity:0;transform:translateY(-18px)}54%{opacity:1;transform:translateY(-18px);animation-timing-function:cubic-bezier(.5,0,1,1)}70%{opacity:1;transform:none;animation-timing-function:${EASE}}78%{opacity:1;transform:translateY(-3px);animation-timing-function:cubic-bezier(.5,0,1,1)}86%,100%{opacity:1;transform:none}}
@keyframes ag-q-book{0%,86%{opacity:0}88%,97%{opacity:1}99%,100%{opacity:0}}
@keyframes ag-q-leaf{0%,89%{opacity:0;transform:none}90%{opacity:1;transform:none}95%{opacity:1;transform:scaleX(-1)}96%,100%{opacity:0;transform:scaleX(-1)}}
@keyframes ag-thread{0%,28%{stroke-dashoffset:100;opacity:1;animation-timing-function:linear}50%,100%{stroke-dashoffset:0;opacity:1}}
@keyframes ag-knot{0%,50%{opacity:0;transform:scale(0)}56%{opacity:1;transform:scale(1.25)}62%,100%{opacity:1;transform:scale(1)}}
@keyframes ag-apartL{0%{opacity:0;transform:translateY(6px)}15%,45%{opacity:1;transform:none}75%,100%{opacity:0;transform:translateX(-8px)}}
@keyframes ag-apartR{0%{opacity:0;transform:translateY(6px)}15%,45%{opacity:1;transform:none}75%,100%{opacity:0;transform:translateX(8px)}}
@keyframes ag-shrugeyes{0%,10%{transform:translate(0,0)}20%,32%{transform:translate(-4px,0)}42%,54%{transform:translate(4px,0)}64%,100%{transform:translate(0,0)}}
@keyframes ag-shrug{0%,62%,100%{transform:none}70%,80%{transform:translateY(-3px) scaleX(1.03)}}
@keyframes ag-q-hum{0%,86%,100%{transform:none}88%{transform:rotate(-4deg)}91%{transform:rotate(4deg)}94%{transform:rotate(-4deg)}97%{transform:rotate(3deg)}}
@keyframes ag-q-note{0%,86%{opacity:0;transform:translate(0,4px)}89%{opacity:1;transform:none}97%{opacity:1;transform:translate(3px,-4px)}100%{opacity:0;transform:translate(4px,-6px)}}
@keyframes ag-l1{0%,8%{stroke-dashoffset:40}30%,100%{stroke-dashoffset:0}}
@keyframes ag-l2{0%,32%{stroke-dashoffset:40}55%,100%{stroke-dashoffset:0}}
@keyframes ag-l3{0%,57%{stroke-dashoffset:40}75%,100%{stroke-dashoffset:0}}
@keyframes ag-write{0%{transform:translate(0,30px);opacity:0;animation-timing-function:${SOFT}}8%{transform:translate(0,0);opacity:1;animation-timing-function:linear}30%{transform:translate(24px,0)}32%{transform:translate(0,5px);animation-timing-function:linear}55%{transform:translate(24px,5px)}57%{transform:translate(0,10px);animation-timing-function:linear}75%{transform:translate(18px,10px);animation-timing-function:${EASE}}82%,100%{transform:translate(18px,34px);opacity:0}}
@keyframes ag-follow3{0%{transform:translate(0,0);animation-timing-function:${EASE}}8%{transform:translate(-3px,3px);animation-timing-function:linear}30%{transform:translate(3px,3px)}32%{transform:translate(-3px,3px);animation-timing-function:linear}55%{transform:translate(3px,3px)}57%{transform:translate(-3px,3px);animation-timing-function:linear}75%{transform:translate(2px,3px);animation-timing-function:${EASE}}85%,100%{transform:translate(0,0)}}
@keyframes ag-foldpage{0%,10%{opacity:1;transform:none}25%,100%{opacity:0;transform:scale(.4) rotate(-10deg)}}
@keyframes ag-fly{0%,18%{opacity:0;transform:scale(.5)}26%{opacity:1;transform:none;animation-timing-function:${EASE}}70%{opacity:1;transform:translate(30px,-46px) rotate(-12deg)}80%,100%{opacity:0;transform:translate(36px,-56px) rotate(-14deg)}}
@keyframes ag-crumple{0%{opacity:1;transform:none}22%{opacity:1;transform:scale(.25) rotate(50deg)}26%{opacity:0;transform:scale(.2)}72%{opacity:0;transform:translateY(16px)}86%,100%{opacity:1;transform:none}}
@keyframes ag-toss{0%,22%{opacity:0;transform:none}26%{opacity:1;transform:none}40%{opacity:1;transform:translate(18px,-22px)}56%{opacity:1;transform:translate(34px,-6px)}62%,100%{opacity:0;transform:translate(38px,4px)}}
@keyframes ag-q-click{0%,88%{opacity:0;transform:translate(6px,8px)}90%{opacity:1;transform:translate(6px,0)}92%{transform:translate(6px,1.5px)}93%{transform:translate(6px,0)}94%{transform:translate(6px,1.5px)}95%{transform:translate(6px,0)}97%{opacity:1;transform:translate(6px,0)}99%,100%{opacity:0;transform:translate(6px,0)}}
@keyframes ag-tap{to{transform:translateY(2.5px)}}
@keyframes ag-nod{0%,40%,100%{transform:none}15%{transform:translateY(3px)}28%{transform:none}}
@keyframes ag-in{0%{opacity:0;transform:translateY(8px);animation-timing-function:${SOFT}}10%,100%{opacity:1;transform:none}}
@keyframes ag-pull{0%,60%{transform:none;opacity:1;animation-timing-function:${EASE}}74%,84%{transform:scaleX(.72);opacity:1}92%,100%{transform:scaleX(.72);opacity:0}}
@keyframes ag-amityeyes{0%,8%{transform:translate(0,0);animation-timing-function:${EASE}}14%,20%{transform:translate(-5px,0);animation-timing-function:${EASE}}24%,26%{transform:translate(5px,0);animation-timing-function:${EASE}}28%{transform:translate(-5px,0);animation-timing-function:linear}50%{transform:translate(5px,0);animation-timing-function:${EASE}}56%,62%{transform:translate(0,-3px);animation-timing-function:${EASE}}68%,100%{transform:translate(0,0)}}
@keyframes ag-ul1{0%,12%{stroke-dashoffset:20}30%,100%{stroke-dashoffset:0}}
@keyframes ag-ul2{0%,34%{stroke-dashoffset:20}46%,100%{stroke-dashoffset:0}}
@keyframes ag-markup{0%,8%{opacity:0;transform:translate(4px,8px)}12%{opacity:1;transform:translate(0,0);animation-timing-function:linear}30%{opacity:1;transform:translate(17.5px,0)}34%{opacity:1;transform:translate(0,10px);animation-timing-function:linear}46%,52%{opacity:1;transform:translate(11.5px,10px)}60%,100%{opacity:0;transform:translate(16px,18px)}}
@keyframes ag-slam{0%{opacity:0;transform:translate(22px,-26px) rotate(18deg);animation-timing-function:${EASE}}35%,48%{opacity:1;transform:translate(0,-12px);animation-timing-function:cubic-bezier(.6,0,1,1)}55%,64%{opacity:1;transform:none;animation-timing-function:${EASE}}80%{opacity:1;transform:translate(0,-12px);animation-timing-function:${EASE}}100%{opacity:0;transform:translate(22px,-26px) rotate(18deg)}}
@keyframes ag-slam-no{0%{opacity:0;transform:translate(22px,-26px) rotate(18deg);animation-timing-function:${EASE}}35%,48%{opacity:1;transform:translate(0,-12px);animation-timing-function:cubic-bezier(.6,0,1,1)}55%,64%{opacity:1;transform:none;animation-timing-function:${EASE}}80%{opacity:1;transform:translate(0,-12px);animation-timing-function:${EASE}}100%{opacity:0;transform:translate(22px,-26px) rotate(18deg)}}
@keyframes ag-markin{0%{opacity:0;transform:scale(1.5)}100%{opacity:1;transform:scale(1)}}`;

// Colours live in CSS so dark mode can swap them without touching the markup. Flat fills only.
function palette(R, base, fg) {
  return `${R} .base{fill:${base}}${R} .ft{fill:${fg}}${R} .st{stroke:${fg}}`;
}

function css(a) {
  const R = `.ag-${a.id}`, fg = a.fg ?? "#FFFFFF";
  const dark = a.dark ? palette(R, a.dark, a.darkFg ?? fg) : "";
  return `${palette(R, a.color, fg)}
${R} .st{fill:none;stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round}
${R} .eye,${R} .tilt,${R} .pupil,${R} .eyes{transform-box:fill-box;transform-origin:center}
${R} .gaze{transition:transform .4s ${EASE}}
${R} .happy,${R} .prop{opacity:0}
${R} .happy,${R} .eyes,${R} .tilt{transition:opacity .25s,transform .35s ${EASE}}
${R} .eye{animation:ag-blink ${a.blink[0]}s ${a.blink[1]}s infinite}
${R}[data-state=idle] .eyes{animation:ag-glance 7.5s ${a.blink[1] * 1.7}s infinite}
${R}[data-state=done] .eyes{opacity:0}
${R}[data-state=done] .happy{opacity:1}
${R}[data-state=done] .head{animation:ag-bob 2.4s infinite}
${R}[data-state=reject] .eyes{transform:translateY(3px) scaleY(.55)}
${a.motion(R)}${a.sweat ? `
${R}[data-state=reject] .sweat{animation:ag-sweat 2.2s infinite}` : ""}
@media (prefers-color-scheme:dark){${dark}}
${dark.replaceAll(R, `.dark ${R}`)}
@media (prefers-reduced-motion:reduce){${R} *{animation:none!important;transition:none!important}}`;
}

function body(a, uid) {
  const [lx, rx, y] = a.eyes, [w, h] = a.eye;
  // eye (blink) > tilt (upright; a state may angle it, as Fides does on reject) > pupil (role animations): one transform per layer.
  const eye = (cls, x) => `<g class="eye ${cls}"><g class="tilt"><rect class="ft pupil" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2}"/></g></g>`;
  return `<g class="head"><path class="base" d="${SHAPES[a.shape]}"/>
${a.extras ?? ""}
<g class="gaze"><g class="eyes">${eye("eL", lx)}${eye("eR", rx)}</g></g>
<path class="st happy" d="${happy(lx, y, w)}${happy(rx, y, w)}" style="stroke-width:4.4"/>
${a.props ?? ""}${a.sweat ? `<g transform="translate(${a.sweat[0]} ${a.sweat[1]})"><path class="prop sweat" d="${SWEAT}" fill="#A8D8FF"/></g>` : ""}</g>`;
}

let uid = 0;
const svg = (a, attrs = "", withKeyframes = true) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="ag ag-${a.id}" data-state="idle" viewBox="0 0 100 100" role="img" aria-label="${a.name}, ${a.role}" ${attrs}><style>${withKeyframes ? KEYFRAMES : ""}${css(a)}</style>${body(a, withKeyframes ? "" : `-${uid++}`)}</svg>`;

for (const a of AGENTS) fs.writeFileSync(path.join(out, `${a.id}.svg`), svg(a, 'width="96" height="96"') + "\n");

const STATES = ["idle", "working", "reject", "done"];
const card = (a) => `
<div class="card" data-agent="${a.id}">
  <div class="big">${svg(a, 'width="140" height="140"', false)}</div>
  <div class="name">${a.name}</div><div class="role">${a.role}</div>
  <div class="st-btns">${STATES.map((s) => `<button data-s="${s}">${s}</button>`).join("")}</div>
  <div class="sizes">${svg(a, 'width="36" height="36"', false)}${svg(a, 'width="22" height="22"', false)}<span class="dark">${svg(a, 'width="36" height="36"', false)}${svg(a, 'width="22" height="22"', false)}</span></div>
</div>`;

fs.writeFileSync(path.join(out, "preview.html"), `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entangle agents</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  body{margin:0;background:#fff;color:#1D1D1F;font-family:"Inter",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  main{max-width:1100px;margin:0 auto;padding:24px 16px 56px}
  .all{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:18px;font-size:14px;color:#6E6E73}
  button{font:500 13px "Inter",sans-serif;border:1px solid #D2D2D7;background:#fff;color:#1D1D1F;border-radius:999px;padding:6px 12px;cursor:pointer}
  button[aria-pressed=true]{border-color:#1D1D1F;box-shadow:inset 0 0 0 1px #1D1D1F}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
  .card{background:#F5F5F7;border-radius:22px;padding:18px;display:flex;flex-direction:column;align-items:center;gap:6px}
  .big{padding:4px 0 6px}
  .name{font-size:20px;font-weight:600;letter-spacing:-0.02em}
  .role{font-size:13px;color:#6E6E73;margin-bottom:6px}
  .st-btns{display:flex;gap:5px;flex-wrap:wrap;justify-content:center}
  .st-btns button{padding:4px 9px;font-size:12px}
  .sizes{display:flex;gap:8px;align-items:center;margin-top:10px}
  .sizes .dark{background:#111113;border-radius:10px;padding:5px;display:flex;gap:6px;align-items:center}
</style>
<style>${KEYFRAMES}</style>
<main>
  <div class="all">All agents: ${STATES.map((s) => `<button data-all="${s}">${s}</button>`).join("")}</div>
  <div class="grid">${AGENTS.map(card).join("")}</div>
</main>
<script>
const set = (card, s) => {
  card.querySelectorAll("svg.ag").forEach((el) => el.setAttribute("data-state", s));
  card.querySelectorAll(".st-btns button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.s === s));
};
document.querySelectorAll(".card").forEach((c) => { set(c, "idle"); c.querySelectorAll(".st-btns button").forEach((b) => b.onclick = () => set(c, b.dataset.s)); });
document.querySelectorAll("[data-all]").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".card").forEach((c) => set(c, b.dataset.all));
  document.querySelectorAll("[data-all]").forEach((x) => x.setAttribute("aria-pressed", x === b));
});
</script>
</html>
`);
// The live run simulation: the template's script drives these faces through one scripted run.
const stageAgents = AGENTS.map((a) => `<div class="agent" data-id="${a.id}"><div class="breathe">${svg(a, 'width="92" height="92"', false)}</div>
<div class="label"><b>${a.name}</b><span>${a.role}</span></div><div class="bubble"></div><div class="dots"><i></i><i></i><i></i></div></div>`).join("\n");
fs.writeFileSync(path.join(out, "simulation.html"), fs.readFileSync(new URL("./simulation.html", import.meta.url), "utf8")
  .replace("/*KEYFRAMES*/", KEYFRAMES).replace("<!--AGENTS-->", stageAgents)
  .replace("/*NAMES*/{}", JSON.stringify(Object.fromEntries(AGENTS.map((a) => [a.id, a.name])))));

console.log("wrote", AGENTS.length, "agents");
