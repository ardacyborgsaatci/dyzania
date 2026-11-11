import unittest

import support  # noqa: F401
import firmdata
import guards


class Intents(unittest.TestCase):
    def test_wants_booking(self):
        for said in [
            "I'd like to book a consultation",
            "Can I book an appointment?",
            "I want to schedule a first consultation about my divorce",
            "book",
            "Please book me a time",
            "I need to see a lawyer",
            "I'd like to talk to an attorney",
            "set up a meeting with someone about a car accident",
            "Can you book me in for Thursday?",
        ]:
            self.assertTrue(guards.wants_booking(said), said)

    def test_questions_about_booking_are_not_requests(self):
        for said in [
            "How do I book a consultation?",
            "What does a consultation cost?",
            "When can I book?",
            "Do you offer consultations at night?",
            "What should I bring to a consultation?",
            "I don't want to book anything, I just have a question",
            "Where is the office?",
            "",
            None,
        ]:
            self.assertFalse(guards.wants_booking(said), said)

    def test_change_requests(self):
        for said in ["I need to cancel my appointment", "Can I reschedule my consultation?", "I want to change my booking", "my appointment, I need to move it"]:
            self.assertTrue(guards.wants_change(said), said)
            self.assertFalse(guards.wants_booking(said), said)  # never starts a new booking

    def test_advice_requests(self):
        for said in [
            "Do I have a case?",
            "Should I sue my employer?",
            "Will I win custody?",
            "What are my chances?",
            "How long do I have to file?",
            "What's my deadline?",
            "Is it legal for my landlord to do that?",
            "What should I do about the letter I got?",
            "Should I sign this settlement?",
            "How much is my case worth?",
        ]:
            self.assertTrue(guards.asks_for_advice(said), said)

    def test_ordinary_questions_are_not_advice(self):
        for said in ["What are your office hours?", "What should I bring?", "Do you handle divorce cases?", "How much is the first consultation?", "Where are you located?"]:
            self.assertFalse(guards.asks_for_advice(said), said)

    def test_wants_person(self):
        for said in ["Can I speak to a real person?", "I want to talk to the receptionist", "put me through to someone", "Is there a human I can talk to?"]:
            self.assertTrue(guards.wants_person(said), said)
        for said in ["Where is the office?", "Tell me about the people who work there", "I talked to a lawyer last week"]:
            self.assertFalse(guards.wants_person(said), said)


class FixedReplies(unittest.TestCase):
    def test_urgent_reply_for_court_papers(self):
        text = guards.urgent_reply(firmdata.urgent_flags("I was served with papers and have a hearing next week"))
        self.assertIn("time-sensitive", text)
        self.assertIn("urgent@hollismarr.example", text)
        self.assertIn("555-0142", text)
        self.assertIn("can't tell you what a deadline is", text)
        self.assertIn("not a lawyer", text)
        self.assertIn("say book", text)
        self.assertNotIn("911", text)

    def test_urgent_reply_for_safety_starts_with_the_emergency_line(self):
        text = guards.urgent_reply(firmdata.urgent_flags("I'm afraid for my safety and I need a protective order"))
        self.assertTrue(text.startswith(firmdata.FIRM["language"]["emergency"]))

    def test_urgent_reply_for_matters_the_firm_does_not_handle(self):
        text = guards.urgent_reply(firmdata.urgent_flags("my son was arrested last night"))
        self.assertIn("doesn't handle criminal or housing", text)
        self.assertIn("bar association", text)
        self.assertNotIn("say book", text)           # booking is not offered for something the firm cannot take
        self.assertNotIn("urgent@hollismarr.example", text)

    def test_no_reply_states_a_deadline_promises_a_time_or_gives_advice(self):
        replies = [
            guards.urgent_reply(firmdata.urgent_flags("served with a summons, hearing on friday")),
            guards.advice_reply(), guards.person_reply(), guards.change_reply(), guards.blocked_reply(), guards.quiet_reply(),
        ]
        for text in replies:
            self.assertEqual(guards.problems_in(text), [], text)

    def test_numbers_come_from_the_firm_data(self):
        self.assertIn(firmdata.FIRM["phone"], guards.person_reply())
        self.assertIn("8:30 AM to 5:30 PM", guards.person_reply())
        self.assertIn("24 hours", guards.change_reply())


class AnswerCheck(unittest.TestCase):
    ALLOWED = "The first consultation is 45 minutes and costs $150. Email hello@hollismarr.example or call 555-0142."

    def test_good_answers_pass(self):
        for text in [
            "The first consultation for family law is 45 minutes and costs $150.",
            "The office is at 220 Canal Street, Suite 4, and it is open Monday to Friday.",
            "You can email hello@hollismarr.example or call 555-0142.",
            "I can't promise or guarantee any result, but an attorney can talk it through.",
            "Personal injury cases are handled on a contingency basis.",
            "I can't say whether you have a case, only an attorney can.",
            "I cannot tell you what your deadline is.",
        ]:
            self.assertEqual(guards.problems_in(text, self.ALLOWED), [], text)

    def test_advice_and_opinions_are_caught(self):
        bad = {
            "You have a strong case.": "case_opinion",
            "You probably have a good claim here.": "case_opinion",
            "You will win custody.": "outcome",
            "You should sue your employer.": "advice",
            "I recommend that you settle.": "advice",
            "Your deadline is next Friday.": "deadline_as_fact",
            "The statute of limitations is two years.": "deadline_as_fact",
            "You must file within 30 days.": "deadline_as_fact",
            "An attorney will call you within an hour.": "promised_time",
            "That is illegal.": "legal_conclusion",
            "You are entitled to compensation.": "legal_conclusion",
            "We guarantee a result.": "promise",
            "I can't say you have no case, but you should sue your employer.": "advice",
            "It is not clear, but you do have a strong case.": "case_opinion",
        }
        for text, reason in bad.items():
            self.assertIn(reason, guards.problems_in(text, self.ALLOWED), text)

    def test_invented_facts_are_caught(self):
        self.assertIn("invented_amount", guards.problems_in("The consultation costs $300.", self.ALLOWED))
        self.assertIn("unknown_email", guards.problems_in("Write to help@other.com", self.ALLOWED))
        self.assertIn("outside_link", guards.problems_in("See https://www.example.com/law for details.", self.ALLOWED))
        self.assertIn("unknown_phone", guards.problems_in("Call 555-9999.", self.ALLOWED))

    def test_a_dollar_amount_not_in_the_knowledge_that_was_sent_is_caught(self):
        self.assertIn("invented_amount", guards.problems_in("It costs $150.", "No fees are listed here."))

    def test_plain_text(self):
        self.assertEqual(guards.plain("**Hello** there.\n- one\n- two"), "Hello there. one two")
        long = " ".join(f"Sentence number {i}." for i in range(8))
        self.assertEqual(guards.plain(long).count("."), guards.MAX_SENTENCES)
        self.assertEqual(guards.plain(None), "")


if __name__ == "__main__":
    unittest.main()
