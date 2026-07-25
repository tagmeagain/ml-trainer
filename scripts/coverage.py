#!/usr/bin/env python3
"""Per-stage coverage: how many stubs are still unfilled, how many cards exist.

    python scripts/coverage.py

This is the progress view that replaces the tracker's Status column (SPEC 6.3).
It reads content/ leniently — an entry that fails validation is still counted so
the numbers stay honest while cards are mid-edit. Use validate.py to gate.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

STAGE_LABELS = {
    "S0": "Math & ML Prereqs",
    "S1": "Neural Net Foundations",
    "S2": "Tokenization & Embeddings",
    "S3": "Attention (the core)",
    "S4": "Positional Encoding",
    "S5": "Transformer Block",
    "S6": "GPT / Decoder",
    "S7": "Efficient Attention",
    "S8": "Training at Scale",
    "S9": "Fine-Tuning / PEFT",
    "S10": "Alignment (RLHF / DPO)",
    "S11": "Quantization & Inference",
    "S12": "Modern Architectures",
    "S13": "Distributed Training",
    "S14": "Classical ML + Stats + Recsys",
    "S15": "Production & Synthesis",
    "S16": "Safety, Agents & Company Prep",
    "I0": "Foundations & Mental Model",
    "I1": "GPU Architecture & Roofline",
    "I2": "Transformer Inference Math",
    "I3": "KV Cache",
    "I4": "Attention Kernels",
    "I5": "Batching & Scheduling",
    "I6": "Quantization for Inference",
    "I7": "Decoding Optimizations",
    "I8": "Multi-GPU & Distributed Inference",
    "I9": "Serving Systems & Frameworks",
    "I10": "Production Inference Ops",
    "I11": "Advanced / Frontier",
    "I12": "Capstone & Synthesis",
    "F0": "Landscape & Mental Model",
    "F1": "Data",
    "F2": "SFT",
    "F3": "PEFT (LoRA & Family)",
    "F4": "Reward Modeling",
    "F5": "RLHF / PPO",
    "F5B": "GRPO Family & Modern RL",
    "F6": "DPO & Direct Preference",
    "F7": "Advanced Alignment & RL",
    "F8": "Distillation & Specialized FT",
    "F9": "Training Systems & Memory",
    "F10": "Evaluation & Synthesis",
    "D": "DSA — Coding Patterns",
    "SD": "System Design",
    "B": "Projects / Behavioural",
}

_GROUP_ORDER = {"S": 0, "I": 1, "F": 2, "D": 3, "SD": 3, "B": 3}


def _stage_key(stage: str) -> tuple:
    """Sort S0..S16, then I0..I12, then F0..F10, then D/SD/B."""
    m = re.match(r"^([A-Z]+)(\d*)([A-Z]*)$", stage)
    if not m:
        return (9, 999, stage)
    letters, digits, suffix = m.groups()
    group = _GROUP_ORDER.get(letters, 8)
    return (group, int(digits) if digits else 0, suffix, letters)


def _load(name: str) -> list[dict]:
    path = CONTENT / name
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"warning: {name} is not valid JSON ({exc}); counted as empty", file=sys.stderr)
        return []
    return [e for e in data if isinstance(e, dict)] if isinstance(data, list) else []


def _bar(done: int, total: int, width: int = 18) -> str:
    if total == 0:
        return " " * width
    filled = round(width * done / total)
    return "█" * filled + "·" * (width - filled)


def main() -> int:
    stubs = _load("stubs.json")
    cards = [c for n in ("cards.json", "seed.json") for c in _load(n)]

    # seed.json is a bundled subset of cards.json; de-duplicate on id.
    seen: set[str] = set()
    unique_cards = []
    for c in cards:
        cid = c.get("id")
        if cid in seen:
            continue
        seen.add(cid)
        unique_cards.append(c)

    stub_by_stage = Counter(s.get("stage", "?") for s in stubs)
    card_by_stage = Counter(c.get("stage", "?") for c in unique_cards)
    stages = sorted(set(stub_by_stage) | set(card_by_stage), key=_stage_key)

    print(f"{'stage':<6} {'':<32} {'cards':>6} {'stubs':>6} {'':<18}")
    print("-" * 72)
    for stage in stages:
        done, todo = card_by_stage[stage], stub_by_stage[stage]
        label = STAGE_LABELS.get(stage, "")[:32]
        print(f"{stage:<6} {label:<32} {done:>6} {todo:>6}  {_bar(done, done + todo)}")

    print("-" * 72)
    total_cards, total_stubs = len(unique_cards), len(stubs)
    total = total_cards + total_stubs
    pct = (100 * total_cards / total) if total else 0.0
    print(f"{'TOTAL':<6} {'':<32} {total_cards:>6} {total_stubs:>6}  {pct:5.1f}% filled")

    by_type = Counter(c.get("type", "?") for c in unique_cards)
    print(f"\nby type:      " + ", ".join(f"{k} {v}" for k, v in sorted(by_type.items())))

    card_by_cat = Counter(c.get("category", "?") for c in unique_cards)
    stub_by_cat = Counter(s.get("category", "?") for s in stubs)
    print("\nby category:")
    for cat in sorted(set(card_by_cat) | set(stub_by_cat)):
        print(f"  {cat:<20} {card_by_cat[cat]:>4} cards  {stub_by_cat[cat]:>4} stubs")

    return 0


if __name__ == "__main__":
    sys.exit(main())
