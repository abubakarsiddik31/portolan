from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TASKS = REPO_ROOT / "bench/tasks/dev"
PLACEHOLDER = re.compile(r"\{([a-zA-Z0-9_]+)\}")


@dataclass(frozen=True)
class Task:
    id: str
    template_id: str
    site: str
    goal: str
    start: str
    max_steps: int
    values: dict[str, str]
    success: dict[str, Any]


def fill(text: str, values: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in values:
            raise ValueError(f"missing task param {key!r}")
        return values[key]

    return PLACEHOLDER.sub(replace, text)


def fill_success(success: dict[str, Any], values: dict[str, str]) -> dict[str, Any]:
    filled: dict[str, Any] = {}
    if "url_matches" in success:
        filled["url_matches"] = fill(success["url_matches"], values)
    if "dom" in success:
        filled["dom"] = fill(success["dom"], values)
    if "extracted" in success:
        filled["extracted"] = {
            key: fill(selector, values) for key, selector in success["extracted"].items()
        }
    if "download" in success:
        filled["download"] = {
            key: fill(value, values) for key, value in success["download"].items()
        }
    return filled


def load_tasks(directory: str | Path | None = None) -> list[Task]:
    root = Path(directory) if directory is not None else DEFAULT_TASKS
    tasks: list[Task] = []

    for path in sorted(root.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        site = data["site"]
        for template in data["templates"]:
            for index, values in enumerate(template["params"]):
                tasks.append(
                    Task(
                        id=f"{template['id']}#{index + 1}",
                        template_id=template["id"],
                        site=site,
                        goal=fill(template["goal"], values),
                        start=template["start"],
                        max_steps=template["max_steps"],
                        values=values,
                        success=fill_success(template["success"], values),
                    )
                )

    return tasks
