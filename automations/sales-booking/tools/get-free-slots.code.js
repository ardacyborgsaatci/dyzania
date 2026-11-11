const input = $('Booking Inputs').first().json;
const length = Number(input.lengthMinutes) === 45 ? 45 : 30;
const DAY = 24 * 3600 * 1000;
const now = Date.now();
const earliest = now + DAY;
const latest = now + 14 * DAY;
const from = input.fromDate ? Date.parse(input.fromDate) : earliest;
const to = input.toDate ? Date.parse(input.toDate) : latest;
const rangeStart = Math.max(from, earliest);
const rangeEnd = Math.min(to, latest);
const booked = $input.all().map(i => i.json).filter(r => r.status === 'booked' && r.startsAt && r.endsAt);
const busy = booked.map(r => [Date.parse(r.startsAt) - 15 * 60000, Date.parse(r.endsAt) + 15 * 60000]);
const out = [];
const startDay = Math.floor(rangeStart / DAY) * DAY;
for (let d = startDay; d <= rangeEnd && out.length < 12; d += DAY) {
  const dow = new Date(d).getUTCDay();
  if (dow === 0 || dow === 6) { continue; }
  for (let t = 600; t + length <= 960 && out.length < 12; t += 30) {
    const s = d + t * 60000;
    const e = s + length * 60000;
    if (s < rangeStart || s > rangeEnd) { continue; }
    const clash = busy.some(b => s - 15 * 60000 < b[1] && b[0] < e + 15 * 60000);
    if (!clash) {
      const iso = new Date(s).toISOString();
      out.push({ json: { slotId: iso, startsAt: iso, endsAt: new Date(e).toISOString(), lengthMinutes: length } });
    }
  }
}
return out;
