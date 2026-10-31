# Contributing

Thanks for looking. Entangle started as a two-day hackathon entry, so issues and small pull requests are the easiest to take.

## Set up

```bash
npm install                      # Node 22.22 or newer
npm run replay -- out/golden     # the committed reference run, no keys needed
npm run match -- --mock          # a full run on mock models and the test fixture
```

For real models, copy `.env.example` to `.env` and set one key (or `LOCAL_CLAUDE=1`). The full dataset goes in `data/raw/`
(see [`docs/dataset.md`](docs/dataset.md)); without it the CLI uses the 5-company fixture in `test/fixtures/data/`.

## Before you open a pull request

```bash
npm run typecheck
node --import tsx --test src/data/*.test.ts test/*.test.ts src/agents/*/*.test.ts
```

- Keep a pull request to one change, and say what it changes and how you checked it.
- Commit messages are one line, `type(scope): what`, with `type` one of feat, fix, docs, refactor, test or chore.
- Do not commit `.env`, `data/raw/`, `data/uploads/` or local runs in `out/`. Only `out/golden/` and the reverse searches are committed.
- A change to a prompt or the Critic's rubric should come with a rerun of `npm run critic:eval` and its numbers.

## Data and people

The dataset is synthetic, but the names look real. Read [Responsible use of data](README.md#responsible-use-of-data) before you
add a data source. In short: never search the web or a real API for a person by name, and never output a ranking of people.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
