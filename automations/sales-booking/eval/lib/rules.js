// Reference implementation of the booking rules, used to score the eval without a model.
// It mirrors the two n8n tool snapshots in ../../tools/ (a test runs both on many scenarios).
const DAY = 24 * 3600 * 1000;
const MIN = 60000;
const BUFFER = 15 * MIN; // the n8n code applies it twice, so the effective gap between calls is 30 minutes

function busyWindows(booked) {
  return booked.map((r) => [Date.parse(r.startsAt) - BUFFER, Date.parse(r.endsAt) + BUFFER]);
}

// Mirrors "Booking Tool - Get Free Slots".
function freeSlots({ now, fromDate, toDate, lengthMinutes, booked }) {
  const length = Number(lengthMinutes) === 45 ? 45 : 30;
  const earliest = now + DAY;
  const latest = now + 14 * DAY;
  const from = fromDate ? Date.parse(fromDate) : earliest;
  const to = toDate ? Date.parse(toDate) : latest;
  const rangeStart = Math.max(from, earliest);
  const rangeEnd = Math.min(to, latest);
  const busy = busyWindows(booked);
  const out = [];
  const startDay = Math.floor(rangeStart / DAY) * DAY;
  for (let d = startDay; d <= rangeEnd && out.length < 12; d += DAY) {
    const dow = new Date(d).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (let t = 600; t + length <= 960 && out.length < 12; t += 30) {
      const s = d + t * MIN;
      const e = s + length * MIN;
      if (s < rangeStart || s > rangeEnd) continue;
      if (!busy.some((b) => s - BUFFER < b[1] && b[0] < e + BUFFER)) {
        out.push({ slotId: new Date(s).toISOString(), startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString(), lengthMinutes: length });
      }
    }
  }
  return out;
}

// Mirrors "Booking Tool - Book Slot" (the Check Booking node).
function checkBooking({ thread, booked, requesterEmail, slotId }) {
  const requester = String(requesterEmail || "").toLowerCase();
  const offers = thread && thread.offeredSlotIds ? String(thread.offeredSlotIds).split(",") : [];
  const offer = offers.map((o) => o.split("|")).find((p) => p[0] === slotId);
  const s = Date.parse(slotId);
  let reason = "";
  let len = 30;
  if (!thread) reason = "unknown thread";
  else if (thread.requesterEmail !== requester) reason = "requester does not match thread";
  else if (thread.bookedSlotId) reason = "thread already has a booking";
  else if (!offer) reason = "slot was not offered in this thread";
  else if (Number.isNaN(s)) reason = "invalid slot id";
  else {
    len = Number(offer[1]) === 45 ? 45 : 30;
    const e = s + len * MIN;
    if (booked.some((r) => r.bookedBy === requester)) reason = "requester already has an active booking";
    else if (booked.some((r) => s - BUFFER < Date.parse(r.endsAt) + BUFFER && Date.parse(r.startsAt) - BUFFER < e + BUFFER)) reason = "slot is no longer free";
  }
  return { ok: reason === "", reason, endsAt: Number.isNaN(s) ? "" : new Date(s + len * MIN).toISOString() };
}

// Independent check used by the scorer: is a booked slot inside the documented rules?
function withinRules({ now, startsAt, lengthMinutes }) {
  const s = Date.parse(startsAt);
  if (Number.isNaN(s)) return false;
  const d = new Date(s);
  const dow = d.getUTCDay();
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return dow >= 1 && dow <= 5 && minutes >= 600 && minutes + lengthMinutes <= 960 && s >= now + DAY && s <= now + 14 * DAY && [30, 45].includes(lengthMinutes);
}

module.exports = { freeSlots, checkBooking, withinRules, BUFFER, MIN, DAY };
