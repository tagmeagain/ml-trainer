#!/usr/bin/env python3
"""Validate every JSON file under content/ against the pydantic models.

    python scripts/validate.py

Exit code 0 means every card and stub parsed and every cross-file invariant
held. Non-zero means something failed, and per CLAUDE.md that gates the commit:
stop and report, do not loosen the schema to make it pass.

Errors are fatal. Warnings are style notes against the authoring standards in
CLAUDE.md; they are printed but do not change the exit code, because the fix is
to rewrite the card, never to relax the model.
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from pydantic import ValidationError

from schema import Card, Stub, Thread

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

# Files whose entries are stubs rather than finished cards.
STUB_FILES = {"stubs.json"}

# Files whose entries are threads: ordering over cards, not cards themselves.
THREAD_FILES = {"threads.json"}

# CLAUDE.md: "interview_question is a scenario, not a definition prompt."
DEFINITION_PROMPT_RE = re.compile(
    r"^\s*(what\s+(is|are|does|do)\b|define\b|describe\b|explain\s+what\b|name\s+the\b)",
    re.IGNORECASE,
)

# Literal "\\u00b7" text instead of the character it encodes. Happens when a
# generated batch double-escapes its JSON, and it renders as visible garbage.
LITERAL_ESCAPE_RE = re.compile(r"\\u[0-9a-fA-F]{4}")

# A rough tell for a vague example: no digits is already fatal in the schema,
# but hedge words with only a token number are the usual near-miss.
VAGUE_EXAMPLE_RE = re.compile(
    r"\b(significant|large amounts?|a lot of|much (?:more|less)|many|various)\b",
    re.IGNORECASE,
)


def _fmt(err: ValidationError, where: str) -> list[str]:
    out = []
    for e in err.errors():
        loc = ".".join(str(p) for p in e["loc"]) or "(root)"
        out.append(f"{where}: {loc}: {e['msg']}")
    return out


def main() -> int:
    if not CONTENT.is_dir():
        print(f"error: no content directory at {CONTENT}", file=sys.stderr)
        return 2

    files = sorted(CONTENT.glob("*.json"))
    if not files:
        print(f"error: no JSON files under {CONTENT}", file=sys.stderr)
        return 2

    errors: list[str] = []
    warnings: list[str] = []
    ids_seen: dict[str, str] = {}          # id -> "file[index]"
    counts: dict[str, int] = {}
    cards_by_file: dict[str, list[Card]] = defaultdict(list)
    threads: list[tuple[str, Thread]] = []  # ("file[index]", thread)

    for path in files:
        rel = path.relative_to(ROOT)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"{rel}: not valid JSON: {exc}")
            counts[path.name] = 0
            continue

        if not isinstance(raw, list):
            errors.append(f"{rel}: top level must be a JSON array of objects")
            counts[path.name] = 0
            continue

        if path.name in THREAD_FILES:
            model = Thread
        elif path.name in STUB_FILES:
            model = Stub
        else:
            model = Card
        counts[path.name] = len(raw)

        for i, entry in enumerate(raw):
            where = f"{rel}[{i}]"
            if not isinstance(entry, dict):
                errors.append(f"{where}: entry is {type(entry).__name__}, expected object")
                continue
            try:
                obj = model.model_validate(entry)
            except ValidationError as exc:
                ident = entry.get("id", "<no id>")
                errors.extend(_fmt(exc, f"{where} id={ident}"))
                continue

            if isinstance(obj, Thread):
                # Thread ids live in their own namespace — they name an arc,
                # not a card — so they are deliberately not added to ids_seen.
                threads.append((where, obj))
                continue

            # -- ids are permanent and must be globally unique --------------
            prior = ids_seen.get(obj.id)
            if prior is not None:
                errors.append(f"{where}: duplicate id {obj.id!r}, already used at {prior}")
            else:
                ids_seen[obj.id] = where

            if isinstance(obj, Card):
                cards_by_file[path.name].append(obj)
                _lint_card(obj, where, warnings)

    # -- cross-file: threads must point at cards that exist -----------------
    card_ids = {c.id for cards in cards_by_file.values() for c in cards}
    _check_threads(threads, card_ids, ids_seen, errors, warnings)

    # -- report ------------------------------------------------------------
    for name in sorted(counts):
        if name in THREAD_FILES:
            kind = "threads"
        elif name in STUB_FILES:
            kind = "stubs"
        else:
            kind = "cards"
        print(f"  {name:<16} {counts[name]:>4} {kind}")
    total_cards = sum(len(v) for v in cards_by_file.values())
    print(f"  {'':<16} {'':>4} ---")
    print(f"  {'valid cards':<16} {total_cards:>4}")

    if warnings:
        print(f"\n{len(warnings)} warning(s):", file=sys.stderr)
        for w in warnings:
            print(f"  warn: {w}", file=sys.stderr)

    if errors:
        print(f"\n{len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print(f"  {e}", file=sys.stderr)
        print("\nFAILED", file=sys.stderr)
        return 1

    print("\nOK")
    return 0


def _check_threads(
    threads: list[tuple[str, Thread]],
    card_ids: set[str],
    ids_seen: dict[str, str],
    errors: list[str],
    warnings: list[str],
) -> None:
    """Cross-file thread invariants.

    The browser-side validator in queue.js deliberately tolerates a thread that
    names a card which does not exist — a bad content push must not break the
    installed app. That tolerance is a runtime safety net, not a licence: on the
    laptop an unresolvable reference is an error, because it is always a typo or
    a card that was renamed in violation of the permanent-id rule.
    """
    if not threads:
        return

    seen_thread_ids: dict[str, str] = {}
    threaded: set[str] = set()

    for where, thread in threads:
        prior = seen_thread_ids.get(thread.id)
        if prior is not None:
            errors.append(
                f"{where}: duplicate thread id {thread.id!r}, already used at {prior}"
            )
        else:
            seen_thread_ids[thread.id] = where

        for j, entry in enumerate(thread.cards):
            if entry.id in card_ids:
                threaded.add(entry.id)
                continue
            if entry.id in ids_seen:
                errors.append(
                    f"{where}.cards[{j}]: {entry.id!r} is a stub, not a finished card, "
                    "so it has nothing to render"
                )
            else:
                errors.append(
                    f"{where}.cards[{j}]: references unknown card {entry.id!r}"
                )

    # Coverage note, not a failure: unthreaded cards still reach the queue via
    # the stage-ordered tail. It is just useful to know how much has a story.
    loose = len(card_ids) - len(threaded)
    if loose:
        warnings.append(
            f"{loose} of {len(card_ids)} cards belong to no thread and will appear "
            "in plain stage order"
        )


def _lint_card(card: Card, where: str, warnings: list[str]) -> None:
    """Style checks against CLAUDE.md's authoring standards. Non-fatal."""
    for field in ("concept", "example", "interview_question", "topic"):
        if LITERAL_ESCAPE_RE.search(getattr(card, field)):
            warnings.append(f"{where} id={card.id}: {field} contains a literal "
                            "\\uXXXX escape instead of the character")
    for i, point in enumerate(card.answer_points):
        if LITERAL_ESCAPE_RE.search(point):
            warnings.append(f"{where} id={card.id}: answer_points[{i}] contains a "
                            "literal \\uXXXX escape")
    if DEFINITION_PROMPT_RE.match(card.interview_question):
        warnings.append(
            f"{where} id={card.id}: interview_question reads as a definition prompt, "
            "not a scenario"
        )
    if VAGUE_EXAMPLE_RE.search(card.example):
        warnings.append(
            f"{where} id={card.id}: example uses vague quantity language; "
            "prefer concrete worked numbers"
        )
    if card.type == "formula" and card.formula and "\\" not in card.formula:
        warnings.append(
            f"{where} id={card.id}: formula card has no LaTeX commands, "
            "check it is not raw unicode maths"
        )
    # "No card is answerable by restating concept back."
    q_words = {w for w in re.findall(r"[a-z]{5,}", card.interview_question.lower())}
    c_words = {w for w in re.findall(r"[a-z]{5,}", card.concept.lower())}
    if q_words and len(q_words & c_words) / len(q_words) > 0.8:
        warnings.append(
            f"{where} id={card.id}: interview_question overlaps concept heavily; "
            "it may be answerable by restating concept"
        )


if __name__ == "__main__":
    sys.exit(main())
