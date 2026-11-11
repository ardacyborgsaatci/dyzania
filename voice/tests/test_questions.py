"""The question set, checked offline: labels, the fixed paths (no model), retrieval, and that a good answer is not blocked."""
import unittest

import support
from support import ScriptedApi, slot, slots_answer
import guards
import knowledge
import questions
import router


class Silent:
    def __call__(self, messages, system):
        raise AssertionError("the model was asked")


API = ScriptedApi(slots=slots_answer([
    slot("2026-11-12", "10:00", "2026-11-12T16:00:00Z"),
    slot("2026-11-12", "14:00", "2026-11-12T20:00:00Z"),
    slot("2026-11-13", "10:30", "2026-11-13T16:30:00Z"),
]))


class Labels(unittest.TestCase):
    def test_well_formed(self):
        ids = [q["id"] for q in questions.QUESTIONS]
        self.assertEqual(len(ids), len(set(ids)))
        for q in questions.QUESTIONS:
            self.assertIn(q["set"], {"dev", "holdout"}, q["id"])
            self.assertIn(q["source"], questions.SOURCES, q["id"])
            self.assertTrue(q["ask"].strip(), q["id"])
            self.assertTrue(q.get("include") or q.get("avoidRegex") or q.get("avoid"), q["id"] + " has nothing to check")
            for group in q.get("include", []):
                self.assertTrue(group and all(isinstance(w, str) and w for w in group), q["id"])
            if q["source"] == "model":
                self.assertTrue(q.get("ideal"), q["id"] + " needs an ideal answer")

    def test_counts(self):
        self.assertGreaterEqual(len(questions.by_set("dev")), 30)
        self.assertGreaterEqual(len(questions.by_set("holdout")), 10)

    def test_the_checker_catches_what_it_should(self):
        q = next(q for q in questions.QUESTIONS if q["id"] == "Q03")
        self.assertEqual(questions.check_answer(q, q["ideal"]), [])
        self.assertTrue(questions.check_answer(q, "The first consultation is free."))      # missing the fee
        q4 = next(q for q in questions.QUESTIONS if q["id"] == "Q04")
        self.assertTrue(questions.check_answer(q4, "It is free, but it costs $150."))       # forbidden
        q26 = next(q for q in questions.QUESTIONS if q["id"] == "Q26")
        self.assertTrue(questions.check_answer(q26, "You have a strong case."))
        self.assertEqual(questions.check_answer(q26, "I can't say whether anyone has a case."), [])


class FixedPaths(unittest.TestCase):
    """Urgent, advice, person, change and booking questions are answered without the model, with the words the label expects."""

    def test_each_one(self):
        for q in questions.QUESTIONS:
            if q["source"] == "model":
                continue
            t = router.route(q["ask"], [], None, api=API, ask_model=Silent())
            self.assertEqual(t.source if t.source != "flow" else "flow", q["source"], q["id"] + " " + q["ask"])
            self.assertEqual(questions.check_answer(q, t.text), [], q["id"] + ": " + t.text)
            everything = " ".join(c["text"] for c in knowledge.CHUNKS)   # the fee in a booking offer comes from the booking service
            self.assertEqual(guards.problems_in(t.text, everything), [], q["id"])


class Retrieval(unittest.TestCase):
    def failing(self, which):
        return [q["id"] + " sent " + str(questions.sections_sent(q)) for q in questions.by_set(which) if q["source"] == "model" and not questions.sections_ok(q)]

    def test_dev_questions_get_the_section_that_holds_the_answer(self):
        self.assertEqual(self.failing("dev"), [])

    def test_holdout_questions_get_the_section_that_holds_the_answer(self):
        self.assertEqual(self.failing("holdout"), [])

    def test_a_question_with_no_section_still_gets_the_intro(self):
        sent = questions.sections_sent({"ask": "xyzzy plugh"})
        self.assertEqual(len(sent), 2)


class IdealAnswers(unittest.TestCase):
    def test_a_good_answer_passes_the_words_check_and_the_answer_check(self):
        for q in questions.QUESTIONS:
            if q["source"] != "model":
                continue
            ideal = q["ideal"]
            self.assertEqual(questions.check_answer(q, ideal), [], q["id"])
            _, allowed = knowledge.build_system([{"role": "user", "content": q["ask"]}])
            self.assertEqual(guards.problems_in(ideal, allowed), [], q["id"] + ": " + ideal)
            self.assertEqual(guards.plain(ideal), ideal, q["id"] + " is longer than a spoken answer should be")

    def test_through_the_router_a_good_answer_comes_back_unchanged(self):
        for q in questions.QUESTIONS:
            if q["source"] != "model":
                continue
            t = router.route(q["ask"], [], None, api=API, ask_model=lambda m, s, a=q["ideal"]: a)
            self.assertEqual((t.source, t.text), ("model", q["ideal"]), q["id"])


if __name__ == "__main__":
    unittest.main()
