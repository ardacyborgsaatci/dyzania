import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from demo_intent import SALES_URL, wants_demo  # noqa: E402


class DemoIntent(unittest.TestCase):
    def test_asks_for_a_demo(self):
        for text in [
            "Can I book a demo?",
            "I'd like a demo please",
            "I want to schedule a demonstration for my team",
            "Can I talk to sales?",
            "How do I contact sales",
            "Put me through to the sales team",
        ]:
            self.assertTrue(wants_demo(text), text)

    def test_ordinary_questions_do_not_trigger(self):
        for text in [
            "How much is the Pro plan?",
            "What are your support hours?",
            "How do supplier bills work?",
            "I don't want a demo, just the price",
            "",
            None,
        ]:
            self.assertFalse(wants_demo(text), text)

    def test_link_carries_no_personal_data(self):
        self.assertTrue(SALES_URL.startswith("https://"))
        self.assertIn("topic=demo", SALES_URL)
        self.assertNotIn("@", SALES_URL)


if __name__ == "__main__":
    unittest.main()
