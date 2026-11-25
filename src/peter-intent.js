// Works out what the user wants to plan from what they said, e.g. "plan something for tomorrow",
// "plan my Friday", "December 3rd", "next week". Returns a session target for
// window.peter.startSession(), or null if no day or week was mentioned.
//
//   { mode: 'day', date: 'YYYY-MM-DD' }
//   { mode: 'week' }                       this week
//   { mode: 'week', weekStart: 'YYYY-MM-DD' }

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

const day = (d) => ({ mode: 'day', date: toISO(d) });

export function parsePlanTarget(text, now = new Date()) {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')} `;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/ next week /.test(t)) {
    // Same as the app's "this week" on a Sunday (the week starting tomorrow), else Monday + 7.
    const dow = today.getDay();
    const start = dow === 0 ? addDays(today, 1) : addDays(today, 7 - (dow - 1));
    return { mode: 'week', weekStart: toISO(start) };
  }

  if (/ day after tomorrow /.test(t)) return day(addDays(today, 2));
  if (/ (tomorrow|tmrw|tmr) /.test(t)) return day(addDays(today, 1));
  if (/ (today|tonight|this morning|this afternoon|this evening) /.test(t)) return day(today);

  // "december 3", "dec 3rd"
  const monthDay = t.match(new RegExp(` (${MONTHS.join('|')})[a-z]* (\\d{1,2})(st|nd|rd|th)? `));
  if (monthDay) {
    let d = new Date(today.getFullYear(), MONTHS.indexOf(monthDay[1]), Number(monthDay[2]));
    if (d < today) d = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
    return day(d);
  }

  // "the 28th": this month, or next month if it's already passed
  const ordinal = t.match(/ the (\d{1,2})(st|nd|rd|th) /);
  if (ordinal) {
    let d = new Date(today.getFullYear(), today.getMonth(), Number(ordinal[1]));
    if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, Number(ordinal[1]));
    return day(d);
  }

  // "friday", "next friday": the next one coming (a week out if it's today and they said "next")
  const weekday = t.match(new RegExp(` (next )?(${DAY_NAMES.join('|')})s? `));
  if (weekday) {
    const target = DAY_NAMES.indexOf(weekday[2]);
    let ahead = (target - today.getDay() + 7) % 7;
    if (ahead === 0 && weekday[1]) ahead = 7;
    return day(addDays(today, ahead));
  }

  if (/ week /.test(t)) return { mode: 'week' };
  if (/ day /.test(t)) return day(today);
  return null;
}
