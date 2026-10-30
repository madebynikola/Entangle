# Test fixtures

`data/` is a small slice of the EINSTEIN dataset (jigjoy-ai/einstein-matchmaker-data v2.0, synthetic) in the dataset's own
file format, so `loadDataset(FIXTURE_DIR)` from `src/data/` works on it like on the full set. It loads in about 20 ms.

```ts
import { FIXTURE_DIR, loadDataset } from "../src/data"
const data = loadDataset(FIXTURE_DIR) // or EINSTEIN_DATA_DIR=test/fixtures/data
```

Rebuild it from `data/raw/` with `npx tsx src/data/make-fixtures.ts`. The selection is deterministic.

## What is in it

| | |
| --- | --- |
| Companies | 5, with 16 challenges and 30 pages |
| Researcher profiles | 30 (28 people after merging 2 duplicates) |
| Publications, projects, patents | 413, 81, 1: every record linked to a fixture researcher |

Links to researchers outside the fixture are cut: such authors become outside co-authors (`researcher_id: null`),
and project participants outside the fixture are dropped. Every id the fixture references exists in it.

| Company | Why it is here |
| --- | --- |
| C001 ArmaturaSec | Clear research challenges (anomaly detection on Modbus/BACnet, firmware testing) |
| C006 PravniPilot | C006-CH2 is a Series A round: not a research problem |
| C054 Polje Senzor | Challenges written in Serbian |
| C120 Analitika Petrović | C120-CH3 names an employee's leave (the reason is removed on load); CH3 is about hiring |
| C139 Farmavita | Its director is named Jelena Marković, like researcher R0976: a name trap |

21 researchers come from retrieval on these challenges (the top candidates of each, round-robin). The other 9 are trap cases:

| Ids | Trap |
| --- | --- |
| R0139 = R0539 | One person, two profiles (surname first). Loads as R0539 with alias R0139 |
| R0556 = R0976 | One person, two profiles (Cyrillic). Loads as R0976 with alias R0556 |
| R0128, R0881 | Two people named Nina Mamužić |
| R0068 | Left the university in March 2026: `status: "departed"`, cannot lead |
| R0079 | Professor emeritus, consulting only: cannot lead |
| R0341 | On leave until September 2026: `availability` keeps the dates, not the reason |
