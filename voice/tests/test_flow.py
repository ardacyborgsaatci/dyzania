"""The booking dialog, run against the real booking rules (through Node) and against scripted answers for the awkward cases."""
import json
import unittest

import support
from support import RealRulesApi, ScriptedApi, say, slot, slots_answer
import booking_flow
import spoken

FAMILY = "I'd like to book a consultation about my divorce"
GOOD_CALL = ["the second one", "my name is Jane Doe", "555 010 0199", "jane dot doe at example dot com", "yes", "none"]


def book_all_the_way(api, *extra, first=FAMILY):
    r = booking_flow.start(first, api)
    return say(r, *GOOD_CALL, "yes", *extra, api=api)


@unittest.skipUnless(support.HAS_NODE, "node is not installed")
class AgainstTheRealRules(unittest.TestCase):
    def test_a_whole_booking(self):
        api = RealRulesApi()
        replies = book_all_the_way(api)
        offer, final = replies[0], replies[-1]

        # the offer: three times, spread out, with the fee and the zone
        self.assertIn("Family law", offer.text)
        self.assertIn("first, ", offer.text)
        self.assertIn("third, ", offer.text)
        self.assertIn("Central time", offer.text)
        self.assertIn("$150 for this first consultation", offer.text)
        starts = [booking_flow._minutes(s["start"]) for s in offer.state["slots"]]
        self.assertEqual(len(starts), 3)
        self.assertTrue(all(b - a >= booking_flow.SPREAD_MINUTES for a, b in zip(starts, starts[1:])), starts)

        # the read-backs
        self.assertIn("I heard jane.doe@example.com", replies[4].text)
        self.assertEqual(replies[4].spell, ["jane.doe@example.com"])
        summary = replies[6]
        self.assertEqual(summary.state["step"], "confirm")
        for want in ["Jane Doe", "5550100199", "jane.doe@example.com", "not a lawyer", "no attorney-client relationship", "Shall I book it"]:
            self.assertIn(want, summary.text)
        self.assertEqual(summary.spell, ["5550100199", "jane.doe@example.com"])

        # the booking itself
        self.assertTrue(final.ended)
        self.assertIsNone(final.state)
        self.assertEqual(len(api.rows), 1)
        row = api.rows[0]
        self.assertEqual((row["status"], row["channel"], row["area"]), ("booked", "voice", "family"))
        self.assertEqual((row["name"], row["email"], row["phone"]), ("Jane Doe", "jane.doe@example.com", "5550100199"))
        chosen = offer.state["slots"][1]
        self.assertEqual(row["startUtc"], chosen["start"])
        self.assertIn(spoken.say_when(chosen["date"], chosen["time"]), final.text)
        self.assertIn("DY-", final.text)
        self.assertIn("confirmation email is on its way to jane.doe@example.com", final.text)
        self.assertIn("not a lawyer", final.text)
        self.assertIn("jane.doe@example.com", final.spell)

    def test_the_booking_call_carries_consent_voice_channel_and_no_honeypot(self):
        api = RealRulesApi()
        book_all_the_way(api)
        _, body = [c for c in api.calls if c[0] == "book"][0]
        self.assertIs(body["consent"], True)
        self.assertEqual((body["channel"], body["website"], body["noOtherSide"], body["otherSide"]), ("voice", "", True, ""))

    def test_pick_by_clock_time(self):
        api = RealRulesApi()
        r = booking_flow.start(FAMILY, api)
        times = r.state["slots"]
        target = times[2]
        hour = int(target["time"].split(":")[0])
        said = f"the {hour % 12 or 12} {'am' if hour < 12 else 'pm'} one"
        r2 = booking_flow.handle(r.state, said, api)
        self.assertEqual(r2.state["slot"], target)

    def test_later_asks_for_times_after_the_last_one_offered(self):
        api = RealRulesApi()
        r = booking_flow.start(FAMILY, api)
        last = r.state["slots"][-1]["start"]
        r2 = booking_flow.handle(r.state, "do you have anything later", api)
        self.assertEqual(r2.state["step"], "times")
        self.assertTrue(all(s["start"] > last for s in r2.state["slots"]))
        self.assertIn("slots", [c[0] for c in api.calls])
        self.assertEqual(api.calls[-1][1]["after"], last)

    def test_the_matter_can_come_in_a_later_answer(self):
        api = RealRulesApi()
        r = booking_flow.start("I'd like to book a consultation", api)
        self.assertEqual(r.state["step"], "area")
        self.assertIn("Which kind of matter", r.text)
        r2 = booking_flow.handle(r.state, "estate planning", api)
        self.assertEqual(r2.state["step"], "times")
        self.assertEqual(r2.state["area"], "estate")

    def test_a_matter_the_firm_does_not_handle_ends_politely_without_calling_the_service(self):
        api = RealRulesApi()
        r = booking_flow.start("I want to book a consultation about my immigration visa", api)
        self.assertTrue(r.ended)
        self.assertIn("doesn't handle immigration", r.text)
        self.assertIn("bar association", r.text)
        self.assertEqual(api.calls, [])

    def test_a_repeat_booking_and_a_conflict_hold_are_answered_in_identical_words(self):
        api = RealRulesApi()
        book_all_the_way(api)                       # Jane books once
        again = RealRulesApi()
        again.rows = list(api.rows)
        r = booking_flow.start(FAMILY, again)
        repeat = say(r, "the first one", "my name is Jane Doe", "555 010 0199", "jane dot doe at example dot com", "yes", "none", "yes", api=again)[-1]

        held_api = RealRulesApi()
        r2 = booking_flow.start(FAMILY, held_api)
        held = say(r2, "the first one", "my name is Sam Rivera", "555 010 0177", "sam dot rivera at example dot com", "yes", "Harlan Whitcombe", "yes", api=held_api)[-1]

        self.assertTrue(repeat.ended and held.ended)
        self.assertEqual(repeat.text, held.text)
        self.assertIn("555-0142", repeat.text)
        for word in ["conflict", "already", "booked", "client", "Whitcombe"]:
            self.assertNotIn(word, repeat.text)
        self.assertEqual([r["status"] for r in held_api.rows], ["held"])   # a person follows up; no time was reserved
        self.assertEqual(held_api.rows[0]["startUtc"], "")

    def test_a_time_taken_while_the_caller_was_deciding_gives_new_times(self):
        api = RealRulesApi()
        r = booking_flow.start(FAMILY, api)
        chosen = r.state["slots"][0]
        # someone else takes that time (only one family attorney is free then, so one booking is enough)
        other = {"name": "Pat Lee", "email": "p0@example.com", "phone": "5550100300", "area": "family", "noOtherSide": True,
                 "consent": True, "channel": "form", "start": chosen["start"]}
        self.assertEqual(api.book(other)["code"], "booked")
        self.assertEqual(api.book(dict(other, name="Kim Ode", email="p1@example.com", phone="5550100301"))["code"], "slot_unavailable")
        replies = say(r, "the first one", "my name is Jane Doe", "555 010 0199", "jane dot doe at example dot com", "yes", "none", "yes", api=api)
        gone = replies[-1]
        self.assertEqual(gone.state["step"], "times")
        self.assertIn("that time has just gone", gone.text)
        self.assertTrue(all(s["start"] != chosen["start"] for s in gone.state["slots"]))
        # picking a new one goes straight back to the summary and books it
        again = say(gone, "the first one", "yes", api=api)
        self.assertEqual(again[1].state["step"], "confirm")
        self.assertTrue(again[-1].ended)
        self.assertIn("is booked for", again[-1].text)
        self.assertEqual(len([r for r in api.rows if r["name"] == "Jane Doe"]), 1)

    def test_changing_the_phone_number_at_the_summary(self):
        api = RealRulesApi()
        r = booking_flow.start(FAMILY, api)
        replies = say(r, "the first one", "my name is Jane Doe", "555 010 0199", "jane dot doe at example dot com", "yes", "none", "no", "my phone number", "555 010 0111", api=api)
        self.assertIn("What would you like to change", replies[7].text)
        self.assertEqual(replies[-1].state["step"], "confirm")
        self.assertIn("5550100111", replies[-1].text)
        final = booking_flow.handle(replies[-1].state, "yes", api)
        self.assertEqual(api.rows[0]["phone"], "5550100111")
        self.assertTrue(final.ended)

    def test_skipping_the_phone_number(self):
        api = RealRulesApi()
        r = booking_flow.start(FAMILY, api)
        replies = say(r, "the first one", "my name is Jane Doe", "skip", "jane dot doe at example dot com", "yes", "none", "yes", api=api)
        self.assertIn("No phone number.", replies[-2].text)
        self.assertEqual(api.rows[0]["phone"], "")

    def test_the_other_side_can_be_a_name(self):
        api = RealRulesApi()
        r = booking_flow.start("I want to book a consultation about a car accident", api)
        say(r, "the first one", "my name is Jane Doe", "555 010 0199", "jane dot doe at example dot com", "yes", "the other side is Acme Trucking", "yes", api=api)
        self.assertEqual(api.rows[0]["status"], "booked")
        _, body = [c for c in api.calls if c[0] == "book"][0]
        self.assertEqual((body["otherSide"], body["noOtherSide"]), ("Acme Trucking", False))


class Failures(unittest.TestCase):
    def offered(self, api=None):
        api = api or ScriptedApi(slots=slots_answer([
            slot("2026-11-12", "10:00", "2026-11-12T16:00:00Z"),
            slot("2026-11-12", "14:00", "2026-11-12T20:00:00Z"),
            slot("2026-11-13", "10:30", "2026-11-13T16:30:00Z"),
        ]))
        return api, booking_flow.start(FAMILY, api)

    def test_two_failed_email_tries_send_the_caller_to_the_website_and_nothing_is_booked(self):
        api, r = self.offered()
        replies = say(r, "the first one", "my name is Jane Doe", "555 010 0199", "I don't have an email", "um what", api=api)
        last = replies[-1]
        self.assertTrue(last.ended)
        self.assertIsNone(last.state)
        self.assertIn("dyzania.example/book", last.text)
        self.assertIn("Nothing has been saved", last.text)
        self.assertEqual(last.link["url"], "https://dyzania.example/book")
        self.assertFalse(any(c[0] == "book" for c in api.calls))

    def test_a_read_back_the_caller_rejects_twice_also_ends_on_the_website(self):
        api, r = self.offered()
        replies = say(r, "the first one", "my name is Jane Doe", "555 010 0199", "jane dot doe at example dot com", "no", "jane dot doe at example dot org", "no", api=api)
        self.assertIn("Sorry about that", replies[5].text)
        self.assertTrue(replies[-1].ended)
        self.assertIn("dyzania.example/book", replies[-1].text)
        self.assertFalse(any(c[0] == "book" for c in api.calls))

    def test_one_wrong_read_back_is_fixed_on_the_second_try(self):
        api, r = self.offered()
        replies = say(r, "the first one", "my name is Jane Doe", "555 010 0199", "jane dot doe at example dot com", "no", "jane dot doe at example dot org", "yes", api=api)
        self.assertEqual(replies[-1].state["step"], "other")
        self.assertEqual(replies[-1].state["email"], "jane.doe@example.org")

    def test_a_first_name_only_is_asked_for_again_then_given_up_on(self):
        api, r = self.offered()
        replies = say(r, "the first one", "Jane", "just Jane", api=api)
        self.assertIn("first and last name", replies[2].text)
        self.assertTrue(replies[-1].ended)

    def test_an_unclear_time_is_asked_again_then_given_up_on(self):
        api, r = self.offered()
        replies = say(r, "hmm let me think", "I don't know", api=api)
        self.assertIn("didn't catch which time", replies[1].text)
        self.assertTrue(replies[-1].ended)

    def test_the_service_being_down_never_makes_up_times(self):
        api = ScriptedApi(down=True)
        r = booking_flow.start(FAMILY, api)
        self.assertTrue(r.ended)
        self.assertIn("dyzania.example/book", r.text)
        for word in ["Thursday", "November", "first,", "second,", "Happy to help"]:   # no time was read out, no welcome before a refusal
            self.assertNotIn(word, r.text)

    def test_the_service_failing_at_the_last_step_says_nothing_was_saved(self):
        api, r = self.offered()
        api.down = False
        replies = say(r, *GOOD_CALL, api=api)
        api.down = True
        final = booking_flow.handle(replies[-1].state, "yes", api)
        self.assertTrue(final.ended)
        self.assertIn("Nothing has been saved", final.text)
        self.assertNotIn("booked for", final.text)

    def test_a_field_the_service_refuses_is_asked_for_again_then_goes_straight_to_the_summary(self):
        api, r = self.offered()
        api._book = [{"ok": False, "code": "invalid", "errors": {"email": "Please enter a valid email address."}}]
        replies = say(r, *GOOD_CALL, "yes", api=api)
        again = replies[-1]
        self.assertEqual(again.state["step"], "email")
        self.assertIn("wasn't accepted: your email", again.text)
        api._book = [{"ok": True, "code": "booked", "ref": "DY-TEST01", "attorney": "Dana Hollis", "address": "220 Canal Street, Suite 4, Harlow Point", "confirmationSent": True}]
        after = say(again, "jane dot doe at example dot net", "yes", "yes", api=api)
        self.assertEqual(after[2].state["step"], "confirm")
        self.assertIn("jane.doe@example.net", after[2].text)
        self.assertTrue(after[-1].ended)
        self.assertIn("DY-TEST01", after[-1].text)

    def test_a_confirmation_email_that_could_not_be_sent_says_so(self):
        api, r = self.offered()
        api._book = [{"ok": True, "code": "booked", "ref": "DY-TEST02", "attorney": "Dana Hollis", "address": "220 Canal Street", "confirmationSent": False}]
        final = say(r, *GOOD_CALL, "yes", api=api)[-1]
        self.assertIn("couldn't send the confirmation email", final.text)
        self.assertIn("DY-TEST02", final.text)
        self.assertNotIn("on its way", final.text)
        self.assertEqual(final.spell, ["DY-TEST02"])

    def test_the_service_saying_unavailable_ends_on_the_website(self):
        api, r = self.offered()
        api._book = [{"ok": False, "code": "unavailable", "message": "We could not complete this request."}]
        final = say(r, *GOOD_CALL, "yes", api=api)[-1]
        self.assertTrue(final.ended)
        self.assertIn("dyzania.example/book", final.text)


class Interrupts(unittest.TestCase):
    def setUp(self):
        self.api = ScriptedApi(slots=slots_answer([
            slot("2026-11-12", "10:00", "2026-11-12T16:00:00Z"),
            slot("2026-11-12", "14:00", "2026-11-12T20:00:00Z"),
            slot("2026-11-13", "10:30", "2026-11-13T16:30:00Z"),
        ]))
        self.r = booking_flow.start(FAMILY, self.api)

    def test_stop_ends_the_dialog_at_any_step_and_saves_nothing(self):
        steps = [[], ["the first one"], ["the first one", "Jane Doe"], ["the first one", "Jane Doe", "555 010 0199"]]
        for lines in steps:
            replies = say(self.r, *lines, "never mind", api=self.api)
            self.assertTrue(replies[-1].ended)
            self.assertIn("Nothing was saved", replies[-1].text)
        self.assertFalse(any(c[0] == "book" for c in self.api.calls))

    def test_repeat_says_the_question_again_without_counting_as_a_failure(self):
        r = booking_flow.handle(self.r.state, "sorry, say that again", self.api)
        self.assertEqual(r.text, booking_flow.prompt(self.r.state).text)
        self.assertEqual(r.state["tries"], 0)

    def test_the_state_passed_in_is_never_changed(self):
        before = json.dumps(self.r.state, sort_keys=True)
        booking_flow.handle(self.r.state, "the first one", self.api)
        self.assertEqual(json.dumps(self.r.state, sort_keys=True), before)

    def test_the_state_is_plain_json_at_every_step_and_holds_no_secret(self):
        api = self.api
        api._book = [{"ok": True, "code": "booked", "ref": "DY-TEST03", "attorney": "Dana Hollis", "address": "x", "confirmationSent": True}]
        replies = say(self.r, *GOOD_CALL, "yes", api=api)
        for rep in replies[:-1]:
            blob = json.dumps(rep.state)
            self.assertNotIn("consent", blob)
            self.assertNotIn("secret", blob.lower())
        self.assertIsNone(replies[-1].state)


if __name__ == "__main__":
    unittest.main()
