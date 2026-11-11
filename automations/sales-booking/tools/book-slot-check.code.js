const input = $('Book Inputs').first().json;
const threadRows = $('Read Thread State').all().map(i => i.json).filter(r => r.threadId === input.threadId);
const thread = threadRows.length > 0 ? threadRows[0] : null;
const fixture = $('Read Fixture Calendar').all().map(i => i.json).filter(r => r.status === 'booked' && r.startsAt && r.endsAt);
const requester = String(input.requesterEmail || '').toLowerCase();
const offers = thread && thread.offeredSlotIds ? String(thread.offeredSlotIds).split(',') : [];
const offer = offers.map(o => o.split('|')).find(p => p[0] === input.slotId);
const s = Date.parse(input.slotId);
let reason = '';
let len = 30;
if (!thread) {
  reason = 'unknown thread';
} else if (thread.requesterEmail !== requester) {
  reason = 'requester does not match thread';
} else if (thread.bookedSlotId) {
  reason = 'thread already has a booking';
} else if (!offer) {
  reason = 'slot was not offered in this thread';
} else if (isNaN(s)) {
  reason = 'invalid slot id';
} else {
  len = Number(offer[1]) === 45 ? 45 : 30;
  const e = s + len * 60000;
  if (fixture.some(r => r.bookedBy === requester)) {
    reason = 'requester already has an active booking';
  } else if (fixture.some(r => s - 15 * 60000 < Date.parse(r.endsAt) + 15 * 60000 && Date.parse(r.startsAt) - 15 * 60000 < e + 15 * 60000)) {
    reason = 'slot is no longer free';
  }
}
const ok = reason === '';
const endsAt = isNaN(s) ? '' : new Date(s + len * 60000).toISOString();
return [{ json: {
  ok: ok,
  reason: reason,
  threadId: input.threadId,
  requesterEmail: requester,
  slotId: input.slotId,
  startsAt: isNaN(s) ? '' : input.slotId,
  endsAt: endsAt,
  status: ok ? 'booked' : 'rejected'
} }];
