import unittest

import support  # noqa: F401
import state

KEY = state.key_from("test-secret")
OTHER_KEY = state.key_from("another-secret")


class SealedState(unittest.TestCase):
    def test_round_trip(self):
        s = {"step": "email", "name": "Jane Doe", "slots": [{"start": "2026-11-12T16:00:00Z"}], "n": 3}
        self.assertEqual(state.unseal(state.seal(s, KEY, now=1000), KEY, now=1100), s)

    def test_a_changed_state_is_refused(self):
        token = state.seal({"step": "email"}, KEY, now=1000)
        payload, sig = token.split(".")
        forged = state.seal({"step": "confirm"}, OTHER_KEY, now=1000).split(".")[0] + "." + sig
        self.assertIsNone(state.unseal(forged, KEY, now=1000))
        self.assertIsNone(state.unseal(payload[:-2] + "AA." + sig, KEY, now=1000))
        self.assertIsNone(state.unseal(token, OTHER_KEY, now=1000))

    def test_old_or_future_states_are_refused(self):
        token = state.seal({"step": "name"}, KEY, now=1000)
        self.assertIsNotNone(state.unseal(token, KEY, now=1000 + state.MAX_AGE))
        self.assertIsNone(state.unseal(token, KEY, now=1000 + state.MAX_AGE + 1))
        self.assertIsNone(state.unseal(token, KEY, now=500))   # stamped in the future

    def test_garbage_is_refused(self):
        for token in [None, "", "abc", "a.b.c", ".", 5, {"step": "confirm"}, "e30.deadbeef"]:
            self.assertIsNone(state.unseal(token, KEY, now=1000), token)


if __name__ == "__main__":
    unittest.main()
