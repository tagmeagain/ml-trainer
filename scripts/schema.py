"""Pydantic card model — the laptop-side source of truth for the card schema.

Mirrors SPEC.md section 2. The browser-side validator in app.js must be kept in
step with this file; any field change touches both in the same commit.

Two models live here:

  Card  — a finished card. Strict. Extra fields are rejected, which is what
          stops a stray `_source` from ever reaching content/cards.json.
  Stub  — an unfilled row seeded from the tracker (SPEC 6.1). Carries only the
          identity fields plus `_source`, and is deliberately NOT a Card.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# --------------------------------------------------------------------------
# Vocabularies
# --------------------------------------------------------------------------

# SPEC 2 "Categories" — mirrors the tracker so coverage maps one-to-one.
CATEGORIES: tuple[str, ...] = (
    "math-prereq",
    "nn-foundations",
    "tokenization",
    "attention",
    "positional",
    "transformer-block",
    "decoder",
    "efficient-attention",
    "training-scale",
    "peft",
    "alignment",
    "inference",
    "architectures",
    "distributed",
    "classical-ml",
    "production",
    "safety-agents",
    "dsa",
    "system-design",
    "behavioral",
)

Category = Literal[
    "math-prereq",
    "nn-foundations",
    "tokenization",
    "attention",
    "positional",
    "transformer-block",
    "decoder",
    "efficient-attention",
    "training-scale",
    "peft",
    "alignment",
    "inference",
    "architectures",
    "distributed",
    "classical-ml",
    "production",
    "safety-agents",
    "dsa",
    "system-design",
    "behavioral",
]

CardType = Literal["concept", "formula"]
Difficulty = Literal["easy", "mid", "hard"]

# SPEC 2: tracker stage codes, e.g. S0, S3, I3, F1, D, SD, B.
#   S0-S16   Tracker 1 — LLM Learning
#   I0-I12   Inference Engineering
#   F0-F10   Fine-Tuning (plus the F5B sub-stage the tracker actually uses)
#   D        DSA           SD  System Design          B  Behavioural / projects
STAGE_RE = re.compile(r"^(?:S(?:[0-9]|1[0-6])|I(?:[0-9]|1[0-2])|F(?:[0-9]|10|5B)|D|SD|B)$")

# SPEC 2: id is `{category}-{topic-slug}-{nnn}`. Permanent, review history is
# keyed on it. The category prefix is re-checked against the `category` field
# in a model validator so the two can never drift apart.
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-\d{3}$")

CONCEPT_MAX_WORDS = 120

# SPEC 2 / CLAUDE.md: every example must contain real numbers worked through.
_HAS_DIGIT_RE = re.compile(r"\d")


def slugify(text: str) -> str:
    """Tracker topic text -> the `topic-slug` segment of a card id."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug)


# --------------------------------------------------------------------------
# Finished card
# --------------------------------------------------------------------------


class Card(BaseModel):
    """A finished, publishable card."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str
    type: CardType
    stage: str
    category: Category
    topic: str = Field(min_length=1)
    difficulty: Difficulty
    formula: str | None = None
    concept: str = Field(min_length=1)
    example: str = Field(min_length=1)
    interview_question: str = Field(min_length=1)
    answer_points: list[str] = Field(min_length=3, max_length=5)
    tags: list[str] | None = None
    source_link: str | None = None

    # -- field-level rules -------------------------------------------------

    @field_validator("id")
    @classmethod
    def _id_format(cls, v: str) -> str:
        if not ID_RE.match(v):
            raise ValueError(
                f"id {v!r} must be {{category}}-{{topic-slug}}-{{nnn}}, "
                "lowercase a-z0-9 and hyphens, ending in exactly three digits"
            )
        return v

    @field_validator("stage")
    @classmethod
    def _stage_format(cls, v: str) -> str:
        if not STAGE_RE.match(v):
            raise ValueError(
                f"stage {v!r} is not a known tracker stage code "
                "(S0-S16, I0-I12, F0-F10/F5B, D, SD, B)"
            )
        return v

    @field_validator("concept")
    @classmethod
    def _concept_length(cls, v: str) -> str:
        words = len(v.split())
        if words >= CONCEPT_MAX_WORDS:
            raise ValueError(f"concept is {words} words, must be under {CONCEPT_MAX_WORDS}")
        return v

    @field_validator("example")
    @classmethod
    def _example_has_numbers(cls, v: str) -> str:
        if not _HAS_DIGIT_RE.search(v):
            raise ValueError(
                "example must contain real numbers worked through "
                "(a model name, actual dimensions, an actual result)"
            )
        return v

    @field_validator("answer_points")
    @classmethod
    def _answer_points_nonempty(cls, v: list[str]) -> list[str]:
        for i, point in enumerate(v):
            if not point.strip():
                raise ValueError(f"answer_points[{i}] is empty")
        return v

    @field_validator("formula")
    @classmethod
    def _formula_not_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("formula is present but blank; omit the field instead")
        return v

    # -- cross-field rules -------------------------------------------------

    @model_validator(mode="after")
    def _formula_required_for_formula_cards(self) -> "Card":
        """SPEC 2: `formula` is required when `type` is `formula`."""
        if self.type == "formula" and not self.formula:
            raise ValueError('type is "formula" so the `formula` field is required')
        return self

    @model_validator(mode="after")
    def _id_starts_with_category(self) -> "Card":
        """The id's leading segment(s) must be the card's category."""
        if not self.id.startswith(self.category + "-"):
            raise ValueError(
                f"id {self.id!r} must start with its category {self.category!r} "
                f"(expected {self.category}-{{topic-slug}}-{{nnn}})"
            )
        # Guard against `inference-...` masquerading for a longer category name.
        remainder = self.id[len(self.category) + 1 :]
        if not remainder or remainder[0] == "-":
            raise ValueError(f"id {self.id!r} has an empty topic-slug segment")
        return self


# --------------------------------------------------------------------------
# Stub
# --------------------------------------------------------------------------


class Stub(BaseModel):
    """An unfilled tracker row (SPEC 6.1). Not a finished card.

    Note the `_source` alias dance: pydantic treats leading-underscore names as
    private, so the field is `source` in Python and `_source` on the wire.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True, str_strip_whitespace=True)

    id: str
    type: CardType
    stage: str
    category: Category
    topic: str = Field(min_length=1)
    source: str | None = Field(default=None, alias="_source")
    # Formulas-sheet stubs arrive with the raw formula text and its priority
    # stars already attached; both are raw material for the fill step.
    formula: str | None = None
    priority: str | None = None

    _id_format = field_validator("id")(Card._id_format.__func__)  # type: ignore[attr-defined]
    _stage_format = field_validator("stage")(Card._stage_format.__func__)  # type: ignore[attr-defined]

    @model_validator(mode="after")
    def _id_starts_with_category(self) -> "Stub":
        if not self.id.startswith(self.category + "-"):
            raise ValueError(
                f"id {self.id!r} must start with its category {self.category!r}"
            )
        return self
