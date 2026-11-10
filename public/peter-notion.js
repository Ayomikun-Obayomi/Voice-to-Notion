// Everything Peter does in Notion. Runs in Electron's main process (Notion's API can't be
// called from the app window directly because of browser security rules).
const store = require('./peter-store');
const dates = require('./peter-dates');

const NOTION_VERSION = '2022-06-28';

function token() {
  const t = store.getSecret('notionToken');
  if (!t) throw new Error('NOTION_NOT_CONNECTED');
  return t;
}

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('NOTION_NOT_CONNECTED');
  if (!res.ok) {
    const err = new Error(data.message || `Notion error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const text = (s) => [{ type: 'text', text: { content: String(s || '').slice(0, 2000) } }];
const plain = (rich) => (rich || []).map((r) => r.plain_text).join('');

// ---------- Connection ----------

function isConnected() {
  return !!store.getSecret('notionToken');
}

function saveConnection({ token: t, template, workspace }) {
  store.setSecret('notionToken', t);
  store.set('notionWorkspace', workspace || '');
  if (template) store.set('peterPageId', template);
}

function disconnect() {
  store.setSecret('notionToken', null);
  store.set('peterPageId', null);
  store.set('activeWeek', null);
}

// ---------- Peter's home page ----------

async function pageExists(id) {
  try {
    const page = await notion('GET', `/pages/${id}`);
    return !page.archived && !page.in_trash;
  } catch (e) {
    if (e.status === 404 || e.status === 400) return false;
    throw e;
  }
}

// Finds the "Peter" page the user shared (or Notion copied from the template).
async function ensurePeterPage() {
  const saved = store.get('peterPageId');
  if (saved && (await pageExists(saved))) return saved;

  const result = await notion('POST', '/search', {
    filter: { property: 'object', value: 'page' },
    page_size: 50,
  });
  const pages = (result.results || []).filter((p) => !p.archived && p.parent?.type !== 'database_id');
  const titleOf = (p) => plain(Object.values(p.properties || {}).find((v) => v.type === 'title')?.title);
  const peter = pages.find((p) => titleOf(p).trim().toLowerCase() === 'peter') || pages[0];

  if (!peter) throw new Error('NO_PETER_PAGE');
  store.set('peterPageId', peter.id);
  return peter.id;
}

// ---------- Creating sessions ----------

function databaseProperties(mode, range) {
  const props = {
    Task: { title: {} },
    Rank: { number: { format: 'number' } },
    Why: { rich_text: {} },
    Done: { checkbox: {} },
  };
  if (mode === 'week') {
    props.Day = { select: { options: dates.weekDays(range).map((d) => ({ name: d.name })) } };
    props.Date = { date: {} };
  }
  return props;
}

function rowProperties(task, mode) {
  const props = {
    Task: { title: text(task.title) },
    Rank: { number: task.rank },
    Why: { rich_text: text(task.why) },
    Done: { checkbox: !!task.done },
  };
  if (mode === 'week') {
    props.Day = { select: { name: dates.dayName(task.date) } };
    props.Date = { date: { start: task.date } };
  }
  return props;
}

// Rows are added in order so Notion shows them sorted (the API can't set a view's sort).
async function addRows(databaseId, tasks, mode) {
  const created = [];
  for (const t of tasks) {
    const page = await notion('POST', '/pages', {
      parent: { database_id: databaseId },
      properties: rowProperties(t, mode),
    });
    created.push({ ...t, id: page.id });
  }
  return created;
}

async function createSession({ mode, range, tasks }) {
  const peterPageId = await ensurePeterPage();
  const title = mode === 'week'
    ? `Week · ${dates.weekLabel(range)}`
    : `Day · ${dates.dayLabel(dates.todayISO())}`;

  const page = await notion('POST', '/pages', {
    parent: { page_id: peterPageId },
    icon: { type: 'emoji', emoji: mode === 'week' ? '🗓️' : '☀️' },
    properties: { title: { title: text(title) } },
  });

  const db = await notion('POST', '/databases', {
    parent: { type: 'page_id', page_id: page.id },
    is_inline: true,
    title: text(mode === 'week' ? 'This week' : 'Today'),
    properties: databaseProperties(mode, range),
  });

  const created = await addRows(db.id, tasks, mode);

  if (mode === 'week') {
    store.set('activeWeek', { databaseId: db.id, pageId: page.id, start: range.start, end: range.end });
  } else {
    store.set('activeDay', { databaseId: db.id, pageId: page.id, date: dates.todayISO() });
  }
  return { pageId: page.id, databaseId: db.id, url: page.url, tasks: created };
}

// ---------- Reading and editing an existing plan ----------

function rowToTask(row) {
  const p = row.properties;
  return {
    id: row.id,
    title: plain(p.Task?.title),
    rank: p.Rank?.number ?? 999,
    why: plain(p.Why?.rich_text),
    done: !!p.Done?.checkbox,
    date: p.Date?.date?.start || null,
  };
}

async function databaseExists(id) {
  try {
    const db = await notion('GET', `/databases/${id}`);
    return !db.archived && !db.in_trash;
  } catch (e) {
    if (e.status === 404 || e.status === 400) return false;
    throw e;
  }
}

async function queryTasks(databaseId, date) {
  const body = {
    sorts: [{ property: 'Rank', direction: 'ascending' }],
    page_size: 100,
  };
  if (date) body.filter = { property: 'Date', date: { equals: date } };
  const result = await notion('POST', `/databases/${databaseId}/query`, body);
  return (result.results || []).filter((r) => !r.archived).map(rowToTask);
}

// Applies the reviewed list to an existing plan: updates kept tasks, adds new ones, archives removed ones.
async function applyChanges({ databaseId, mode, tasks, removedIds }) {
  const saved = [];
  for (const t of tasks) {
    if (t.id) {
      await notion('PATCH', `/pages/${t.id}`, { properties: rowProperties(t, mode) });
      saved.push(t);
    } else {
      const [created] = await addRows(databaseId, [t], mode);
      saved.push(created);
    }
  }
  for (const id of removedIds || []) {
    await notion('PATCH', `/pages/${id}`, { archived: true });
  }
  return saved;
}

async function setDone(pageId, done) {
  await notion('PATCH', `/pages/${pageId}`, { properties: { Done: { checkbox: !!done } } });
}

module.exports = {
  isConnected,
  saveConnection,
  disconnect,
  ensurePeterPage,
  createSession,
  databaseExists,
  queryTasks,
  applyChanges,
  setDone,
};
