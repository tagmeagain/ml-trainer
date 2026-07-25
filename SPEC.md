# ML Trainer — PWA Spec

An installable Progressive Web App that shows one ML/LLM interview concept card at a time. Installed to the Android home screen next to Instagram, so opening it is as cheap as opening a social app.

Content is seeded from the owner's existing `Master_Interview_Prep_Tracker.xlsx` — roughly 200 curated topics across LLM theory, inference engineering, fine-tuning, classical ML, DSA, and a Formulas sheet.

Target roles: AI Research Engineer and Inference Engineering.

---

## 1. Core product rules

1. **One card per screen.** No feed, no infinite scroll. Navigation is a fixed daily queue with next and previous.
2. **Everything on one page.** Concept, formula, example, interview question, and answer points all live on the same card. Tapping reveals sections in place — never a modal, never a route change.
3. **Card readable in 30 seconds** before the reveal. `concept` under 120 words.
4. **Every card has a concrete worked example** with real numbers.
5. **Works offline.** After first load the app functions with no network.
6. **No backend, no account, no login.** Content from a public GitHub repo, progress in localStorage.
7. **No build step.** Plain HTML, CSS, and vanilla JS. No npm, no bundler, no framework.

---

## 2. Card data model

Cards live as JSON in `/content/*.json`.

```json
{
  "id": "inference-kv-cache-memory-001",
  "type": "concept",
  "stage": "I3",
  "category": "inference",
  "topic": "KV cache memory",
  "difficulty": "hard",
  "formula": "\\text{bytes} = 2 \\cdot L \\cdot S \\cdot G \\cdot d_h \\cdot \\text{dtype} \\cdot B",
  "concept": "Each layer caches one K and one V tensor per KV head. With GQA, G is the number of KV heads, not query heads — that is where the savings come from.",
  "example": "LLaMA-2 70B: L=80, G=8, d_h=128, S=4096, fp16, batch 1 gives 10.5 GB. At batch 8 that is 84 GB, more than the 140 GB of weights leaves free on one node.",
  "interview_question": "Throughput drops sharply as average context grows. Why, and what would you change?",
  "answer_points": [
    "KV grows linearly with S and batch, so fewer requests fit in memory",
    "Decode is bandwidth bound, so more cache is read per generated token",
    "Fixes: GQA to shrink G, FP8 KV cache, PagedAttention, prefix caching"
  ],
  "tags": ["kv-cache", "memory", "serving"],
  "source_link": "https://arxiv.org/abs/2309.06180"
}
```

### Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `{category}-{topic-slug}-{nnn}`. Permanent — review history is keyed on it. Never renumber or reuse. |
| `type` | yes | `concept` or `formula` |
| `stage` | yes | Tracker stage code, e.g. `S0`, `S3`, `I3`, `F1`, `D`, `SD`, `B` |
| `category` | yes | see list below |
| `topic` | yes | matches the tracker's Topic column where possible |
| `difficulty` | yes | `easy` \| `mid` \| `hard` |
| `formula` | no | LaTeX, rendered with KaTeX. Required when `type` is `formula`. |
| `concept` | yes | under 120 words |
| `example` | yes | must contain real numbers |
| `interview_question` | yes | a scenario, not a definition prompt |
| `answer_points` | yes | 3-5 bullets |
| `tags` | no | |
| `source_link` | no | |

### Categories

Mirrors the tracker so coverage maps one-to-one:

`math-prereq` · `nn-foundations` · `tokenization` · `attention` · `positional` · `transformer-block` · `decoder` · `efficient-attention` · `training-scale` · `peft` · `alignment` · `inference` · `architectures` · `distributed` · `classical-ml` · `production` · `safety-agents` · `dsa` · `system-design` · `behavioral`

### Formula cards

`type: "formula"` cards are pure recall drills, matching the tracker's "re-write every starred formula from memory monthly" instruction. They render the formula large and centred, with `concept` explaining what each symbol means and `example` giving the key numbers. The interview question is always some variant of "derive this" or "compute it for case X".

Every starred formula in the tracker's Formulas sheet becomes one formula card.

---

## 3. Architecture

```
GitHub repo (content/*.json)
        |  fetched by the app, cached by the service worker
        v
    index.html + app.js          <-- served from GitHub Pages
        |
        v
    localStorage (review state, daily queue)
```

### 3.1 Storage

| What | Where | Why |
|---|---|---|
| Card content | Cache API, via the service worker | stale-while-revalidate, works offline, no DB code |
| Review state | localStorage, key `review` | small, synchronous, survives reinstall of the PWA |
| Daily queue | localStorage, key `queue:YYYY-MM-DD` | rebuilt each day |
| Settings | localStorage, key `settings` | |

Review state, keyed by card id:

```json
{
  "box": 3,
  "lastReviewed": "2026-07-20",
  "nextReview": "2026-07-27",
  "seenCount": 4,
  "history": ["got", "fuzzy", "got", "got"]
}
```

Cap `history` at 10 entries. If a card id vanishes from content, keep the orphaned entry; prune orphans older than 90 days.

Content and review state are separate on purpose: content can be regenerated, rewritten, or reordered without touching progress.

### 3.2 Daily queue

Built once per day on first open. Three tiers in order:

1. **Due** — `nextReview <= today`, oldest due first.
2. **New** — never seen. **Capped at 8 per day.**
3. **Filler** — random card from the weakest category (highest share of `forgot` in the last 30 days).

Tier 3 means there is always a card; the app never shows an empty state.

### 3.3 The card page

One screen, top to bottom:

1. Category chip, stage code, and queue position
2. Topic and difficulty
3. Formula block (only if `formula` is present), rendered with KaTeX
4. Concept
5. Worked example, in a tinted box
6. **Test me** button

Tapping **Test me** expands the interview question in place. A second tap expands `answer_points` below it. Both expansions happen on the same page with no navigation — the card grows and the page scrolls if needed.

Bottom bar, fixed: previous arrow, Got it, Fuzzy, Forgot, next arrow.

- Grading writes review state and advances the pointer.
- Arrows move the pointer without grading.
- Returning to a graded card shows its grade highlighted and allows changing it.

### 3.4 Leitner scheduling

Box intervals: 1 = 1 day, 2 = 3 days, 3 = 7 days, 4 = 21 days, 5 = 60 days.

- `got` moves up one box (max 5)
- `fuzzy` holds
- `forgot` resets to box 1

`nextReview = lastReviewed + interval(box)`. Pure functions in `scheduler.js`, unit tested before being wired to the UI.

### 3.5 Content sync

- On load, and at most once per 24 hours, fetch each file under `content/` from the raw GitHub URL.
- Validate each card against the schema in JS. **If validation fails, keep the cached copy** and log it. A bad push must never break the installed app.
- The app ships with `content/seed.json` so first load works before any fetch.

---

## 4. Build phases

### Phase 1 — Card page, static
`index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`. Load bundled seed cards, pick one at random, render the full card page including the Test me reveal. KaTeX from CDN, cached by the service worker. Installable to the home screen.

### Phase 2 — Scheduling and navigation
`scheduler.js` and `queue.js` as pure functions with tests. localStorage review state. Daily queue, next and previous, grading.

### Phase 3 — Content seeded from the tracker
See section 6.

### Phase 4 — Sync from GitHub

### Phase 5 — Stats
Streak, cards reviewed, accuracy by category, weakest stages. A simple per-stage progress bar mirroring the tracker.

### Phase 6 — Free-text grading (optional)
API key in localStorage, entered in settings. Type an answer, Anthropic API grades it against `answer_points`, returns 0-5 plus one line on what was missed. Button-triggered only. Score 4-5 = `got`, 2-3 = `fuzzy`, 0-1 = `forgot`.

---

## 5. Tech stack

- Plain HTML, CSS, vanilla JS. No framework, no bundler, no npm for the app itself.
- KaTeX from `cdn.jsdelivr.net`, precached by the service worker for offline formula rendering.
- Service worker: app shell cache-first, content stale-while-revalidate.
- Hosted on GitHub Pages (HTTPS is required for PWA install).
- Dev tooling in Python on the laptop: `openpyxl`, `pydantic`.

Keep the app to four files plus the manifest. If `app.js` passes ~800 lines, split by concern (`scheduler.js`, `queue.js`, `render.js`) — still no bundler, just ES modules.

---

## 6. Content pipeline

### 6.1 Seeding from the tracker

`scripts/seed_from_tracker.py` reads `Master_Interview_Prep_Tracker.xlsx` and emits one **stub** card per row into `content/stubs.json`:

- Sheet `Tracker 1 — LLM Learning` → stage from the Stage column, category mapped from stage
- Sheet `Inference Engineering` → category `inference`, stage from the `I*` code
- Sheet `Fine-Tuning` → category `peft`, stage from the `F*` code
- Sheet `Tracker 2 — DSA+SysD+Proj` → categories `dsa`, `system-design`, `behavioral`
- Sheet `Formulas` → `type: "formula"`, one card per row, `formula` from the Formula column, key numbers into `example`

A stub carries `id`, `type`, `stage`, `category`, `topic`, and the raw tracker text (Theory / Math / Code columns) in a temporary `_source` field. It is **not** a finished card.

### 6.2 Filling stubs

Claude Code turns stubs into cards in batches of 10, using `_source` as raw material, then deletes `_source`. Batching matters — quality drops sharply past about 10 cards per invocation.

```bash
claude -p "Read content/stubs.json. Take the first 10 stubs with status unfilled. \
For each, write concept, example, interview_question, and answer_points per the card \
authoring standards in CLAUDE.md, using the _source field as raw material. \
Every example needs real numbers. Move finished cards to content/cards.json, \
remove _source, and delete them from stubs.json. \
Then run python scripts/validate.py." \
  --allowedTools "Read,Write,Edit,Bash(python scripts/validate.py)" \
  --output-format json --max-turns 25 --max-budget-usd 1.00
```

Ten cards per run, a few runs a week, and the full tracker is covered in about a month — while you are already using the app on the cards that exist.

### 6.3 Coverage
`python scripts/coverage.py` prints, per stage, how many stubs are unfilled and how many cards exist. This is the progress view that replaces the tracker's Status column.

### 6.4 Git rules
- Validation gates the commit. If `validate.py` exits non-zero, nothing is pushed.
- Generated content goes to a branch `content/YYYY-MM-DD`, never straight to main. Review the diff on GitHub, merge from the phone, and the app picks it up on next sync.
- Git credentials must already be configured. Claude Code uses existing git auth.
- Never `--dangerously-skip-permissions` on a script that pushes.

### 6.5 Bulk editing
```
python scripts/csv_tool.py export    # content/*.json -> cards.csv
python scripts/csv_tool.py import    # cards.csv -> content/*.json, validates, fails loud
```
Spreadsheet for bulk cleanup, JSON stays the committed source of truth. Never commit the CSV.

---

## 7. Repo layout

```
.
├── CLAUDE.md
├── SPEC.md
├── index.html
├── app.js
├── scheduler.js
├── queue.js
├── styles.css
├── sw.js
├── manifest.webmanifest
├── content/
│   ├── cards.json          finished cards
│   ├── stubs.json          unfilled stubs from the tracker
│   └── seed.json           bundled subset for first load
├── scripts/
│   ├── seed_from_tracker.py
│   ├── schema.py           pydantic card model
│   ├── validate.py
│   ├── coverage.py
│   └── csv_tool.py
├── tests/
│   └── scheduler.test.js
└── tracker/
    └── Master_Interview_Prep_Tracker.xlsx
```

The schema is defined twice — `scripts/schema.py` (pydantic, laptop) and the validator in `app.js` (browser). Any field change touches both in the same commit.

---

## 8. Topic source

The master topic list is the tracker workbook, not this document. It contains:

- **Tracker 1 — LLM Learning**, 99 rows across Stages 0-16: math prereqs, neural net foundations, tokenization and embeddings, attention, positional encoding, transformer block, GPT decoder, efficient attention, training at scale, PEFT, alignment, quantization and inference, modern architectures, distributed training, classical ML and stats and recsys, production synthesis, safety and agents.
- **Inference Engineering**, 53 rows across I0-I12: prefill vs decode, GPU architecture and roofline, transformer inference math, KV cache, attention kernels, batching and scheduling, quantization, decoding optimizations, multi-GPU, serving systems, production ops, frontier topics, capstone.
- **Fine-Tuning**, F0 onward: the post-training pipeline, data and loss masking, SFT, LoRA and QLoRA.
- **Tracker 2 — DSA + SysD + Proj**, 20+ rows of coding patterns.
- **Formulas**, 28 rows with priority stars — each becomes a `type: "formula"` card. The starred ones are the highest-value cards in the whole deck.

Prioritise generation in this order: Formulas sheet first (highest density of interview value), then Inference Engineering, then Tracker 1 Stages 3-11, then everything else.

---

## 9. Definition of done for v1

- Installs to the Android home screen and opens full screen with no browser chrome.
- Works with no network after first load.
- Card page renders concept, formula, example, and reveals question and answer points in place.
- Daily queue, next and previous, and grading all work and persist across sessions.
- Formulas render correctly with KaTeX, including subscripts and Greek letters.
- Scheduler and queue have passing unit tests.
- At least the full Formulas sheet plus 40 inference cards are filled.
