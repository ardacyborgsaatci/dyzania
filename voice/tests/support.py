"""Shared helpers for the voice tests."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import booking_flow  # noqa: E402

BRIDGE = Path(__file__).resolve().parent / "bridge.js"
PARITY = Path(__file__).resolve().parent / "parity.js"
HAS_NODE = shutil.which("node") is not None
NOW = "2026-11-11T15:00:00Z"  # Wednesday 9:00 in the firm's time


def node_json(script: Path, payload) -> dict | list:
    p = subprocess.run(["node", str(script)], input=json.dumps(payload), capture_output=True, text=True, timeout=60, encoding="utf-8")
    if p.returncode != 0:
        raise RuntimeError(p.stderr[-500:])
    return json.loads(p.stdout)


class RealRulesApi:
    """The booking service as the voice line sees it, answered by the real booking rules (no copy of them)."""

    def __init__(self, now: str = NOW):
        self.rows: list = []
        self.now = now
        self.calls: list = []

    def _run(self, op: str, body: dict, **extra):
        self.calls.append((op, body))
        out = node_json(BRIDGE, {"op": op, "body": body, "rows": self.rows, "now": self.now, **extra})
        self.rows = out["rows"]
        return out["result"]

    def slots(self, area, after=None, limit=3):
        body = {"area": area, "limit": limit}
        if after:
            body["after"] = after
        return self._run("slots", body)

    def book(self, payload):
        return self._run("book", payload)


class ScriptedApi:
    """A booking service that answers from a list, for the cases the real rules make hard to reach (outage, race)."""

    def __init__(self, slots=None, book=None, down=False):
        self._slots = slots
        self._book = list(book or [])
        self.down = down
        self.calls: list = []

    def slots(self, area, after=None, limit=3):
        self.calls.append(("slots", area, after))
        if self.down:
            raise booking_flow.BookingError("down")
        return self._slots(area, after) if callable(self._slots) else self._slots

    def book(self, payload):
        self.calls.append(("book", payload))
        if self.down:
            raise booking_flow.BookingError("down")
        return self._book.pop(0)


def slot(date: str, time: str, start: str):
    return {"start": start, "date": date, "time": time, "label": f"{date} {time}"}


def slots_answer(slots, area="family", **extra):
    base = {
        "ok": True, "area": area, "areaName": {"family": "Family law", "injury": "Personal injury"}.get(area, area),
        "timezone": "America/Chicago", "timezoneName": "Central Standard Time", "consultMinutes": 45,
        "fee": "$150 for this first consultation, credited toward the retainer if you hire the firm.",
        "slots": slots, "more": False, "note": "",
    }
    base.update(extra)
    return base


def say(reply, *lines, api):
    """Feed the caller's lines to the dialog one at a time; returns every reply (the last one is the result)."""
    replies = [reply]
    for line in lines:
        assert replies[-1].state is not None, f"the dialog ended before {line!r}: {replies[-1].text}"
        replies.append(booking_flow.handle(replies[-1].state, line, api))
    return replies
