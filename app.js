/* ML Trainer — Phase 1.
 *
 * Load the bundled cards, validate them, show one at random, and reveal the
 * question and answer points in place on the same page.
 *
 * Deliberately not here yet: Leitner scheduling, the daily queue, grading, and
 * background sync from GitHub. Those are Phases 2 and 4 and get their own
 * modules (scheduler.js, queue.js) so this file stays readable.
 */

const CONTENT_URL = "content/cards.json";
const CACHE_KEY = "cards:v1"; // last known-good content, per SPEC 3.5

// ---------------------------------------------------------------- schema
//
// The browser-side mirror of scripts/schema.py. SPEC 7: the schema is defined
// twice on purpose, and any field change touches both in the same commit.
// A bad content push must never break the installed app, so this validator
// rejects individual bad cards rather than throwing.

const CATEGORIES = new Set([
  // Tracker 1 — the core LLM path
  "math-prereq", "nn-foundations", "tokenization", "attention", "positional",
  "transformer-block", "decoder", "efficient-attention", "training-scale",
  "architectures", "distributed", "classical-ml", "production", "safety-agents",
  // Fine-Tuning
  "post-training", "ft-data", "sft", "peft", "reward-modeling", "rlhf", "dpo",
  "alignment", "distillation", "training-systems", "eval",
  // Inference Engineering
  "inference", "inference-math", "gpu-arch", "kv-cache", "attention-kernels",
  "batching", "quantization", "decoding", "distributed-inference", "serving",
  // Tracker 2
  "dsa", "system-design", "behavioral",
]);
const TYPES = new Set(["concept", "formula"]);
const DIFFICULTIES = new Set(["easy", "mid", "hard"]);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{3}$/;
const STAGE_RE = /^(?:S(?:[0-9]|1[0-6])|I(?:[0-9]|1[0-2])|F(?:[0-9]|10|5B)|D|SD|B)$/;
const CONCEPT_MAX_WORDS = 120;

const isText = (v) => typeof v === "string" && v.trim().length > 0;

/** @returns {string|null} the reason it is invalid, or null when it is fine. */
function cardError(c) {
  if (typeof c !== "object" || c === null) return "not an object";
  if (!isText(c.id) || !ID_RE.test(c.id)) return "bad id";
  if (!TYPES.has(c.type)) return "bad type";
  if (!isText(c.stage) || !STAGE_RE.test(c.stage)) return "bad stage";
  if (!CATEGORIES.has(c.category)) return "bad category";
  if (!c.id.startsWith(c.category + "-")) return "id does not match category";
  if (!isText(c.topic)) return "missing topic";
  if (!DIFFICULTIES.has(c.difficulty)) return "bad difficulty";
  if (!isText(c.concept)) return "missing concept";
  if (c.concept.split(/\s+/).length >= CONCEPT_MAX_WORDS) return "concept too long";
  if (!isText(c.example)) return "missing example";
  if (!/\d/.test(c.example)) return "example has no numbers";
  if (!isText(c.interview_question)) return "missing interview_question";
  if (!Array.isArray(c.answer_points)) return "answer_points not an array";
  if (c.answer_points.length < 3 || c.answer_points.length > 5) {
    return "answer_points must be 3-5";
  }
  if (!c.answer_points.every(isText)) return "empty answer point";
  if (c.type === "formula" && !isText(c.formula)) return "formula card has no formula";
  if (c.formula !== undefined && c.formula !== null && !isText(c.formula)) {
    return "blank formula";
  }
  return null;
}

/** Split a payload into the cards worth showing and a list of complaints. */
function validateDeck(raw) {
  if (!Array.isArray(raw)) return { cards: [], problems: ["payload is not an array"] };
  const cards = [];
  const problems = [];
  for (const c of raw) {
    const err = cardError(c);
    if (err) problems.push(`${c && c.id ? c.id : "<no id>"}: ${err}`);
    else cards.push(c);
  }
  return { cards, problems };
}

// --------------------------------------------------------------- loading

async function loadDeck() {
  let raw = null;
  let source = "network";

  try {
    const res = await fetch(CONTENT_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (err) {
    console.warn("content fetch failed, falling back to last known good", err);
    raw = null;
  }

  if (raw !== null) {
    const { cards, problems } = validateDeck(raw);
    if (problems.length) console.warn(`${problems.length} invalid card(s)`, problems);

    // Only trust the new payload if enough of it survived validation. A push
    // that breaks most of the deck keeps the cached copy instead.
    if (cards.length > 0) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cards));
      } catch (err) {
        console.warn("could not cache deck", err);
      }
      return { cards, problems, source };
    }
    console.warn("new content had no usable cards; keeping the cached copy");
  }

  source = "cache";
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    const { cards, problems } = validateDeck(cached);
    return { cards, problems, source };
  } catch {
    return { cards: [], problems: ["no cached content"], source };
  }
}

// -------------------------------------------------------------- rendering

const el = (id) => document.getElementById(id);

const $card = el("card");
const $category = el("category");
const $stage = el("stage");
const $position = el("position");
const $topic = el("topic");
const $difficulty = el("difficulty");
const $formula = el("formula");
const $concept = el("concept");
const $example = el("example");
const $reveal = el("reveal");
const $question = el("question");
const $questionText = el("question-text");
const $answers = el("answers");
const $answerList = el("answer-list");
const $prev = el("prev");
const $next = el("next");
const $barLabel = el("bar-label");
const $banner = el("banner");

const CATEGORY_LABEL = {
  "math-prereq": "math", "nn-foundations": "neural nets",
  "tokenization": "tokenization", "attention": "attention",
  "positional": "positional", "transformer-block": "block",
  "decoder": "decoder", "efficient-attention": "efficient attn",
  "training-scale": "scaling", "architectures": "architectures",
  "distributed": "distributed", "classical-ml": "classical ml",
  "production": "production", "safety-agents": "safety",
  "post-training": "post-training", "ft-data": "ft data", "sft": "sft",
  "peft": "peft", "reward-modeling": "reward model", "rlhf": "rlhf",
  "dpo": "dpo", "alignment": "alignment", "distillation": "distillation",
  "training-systems": "train systems", "eval": "eval",
  "inference": "inference", "inference-math": "inference math",
  "gpu-arch": "gpu", "kv-cache": "kv cache",
  "attention-kernels": "attn kernels", "batching": "batching",
  "quantization": "quantization", "decoding": "decoding",
  "distributed-inference": "multi-gpu", "serving": "serving",
  "dsa": "dsa", "system-design": "sys design", "behavioral": "behavioral",
};

/* A long formula on a 412px phone would otherwise need sideways scrolling,
 * which ruins a 30-second card. Shrink it to fit instead, down to a floor
 * below which it would stop being readable — past that, scrolling is the
 * lesser evil and the CSS overflow takes over. */
const FORMULA_MIN_SCALE = 0.55;

function fitFormula() {
  if ($formula.hidden) return;
  $formula.style.fontSize = "";           // measure at natural size
  const available = $formula.clientWidth;
  const needed = $formula.scrollWidth;
  if (available > 0 && needed > available) {
    const scale = Math.max(FORMULA_MIN_SCALE, (available / needed) * 0.98);
    $formula.style.fontSize = `${scale}em`;
  }
}

/* Measuring before the KaTeX webfonts land gives fallback-font widths, which
 * are wrong — the formula then overflows once the real glyphs arrive. Re-fit
 * once fonts are ready. After the first card they are cached and this is a
 * no-op. */
function fitFormulaWhenReady() {
  fitFormula();
  if (document.fonts && document.fonts.status !== "loaded") {
    document.fonts.ready.then(fitFormula);
  }
}

/** Render LaTeX, degrading to readable raw text rather than blanking. */
function renderFormula(latex) {
  if (!isText(latex)) {
    $formula.hidden = true;
    $formula.textContent = "";
    return;
  }
  $formula.hidden = false;
  $formula.textContent = "";

  if (typeof window.katex === "undefined") {
    // KaTeX has not loaded (first paint, or offline before precache landed).
    const pre = document.createElement("div");
    pre.className = "raw";
    pre.textContent = latex;
    $formula.appendChild(pre);
    fitFormulaWhenReady();
    return;
  }

  try {
    window.katex.render(latex, $formula, {
      displayMode: true,
      throwOnError: false, // a malformed formula degrades, never blanks the card
      strict: false,
      trust: false,
    });
    fitFormulaWhenReady();
  } catch (err) {
    console.warn("katex failed outright", err);
    const pre = document.createElement("div");
    pre.className = "raw";
    pre.textContent = latex;
    $formula.appendChild(pre);
    fitFormulaWhenReady();
  }
}

/** Reveal state: 0 = card only, 1 = + question, 2 = + answer points. */
let revealStep = 0;

function applyReveal() {
  $question.hidden = revealStep < 1;
  $answers.hidden = revealStep < 2;

  if (revealStep === 0) {
    $reveal.hidden = false;
    $reveal.textContent = "Test me";
  } else if (revealStep === 1) {
    $reveal.hidden = false;
    $reveal.textContent = "Show answer points";
  } else {
    $reveal.hidden = true;
  }
}

function renderCard(card, index, total) {
  $category.textContent = CATEGORY_LABEL[card.category] || card.category;
  $stage.textContent = card.stage;
  $position.textContent = `${index + 1} / ${total}`;

  $topic.textContent = card.topic;
  $difficulty.textContent = card.difficulty;
  $difficulty.dataset.level = card.difficulty;

  renderFormula(card.formula);

  $concept.textContent = "";
  const conceptP = document.createElement("p");
  conceptP.textContent = card.concept;
  $concept.appendChild(conceptP);

  $example.textContent = "";
  const exampleP = document.createElement("p");
  exampleP.textContent = card.example;
  $example.appendChild(exampleP);

  $questionText.textContent = card.interview_question;

  $answerList.textContent = "";
  for (const point of card.answer_points) {
    const li = document.createElement("li");
    li.textContent = point;
    $answerList.appendChild(li);
  }

  revealStep = 0;
  applyReveal();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function showBanner(message) {
  $banner.textContent = message;
  $banner.hidden = false;
}

function showEmptyState(problems) {
  $topic.textContent = "No cards available";
  $category.textContent = "setup";
  $stage.textContent = "—";
  $position.textContent = "";
  $difficulty.textContent = "";
  $formula.hidden = true;
  $concept.textContent =
    "content/cards.json could not be loaded or contained no valid cards. " +
    "Run python scripts/validate.py on the laptop to see why.";
  $example.hidden = true;
  $reveal.hidden = true;
  if (problems.length) showBanner(problems.slice(0, 3).join(" · "));
}

// ------------------------------------------------------------------ app

/* Phase 1 navigation: a shuffled deck, walked with the arrows. Phase 2
 * replaces this wholesale with the daily queue from queue.js. */
function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function main() {
  const { cards, problems, source } = await loadDeck();

  if (cards.length === 0) {
    showEmptyState(problems);
    return;
  }

  const deck = shuffle(cards);
  let index = 0;

  const show = () => {
    renderCard(deck[index], index, deck.length);
    $prev.disabled = index === 0;
    $next.disabled = index === deck.length - 1;
    $barLabel.textContent = deck[index].type === "formula" ? "formula" : "concept";
  };

  $reveal.addEventListener("click", () => {
    if (revealStep < 2) revealStep += 1;
    applyReveal();
  });

  $prev.addEventListener("click", () => {
    if (index > 0) { index -= 1; show(); }
  });

  $next.addEventListener("click", () => {
    if (index < deck.length - 1) { index += 1; show(); }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") $prev.click();
    else if (e.key === "ArrowRight") $next.click();
    else if (e.key === " " || e.key === "Enter") {
      if (document.activeElement !== $reveal && !$reveal.hidden) {
        e.preventDefault();
        $reveal.click();
      }
    }
  });

  show();

  if (source === "cache") {
    showBanner("Offline — showing the last known-good deck.");
  } else if (problems.length) {
    showBanner(`${problems.length} card(s) failed validation and were skipped.`);
  }

  // KaTeX is deferred, so the first card may paint before it is ready.
  // Re-render the formula once it arrives.
  if (typeof window.katex === "undefined") {
    window.addEventListener("load", () => renderFormula(deck[index].formula), { once: true });
  }
}

main();

// Rotating the phone changes the width the formula must fit into.
window.addEventListener("resize", fitFormula);

// ------------------------------------------------------- service worker

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("service worker registration failed", err);
    });
  });
}
