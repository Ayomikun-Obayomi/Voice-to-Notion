// The Day / Week session flow:
//   start(mode) → what Peter says first, and any tasks already planned
//   plan(context, transcript) → Claude's ranked proposal for the review screen
//   save(context, reviewed) → writes to Notion
const notion = require('./peter-notion');
const planner = require('./peter-planner');
const dates = require('./peter-dates');
const store = require('./peter-store');

// Returns the saved week plan if it covers `date` and still exists in Notion.
async function activeWeekFor(date) {
  const week = store.get('activeWeek');
  if (!week || !dates.inRange(date, week)) return null;
  if (!(await notion.databaseExists(week.databaseId))) {
    store.set('activeWeek', null);
    return null;
  }
  return week;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

async function start(mode) {
  const today = dates.todayISO();

  if (mode === 'day') {
    const week = await activeWeekFor(today);
    if (week) {
      const existing = await notion.queryTasks(week.databaseId, today);
      const greeting = existing.length
        ? `You already have ${plural(existing.length, 'task')} planned for today from your week plan. ` +
          `I'll keep them as they are, but you can add new tasks, remove some, or change the order. What would you like to do?`
        : `Your week plan has nothing for today yet. Tell me what you'd like to add, and I'll put it in today's plan.`;
      return { mode, source: 'week', target: week, existing, today, greeting };
    }
    return {
      mode,
      source: 'new',
      existing: [],
      today,
      greeting: "What do you want to get done today? Just talk, and I'll turn it into a ranked list.",
    };
  }

  // Week
  const range = dates.weekRange();
  const week = store.get('activeWeek');
  const sameWeek = week && week.start === range.start && (await notion.databaseExists(week.databaseId));
  if (sameWeek) {
    const existing = await notion.queryTasks(week.databaseId);
    const greeting =
      `You already have a plan for this week with ${plural(existing.length, 'task')}. ` +
      `I'll keep it as it is, but you can add tasks, remove some, move them to other days, or change the order. What would you like to do?`;
    return { mode, source: 'week', target: week, existing, today: dates.todayISO(), range, greeting };
  }
  return {
    mode,
    source: 'new',
    existing: [],
    today: dates.todayISO(),
    range,
    greeting: `Let's plan your week, ${dates.weekLabel(range)}. Tell me everything on your mind, and mention any deadlines or days you already know.`,
  };
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
  const tasks = planner.renumber(
    reviewed.tasks.map((t) => ({ ...t, date: context.mode === 'week' ? t.date : context.today }))
  );

  // Anything that existed before but is no longer in the list was removed by the user.
  const keptIds = new Set(tasks.filter((t) => t.id).map((t) => t.id));
  const removedIds = context.existing.map((t) => t.id).filter((id) => !keptIds.has(id));

  if (context.source === 'week') {
    // Today's plan (or this week's plan) lives inside the week page: edit it in place.
    const saved = await notion.applyChanges({
      databaseId: context.target.databaseId,
      mode: 'week',
      tasks,
      removedIds,
    });
    return { tasks: saved, where: 'week' };
  }

  const created = await notion.createSession({ mode: context.mode, range: context.range, tasks });
  return { tasks: created.tasks, where: context.mode, url: created.url };
}

// For the widget: today's tasks, from the week plan and/or today's day plan.
async function todayTasks() {
  const today = dates.todayISO();
  const result = [];
  const week = await activeWeekFor(today);
  if (week) result.push(...(await notion.queryTasks(week.databaseId, today)));

  const day = store.get('activeDay');
  if (day && day.date === today && (await notion.databaseExists(day.databaseId))) {
    result.push(...(await notion.queryTasks(day.databaseId)));
  }
  return result.sort((a, b) => a.rank - b.rank);
}

module.exports = { start, plan, save, todayTasks };
