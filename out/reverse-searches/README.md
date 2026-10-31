# Five reverse searches, one in Serbian

Five problems that are not in the dataset, run with `npm run match -- --local --problem "..."` in parallel on 2026-10-31.
Models: Haiku 4.5 and Sonnet 4.6 on local Claude Code, the second Critic and the shortlist filter on `subq-snap-1.1`
(`SUBQ=1`, `SCREEN=1` in `.env`), OpenAlex on. Each folder replays with `npm run replay -- out/reverse-searches/<case>`.
`cli.txt` in each folder is what the CLI printed.

**Result.** Four of five answers are right against the researchers' records. The Serbian problem also finds a sensible
researcher, but its proposal carries a wrong translation that no check catches. The vague problem gets no researcher,
which is the right answer. The first energy run crashed on a network error and lost its results (`energy-crashed/`).

| Case | Problem (short) | Answer | Right? | Time | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| `energy` | Rooftop PV inverters trip on grid overvoltage, export limit costs 8% yield | R0696 Jeremić 0.93, R0904 Simić 0.61; proposal **needs human** | Yes | 5 min 23 s | 417k | $1.41 |
| `medtech` | ECG patch misses AF while the patient walks | R0906 Popović 0.92; proposal accepted | Yes, best in dataset | 5 min 36 s | 274k | $0.94 |
| `agritech` | Orchard irrigation overwaters after rain, slow soil probes | R0662 Ilić 0.87, R0218 Orlović 0.81, R1047 Pantelić 0.62; proposal accepted | Yes | 5 min 58 s | 359k | $1.19 |
| `vague` | "Customers are not happy ... product should be smarter" | Triage `not-research`, no researcher | Yes | 42 s | 10k | $0.03 |
| `serbian` | Apple sorting line misgrades skin damage and early rot (in Serbian) | R0548 Stojanović 0.88; proposal accepted | Yes, nearest fit | 6 min 30 s | 427k | $1.45 |

## How each answer compares with the records

I compared each answer with the researchers' fields, keywords and publications in `data/raw`, and with an independent
keyword ranking of all 1,047 researchers on the problem's topic words.

- **Energy.** Jeremić's keywords are hosting capacity, voltage regulation, reactive power compensation and smart inverters
  in low-voltage networks, and his papers include Volt-Var control for prosumer networks (SYN-PUB-07797). He is first in
  the independent ranking too. Simić (PV forecasting) is a fair second at 0.61. Ninkov (inverter EMC) was profiled and
  correctly not paired. The proposal went to `needs-human/` after 3 revisions: the last rejections were editorial
  phrases ("needed to turn that data into a validated control design"), not wrong facts.
- **Medtech.** Popović is the clear best match in the dataset. Her papers are "Cutting false atrial fibrillation alarms in
  patch ECG with motion-aware filtering" and a benchmark of motion-corrupted patch ECG with accelerometry. The shortlist
  filter rated her 0.996 and the next candidate 0.48. Only 3 researchers were profiled.
- **Agritech.** Ilić is first in the independent ranking. He works on irrigation scheduling, has a paper on capacitive
  soil moisture probe calibration, and is the inventor of a granted multi-depth soil moisture probe patent (SYN-PAT-001,
  checked). Orlović (machine learning on agronomic sensor archives) and Pantelić (soil water balance) are fair picks.
  Pekez (flood frequency) was profiled but correctly not paired.
- **Vague.** The Analyst triaged it `not-research`: "Customer dissatisfaction and retention are business and product
  management problems". The run stops after 42 s for $0.03. This is the wanted behaviour for a problem without a technical question.
- **Serbian.** No researcher in the dataset publishes on fruit or produce imaging. A search of all publications for
  apple, fruit or postharvest together with imaging, sorting or defect terms finds only insect-trap photos (R0166) and
  VOC ripeness sensing (R0729). The nearest fits are visual defect detection on industrial lines. Stojanović
  (few-shot surface defect detection, synthetic defects, anomaly detection on assembly lines) is a sensible answer, and
  the proposal says honestly that his work covers industrial parts, not produce. The shortlist filter rated R0166 at 0.03,
  also right. Two more pairs (Lukić R0406, Bulatović R0437) were dropped after 3 rounds over citations of their own papers,
  not over the Serbian text.

## What fails for the Serbian problem

Retrieval does not fail. The Analyst translates the problem and writes English search terms ("apple defect detection",
"postharvest disease detection", ...), and the shortlist uses only those terms (`src/agents/profiler/shortlist.ts`), so
the same researchers come up as for an English problem. These parts fail:

1. **A wrong translation reaches the proposal, and the Critic does not catch it.** "oštećenja kore" (damage to the fruit
   skin) became "bark damage". The proposal (`serbian/proposals/C999-CH1-R0548.md`) says "bark damage" 7 times. One of the
   Critic's own reasons translates the source correctly as "minor skin damage", but no claim was rejected for "bark".
   The Critic checks that the source supports a claim; it does not check the translation of a word.
2. **The Analyst invents the original term in brackets.** The prompt says to add the Serbian original when unsure
   (`src/agents/analyst/prompt.ts:26`). The restatement says "minor bark damage (drobna oštećenja kore)", but the text says
   "sitnim oštećenjima kore". "drobna" is not in the source. This one did not reach the proposal.
3. **A derived number is stated as a fact.** "greška je i dalje oko 12%" (the error is still about 12%) became "only ~88%
   accuracy", in the need and in the proposal. The Critic accepted it. It is arithmetic, but "accuracy" is not what the company wrote.
4. **The Serbian sector goes untranslated into the EU calls search.** `--sector "Prerada hrane"` was passed to the EU portal
   as the query "prerada hrane", and the portal search is English only (`languages: ["en"]` in `src/data/eucalls.ts`).
   The Serbian run found 1 EU call; the three English runs with a sector found 2 to 3.
5. **It costs more.** The Serbian run used the most tokens (427k, $1.45) and the most Critic work (15 send-backs, 45
   rejected claims, against 11–14 and 27–44 for the English runs). The first Critic review of the need took 65 s,
   against 23–33 s for the English runs, and the Analyst took 12.6 s against about 7 s.

The Critic's word checks do not fail more on Serbian: 3 code-check rejections cite the problem text, against 2 for
medtech and 1 for agritech.

## Other findings, not about language

- **A network error kills the whole run** (`energy-crashed/cli.txt`). After 192 s, with 2 pairs accepted and a Writer at
  work, Node's built-in `fetch` (undici) threw `AssertionError [ERR_ASSERTION]` in `Parser.finish` when a TLS socket
  closed mid-response. The Funding Scout had just sent its EU portal and CORDIS queries. The error came from a socket event,
  not from the fetch promise, so `src/cli.ts:88` (which handles only `unhandledRejection`) did not catch it. The run wrote
  only `problem.json` and the trace. All results were lost. The rerun with the same problem worked (`energy/`).
- **The acronym check rejects true claims.** The code check rejected "PV" in claims on SYN-PUB-07801, 07796, 07797 and 03969:
  each of these says "photovoltaic", a single word, and `spells()` in `src/agents/critic/checks.ts` needs one word per
  letter. In medtech it rejected "AF" on C999-CH1, which says "atrial fibrillation".

## The problems as run

```sh
npm run match -- --local --sector "Solar energy" --problem "Our rooftop solar inverters disconnect from the grid on hot summer afternoons because the local grid voltage rises too high. We tried lowering the export limit on every site, but that loses about 8% of the yearly yield. We have five years of inverter logs and grid voltage readings from 300 sites."
npm run match -- --local --sector "Medical devices" --problem "Our wearable ECG patch misses atrial fibrillation episodes when patients walk or move during the day. We remove motion artefacts with a fixed band-pass filter, but sensitivity drops below 80% while the patient walks. We have 1,200 hours of cardiologist-annotated recordings from 90 patients."
npm run match -- --local --sector "Agriculture" --problem "Our irrigation controllers in apple orchards overwater after rain because the soil moisture probes react slowly. We tried a fixed pause after each rainfall, but young trees still show root stress and the water bill keeps growing. We have three seasons of probe readings, weather station data and yield records from 60 hectares."
npm run match -- --local --problem "Our customers are not happy and some of them leave us. We think our product should be smarter, but we do not know where to start."
npm run match -- --local --sector "Prerada hrane" --problem "Naša linija za sortiranje voća često pogrešno razvrstava jabuke sa sitnim oštećenjima kore i početnom truleži. Probali smo kameru sa fiksnim pragovima boje, ali greška je i dalje oko 12% i kupci vraćaju robu. Imamo 40.000 označenih slika jabuka iz tri sezone berbe."
```

The five ran in parallel, and card #61's real run used the same local Claude Code login at the same time. The times above include that load.
