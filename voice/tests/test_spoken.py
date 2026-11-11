import unittest

import support  # noqa: F401  (puts the voice folder on the path)
import spoken


class Email(unittest.TestCase):
    def test_spoken_forms(self):
        cases = {
            "jane dot doe at example dot com": "jane.doe@example.com",
            "my email is jane dot doe at example dot com": "jane.doe@example.com",
            "it's j a n e dot d o e at gmail dot com": "jane.doe@gmail.com",
            "jane underscore doe at g mail dot com": "jane_doe@gmail.com",
            "jane dash doe one two three at yahoo dot com please": "jane-doe123@yahoo.com",
            "john at gmail dot com": "john@gmail.com",
            "reach me at john dot smith at outlook dot com": "john.smith@outlook.com",
            "J-A-N-E dot Doe at example dot org.": "jane.doe@example.org",
            "jane plus legal at example dot com": "jane+legal@example.com",
        }
        for said, want in cases.items():
            self.assertEqual(spoken.parse_email(said), want, said)

    def test_typed_forms(self):
        self.assertEqual(spoken.parse_email("Jane.Doe@Example.com"), "jane.doe@example.com")
        self.assertEqual(spoken.parse_email("it is jane.doe@example.com, thanks."), "jane.doe@example.com")
        self.assertEqual(spoken.parse_email("jane.doe at example.com"), "jane.doe@example.com")

    def test_not_an_address(self):
        for said in ["", None, "I don't have one", "jane dot doe", "at the office", "jane at home", "no email address at all dot dot"]:
            self.assertIsNone(spoken.parse_email(said), said)

    def test_read_back(self):
        self.assertEqual(spoken.email_aloud("jane.doe@gmail.com"), "J, A, N, E, dot, D, O, E, at, gmail dot com")
        self.assertEqual(spoken.email_aloud("a_b1@smith-law.org"), "A, underscore, B, 1, at, S, M, I, T, H, dash, L, A, W dot org")

    def test_round_trip(self):
        for email in ["jane.doe@example.com", "j.smith99@gmail.com", "a-b@outlook.com"]:
            said = email.replace("@", " at ").replace(".", " dot ").replace("-", " dash ")
            self.assertEqual(spoken.parse_email(said), email)


class Phone(unittest.TestCase):
    def test_forms(self):
        cases = {
            "555 010 0199": "5550100199",
            "five five five zero one zero zero one nine nine": "5550100199",
            "my number is (555) 010-0199": "5550100199",
            "five five five oh one four two": "5550142",
            "double five 5 0 1 4 2": "5550142",
            "555-0142 and I was born in 1990": "5550142",
        }
        for said, want in cases.items():
            self.assertEqual(spoken.parse_phone(said), want, said)

    def test_rejects(self):
        for said in ["", None, "I don't have one", "12345", "1 2 3", "1234567890123456"]:
            self.assertIsNone(spoken.parse_phone(said), said)

    def test_read_back(self):
        self.assertEqual(spoken.digits_aloud("5550100199"), "5 5 5, 0 1 0, 0 1 9 9")
        self.assertEqual(spoken.digits_aloud("5550142"), "5 5 5, 0 1 4 2")
        self.assertEqual(spoken.digits_aloud("15550100199"), "1, 5 5 5, 0 1 0, 0 1 9 9")


class YesNo(unittest.TestCase):
    def test_yes(self):
        for said in ["yes", "Yeah.", "yep that's right", "correct", "sure, go ahead", "okay", "that's correct"]:
            self.assertEqual(spoken.parse_yes_no(said), "yes", said)

    def test_no(self):
        for said in ["no", "nope", "that's wrong", "no that's not right", "incorrect", "not quite"]:
            self.assertEqual(spoken.parse_yes_no(said), "no", said)

    def test_unclear_or_both(self):
        for said in ["", None, "hmm", "I think so maybe", "yes no", "yeah no", "what"]:
            self.assertIsNone(spoken.parse_yes_no(said), said)

    def test_stop_and_repeat(self):
        for said in ["stop", "never mind", "cancel that", "forget it"]:
            self.assertTrue(spoken.wants_stop(said), said)
        for said in ["yes", "jane doe", "tomorrow at ten"]:
            self.assertFalse(spoken.wants_stop(said), said)
        for said in ["repeat that", "say that again", "what was that", "pardon", "sorry"]:
            self.assertTrue(spoken.wants_repeat(said), said)
        self.assertFalse(spoken.wants_repeat("my name is Sorry Jones"))


class Names(unittest.TestCase):
    def test_names(self):
        cases = {
            "Jane Doe": "Jane Doe",
            "my name is jane doe": "Jane Doe",
            "It's Maria Garcia-Lopez": "Maria Garcia-Lopez",
            "this is Patrick O'Neil.": "Patrick O'Neil",
            "um, I'm Ana Maria Silva": "Ana Maria Silva",
            "my name is Dana Reyes and my phone is": "Dana Reyes",
        }
        for said, want in cases.items():
            self.assertEqual(spoken.parse_name(said), want, said)

    def test_refused(self):
        for said in ["", None, "Jane", "jane@example.com", "Jane 2 Doe", "I was in a car accident last week and my name is Jane Doe",
                     "one two three four five six"]:
            self.assertIsNone(spoken.parse_name(said), said)


class OtherSide(unittest.TestCase):
    def test_none(self):
        for said in ["none", "no", "No one", "there isn't one", "not applicable", "no other side", "nobody"]:
            self.assertEqual(spoken.parse_other_side(said), {"none": True}, said)

    def test_names(self):
        self.assertEqual(spoken.parse_other_side("Harlan Whitcombe"), {"name": "Harlan Whitcombe"})
        self.assertEqual(spoken.parse_other_side("the other side is Greywater Dental Group"), {"name": "Greywater Dental Group"})
        self.assertEqual(spoken.parse_other_side("it's my employer, Acme Foods"), {"name": "my employer, Acme Foods"})

    def test_unknown_is_not_none(self):
        # "I don't know" is not "there is no other side": the booking records that the caller did not know
        self.assertEqual(spoken.parse_other_side("I don't know"), {"name": spoken.NOT_KNOWN})

    def test_a_story_is_refused(self):
        story = "well it all started when my husband took the car and then he refused to give it back after the court case"
        self.assertIsNone(spoken.parse_other_side(story))
        self.assertIsNone(spoken.parse_other_side(""))


SLOTS = [
    {"start": "2026-11-12T16:00:00Z", "date": "2026-11-12", "time": "10:00"},
    {"start": "2026-11-12T20:00:00Z", "date": "2026-11-12", "time": "14:00"},
    {"start": "2026-11-13T16:30:00Z", "date": "2026-11-13", "time": "10:30"},
]


class Choice(unittest.TestCase):
    def test_ordinals_and_numbers(self):
        for said, want in {"the first one": 0, "second": 1, "third please": 2, "number two": 1, "option three": 2, "1": 0, "the last one": 2, "one": 0, "earliest": 0}.items():
            self.assertEqual(spoken.parse_choice(said, SLOTS), ("pick", want), said)

    def test_by_time_or_day(self):
        self.assertEqual(spoken.parse_choice("the 2 pm one", SLOTS), ("pick", 1))
        self.assertEqual(spoken.parse_choice("two o'clock", SLOTS), ("pick", 1))
        self.assertEqual(spoken.parse_choice("10:30 in the morning", SLOTS), ("pick", 2))
        self.assertEqual(spoken.parse_choice("friday please", SLOTS), ("pick", 2))
        self.assertEqual(spoken.parse_choice("ten am", SLOTS), ("pick", 0))
        self.assertEqual(spoken.parse_choice("14:00", SLOTS), ("pick", 1))

    def test_a_date_is_not_a_time(self):
        self.assertEqual(spoken.parse_choice("the one on November 13th", SLOTS), None)
        self.assertEqual(spoken.parse_choice("friday the 13th", SLOTS), ("pick", 2))

    def test_ambiguous_time_is_not_guessed(self):
        two_tens = [{"start": "x", "date": "2026-11-12", "time": "10:00"}, {"start": "y", "date": "2026-11-13", "time": "10:00"}]
        self.assertIsNone(spoken.parse_choice("ten am", two_tens))
        self.assertEqual(spoken.parse_choice("ten am on friday", two_tens), ("pick", 1))

    def test_more_and_none(self):
        for said in ["later", "something else", "none of those", "do you have anything different", "any later ones"]:
            self.assertEqual(spoken.parse_choice(said, SLOTS), ("more", None), said)
        self.assertIsNone(spoken.parse_choice("hmm let me think", SLOTS))
        self.assertIsNone(spoken.parse_choice("", SLOTS))

    def test_third_option_with_two_offered(self):
        self.assertIsNone(spoken.parse_choice("the third", SLOTS[:2]))


class Aloud(unittest.TestCase):
    def test_when(self):
        self.assertEqual(spoken.say_when("2026-11-12", "10:00"), "Thursday, November 12 at 10 AM")
        self.assertEqual(spoken.say_when("2026-11-13", "14:30"), "Friday, November 13 at 2:30 PM")
        self.assertEqual(spoken.say_when("2026-12-01", "12:00"), "Tuesday, December 1 at 12 PM")

    def test_speakable(self):
        s = spoken.speakable("Hollis & Marr LLP: call 555-0142 or write hello@hollismarr.example. The fee is $150.")
        self.assertIn("Hollis and Marr L L P", s)
        self.assertIn("5 5 5, 0 1 4 2", s)
        self.assertIn("hello at hollismarr dot example", s)
        self.assertIn("150 dollars", s)
        self.assertNotIn("&", s)
        self.assertNotIn("$", s)

    def test_speakable_urls(self):
        s = spoken.speakable("Book at https://hollismarr.example/book. Thank you.")
        self.assertIn("hollismarr dot example slash book.", s)
        self.assertNotIn("https", s)

    def test_speakable_spells_what_it_is_told_to(self):
        s = spoken.speakable("Email: jane.doe@gmail.com. Phone: 5550100199. Reference HM-4F2K9X.", spell=["jane.doe@gmail.com", "5550100199", "HM-4F2K9X"])
        self.assertIn("J, A, N, E, dot, D, O, E, at, gmail dot com", s)
        self.assertIn("5 5 5, 0 1 0, 0 1 9 9", s)
        self.assertIn("H, M, dash, 4, F, 2, K, 9, X", s)
        self.assertNotIn("jane.doe", s)

    def test_speakable_strips_markdown(self):
        self.assertEqual(spoken.speakable("**Hello** `there`\n- item"), "Hello there\nitem")


if __name__ == "__main__":
    unittest.main()
