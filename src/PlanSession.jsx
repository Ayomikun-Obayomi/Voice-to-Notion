import React, { useEffect, useRef, useState } from 'react';

// Day / Week planning session.
//
// Props:
//   initialMode   'day' | 'week' | undefined   Skip the picker if the voice flow already knows the mode.
//   liveTranscript string                       Text from the existing voice recognition. While the user
//                                               is talking, it flows into the editable box below.
//   isListening   boolean                       Whether the mic is currently on (for the status line).
//   onStartListening / onStopListening          Hooks into the existing voice code.
//   onClose       () => void
//   speak         (text) => void                Optional. Defaults to the system voice.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAY_NAMES[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function defaultSpeak(text) {
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {
    /* speech is optional; the text is always on screen */
  }
}

// Group tasks by date (week mode) and keep ranks 1..n within each group.
function groupByDate(tasks) {
  const groups = {};
  for (const t of tasks) (groups[t.date] ||= []).push(t);
  return Object.keys(groups)
    .sort()
    .map((date) => ({ date, tasks: groups[date].sort((a, b) => a.rank - b.rank) }));
}

function renumber(tasks) {
  const counters = {};
  return [...tasks]
    .sort((a, b) => (a.date === b.date ? a.rank - b.rank : a.date < b.date ? -1 : 1))
    .map((t) => {
      counters[t.date] = (counters[t.date] || 0) + 1;
      return { ...t, rank: counters[t.date] };
    });
}

let tempId = 0;
const keyOf = (t) => t.id || t._key || (t._key = `new-${++tempId}`);

export default function PlanSession({
  initialMode,
  liveTranscript = '',
  isListening = false,
  onStartListening,
  onStopListening,
  onClose,
  speak = defaultSpeak,
}) {
  const [step, setStep] = useState(initialMode ? 'loading' : 'choose'); // choose → loading → talk → planning → review → saving → done
  const [connected, setConnected] = useState(null);
  const [context, setContext] = useState(null);
  const [peterSays, setPeterSays] = useState('Hello, what can I help you plan today or the entire week?');
  const [transcript, setTranscript] = useState('');
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [savedUrl, setSavedUrl] = useState(null);
  const userEdited = useRef(false);

  // Notion connection status
  useEffect(() => {
    let off1 = () => {};
    let off2 = () => {};
    window.peter.notionStatus().then((r) => setConnected(r.ok && r.data.connected));
    off1 = window.peter.onNotionConnected(() => {
      setConnected(true);
      setError('');
    });
    off2 = window.peter.onNotionError(({ reason }) => setError(`Notion wasn't connected (${reason}). Try again.`));
    return () => {
      off1();
      off2();
    };
  }, []);

  // Speak whatever Peter says (it's always shown on screen too, for accessibility).
  useEffect(() => {
    if (peterSays) speak(peterSays);
  }, [peterSays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live transcript flows into the box until the user edits it by hand.
  useEffect(() => {
    if (step === 'talk' && !userEdited.current) setTranscript(liveTranscript);
  }, [liveTranscript, step]);

  useEffect(() => {
    if (initialMode && connected) begin(initialMode);
  }, [initialMode, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  async function begin(mode) {
    setError('');
    setStep('loading');
    const r = await window.peter.startSession(mode);
    if (!r.ok) return fail(r.error);
    setContext(r.data);
    setPeterSays(r.data.greeting);
    setTranscript('');
    userEdited.current = false;
    setStep('talk');
    onStartListening?.();
  }

  async function makePlan() {
    onStopListening?.();
    setError('');
    setStep('planning');
    const r = await window.peter.planSession(context, transcript);
    if (!r.ok) return fail(r.error, 'talk');
    setTasks(r.data.tasks);
    setPeterSays(`${r.data.summary} Check the list, then save it.`);
    setStep('review');
  }

  async function savePlan() {
    setError('');
    setStep('saving');
    const clean = tasks.map(({ _key, ...t }) => t);
    const r = await window.peter.saveSession(context, { tasks: clean });
    if (!r.ok) return fail(r.error, 'review');
    setSavedUrl(r.data.url || null);
    const where = r.data.where === 'week' ? 'your week plan in Notion' : 'Notion';
    setPeterSays(`Saved ${clean.length} ${clean.length === 1 ? 'task' : 'tasks'} to ${where}.`);
    setStep('done');
  }

  function fail(err, backTo = 'choose') {
    if (err?.code === 'NOTION_NOT_CONNECTED') setConnected(false);
    setError(err?.message || 'Something went wrong.');
    setStep(backTo);
  }

  // ----- review-list editing -----
  const update = (key, changes) => setTasks((ts) => ts.map((t) => (keyOf(t) === key ? { ...t, ...changes } : t)));
  const remove = (key) => setTasks((ts) => renumber(ts.filter((t) => keyOf(t) !== key)));
  function move(key, direction) {
    setTasks((ts) => {
      const t = ts.find((x) => keyOf(x) === key);
      const sameDay = ts.filter((x) => x.date === t.date).sort((a, b) => a.rank - b.rank);
      const i = sameDay.findIndex((x) => keyOf(x) === key);
      const j = i + direction;
      if (j < 0 || j >= sameDay.length) return ts;
      const other = sameDay[j];
      return ts.map((x) =>
        keyOf(x) === key ? { ...x, rank: other.rank } : keyOf(x) === keyOf(other) ? { ...x, rank: t.rank } : x
      );
    });
  }
  function addTask(date) {
    setTasks((ts) => {
      const count = ts.filter((t) => t.date === date).length;
      return [...ts, { id: null, title: '', why: '', rank: count + 1, date, done: false }];
    });
  }

  const weekDates = context?.range
    ? Array.from({ length: 7 }, (_, i) => {
        const [y, m, d] = context.range.start.split('-').map(Number);
        const dt = new Date(y, m - 1, d + i);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      }).filter((iso) => iso >= context.today)
    : [];

  // ----- UI -----
  if (connected === false) {
    return (
      <Panel onClose={onClose}>
        <PeterLine text="To plan with Peter, connect your Notion. Peter only uses its own Peter page." />
        <button className="w-full rounded-xl bg-slate-900 py-3 font-medium text-white hover:bg-slate-700"
          onClick={() => window.peter.connectNotion()}>
          Connect Notion
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          Your browser opens Notion. Choose "Use a template provided by the developer," then come back here.
        </p>
        {error && <ErrorLine text={error} />}
      </Panel>
    );
  }

  return (
    <Panel onClose={onClose}>
      <PeterLine text={peterSays} />
      {error && <ErrorLine text={error} />}

      {step === 'choose' && (
        <div className="grid grid-cols-2 gap-3">
          <button className="rounded-xl bg-blue-600 py-4 font-medium text-white hover:bg-blue-700" onClick={() => begin('day')}>
            ☀️ Plan my day
          </button>
          <button className="rounded-xl bg-indigo-600 py-4 font-medium text-white hover:bg-indigo-700" onClick={() => begin('week')}>
            🗓️ Plan my week
          </button>
        </div>
      )}

      {(step === 'loading' || step === 'planning' || step === 'saving') && (
        <p className="py-6 text-center text-sm text-slate-500" role="status">
          {step === 'loading' ? 'Checking your plans…' : step === 'planning' ? 'Peter is ranking your tasks…' : 'Saving to Notion…'}
        </p>
      )}

      {step === 'talk' && (
        <div>
          {context?.existing?.length > 0 && (
            <div className="mb-3 rounded-lg bg-slate-50 p-3">
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Already planned</p>
              <ol className="list-decimal pl-5 text-sm text-slate-700">
                {[...context.existing].sort((a, b) => (a.date === b.date ? a.rank - b.rank : a.date < b.date ? -1 : 1))
                  .map((t) => (
                    <li key={t.id}>
                      {t.title}
                      {context.mode === 'week' && t.date && <span className="text-slate-400"> · {dayLabel(t.date)}</span>}
                    </li>
                  ))}
              </ol>
            </div>
          )}
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="peter-transcript">
            {isListening ? '🎤 Listening… you can fix any mistakes here' : 'What you said (you can type or edit)'}
          </label>
          <textarea id="peter-transcript" rows={5}
            className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-blue-500 focus:outline-none"
            value={transcript}
            placeholder={context?.existing?.length ? 'Add tasks, or say what to change. Leave empty to keep it as is.' : 'Start talking…'}
            onChange={(e) => {
              userEdited.current = true;
              setTranscript(e.target.value);
            }}
          />
          <div className="mt-3 flex gap-2">
            {isListening ? (
              <button className="flex-1 rounded-xl border border-slate-300 py-3 text-sm" onClick={() => onStopListening?.()}>
                Stop listening
              </button>
            ) : (
              <button className="flex-1 rounded-xl border border-slate-300 py-3 text-sm" onClick={() => onStartListening?.()}>
                🎤 Talk
              </button>
            )}
            <button className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700" onClick={makePlan}>
              Make my plan
            </button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div>
          {(context.mode === 'week' ? groupByDate(tasks) : [{ date: context.today, tasks: [...tasks].sort((a, b) => a.rank - b.rank) }])
            .map((group) => (
              <div key={group.date} className="mb-4">
                {context.mode === 'week' && <h3 className="mb-1 text-sm font-semibold text-slate-700">{dayLabel(group.date)}</h3>}
                <ul className="space-y-2">
                  {group.tasks.map((t, i) => (
                    <li key={keyOf(t)} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2">
                      <span className="mt-1 w-5 text-right text-sm font-semibold text-slate-400">{t.rank}</span>
                      <div className="flex-1">
                        <input aria-label="Task" className="w-full text-sm font-medium focus:outline-none"
                          value={t.title} placeholder="New task"
                          onChange={(e) => update(keyOf(t), { title: e.target.value })} />
                        {t.why && <p className="text-xs text-slate-500">{t.why}</p>}
                        {context.mode === 'week' && (
                          <select aria-label="Day" className="mt-1 text-xs text-slate-600"
                            value={t.date}
                            onChange={(e) => setTasks((ts) => renumber(ts.map((x) =>
                              keyOf(x) === keyOf(t) ? { ...x, date: e.target.value, rank: 999 } : x)))}>
                            {weekDates.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
                          </select>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <button aria-label="Move up" disabled={i === 0} className="px-1 text-slate-500 disabled:opacity-30"
                          onClick={() => move(keyOf(t), -1)}>▲</button>
                        <button aria-label="Move down" disabled={i === group.tasks.length - 1} className="px-1 text-slate-500 disabled:opacity-30"
                          onClick={() => move(keyOf(t), 1)}>▼</button>
                      </div>
                      <button aria-label="Remove task" className="px-1 text-slate-400 hover:text-red-600" onClick={() => remove(keyOf(t))}>✕</button>
                    </li>
                  ))}
                </ul>
                <button className="mt-1 text-xs text-blue-600" onClick={() => addTask(group.date)}>+ Add task</button>
              </div>
            ))}
          {context.mode === 'week' && tasks.length === 0 && weekDates[0] && (
            <button className="mb-3 text-xs text-blue-600" onClick={() => addTask(weekDates[0])}>+ Add task</button>
          )}
          <div className="flex gap-2">
            <button className="flex-1 rounded-xl border border-slate-300 py-3 text-sm" onClick={() => setStep('talk')}>
              Back
            </button>
            <button className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700"
              disabled={tasks.some((t) => !t.title.trim())} onClick={savePlan}>
              Save to Notion
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="flex gap-2">
          {savedUrl && (
            <a className="flex-1 rounded-xl border border-slate-300 py-3 text-center text-sm" href={savedUrl} target="_blank" rel="noreferrer">
              Open in Notion
            </a>
          )}
          <button className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-medium text-white" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </Panel>
  );
}

function Panel({ children, onClose }) {
  return (
    <div className="relative rounded-2xl bg-white p-4 shadow-lg">
      {onClose && (
        <button aria-label="Close" className="absolute right-3 top-3 text-slate-400 hover:text-slate-700" onClick={onClose}>✕</button>
      )}
      {children}
    </div>
  );
}

// Peter's words are always visible, not just spoken.
function PeterLine({ text }) {
  return (
    <p className="mb-4 pr-6 text-sm text-slate-800" aria-live="polite">
      <span className="font-semibold">🗣️ Peter:</span> {text}
    </p>
  );
}

function ErrorLine({ text }) {
  return <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700" role="alert">{text}</p>;
}
