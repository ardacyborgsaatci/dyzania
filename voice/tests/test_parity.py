"""The voice line sorts a caller the same way the website sorts a visitor.

The web side's rules (firm/lib/areas.js and urgency.js, run by Node) and this folder's Python copy are run on the same
sentences. If someone edits one side only, this fails. It also fails when the data copy in voice/firm drifts from firm/.
"""
import json
import unittest
from pathlib import Path

import support
import firmdata

SENTENCES = [
    "I want a divorce",
    "I need help with child custody and child support",
    "my husband and I are separated and want a prenup",
    "I was in a car accident and I'm injured",
    "I got a dog bite last week",
    "I was fired and I think it was retaliation",
    "I want to make a will and a trust",
    "my father died and I need probate",
    "I need guardianship of a child",
    "I was arrested for a DUI",
    "my landlord is evicting me",
    "I need an immigration lawyer for a green card",
    "I want to file for bankruptcy",
    "tell me about real estate closings",
    "my son is in police custody",
    "I want custody of my kids and my landlord is evicting us",
    "hello",
    "what are your office hours",
    "I have a hearing on Friday",
    "I was served with a summons yesterday",
    "there is a deadline coming up and the statute of limitations",
    "I'm afraid for my safety and he hurt me",
    "I'm hard of hearing, can you speak up",
    "I keep hearing that I need a lawyer",
    "I served in the army",
    "he was served papers by a process server",
    "I was locked out of my apartment and got a notice to quit",
    "my brother is in jail and has a bail hearing",
    "I have a trial date and a pretrial conference",
    "the response is due next week",
    "Divorced twice and now injured at work",
    "I must appear in court",
    "she is being threatened",
    "the three day notice says I have until Monday",
]


@unittest.skipUnless(support.HAS_NODE, "node is not installed")
class SameAsTheWebSide(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.web = support.node_json(support.PARITY, SENTENCES)

    def test_practice_area_matching(self):
        for said, web in zip(SENTENCES, self.web):
            mine = firmdata.classify_area(said)
            self.assertEqual(mine["area"], web["area"], said)
            self.assertEqual(mine["basis"], web["basis"], said)
            self.assertEqual(mine["hits"], web["hits"], said)
            self.assertEqual(mine["outOfScope"]["id"] if mine["outOfScope"] else None, web["outOfScope"], said)

    def test_urgent_wording(self):
        for said, web in zip(SENTENCES, self.web):
            mine = sorted(f["id"] for f in firmdata.urgent_flags(said))
            self.assertEqual(mine, web["urgent"], said)


class DataCopies(unittest.TestCase):
    def test_voice_firm_files_are_the_shared_files(self):
        shared = Path(__file__).resolve().parents[2] / "firm"
        for name in ["firm.json", "practice-areas.json", "urgency.json", "availability.json"]:
            self.assertEqual(
                json.loads((firmdata.DATA_DIR / name).read_text(encoding="utf-8")),
                json.loads((shared / name).read_text(encoding="utf-8")),
                name + " differs from firm/" + name + "; run node scripts/sync-knowledge.mjs",
            )

    def test_knowledge_copies_are_the_shared_files(self):
        shared = Path(__file__).resolve().parents[2] / "knowledge"
        mine = Path(__file__).resolve().parents[1] / "knowledge"
        for f in sorted(shared.glob("*.md")):
            self.assertEqual((mine / f.name).read_text(encoding="utf-8").replace("\r\n", "\n"), f.read_text(encoding="utf-8").replace("\r\n", "\n"), f.name)


class VoiceChoices(unittest.TestCase):
    def test_the_answer_to_which_matter(self):
        cases = {
            "family law": "family", "personal injury": "injury", "employment": "employment", "estate planning": "estate",
            "probate": "estate", "I want to make a will": "estate", "a trust": "estate", "my job": "employment",
            "divorce": "family", "a car accident": "injury", "I was fired": "employment",
        }
        for said, area in cases.items():
            self.assertEqual(firmdata.choose_area(said), {"kind": "area", "area": area}, said)

    def test_two_matters_in_one_answer_are_not_guessed(self):
        r = firmdata.choose_area("a divorce and also I was injured")
        self.assertEqual(r["kind"], "ambiguous")
        self.assertEqual(r["areas"], ["family", "injury"])

    def test_matters_the_firm_does_not_handle(self):
        r = firmdata.choose_area("I need an immigration lawyer")
        self.assertEqual(r["kind"], "out")
        self.assertEqual(r["out"]["id"], "immigration")
        self.assertEqual(firmdata.choose_area("my landlord is evicting me")["out"]["id"], "housing")

    def test_nothing_recognised(self):
        self.assertEqual(firmdata.choose_area("hmm, I don't know")["kind"], "unclear")
        self.assertEqual(firmdata.choose_area("")["kind"], "unclear")

    def test_the_word_will_alone_is_not_estate_planning(self):
        self.assertEqual(firmdata.choose_area("I will need a divorce")["area"], "family")


if __name__ == "__main__":
    unittest.main()
