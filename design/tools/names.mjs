// Agent-name research: a scored pool of ~500 candidate words, plus the complete sets built from it.
// Usage: node tools/names.mjs <outDir>   (prints the top words per role and writes naming.html)
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];

// word;origin;meaning;roles   roles: o orchestrator, a analyst, p profiler, m matchmaker, w writer, c critic, h human, g general
const UNIVERSAL = `
Vega;Latin;brightest guiding star of the north;o
Lyra;Greek;the lyre constellation;w
Altair;Arabic;the flying star;o
Rigel;Arabic;bright foot of Orion;g
Deneb;Arabic;tail of the swan;g
Mira;Latin;wonderful;g
Nova;Latin;new star;g
Orion;Greek;the hunter;a
Sirius;Greek;brightest star in the sky;o
Atlas;Greek;holds up the sky;o
Castor;Greek;one of the twins;m
Pollux;Greek;one of the twins;m
Elara;Greek;a moon of Jupiter;g
Io;Greek;a moon of Jupiter;g
Rhea;Greek;flow;g
Luna;Latin;moon;m
Lua;Portuguese;moon;m
Sol;Latin;sun;a
Ceres;Latin;goddess of harvest;a
Juno;Latin;goddess of unions;m
Vesta;Latin;keeper of the hearth;h
Polaris;Latin;the north star;o
Spica;Latin;ear of grain;a
Ursa;Latin;bear;g
Leo;Latin;lion;g
Draco;Latin;dragon;c
Cygnus;Latin;swan;g
Carina;Latin;keel of a ship;o
Vela;Latin;sails;o
Lynx;Greek;sharp-eyed cat;a
Corvus;Latin;crow;c
Aquila;Latin;eagle;a
Zenith;Arabic;highest point;o
Nadir;Arabic;lowest point;g
Comet;Greek;wanderer with a tail;g
Pulsar;English;a star with a steady beat;o
Orbit;Latin;path around a centre;o
Halo;Greek;ring of light;g
Aurora;Latin;dawn;g
Eos;Greek;dawn;g
Selene;Greek;moon;m
Helios;Greek;sun;a
Gaia;Greek;earth;g
Terra;Latin;earth;g
Astra;Latin;the stars;g
Stella;Latin;star;g
Cosmo;Greek;order;o
Kepler;German;astronomer who found the orbits;p
Tycho;Danish;astronomer who measured everything;p
Iris;Greek;the eye's iris, and the messenger;p
Lumen;Latin;light;p
Lux;Latin;light;g
Prism;Greek;splits light into parts;a
Lens;English;focuses light;a
Ray;English;beam of light;g
Beam;English;ray of light;g
Glint;English;small flash of light;g
Spark;English;first light;a
Flint;English;strikes sparks;c
Optic;Greek;of seeing;p
Focus;Latin;point of attention;a
Scope;Greek;a view;a
Vista;Italian;view;a
Argus;Greek;the hundred-eyed watcher;c
Pupil;Latin;centre of the eye, and a student;p
Retina;Latin;the eye's screen;p
Mirror;English;reflects back;c
Clara;Latin;clear;c
Lucid;Latin;clear;c
Vivid;Latin;lively;g
Tempo;Italian;speed of the beat;o
Cadence;Latin;rhythm;o
Coda;Italian;the closing part;w
Aria;Italian;a solo song;w
Chord;Greek;notes sounding together;m
Echo;Greek;answering sound;g
Forte;Italian;strong;g
Rondo;Italian;a theme that returns;o
Presto;Italian;fast;o
Sonata;Italian;a sounded piece;w
Canto;Italian;song;w
Harmony;Greek;fitting together;m
Duet;Italian;for two;m
Duo;Latin;two;m
Trio;Italian;three;g
Metro;Greek;measure;o
Baton;French;the conductor's stick;o
Maestro;Italian;master, conductor;o
Clef;French;the key of a score;o
Note;Latin;a sign;w
Tune;English;melody;w
Cue;English;signal to start;o
Pulse;Latin;beat;o
Rhythm;Greek;flow;o
Meter;Greek;measure;c
Opus;Latin;a work;w
Lyric;Greek;words of a song;w
Ode;Greek;a poem;w
Verse;Latin;a line of a poem;w
Rhyme;English;matching sounds;w
Poet;Greek;maker;w
Muse;Greek;inspiration;w
Calliope;Greek;muse of poetry;w
Clio;Greek;muse of history;p
Thalia;Greek;muse of joy;g
Erato;Greek;muse of verse;w
Urania;Greek;muse of astronomy;p
Quill;English;feather pen;w
Ink;English;ink;w
Scribe;Latin;writer;w
Folio;Latin;leaf of a book;w
Page;English;page;w
Script;Latin;written;w
Glyph;Greek;carved sign;w
Rune;Norse;secret letter;w
Memo;Latin;note to remember;w
Draft;English;first version;w
Story;Greek;story;w
Fable;Latin;short tale;w
Saga;Norse;long tale;w
Prose;Latin;plain writing;w
Penna;Italian;pen;w
Pluma;Spanish;pen, feather;w
Stylo;French;pen;w
Papyrus;Greek;old paper;w
Vellum;French;fine parchment;w
Margin;Latin;edge of the page;c
Index;Latin;pointer;p
Codex;Latin;book;p
Tome;Greek;volume;p
Lexis;Greek;word;w
Logos;Greek;word, reason;c
Mythos;Greek;story;w
Thesis;Greek;a claim;w
Essay;French;an attempt;w
Sonnet;Italian;a short poem;w
Haiku;Japanese;a short poem;w
Libra;Latin;scales;c
Libro;Italian;book;p
Vera;Latin;true;c
Verity;Latin;truth;c
Veri;Latin;true;c
Fides;Latin;trust;c
Arbiter;Latin;judge;c
Sage;English;wise;c
Proof;English;proof;c
Probe;Latin;a test;c
Assay;French;test of a metal;c
Audit;Latin;hearing, check;c
Gauge;French;measure;c
Ruler;English;straight edge;c
Plumb;Latin;true vertical;c
Level;English;level;c
Sieve;English;filter;c
Filter;Latin;filter;c
Check;English;check;c
Tally;French;count;c
Ledger;English;record book;c
Candor;Latin;honesty;c
Ratio;Latin;reason;c
Logic;Greek;reasoning;c
Axiom;Greek;self-evident truth;c
Canon;Greek;rule;c
Norma;Latin;rule, carpenter's square;c
Regula;Latin;rule;c
Vigil;Latin;watch;c
Sentry;English;guard;c
Warden;English;keeper;c
Keel;English;keeps a ship straight;c
Anchor;Greek;anchor;o
Nexus;Latin;link;m
Knot;English;knot;m
Link;English;link;m
Bond;English;bond;m
Tie;English;tie;m
Weave;English;weave;m
Loom;English;weaves threads together;m
Bridge;English;bridge;m
Union;Latin;union;m
Amity;Latin;friendship;m
Cupid;Latin;god of love;m
Amor;Latin;love;m
Kismet;Turkish;fate;m
Fortuna;Latin;luck;m
Venn;English;overlapping circles;m
Pair;Latin;pair;m
Twain;English;two;m
Gemini;Latin;twins;m
Dyad;Greek;pair;m
Tandem;Latin;two working together;m
Hinge;English;joins two parts;m
Clasp;English;clasp;m
Thread;English;thread;m
Strand;English;strand;m
Helix;Greek;spiral;m
Fiber;Latin;fibre;m
Spindle;English;spins thread;m
Shuttle;English;carries thread across the loom;m
Braid;English;braid;m
Tangle;English;tangle;m
Mesh;English;mesh;m
Matrix;Latin;grid;o
Liaison;French;go-between;m
Ally;French;ally;m
Kin;English;family;m
Synapse;Greek;where two nerves meet;m
Axon;Greek;nerve fibre;m
Magnet;Greek;magnet;m
Lodestar;English;guiding star;o
Lodestone;English;natural magnet;m
Scout;French;scout;a
Seeker;English;seeker;a
Hawk;English;hawk;a
Falcon;Latin;falcon;a
Kestrel;English;hovering falcon;a
Osprey;Latin;fishing hawk;a
Hound;English;tracking dog;a
Beagle;French;tracking dog;a
Fox;English;fox;a
Ferret;Latin;ferret;a
Radar;English;radar;a
Sonar;English;sonar;a
Survey;French;survey;a
Sonde;French;probe;a
Quest;Latin;search;a
Query;Latin;question;a
Delve;English;dig in;a
Prospect;Latin;prospect;a
Sextant;Latin;navigator's tool;o
Compass;Latin;compass;o
Bearing;English;direction;o
Vector;Latin;carrier, direction;o
Pilot;Greek;pilot;o
Helm;English;helm;o
Rudder;English;rudder;o
Skipper;Dutch;captain;o
Steward;English;steward;o
Marshal;French;organiser;o
Usher;French;usher;o
Herald;French;messenger;o
Envoy;French;envoy;o
Courier;French;courier;o
Hermes;Greek;messenger of the gods;o
Mercury;Latin;messenger of the gods;o
Relay;French;relay;o
Conduit;Latin;channel;o
Hub;English;hub;o
Axis;Latin;axis;o
Pivot;French;pivot;o
Keystone;English;stone that holds the arch;o
Ivy;English;climbing plant;m
Fern;English;fern;g
Wren;English;small songbird;g
Lark;English;songbird;w
Robin;English;songbird;g
Juniper;Latin;juniper;g
Rowan;English;rowan tree;g
Aspen;English;aspen;g
Birch;English;birch;g
Alder;English;alder;g
Willow;English;willow;g
Maple;English;maple;g
Cedar;Greek;cedar;g
Hazel;English;hazel;g
Linden;German;linden;g
Olive;Latin;olive;g
Laurel;Latin;the poet's laurel;w
Myrtle;Greek;myrtle;g
Clover;English;clover;g
Moss;English;moss;g
Reed;English;reed pen;w
Pebble;English;pebble;g
Coral;Greek;coral;g
Pearl;French;pearl;g
Amber;Arabic;amber;a
Jade;Spanish;jade;g
Onyx;Greek;onyx;c
Opal;Latin;opal;g
Ruby;Latin;ruby;g
Cobalt;German;cobalt;g
Indigo;Greek;indigo;g
Ochre;Greek;ochre;a
Sienna;Italian;earth pigment;a
Umber;Latin;earth pigment;g
Teal;English;teal;w
Slate;French;writing slate;w
Ada;name;after Ada Lovelace;p
Ari;name;lion;g
Kai;name;sea;g
Mila;name;dear;m
Nia;name;purpose;g
Ora;name;light;g
Ida;name;work;g
Eli;name;ascent;g
Ela;name;goddess;g
Uma;name;tranquillity;g
Zara;name;radiance;g
Noa;name;movement;g
Lia;name;bringer of good news;g
Mia;name;mine;g
Lea;name;meadow;g
Nora;name;light;g
Ivo;name;yew;g
Leon;name;lion;g
Max;name;greatest;g
Theo;name;god-given;g
Otto;name;wealth;g
Hugo;name;mind, intellect;p
Lev;name;heart;g
Tara;name;star;g
Kira;name;ray of light;g
Rina;name;joy;g
Sena;name;radiance;g
Lena;name;light;g
Dora;name;gift;g
Vida;name;life;g
Nika;name;victory;g
Mara;name;sea;g
Ena;name;fire;g
Una;name;one;g
Teo;name;god-given;g
Niko;name;victory of the people;g
Remi;name;oarsman;g
Pax;Latin;peace;h
`;

const SERBIAN = `
Takt;Serbian;the beat a conductor keeps;o
Lupa;Serbian;magnifying glass;a;x
Oko;Serbian;eye;p
Spona;Serbian;clasp, link;m
Tinta;Serbian;ink;w;x
Vaga;Serbian;scales;c
Ti;Serbian;you;h
Zora;Serbian;dawn;g
Iskra;Serbian;spark;a
Most;Serbian;bridge;m
Veza;Serbian;connection;m
Nit;Serbian;thread;m
Splet;Serbian;tangle, web;m
Uzao;Serbian;knot;m
Klupko;Serbian;ball of yarn;m
Kalem;Serbian;graft that joins two plants;m
Spoj;Serbian;joint, union;m
Par;Serbian;pair;m
Sklop;Serbian;assembly;o
Vez;Serbian;embroidery, stitch;m
Razboj;Serbian;loom;m
Vreteno;Serbian;spindle;m
Tkanje;Serbian;weaving;m
Kompas;Serbian;compass;o;x
Sat;Serbian;clock;o
Ritam;Serbian;rhythm;o
Kormilo;Serbian;helm;o
Jedro;Serbian;sail;o
Sidro;Serbian;anchor;o
Luka;Serbian;harbour (also a name);o
Putokaz;Serbian;signpost;o
Zvezda;Serbian;star;o
Sunce;Serbian;sun;a
Mesec;Serbian;moon;m
Danica;Serbian;the morning star;o
Svetlo;Serbian;light;p
Zrak;Serbian;ray;p
Plamen;Serbian;flame;g
Kremen;Serbian;flint;c
Vid;Serbian;sight;p
Zenica;Serbian;pupil of the eye;p
Trag;Serbian;trace, track;a
Putnik;Serbian;traveller;a
Lovac;Serbian;hunter;a
Soko;Serbian;falcon;a
Orao;Serbian;eagle;a
Vuk;Serbian;wolf;a
Lisica;Serbian;fox;a
Mrav;Serbian;ant;g
Sova;Serbian;owl, reads at night;p
Gavran;Serbian;raven;c
Slavuj;Serbian;nightingale;w
Lasta;Serbian;swallow;g
Labud;Serbian;swan;g
Pero;Serbian;pen, feather;w
Slovo;Serbian;letter of the alphabet;w
Pismo;Serbian;letter, mail;w
List;Serbian;leaf, sheet of paper;w
Svitak;Serbian;scroll;w
Knjiga;Serbian;book;p
Strana;Serbian;page;w
Mastilo;Serbian;ink;w
Olovka;Serbian;pencil;w
Kreda;Serbian;chalk;w
Tabla;Serbian;board;w
Pesma;Serbian;song, poem;w
Stih;Serbian;verse;w
Rima;Serbian;rhyme;w
Bajka;Serbian;fairy tale;w
Nota;Serbian;note;w;x
Sito;Serbian;sieve: lets the good through;c
Mera;Serbian;measure;c
Merilo;Serbian;yardstick, criterion;c
Lenjir;Serbian;ruler;c
Istina;Serbian;truth;c
Pravda;Serbian;justice;c
Sudija;Serbian;judge;c
Provera;Serbian;check;c
Dokaz;Serbian;proof;c
Kantar;Serbian;steelyard scale;c
Visak;Serbian;plumb line;c
Libela;Serbian;spirit level;c
Kocka;Serbian;cube, dice;g
Stub;Serbian;pillar;o
Temelj;Serbian;foundation;o
Krov;Serbian;roof;g
Kapija;Serbian;gate;o
Vrata;Serbian;door;g
Brava;Serbian;lock;g
Kruna;Serbian;crown;g
Grb;Serbian;coat of arms;g
Nauka;Serbian;science;p
Znanje;Serbian;knowledge;p
Um;Serbian;mind;p
Misao;Serbian;thought;p
Ideja;Serbian;idea;g;x
Smisao;Serbian;meaning;g
Duh;Serbian;spirit;g
Volja;Serbian;will;g
Nada;Serbian;hope;g
Mila;Serbian;dear;m
Draga;Serbian;dear;m
Ljuba;Serbian;love;m
Sloga;Serbian;unity;m
Sklad;Serbian;harmony;m
Mir;Serbian;peace;h
Radost;Serbian;joy;g
Seme;Serbian;seed;g
Klica;Serbian;sprout;g
Koren;Serbian;root;p
Grana;Serbian;branch;g
Stablo;Serbian;tree trunk;g
Hrast;Serbian;oak;g
Lipa;Serbian;linden;g
Jela;Serbian;fir;g
Breza;Serbian;birch;g
Javor;Serbian;maple;g
Iva;Serbian;willow;g
Bor;Serbian;pine;g
Dren;Serbian;cornel, the hardest wood;c
Smreka;Serbian;spruce;g
Bagrem;Serbian;acacia;g
Vrba;Serbian;willow;g
Loza;Serbian;vine, lineage;m
Grozd;Serbian;grape cluster;g
Klas;Serbian;ear of wheat;a
Zrno;Serbian;grain;g
Polje;Serbian;field;g
Reka;Serbian;river;g
Izvor;Serbian;spring, source;p
Vrelo;Serbian;spring;p
Kap;Serbian;drop;w
Rosa;Serbian;dew;g
Oblak;Serbian;cloud;g
Vetar;Serbian;wind;g
Munja;Serbian;lightning;g
Grom;Serbian;thunder;c
Duga;Serbian;rainbow;p
Sneg;Serbian;snow;g
Led;Serbian;ice;g
Kamen;Serbian;stone;g
Biser;Serbian;pearl;g
Zlato;Serbian;gold;g
Srebro;Serbian;silver;g
Bakar;Serbian;copper;a
Alat;Serbian;tool;a
Ruka;Serbian;hand;h
Glas;Serbian;voice;o
Zvono;Serbian;bell;o
Frula;Serbian;shepherd's flute;w
Gusle;Serbian;folk fiddle for epic songs;w
Kolo;Serbian;circle dance, everyone in a ring;o
Igra;Serbian;play, dance;g
Dom;Serbian;home;h
Prag;Serbian;threshold;o
Staza;Serbian;path;o
Put;Serbian;road;o
Smer;Serbian;direction;o
Cilj;Serbian;goal;o
Plan;Serbian;plan;o
Red;Serbian;order;o
Med;Serbian;honey;g
Mak;Serbian;poppy;g
Neven;Serbian;marigold;g
Vila;Serbian;fairy;g
Zmaj;Serbian;dragon, a protector in folklore;c
Nebo;Serbian;sky;g
Svemir;Serbian;universe;g
Kosmos;Serbian;cosmos;g;x
Kometa;Serbian;comet;g;x
Sokak;Serbian;little street;g
Bunar;Serbian;well;p
Kotva;Serbian;anchor;o
Sveca;Serbian;candle;p
Fenjer;Serbian;lantern;p
Ogledalo;Serbian;mirror;c
Pecat;Serbian;seal, stamp (pecat);c
Krila;Serbian;wings;g
Pero;Serbian;feather;w
Tinja;Serbian;smoulders;g
Ognjiste;Serbian;hearth;h
Ravnica;Serbian;plain;g
Dunav;Serbian;the Danube;g
Fruska;Serbian;the Fruska Gora hills;g
Salas;Serbian;Vojvodina farmstead;g
Kalemar;Serbian;the one who grafts;m
Tkalja;Serbian;weaver;m
Pletilja;Serbian;knitter;m
Mudrac;Serbian;wise man;c
Znalac;Serbian;expert;p
Tragac;Serbian;seeker;a
Vodic;Serbian;guide;o
Kovac;Serbian;smith;a
Pisar;Serbian;scribe;w
Pisac;Serbian;writer;w
Zapis;Serbian;record, inscription;w
Beleska;Serbian;note;w
Spis;Serbian;document;w
Rukopis;Serbian;handwriting;w
Kist;Serbian;brush;w
Tok;Serbian;flow;o
Talas;Serbian;wave;g
Odjek;Serbian;echo;g
Zvuk;Serbian;sound;g
Ton;Serbian;tone;g
Lira;Serbian;lyre;w
Truba;Serbian;trumpet;o
Bubanj;Serbian;drum;o
Dirigent;Serbian;conductor;o
Kum;Serbian;godparent, best man;m
Sveza;Serbian;bond;m
Sklapanje;Serbian;bringing together;m
Bliznak;Serbian;twin;m
Saveza;Serbian;of the alliance;m
Druga;Serbian;the other one;m
Drug;Serbian;companion;m
Jato;Serbian;flock;o
Kosnica;Serbian;beehive;o
Pcela;Serbian;bee;g
`;

const parse = (src, set) => src.trim().split("\n").map((line) => {
  const [word, origin, meaning, roles, extra] = line.split(";");
  return { word, origin, meaning, roles, set, multi: extra === "x" };
});
const seen = new Set();
const POOL = [...parse(UNIVERSAL, "universal"), ...parse(SERBIAN, "serbian")].filter((w) => !seen.has(w.word + w.set) && seen.add(w.word + w.set));

// Taken: names of well-known AI assistants, models, voices or tools; a confusing choice for an AI product.
const TAKEN = {
  Sol: "a ChatGPT voice", Juniper: "a ChatGPT voice", Maple: "a ChatGPT voice", Aria: "Opera's AI assistant", Nova: "Amazon's Nova models",
  Atlas: "OpenAI's Atlas browser", Gemini: "Google's AI", Echo: "Amazon Echo", Lua: "the Lua programming language", Fable: "a Claude model",
  Iris: "many AI products", Orion: "many AI products", Vega: "the Vega charting library", Pilot: "copilots everywhere", Lumen: "many products",
  Muse: "many AI writing tools", Scribe: "many AI note-takers", Codex: "OpenAI Codex", Mercury: "many products", Hermes: "the Hermes model family",
  Sage: "Sage accounting", Ada: "the Ada language", Kai: "many AI assistants", Matrix: "the film", Synapse: "many products", Quill: "many editors",
  Opus: "a Claude model", Sonnet: "a Claude model", Haiku: "a Claude model", Coda: "the Coda docs app", Tempo: "many apps",
  // Web-searched 2026-10-30 for AI products using the name.
  Vela: "a YC-backed AI scheduling agent", Clio: "Clio's legal AI", Vera: "two AI fact-checkers", Juno: "many AI assistants",
  Lyra: "many AI assistants", Rondo: "RondoFlow, an AI agent-team builder", Baton: "two AI agent orchestrators", Folio: "several AI writing tools",
  Plumb: "AI verification tools", Ode: "Microsoft AI's poetry app", Assay: "AI verification tools",
  Carina: "a Spanish WhatsApp AI assistant", Clef: "Cloudflare's AI decision model", Erato: "a NovelAI writing model", Penna: "a Mac AI writing app",
  Norma: "AI governance tools", Calliope: "several AI writing tools", Laurel: "Laurel's legal and time-tracking AI", Pluma: "Pluma.ai, an AI writing platform",
  Stylo: "several AI writing tools",
};
// Searched the same day and found no AI product of that name (Deneb: only small hobby and agency projects).
const CLEAR = new Set(["Spica", "Tycho", "Amity", "Spona", "Kalem", "Tinta", "Fides", "Deneb"]);
// Odd or negative meanings elsewhere, or English words too plain to read as a name.
const AWKWARD = {
  Vaga: "means 'lazy' in Spanish", Lupa: "Latin slang for a prostitute (mild, historic)", Duh: "English 'duh'", Um: "English 'um'",
  Nit: "English 'nit' (louse egg)", Dom: "English slang", Red: "English 'red'", Most: "English 'most'", Sat: "English 'sat'", Put: "English 'put'",
  List: "English 'list'", Plan: "English 'plan'", Led: "English 'led'", Med: "English 'med'", Mir: "the space station", Vid: "English 'vid'",
  Page: "too plain", Draft: "too plain", Check: "too plain", Proof: "too plain", Link: "too plain", Tie: "too plain", Ink: "too plain",
  Ruler: "too plain", Level: "too plain", Filter: "too plain", Pair: "too plain", Note: "too plain", Kin: "too plain", Bond: "James Bond",
  Cupid: "dating-app cliche", Pupil: "two meanings", Ton: "English 'ton'", Tok: "TikTok", Drug: "English 'drug'", Pecat: "needs a hacek (pečat)",
  Druga: "reads as 'drug' in English", Grb: "unpronounceable outside Serbia", Kum: "English slang", Dren: "close to 'drain'", Kap: "English 'cap'",
};

const vowels = (w) => (w.toLowerCase().match(/[aeiou]+/g) || []).length;
function score(w) {
  const n = w.word.length, lw = w.word.toLowerCase();
  let s = 0;
  const why = [];
  s += n >= 3 && n <= 5 ? 25 : n === 6 ? 15 : n === 2 || n === 7 ? 8 : 0;
  const syl = vowels(lw);
  s += syl === 2 ? 15 : syl === 1 || syl === 3 ? 10 : 0;
  // Easy in both languages: no letters Serbian lacks (q, w, x, y), no English digraphs, no Serbian digraphs.
  const hard = /[qwxy]|th|sh|ch|ph|lj|nj|dz/.test(lw);
  s += hard ? 3 : 15; if (hard) why.push("hard to spell in one language");
  if (/^[a-z]+$/i.test(w.word)) s += 15;
  if (w.multi) { s += 10; why.push("same meaning in several languages"); }
  if (TAKEN[w.word]) { s -= 25; why.push(`taken: ${TAKEN[w.word]}`); }
  if (AWKWARD[w.word]) { s -= 30; why.push(AWKWARD[w.word]); }
  return { score: s, why };
}
POOL.forEach((w) => Object.assign(w, score(w), { clear: CLEAR.has(w.word), taken: !!TAKEN[w.word] }));

// Complete sets, chosen by hand from the top of the pool.
const SETS = [
  { name: "International", pick: true,
    note: "The chosen set. Each name came back clear of AI products in a web search, and each means something in more than one language.",
    names: { o: ["Deneb", "the bright star at the tail of the Swan"], a: ["Spica", "ear of grain: practical, the harvest"], p: ["Tycho", "the astronomer who measured everything"],
      m: ["Amity", "friendship"], w: ["Tinta", "ink in Spanish, Portuguese, Indonesian and Serbian: her ink-drop shape"], c: ["Fides", "Latin for trust; the goddess of good faith"], h: ["You", ""] } },
  { name: "Serbian variant", pick: false,
    note: "Everyday Serbian words that describe each agent's own animation; for a Serbian-language version of the app.",
    names: { o: ["Takt", "the beat a conductor keeps"], a: ["Lupa", "magnifying glass, also in Italian and Spanish"], p: ["Oko", "eye: the observer in glasses"],
      m: ["Spona", "clasp: what joins two things"], w: ["Tinta", "ink, also in Spanish and Portuguese: her ink-drop shape"], c: ["Sito", "sieve: lets only sourced claims through"], h: ["Ti", "you"] } },
];

const ROLES = { o: "Orchestrator", a: "Industry Analyst", p: "Research Profiler", m: "Matchmaker", w: "Proposal Writer", c: "Critic", h: "Human" };
const top = (set, r, k = 8) => POOL.filter((w) => w.set === set && w.roles.includes(r)).sort((x, y) => y.score - x.score || x.word.length - y.word.length).slice(0, k);

if (!out) {
  for (const set of ["universal", "serbian"]) {
    console.log(`\n== ${set} (${POOL.filter((w) => w.set === set).length} words)`);
    for (const r of Object.keys(ROLES)) console.log(ROLES[r].padEnd(18), top(set, r).map((w) => `${w.word}(${w.score})`).join(" "));
  }
  console.log("\ntotal", POOL.length);
} else {
  const data = JSON.stringify({ roles: ROLES, pool: POOL, sets: SETS });
  fs.writeFileSync(path.join(out, "naming.html"), fs.readFileSync(new URL("./naming.html", import.meta.url), "utf8").replace("/*DATA*/null", data));
  console.log("wrote naming.html with", POOL.length, "words");
}
