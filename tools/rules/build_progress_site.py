"""Build the small, static implementation dashboard used by GitHub Pages."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


FIELDS = (
    "code", "name", "setType", "releasedAt", "category", "group", "subgroup",
    "uniqueCards", "implemented", "pending", "percentage",
)


def slim_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep only fields needed by the public chart; pending card text stays private/local."""
    sets = [{field: entry.get(field) for field in FIELDS} for entry in payload.get("sets", [])]
    return {
        "format": "prossh-progress/v1",
        "generatedAt": payload.get("generatedAt"),
        "setCount": payload.get("setCount", len(sets)),
        "membershipCount": payload.get("membershipCount", 0),
        "implementedMembershipCount": payload.get("implementedMembershipCount", 0),
        "percentage": payload.get("percentage", 0),
        "excludedEditions": payload.get("excludedEditions", []),
        "sets": sets,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    slim = slim_payload(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(slim, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Progress site data written: {len(slim['sets']):,} editions -> {args.output}")


if __name__ == "__main__":
    main()
