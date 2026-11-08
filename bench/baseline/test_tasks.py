import re

from tasks import load_tasks

PLACEHOLDER = re.compile(r"\{[a-zA-Z0-9_]+\}")


def test_loads_forty_five_tasks() -> None:
    tasks = load_tasks()
    assert len(tasks) == 45
    assert {task.site for task in tasks} == {"store", "wizard", "portal"}
    assert len({task.id for task in tasks}) == 45


def test_leaves_no_placeholders() -> None:
    for task in load_tasks():
        assert not PLACEHOLDER.search(task.goal)
        values = [
            task.success.get("url_matches", ""),
            task.success.get("dom", ""),
            *task.success.get("extracted", {}).values(),
            *task.success.get("download", {}).values(),
        ]
        for value in values:
            assert not PLACEHOLDER.search(str(value))


def test_keeps_start_paths_relative() -> None:
    for task in load_tasks():
        assert task.start.startswith("/")
