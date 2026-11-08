from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from dotenv import load_dotenv

from tasks import Task, load_tasks

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RESULTS = REPO_ROOT / "bench/results/baseline.jsonl"


def base_urls() -> dict[str, str]:
    return {
        "store": os.environ.get("STORE_URL", "http://127.0.0.1:4100"),
        "wizard": os.environ.get("WIZARD_URL", "http://127.0.0.1:4101"),
        "portal": os.environ.get("PORTAL_URL", "http://127.0.0.1:4102"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Arm A: the browser-use baseline.")
    parser.add_argument(
        "--provider",
        choices=["anthropic", "openai"],
        default=os.environ.get("BASELINE_PROVIDER", "anthropic"),
    )
    parser.add_argument("--model", default=None, help="Model id; defaults to the provider's env var.")
    parser.add_argument("--task", action="append", default=[], help="Task id or template id. Repeatable.")
    parser.add_argument("--site", choices=["store", "wizard", "portal"], default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--max-steps", type=int, default=None)
    parser.add_argument("--results", default=str(DEFAULT_RESULTS))
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def select_tasks(tasks: list[Task], args: argparse.Namespace) -> list[Task]:
    selected = tasks
    if args.site is not None:
        selected = [task for task in selected if task.site == args.site]
    if args.task:
        wanted = set(args.task)
        selected = [
            task for task in selected if task.id in wanted or task.template_id in wanted
        ]
    if args.limit is not None:
        selected = selected[: args.limit]
    return selected


def resolve_model(args: argparse.Namespace) -> str:
    if args.model:
        return args.model
    env_name = "ANTHROPIC_MODEL" if args.provider == "anthropic" else "OPENAI_MODEL"
    model = os.environ.get(env_name)
    if not model:
        raise SystemExit(f"set {env_name} or pass --model")
    return model


def build_llm(provider: str, model: str) -> Any:
    from browser_use import ChatAnthropic, ChatOpenAI

    if provider == "anthropic":
        return ChatAnthropic(model=model)
    return ChatOpenAI(model=model)


def build_browser(headless: bool) -> Any:
    from browser_use import Browser
    from browser_use.browser.chrome import find_chrome_executable

    executable = os.environ.get("CHROME_PATH") or find_chrome_executable()
    if not executable:
        raise SystemExit("Chrome not found; set CHROME_PATH")
    return Browser(executable_path=executable, headless=headless, keep_alive=True)


def browser_use_version() -> str:
    from importlib.metadata import version

    try:
        return version("browser-use")
    except Exception:
        return "unknown"


def append_row(path: str | Path, row: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, separators=(",", ":")) + "\n")


def build_row(
    task: Task,
    args: argparse.Namespace,
    model: str,
    started_at: str,
    duration_ms: int,
    steps: int,
    success: bool,
    detail: str | None,
    usage: Any,
) -> dict[str, Any]:
    input_tokens = int(usage.total_prompt_tokens) if usage else 0
    cached_input_tokens = int(usage.total_prompt_cached_tokens) if usage else 0
    output_tokens = int(usage.total_completion_tokens) if usage else 0
    cost_usd = float(usage.total_cost) if usage else 0.0

    row: dict[str, Any] = {
        "run_id": str(uuid.uuid4()),
        "task_id": task.id,
        "template_id": task.template_id,
        "site": task.site,
        "arm": "A",
        "provider": args.provider,
        "model": model,
        "started_at": started_at,
        "duration_ms": duration_ms,
        "steps": steps,
        "success": success,
        "usage": {
            "input_tokens": input_tokens,
            "cached_input_tokens": cached_input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
        },
        "browser_cost_usd": 0.0,
        "total_cost_usd": cost_usd,
        "notes": f"browser-use {browser_use_version()}; cost from usage summary",
    }
    if detail:
        row["failure_reason"] = detail
    return row


async def check_success(task: Task, browser: Any) -> tuple[bool, str | None]:
    predicate = task.success

    if "download" in predicate:
        return False, "download predicate is not supported by the browser-use arm"

    if "url_matches" in predicate:
        url = await browser.get_current_page_url()
        parsed = urlparse(url)
        path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        if not re.search(predicate["url_matches"], path):
            return False, f"url {path} did not match {predicate['url_matches']}"

    page = await browser.get_current_page()
    if page is None:
        return False, "no current page"

    if "dom" in predicate:
        value = await page.evaluate(f"() => Boolean({predicate['dom']})")
        if str(value).strip().lower() not in {"true", "1"}:
            return False, f"dom predicate failed: {predicate['dom']}"

    if "extracted" in predicate:
        for name, selector in predicate["extracted"].items():
            value = await page.evaluate(
                f"() => document.querySelector({json.dumps(selector)})?.textContent ?? ''"
            )
            text = str(value).strip()
            if text in {"", '""', "''", "null", "undefined"}:
                return False, f"extracted {name} missing"

    return True, None


async def run_task(task: Task, args: argparse.Namespace, model: str, llm: Any) -> dict[str, Any]:
    from browser_use import Agent

    base = base_urls()[task.site]
    task_text = f"Start at {base}{task.start}. {task.goal}"

    started = time.perf_counter()
    started_at = datetime.now(timezone.utc).isoformat()
    steps = 0
    usage = None
    success = False
    detail: str | None = None
    browser = None

    try:
        browser = build_browser(headless=not args.headed)
        agent = Agent(task=task_text, llm=llm, browser=browser)
        history = await agent.run(max_steps=args.max_steps or task.max_steps)
        steps = len(history.history)
        usage = history.usage
        success, detail = await check_success(task, browser)
    except Exception as error:
        detail = f"{type(error).__name__}: {error}"
    finally:
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass

    duration_ms = int((time.perf_counter() - started) * 1000)
    return build_row(
        task=task,
        args=args,
        model=model,
        started_at=started_at,
        duration_ms=duration_ms,
        steps=steps,
        success=success,
        detail=detail,
        usage=usage,
    )


async def main() -> None:
    args = parse_args()
    load_dotenv(REPO_ROOT / ".env")

    tasks = select_tasks(load_tasks(), args)
    if not tasks:
        raise SystemExit("no tasks selected")

    if args.dry_run:
        print(f"{len(tasks)} task(s)")
        for task in tasks[:10]:
            print(f"- {task.id} [{task.site}] {task.goal}")
        return

    model = resolve_model(args)
    llm = build_llm(args.provider, model)

    for index, task in enumerate(tasks, start=1):
        print(f"[{index}/{len(tasks)}] {task.id}")
        row = await run_task(task, args, model, llm)
        append_row(args.results, row)
        print(
            f"  success={row['success']} steps={row['steps']} "
            f"cost=${row['total_cost_usd']:.4f}"
        )


if __name__ == "__main__":
    asyncio.run(main())
