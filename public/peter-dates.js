// Date helpers. Everything uses the Mac's local time and YYYY-MM-DD strings.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function todayISO(now = new Date()) {
  return toISO(now);
}

// Monday–Sunday. On a Sunday, "plan my week" plans the week that starts tomorrow.
function weekRange(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = today.getDay();
  const start = dow === 0 ? addDays(today, 1) : addDays(today, -(dow - 1));
  const end = addDays(start, 6);
  return { start: toISO(start), end: toISO(end) };
}

// The Monday–Sunday week that contains `iso` (no Sunday shift, unlike weekRange).
function weekOf(iso) {
  const d = fromISO(iso);
  const dow = d.getDay();
  const start = addDays(d, dow === 0 ? -6 : -(dow - 1));
  return { start: toISO(start), end: toISO(addDays(start, 6)) };
}

function weekDays(range) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(fromISO(range.start), i);
    days.push({ date: toISO(d), name: DAY_NAMES[d.getDay()] });
  }
  return days;
}

function dayName(iso) {
  return DAY_NAMES[fromISO(iso).getDay()];
}

// "Tue, Oct 20"
function dayLabel(iso) {
  const d = fromISO(iso);
  return `${DAY_NAMES[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "Wednesday, November 25", for things Peter says out loud.
function spokenDay(iso) {
  const d = fromISO(iso);
  return `${FULL_DAY_NAMES[d.getDay()]}, ${FULL_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// "Oct 19–25" or "Oct 26 – Nov 1"
function weekLabel(range) {
  const s = fromISO(range.start);
  const e = fromISO(range.end);
  if (s.getMonth() === e.getMonth()) return `${MONTHS[s.getMonth()]} ${s.getDate()}–${e.getDate()}`;
  return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}`;
}

function inRange(iso, range) {
  return iso >= range.start && iso <= range.end;
}

module.exports = { toISO, fromISO, todayISO, weekRange, weekOf, weekDays, dayName, dayLabel, spokenDay, weekLabel, inRange };
