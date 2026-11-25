// The Day / Week session flow:
//   start(target) → what Peter says first, and any tasks already planned
//   plan(context, transcript) → Claude's ranked proposal for the review screen
//   save(context, reviewed) → writes to Notion
//
// A target is { mode: 'day', date? } (any day, default today) or { mode: 'week', weekStart? }
// (default this week). A plain 'day' / 'week' string works too.
const notion = require('./peter-notion');
const planner = require('./peter-planner');
const dates = require('./peter-dates');
const store = require('./peter-store');

// ---------- Saved plans ----------
// weekPlans: { [weekStart]: { databaseId, pageId, start, end } }
// dayPlans:  { [date]: { databaseId, pageId, date } }

function plans(kind) {
  const saved = store.get(kind) || {};
  // Plans saved before Peter could keep more than one.
  const legacy = store.get(kind === 'weekPlans' ? 'activeWeek' : 'activeDay');
  if (legacy) {
    saved[legacy.start || legacy.date] = legacy;
    store.set(kind, saved);
    store.set(kind === 'weekPlans' ? 'activeWeek' : 'activeDay', null);
  }
  return saved;
}

function savePlan(kind, key, plan) {
  const saved = plans(kind);
  if (plan) saved[key] = plan;
  else delete saved[key];
  store.set(kind, saved);
}

// Returns the saved plan if it still exists in Notion (forgets it otherwise).
async function stillThere(kind, key, plan) {
  if (!plan) return null;
  if (await notion.databaseExists(plan.databaseId)) return plan;
  savePlan(kind, key, null);
  return null;
}

// The saved week plan whose week contains `date`.
async function weekPlanFor(date) {
  const entry = Object.entries(plans('weekPlans')).find(([, w]) => dates.inRange(date, w));
  return entry ? stillThere('weekPlans', entry[0], entry[1]) : null;
}

async function dayPlanFor(date) {
  return stillThere('dayPlans', date, plans('dayPlans')[date]);
}

// ---------- Session ----------

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function normalizeTarget(target) {
  const t = typeof target === 'string' ? { mode: target } : { ...(target || { mode: 'day' }) };
  if (t.mode !== 'week') t.mode = 'day';
  return t;
}

async function start(rawTarget) {
  const target = normalizeTarget(rawTarget);
  const today = dates.todayISO();

  if (target.mode === 'day') {
    const date = target.date && target.date >= today ? target.date : today;
    const isToday = date === today;
    const forWhen = isToday ? 'for today' : `for ${dates.spokenDay(date)}`;
    const base = { mode: 'day', today, date };

    const week = await weekPlanFor(date);
    if (week) {
      const existing = await notion.queryTasks(week.databaseId, date);
      const greeting = existing.length
        ? `You already have ${plural(existing.length, 'task')} planned ${forWhen} from your week plan. ` +
          `I'll keep them as they are, but you can add new tasks, remove some, or change the order. What would you like to do?`
        : `Your week plan has nothing ${forWhen} yet. Tell me what you'd like to add.`;
      return { ...base, source: 'week', target: week, existing, greeting };
    }

    const day = await dayPlanFor(date);
    if (day) {
      const existing = await notion.queryTasks(day.databaseId);
      const greeting =
        `You already have a plan ${forWhen} with ${plural(existing.length, 'task')}. ` +
        `I'll keep it as it is, but you can add tasks, remove some, or change the order. What would you like to do?`;
      return { ...base, source: 'day', target: day, existing, greeting };
    }

    const greeting = isToday
      ? "What do you want to get done today? Just talk, and I'll turn it into a ranked list."
      : `OK, what do you want to plan for ${dates.spokenDay(date)}? Just talk, and I'll turn it into a ranked list.`;
    return { ...base, source: 'new', existing: [], greeting };
  }

  // Week
  const range = target.weekStart ? dates.weekOf(target.weekStart) : dates.weekRange();
  const isThisWeek = range.start === dates.weekRange().start;
  const which = isThisWeek ? 'this week' : `the week of ${dates.weekLabel(range)}`;
  const base = { mode: 'week', today, range };

  const week = await stillThere('weekPlans', range.start, plans('weekPlans')[range.start]);
  if (week) {
    const existing = await notion.queryTasks(week.databaseId);
    const greeting =
      `You already have a plan for ${which} with ${plural(existing.length, 'task')}. ` +
      `I'll keep it as it is, but you can add tasks, remove some, move them to other days, or change the order. What would you like to do?`;
    return { ...base, source: 'week', target: week, existing, greeting };
  }
  const greeting = isThisWeek
    ? `Let's plan your week, ${dates.weekLabel(range)}. Tell me everything on your mind, and mention any deadlines or days you already know.`
    : `OK, let's plan the week of ${dates.weekLabel(range)}. Tell me everything on your mind, and mention any deadlines or days you already know.`;
  return { ...base, source: 'new', existing: [], greeting };
}

async function plan(context, transcript) {
  if (!transcript || !transcript.trim()) {
    // Nothing said: keep the plan exactly as it is.
    return { tasks: planner.renumber(context.existing), removedIds: [], summary: 'No changes. Your plan stays the same.' };
  }
  return planner.plan(context, transcript);
}

// `reviewed` is the list after the user edited it on the review screen.
async function save(context, reviewed) {
  const dayDate = context.date || context.today;
  const tasks = planner.renumber(
    reviewed.tasks.map((t) => ({ ...t, date: context.mode === 'week' ? t.date : dayDate }))
  );

  // Anything that existed before but is no longer in the list was removed by the user.
  const keptIds = new Set(tasks.filter((t) => t.id).map((t) => t.id));
  const removedIds = context.existing.map((t) => t.id).filter((id) => !keptIds.has(id));

  if (context.source === 'week' || context.source === 'day') {
    // The plan already exists in Notion (a day inside a week plan, or a day plan): edit it in place.
    const saved = await notion.applyChanges({
      databaseId: context.target.databaseId,
      mode: context.source,
      tasks,
      removedIds,
    });
    return { tasks: saved, where: context.source };
  }

  const created = await notion.createSession({ mode: context.mode, range: context.range, date: dayDate, tasks });
  if (context.mode === 'week') {
    savePlan('weekPlans', context.range.start, {
      databaseId: created.databaseId, pageId: created.pageId, start: context.range.start, end: context.range.end,
    });
  } else {
    savePlan('dayPlans', dayDate, { databaseId: created.databaseId, pageId: created.pageId, date: dayDate });
  }
  return { tasks: created.tasks, where: context.mode, url: created.url };
}

// For the widget: today's tasks, from the week plan and/or today's day plan.
async function todayTasks() {
  const today = dates.todayISO();
  const result = [];
  const week = await weekPlanFor(today);
  if (week) result.push(...(await notion.queryTasks(week.databaseId, today)));

  const day = await dayPlanFor(today);
  if (day) result.push(...(await notion.queryTasks(day.databaseId)));
  return result.sort((a, b) => a.rank - b.rank);
}

module.exports = { start, plan, save, todayTasks };
