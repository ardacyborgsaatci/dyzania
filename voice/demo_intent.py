"""Detects when a caller on the voice line wants a demo, so the page can show the sales form.

Pure keyword matching: no model call, no personal data. The page gets a fixed link; the
assistant never takes an email address by voice.
"""
import os
import re

SALES_URL = os.getenv("SALES_URL", "https://wrenbook.example/?topic=demo&from=voice#brief")

_ASK = re.compile(
    r"\b(book|schedule|arrange|set up|get|want|need|like|request)\b[^.?!]{0,30}\b(demo|demonstration)\b"
    r"|\b(demo|demonstration)\b[^.?!]{0,20}\b(please|call|meeting)\b"
    r"|\b(talk|speak)\s+(to|with)\s+(sales|someone from sales|a salesperson|a sales rep)\b"
    r"|\bcontact\s+sales\b"
    r"|\bsales\s+(team|call)\b",
    re.IGNORECASE,
)
_NEGATED = re.compile(r"\b(no|not|don'?t|do not)\s+(want|need)\b[^.?!]{0,15}\b(demo|sales)\b", re.IGNORECASE)


def wants_demo(text: str) -> bool:
    text = text or ""
    return bool(_ASK.search(text)) and not _NEGATED.search(text)
