// Turns a brain dump into a ranked plan using Claude (through the Peter Worker).
const { WORKER_URL, PETER_APP_TOKEN } = require('./peter-constants');
const dates = require('./peter-dates');

const RULES = `You are Peter, a planning assistant inside a macOS app.
The user just talked freely about what they need to do. Turn it into a clear, ranked to-do list.

How to write tasks:
- One task per real action. Split bundled items ("email Sam and call the bank" = 2 tasks).
- Short and starting with a verb: "Email Sam about the invoice", not "Sam invoice thing".
- Drop filler, feelings, and anything that is not a task.
- Never invent tasks the user did not mention.

How to rank (1 = do first):
- Hard deadlines and things others are waiting on come first.
- Then important work, with quick wins (under ~15 min) placed early to build momentum.
- Low-urgency "sometime" items go last.
- "why" is one short reason, max 8 words, like "Due Friday" or "Quick win".

Existing tasks (if any are given):
- The user's plan stays the same unless they clearly ask to change it.
- Keep every existing task, with its id and its current order relative to the other existing tasks.
- Only remove an existing task if the user clearly says to (e.g. "drop the gym", "I already did X"). List its id in removed_ids.
- Only reorder existing tasks if the user clearly asks.
- New tasks get id null. Slot them where they make sense.
- Fix a task's wording only if the user asks.

Reply with ONLY valid JSON, no other text.`;

function dayPrompt({ transcript, today, existing }) {
  return `Mode: PLAN MY DAY
Today: ${dates.dayLabel(today)} (${today})

Existing tasks already planned for today, in order:
${existing.length ? JSON.stringify(existing.map((t) => ({ id: t.id, title: t.title, why: t.why })), null, 2) : '(none)'}

What the user said:
"""${transcript}"""

JSON shape:
{
  "tasks": [{ "id": "existing id or null", "title": "...", "rank": 1, "why": "..." }],
  "removed_ids": [],
  "summary": "One friendly sentence Peter says out loud about the plan."
}
Ranks run 1, 2, 3... with no gaps.`;
}

function weekPrompt({ transcript, today, range, existing }) {
  const days = dates.weekDays(range).filter((d) => d.date >= today);
  return `Mode: PLAN MY WEEK
Today: ${dates.dayLabel(today)} (${today})
Days you may schedule on (never earlier than today):
${days.map((d) => `- ${d.name} ${d.date}`).join('\n')}

Existing tasks already in this week's plan:
${existing.length ? JSON.stringify(existing.map((t) => ({ id: t.id, title: t.title, date: t.date, rank: t.rank, why: t.why })), null, 2) : '(none)'}

What the user said:
"""${transcript}"""

Scheduling:
- If the user names a day, use it. Deadlines: schedule the work before the deadline day, not on it when possible.
- Spread work so no single day is overloaded (aim for 3–6 tasks per day).
- Keep existing tasks on their current date unless the user asks to move them.
- Rank tasks within each day separately: every day starts at rank 1.

JSON shape:
{
  "tasks": [{ "id": "existing id or null", "title": "...", "date": "YYYY-MM-DD", "rank": 1, "why": "..." }],
  "removed_ids": [],
  "summary": "One friendly sentence Peter says out loud about the week."
}`;
}

async function callClaude(userPrompt) {
  const res = await fetch(`${WORKER_URL}/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Peter-App': PETER_APP_TOKEN },
    body: JSON.stringify({
      system: RULES,
      max_tokens: 2000,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.error || `Claude request failed (${res.status})`);
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseJSON(text);
}

function parseJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error("Peter couldn't read the plan. Try again.");
  return JSON.parse(text.slice(start, end + 1));
}

// Cleans Claude's answer so the rest of the app can trust it.
function normalize(result, { mode, existing, range, today }) {
  const existingIds = new Set(existing.map((t) => t.id));
  const removed = new Set((result.removed_ids || []).filter((id) => existingIds.has(id)));
  const seen = new Set();

  let tasks = (result.tasks || [])
    .filter((t) => t && typeof t.title === 'string' && t.title.trim())
    .map((t) => {
      const id = t.id && existingIds.has(t.id) && !removed.has(t.id) && !seen.has(t.id) ? t.id : null;
      if (id) seen.add(id);
      const original = id ? existing.find((e) => e.id === id) : null;
      let date = mode === 'week' ? t.date : today;
      if (mode === 'week' && (!date || !dates.inRange(date, range) || date < today)) {
        date = original?.date || today;
      }
      return {
        id,
        title: t.title.trim(),
        why: (t.why || '').trim(),
        rank: Number(t.rank) || 999,
        date,
        done: original ? !!original.done : false,
      };
    });

  // Safety net for "same unless the user says otherwise": if Claude silently dropped an existing
  // task without listing it in removed_ids, put it back.
  for (const e of existing) {
    if (!seen.has(e.id) && !removed.has(e.id)) {
      tasks.push({ ...e, rank: 999 });
    }
  }

  tasks = renumber(tasks);
  return {
    tasks,
    removedIds: [...removed],
    summary: result.summary || 'Here is your plan.',
  };
}

// Sorts by date then rank and renumbers 1..n within each date.
function renumber(tasks) {
  const sorted = [...tasks].sort((a, b) => (a.date === b.date ? a.rank - b.rank : a.date < b.date ? -1 : 1));
  const counters = {};
  return sorted.map((t) => {
    counters[t.date] = (counters[t.date] || 0) + 1;
    return { ...t, rank: counters[t.date] };
  });
}

async function plan(context, transcript) {
  const today = dates.todayISO();
  const prompt = context.mode === 'week'
    ? weekPrompt({ transcript, today, range: context.range, existing: context.existing })
    : dayPrompt({ transcript, today, existing: context.existing });
  const raw = await callClaude(prompt);
  return normalize(raw, { mode: context.mode, existing: context.existing, range: context.range, today });
}

module.exports = { plan, normalize, renumber, parseJSON, dayPrompt, weekPrompt };
