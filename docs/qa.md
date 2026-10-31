# Pitanja drugih timova: Mozaik i "zašto ne jedan veliki LLM"

Kratki odgovori za demo i za pitanja drugih timova. Svaki broj je iz referentnog pokretanja `out/golden/`
(8 kompanija, Sonnet 4.6 i Haiku 4.5), iz njegovog `summary.json` i `trace.jsonl`, ili iz [quality.md](quality.md).

## Odgovor u 30 sekundi

> Skup podataka ima oko 7 miliona tokena, a ni jedan model ne može da ga pročita odjednom. Zato ga deli tim agenata:
> svaki agent čita samo jednu kompaniju ili jednog istraživača, i svi rade u isto vreme na jednom Mozaik runtime-u.
> Najveći poziv modela u celom pokretanju pročitao je 19 hiljada tokena. Drugi razlog je provera: jedan model ne može
> pouzdano da proveri sam sebe. Kod nas poseban Critic, u svom kontekstu, proverava svaku tvrdnju prema zapisu koji ona citira.
> U referentnom pokretanju odbio je 483 tvrdnje i vratio ih na ispravku. Bez te provere one bi otišle kompaniji.

## Kako smo koristili Mozaik?

Jedan Mozaik runtime (`@mozaik-ai/core` 4.1.0) i 21 učesnik na jednoj magistrali događaja. Agenti nikad ne zovu jedni druge.

| Mozaik deo | Šta radi kod nas | Gde |
| --- | --- | --- |
| `defineRuntime<MatchState>()` | Jedan runtime za ceo proces. Njegovo stanje je zajednička tabla (blackboard): potrebe, profili, parovi, predlozi, presude, zadaci, budžet | `src/runtime/mozaik.ts`, `src/runtime/state.ts` |
| `createAgent` | Agenti koji zovu model: 4 analitičara, 6 profajlera, Matchmaker, 3 pisca, 2 Critic-a, Funding Scout, filter užeg spiska | `src/agents/*/` |
| `createHuman` | Učesnici bez modela: Orchestrator, Shortlist i posmatrač koji piše trag | `src/agents/orchestrator/`, `src/agents/profiler/pool.ts`, `src/trace/` |
| `runLoop` | Svaki zadatak je svoja petlja sa svežim kontekstom. Petlja ne čeka, pa jedan agent može da ima više otvorenih petlji | `src/runtime/tasks.ts` |
| `sendEvent` + `SituationSpecification` | Saradnja preko događaja: `artifact.posted`, `shortlist.ready`, `critic.sent_back`, `orchestrator.decided`. Svaki učesnik reaguje na događaj koji ga se tiče | `src/agents/*/` |
| `structuredOutput` | Svaka uloga vraća JSON po šemi. Svaka činjenica je `Claim { text, sourceIds }` | `src/agents/*/prompt.ts` |
| Svoj `InferenceRunner` | `ResilientRunner` oko svakog poziva: najviše 16 poziva odjednom, limiti po provajderu, ponovni pokušaji, prioritet za posao koji je bliži kraju, budžet. Isti interfejs za lokalni Claude Code, mock model i SubQ | `src/runtime/resilient-runner.ts` |
| Događaji koje Mozaik šalje sam | `inference.started/completed` sa tokenima, `model.answer`. Posmatrač piše svaki događaj u `trace.jsonl` (7.105 događaja u referentnom pokretanju). Web aplikacija iz toga crta Stage i Timeline | `src/trace/trace-observer.ts` |

Bitno je da posao ne ide u fazama. Orchestrator dodeljuje posao čim njegov ulaz postoji. Profajleri rade dok analitičari
još čitaju druge kompanije, a prvi predlog se pisao pre nego što je većina kompanija uparena. U 49 minuta bilo je 2 h 47 min
poziva modela, u proseku 3,4 poziva u isto vreme (ograničenje je bilo 6 lokalnih Claude Code sesija).

## Šta nas razlikuje od jednog velikog LLM-a?

### 1. Podaci ne staju u jedan model

Skup podataka ima oko 7 miliona tokena: 1.047 istraživača, 153 kompanije, publikacije, projekti, patenti, sajtovi, oglasi.
Ni jedan model danas ne čita toliko u jednom pozivu. Čak i da može, platio bi svih 7 miliona tokena za svako pitanje, a
pažnja modela opada na dugom kontekstu.

Kod nas svaki poziv vidi samo ono što mu treba. U referentnom pokretanju:

| | Ulazni tokeni po pozivu (medijana) | Najveći poziv |
| --- | --- | --- |
| Svih 696 poziva | 6.285 | 19.447 |
| Analitičar (jedna kompanija) | 7.203 | 9.756 |
| Profajler (jedan istraživač) | 8.104 | 19.447 |
| Pisac (jedan par) | 10.631 | 13.634 |

Ceo posao je 5,0 miliona tokena, a ne 7 miliona po pitanju. Profajliramo samo istraživače sa užeg spiska: profili svih bi
koštali oko 8 miliona tokena.

### 2. Jedan model ne proverava sam sebe

Model koji je napisao tvrdnju ima iste slepe tačke kad je proverava. Naš Critic je poseban agent, u svom kontekstu.
Ne vidi razmišljanje pisca, nego samo tvrdnju i zapise koje ona citira. Provera ima tri sloja:

1. **Kod, bez modela:** svaka tvrdnja citira izvor, svaki citirani id postoji i pripada baš tom istraživaču ili toj kompaniji.
   Ime ili broj koji nije u citiranom zapisu, a jeste u drugom zapisu, ide nazad (`uncited-detail`).
2. **Model:** Sonnet 4.6 čita citirane zapise i za svaku tvrdnju odlučuje da li zapis kaže to što tvrdnja kaže.
3. **Drugi recenzent** na drugom modelu, za predloge. Tvrdnja prolazi samo ako je oba prihvate.

U referentnom pokretanju: 337 pregleda, 194 vraćanja na ispravku, 483 odbijene tvrdnje, 10 odbačenih artefakata.
Na 272 ručno označene tvrdnje Critic hvata 53–67% pogrešnih i odbija 3–6% tačnih ([quality.md](quality.md)).

### 3. Pravi model za pravi posao

Mnogo paralelnog čitanja ide na Haiku 4.5, a odluke (Matchmaker, pisac, Critic) na Sonnet 4.6. Merili smo i Critic na Haiku 4.5:
hvata 11 od 23 pogrešne tvrdnje, a Sonnet 15 do 21. Zato Critic ostaje na Sonnet-u. Jedan model bi morao da bude ili skup za
sve ili slab za sve.

### 4. Ono što ne treba modelu radi kod

Orchestrator ne zove model. Uži spisak bira BM25 pretraga, ne LLM (sa `SCREEN=1` ga još filtrira mali model odluke, subq-snap). Provera id-jeva je kod. Izazov koji nije istraživački
postaje "nema para" bez poziva modela. Svaki od ovih koraka je brz, besplatan i uvek daje isti rezultat.

### 5. Vidi se šta se desilo i koliko je koštalo

Svaki događaj je u `trace.jsonl`, vezan za agenta, zadatak i petlju, sa vremenom, tokenima i cenom. Svaka tvrdnja u predlogu
nosi id zapisa, i u aplikaciji se klikom otvara izvor. Jedan veliki poziv je crna kutija: dobiješ tekst i ne znaš odakle je.

### 6. Greška ostaje lokalna

Zadatak koji padne pada sam. Budžet od 60 minuta zaustavio je poslednju kompaniju (C008) pre uparivanja, a ostalih 6
prihvaćenih predloga je ostalo. Kod jednog velikog poziva, prekid ili loš odgovor znači da nemaš ništa.

## Pitanja koja mogu da dođu posle

**"Da li ste merili jedan veliki LLM naspram ovoga?"**
Ne direktno, i to treba reći. Ceo skup ne staje u jedan poziv, pa takav test nije moguć bez pretrage, a sa pretragom to je
već sistem kao naš. Ono što jesmo merili: koliko pogrešnih tvrdnji jedan jak model (pisac na Sonnet 4.6) napiše kad ga niko ne
proverava. U referentnom pokretanju Critic je odbio 483 tvrdnje. U ručnoj proveri tri predloga, 15 od 76 tvrdnji (20%)
bilo je pogrešno, a prvi Critic ih je propustio. Posle toga smo dodali proveru kodom i proveru slobodnog teksta.

**"Zar više agenata ne košta više?"**
Košta više tokena nego jedan poziv na malom primeru. Ponovni pregledi su oko 26% cene. Ali jedan poziv ne može da pročita
7 miliona tokena, a ono što bi preskočio je upravo provera. Referentno pokretanje je 5,0M tokena, oko 17 dolara po API ceni, za 8 kompanija.

**"Zašto je golden samo na 8 kompanija, a ne na svih 120? Zašto traje toliko?"**
Zato što svaka kompanija ima oko 87 poziva modela, a svaki traje 1 do 1,5 minuta. Referentno pokretanje ima 696 poziva: 8
kompanija, 66 minuta, 5,0M tokena, 17 dolara. To je oko 8 minuta i 2 dolara po kompaniji. Većina poziva nije pisanje nego
provera: 367 pregleda Critic-a prema 19 napisanih predloga. Uz pregled ide ispravka, pa je kvalitet cena vremena. Za svih
120 kompanija isti postav treba oko 16 sati i 250 dolara. Uska tačka nije cena nego broj poziva odjednom: 6 lokalnih Claude
Code sesija. Na API ključu, sa većim `MAX_IN_FLIGHT`, procena je oko 3 sata (nije mereno). Zato smo birali 8 kompanija
koje smo mogli da proverimo ručno, a ne 120 koje niko ne bi pročitao.

**"Da li je ovo pravi paralelizam ili samo asinhroni pozivi?"**
Pravi: do 5 uloga zove model u istom trenutku, dve ili više 48% vremena. Na Timeline-u se trake preklapaju.
Proveri: `npm run replay -- out/golden`, pa Timeline.

**"Šta ako Critic pogreši?"**
Pogreši: propusti trećinu do polovinu suptilnih grešaka (proširen opseg, dodat sud). Zato čovek odobrava svaki par pre
nego što se iko kontaktira. Critic smanjuje posao čoveku, ne zamenjuje ga.

**"Zašto Mozaik, a ne LangGraph ili sopstveni kod?"**
Pravilo hakatona traži Mozaik. Ali i odgovara problemu: magistrala na kojoj svaki učesnik vidi svaki događaj daje nam
Critic-a koji reaguje čim se nešto objavi, i trag bez dodatnog koda. Svoj `InferenceRunner` nam je dao rate limit,
ponovne pokušaje, budžet i mock model na jednom mestu.

**"Šta Mozaik nije mogao?"**
Verzija 4.1.0 ne može da prekine petlju: zadatak koji budžet zaustavi označimo kao neuspeo i ispustimo, ali se ne ubija.
Takođe ne šalje `cache_control`, pa keširanje prompta na API-ju traži omotač.
