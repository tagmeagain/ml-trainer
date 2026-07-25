# CLAUDE.md

Project instructions. Read this every session. `SPEC.md` holds the detail — read it before writing code, and re-read the relevant section before touching the schema, the scheduler, the queue, or the card page.

## What this is

An installable PWA that shows one ML/LLM interview concept card at a time, installed to the Android home screen. It exists to replace a doomscrolling reflex with a 30-second learning moment.

Content is seeded from `tracker/Master_Interview_Prep_Tracker.xlsx`, the owner's own prep tracker — about 200 curated topics. The owner is a senior data scientist with seven years of ML experience targeting AI Research Engineer and Inference Engineering roles. Write cards at that level: assume fluency in the basics, go deep on inference, serving, and post-training.

## Non-negotiable rules

1. **No build step.** Plain HTML, CSS, vanilla JS, ES modules. No npm for the app, no bundler, no framework, no TypeScript compilation.
2. **Everything on one page.** The question and answer points reveal in place on the card. Never a modal, never a route change, never a separate screen.
3. **Card ids are permanent.** Review history is keyed on them. Never renumber, reuse, or bulk-rewrite ids.
4. **Content and review state stay separate.** Content in `content/*.json` and git; review state in localStorage only. Never merge them, never commit review state.
5. **A bad content push must not break the installed app.** Validate on load; on failure keep the cached copy.
6. **The app must work offline** after first load. Anything fetched at runtime is precached by the service worker, KaTeX included.
7. **Build one phase at a time.** If asked for Phase 2, do not start Phase 3. If no phase is named, ask which one.

## Commands

```
python scripts/seed_from_tracker.py    xlsx -> content/stubs.json
python scripts/validate.py             pydantic over all cards
python scripts/coverage.py             unfilled stubs and card counts per stage
python scripts/csv_tool.py export|import
npx serve .                            local preview (service workers need a server, not file://)
```

## Card authoring standards

This is the quality bar. Most generated cards fail on the example.

- `concept` is under 120 words and explains the mechanism, not the definition. "The KV cache stores past keys and values so each token only attends against cached tensors" beats "The KV cache is a cache for keys and values."
- `example` must contain **real numbers worked through** — a model name, actual dimensions, an actual result. "LLaMA-2 70B at 4096 context with GQA-8 needs 10.5 GB of KV cache" is an example. "For a large model this uses significant memory" is not. Reject and rewrite.
- `interview_question` is a scenario, not a definition prompt. "Throughput drops as context grows, walk me through why" beats "What is a KV cache?"
- `answer_points` are 3-5 bullets an interviewer would tick off, including at least one thing a mid-level candidate would miss.
- No card is answerable by restating `concept` back.
- Write at senior level. Do not explain what a gradient is. Do explain why decoupled weight decay matters.
- One hard card beats three shallow ones.

### Formula cards
`type: "formula"` cards drill recall of a specific formula. `formula` holds the LaTeX, `concept` says what each symbol means, `example` gives the key numbers to anchor it, and `interview_question` asks the reader to derive it or compute a case. Every starred row in the tracker's Formulas sheet becomes one of these. Prioritise them — they are the highest-value cards in the deck.

### Filling stubs
Stubs come from the tracker and carry a `_source` field with the original Theory / Math / Code text. Use it as raw material, not as text to copy. **Fill at most 10 stubs per invocation** — quality drops sharply beyond that. Delete `_source` from finished cards.

## LaTeX and KaTeX

- `formula` holds LaTeX with escaped backslashes in JSON: `"\\cdot"`, not `"\cdot"`.
- Render with KaTeX in display mode. Set `throwOnError: false` so a malformed formula degrades to raw text instead of blanking the card.
- Test every formula card renders before committing — subscripts, Greek letters, and `\text{}` are the usual failures.

## Git conventions

- Branches: `content/YYYY-MM-DD` for cards, `feat/short-name` for code, `fix/short-name` for bugs.
- Commit prefixes: `content:`, `feat:`, `fix:`, `test:`, `chore:`.
- **Generated content never goes straight to main.** Always a branch, always pushed for review.
- Run `python scripts/validate.py` before any commit touching `content/`. If it fails, stop and report — do not commit anyway, do not loosen the schema to make it pass.
- Never commit `cards.csv`, `.env`, or an API key.
- Never force push. Never rewrite history on main.

## Things to never do

- Never add a backend, a server, or an account system.
- Never add npm, a bundler, React, Vue, or a CSS framework.
- Never sync review state anywhere. It is device-local.
- Never add analytics or telemetry.
- Never fetch anything on the card render path — content comes from cache, sync happens in the background.
- Never weaken the schema to make a generated card pass.

## Style

- Vanilla JS, ES modules, `const` by default. No jQuery-era patterns.
- Scheduling and queue logic are pure functions in their own modules, tested, with no DOM access.
- CSS: custom properties for colours, dark by default, system font stack, one column, generous line height. No CSS framework.
- The card page is seen dozens of times a day. It should feel calm and finished — nothing blinking, nothing counting down, no streak guilt.
