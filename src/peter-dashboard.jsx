import React, { useState, useRef, useEffect, useCallback } from 'react';
import PlanSession from './PlanSession';

// Picks the plan mode out of what was said with the wake word ("Peter, plan my week").
function modeFromSpeech(text) {
  if (/\bweek\b/.test(text)) return 'week';
  if (/\b(day|today)\b/.test(text)) return 'day';
  return undefined;
}

// The browser's default voice on macOS is often a novelty one (Albert, Bubbles…), so pick a
// natural voice: a downloaded Premium/Enhanced one if there is one, otherwise these in order.
const PREFERRED_VOICES = ['Samantha', 'Daniel', 'Reed (English (US))', 'Eddy (English (US))'];

function pickVoice() {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  return (
    voices.find((v) => v.lang === 'en-US' && /\((Premium|Enhanced)\)/.test(v.name)) ||
    PREFERRED_VOICES.map((name) => voices.find((v) => v.name === name)).find(Boolean) ||
    voices.find((v) => v.lang === 'en-US') ||
    null
  );
}

const GREETING = `Hi, I'm Peter. Say "Hey Peter" whenever you want to plan your day or your week.`;

// "Peter", plus spellings the recognizer sometimes hears instead.
const WAKE_WORD = /\b(peter|pete|pita|peta)\b/;

// Speech comes from Apple's recognizer through the peter-speech helper (public/peter-speech.js).
// Only one listener runs at a time. Returns a function that stops it.
function listen({ onPartial, onFinal, onError, onEnd }) {
  const off = window.peter.onSpeech((e) => {
    if (e.type === 'partial') onPartial?.(e.text);
    else if (e.type === 'final') onFinal?.(e.text);
    else if (e.type === 'error') onError?.(e);
    else if (e.type === 'end') onEnd?.();
  });
  window.peter.startSpeech();
  return () => {
    off();
    window.peter.stopSpeech();
  };
}

export default function PeterDashboard() {
  const [tasks, setTasks] = useState([]);
  const [tasksError, setTasksError] = useState('');
  const [notionConnected, setNotionConnected] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [session, setSession] = useState(null); // null, or { mode } while a plan session is open
  const [isGlobalListening, setIsGlobalListening] = useState(false);
  const [voiceError, setVoiceError] = useState(null);

  const stopTaskRef = useRef(null);
  const stopGlobalRef = useRef(null);
  const finalTranscriptRef = useRef('');

  const speakMessage = (text, callback) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = pickVoice();
    utterance.rate = 1;
    utterance.onend = () => {
      if (callback) callback();
    };
    window.speechSynthesis.speak(utterance);
  };

  // Says hello when the app opens. The voice list loads asynchronously, so wait for it
  // (briefly) or pickVoice() falls back to the default novelty voice.
  const greet = (thenListen) => {
    let done = false;
    const sayHello = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.cancel();
      speakMessage(GREETING);
      thenListen();
    };
    if (window.speechSynthesis.getVoices().length) sayHello();
    else {
      window.speechSynthesis.addEventListener('voiceschanged', sayHello, { once: true });
      setTimeout(sayHello, 1000);
    }
  };

  const loadTasks = useCallback(async () => {
    const status = await window.peter.notionStatus();
    const connected = status.ok && status.data.connected;
    setNotionConnected(connected);
    if (!connected) {
      setTasks([]);
      return;
    }
    const r = await window.peter.todayTasks();
    if (r.ok) {
      setTasks(r.data);
      setTasksError('');
    } else {
      setTasksError(r.error.message);
    }
  }, []);

  const toggleDone = async (task) => {
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    const r = await window.peter.setDone(task.id, !task.done);
    if (!r.ok) {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done: task.done } : t)));
      setTasksError(r.error.message);
    }
  };

  const onSpeechError = (e) => {
    console.warn('[peter] speech error:', e.code, e.message);
    setVoiceError(e.message);
  };

  const stopGlobalListening = () => {
    stopGlobalRef.current?.();
    stopGlobalRef.current = null;
    setIsGlobalListening(false);
  };

  // Wake word: reacts as soon as "Peter" is heard, then gives the user a moment to say
  // "plan my day/week" (or until the phrase ends) before opening the session.
  const startGlobalListening = () => {
    if (stopGlobalRef.current) return;
    setIsGlobalListening(true);
    let heard = '';
    let wakeTimer = null;
    const wake = () => {
      clearTimeout(wakeTimer);
      stopGlobalListening();
      openSession(modeFromSpeech(heard), { byVoice: true });
    };
    const onText = (text, isFinal) => {
      const t = text.toLowerCase();
      if (!wakeTimer && !WAKE_WORD.test(t)) return;
      const at = t.search(WAKE_WORD);
      if (at !== -1) heard = t.slice(at);
      if (isFinal || modeFromSpeech(heard)) wake();
      else if (!wakeTimer) wakeTimer = setTimeout(wake, 1500);
    };
    // Waits for Peter to finish talking, since Peter's own lines can say "Peter".
    const stop = listenWhenQuiet({
      onPartial: (text) => onText(text, false),
      onFinal: (text) => onText(text, true),
      onError: onSpeechError,
      onEnd: stopGlobalListening,
    });
    stopGlobalRef.current = () => {
      clearTimeout(wakeTimer);
      stop();
    };
  };

  // Like listen(), but waits until Peter stops talking, or the mic types out Peter's own words.
  const listenWhenQuiet = (handlers) => {
    let stopped = false;
    let stopListening = null;
    const begin = () => {
      if (stopped) return;
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        setTimeout(begin, 200);
        return;
      }
      stopListening = listen(handlers);
    };
    setTimeout(begin, 300);
    return () => {
      stopped = true;
      stopListening?.();
    };
  };

  // Mic for the plan session: keeps every finished phrase and shows the one in progress after it.
  const startTaskListening = () => {
    stopTaskRef.current?.();
    finalTranscriptRef.current = '';
    setTranscript('');
    setIsListening(true);
    stopTaskRef.current = listenWhenQuiet({
      onPartial: (text) => setTranscript(finalTranscriptRef.current + text),
      onFinal: (text) => {
        finalTranscriptRef.current += text + ' ';
        setTranscript(finalTranscriptRef.current);
      },
      onError: onSpeechError,
      onEnd: () => setIsListening(false),
    });
  };

  // After "Hey Peter" with no day/week, the picker asks what to plan: listen for the answer.
  const listenForMode = () => {
    stopTaskRef.current?.();
    const pick = (text) => {
      const mode = modeFromSpeech(text.toLowerCase());
      if (!mode) return;
      stopTaskRef.current?.();
      stopTaskRef.current = null;
      setSession({ mode });
    };
    stopTaskRef.current = listenWhenQuiet({ onPartial: pick, onFinal: pick, onError: onSpeechError });
  };

  const stopTaskListening = () => {
    stopTaskRef.current?.();
    stopTaskRef.current = null;
    setIsListening(false);
  };

  const openSession = (mode, { byVoice = false } = {}) => {
    stopGlobalListening();
    setSession({ mode });
    if (!mode && byVoice) listenForMode();
  };

  const closeSession = () => {
    stopTaskListening();
    setSession(null);
    setTranscript('');
    finalTranscriptRef.current = '';
    loadTasks();
    if (!voiceError) startGlobalListening();
  };

  const disconnectNotion = async () => {
    await window.peter.disconnectNotion();
    loadTasks();
  };

  useEffect(() => {
    loadTasks();
    const offConnected = window.peter.onNotionConnected(() => loadTasks());
    // Start the wake word only once the greeting is queued, so it doesn't hear "Peter" in it.
    greet(startGlobalListening);
    return () => {
      offConnected();
      stopGlobalListening();
      stopTaskRef.current?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (showSettings) {
    return (
      <div style={{ padding: '20px', fontFamily: 'system-ui', height: '100vh', background: '#f1f5f9' }}>
        <button onClick={() => setShowSettings(false)} style={{ fontSize: '20px', background: 'none', border: 'none', cursor: 'pointer' }}>←</button>
        <h1>Settings</h1>
        <div style={{ marginTop: '20px', padding: '15px', background: 'white', borderRadius: '4px', border: '1px solid #ccc' }}>
          <p style={{ margin: 0 }}><strong>Notion:</strong> {notionConnected ? 'Connected' : 'Not connected'}</p>
          {notionConnected ? (
            <button onClick={disconnectNotion} style={{ width: '100%', padding: '10px', marginTop: '12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Disconnect Notion</button>
          ) : (
            <button onClick={() => window.peter.connectNotion()} style={{ width: '100%', padding: '10px', marginTop: '12px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Connect Notion</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', background: '#f1f5f9', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui' }}>
      <div style={{ background: 'white', padding: '16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>🎙️ Peter</h1>
        <button onClick={() => setShowSettings(true)} style={{ fontSize: '20px', background: 'none', border: 'none', cursor: 'pointer' }}>⚙️</button>
      </div>
      {isGlobalListening && !voiceError && <div style={{ background: '#d1fae5', padding: '12px', textAlign: 'center' }}>🌍 Listening for "Peter"...</div>}
      {voiceError && <div style={{ background: '#fef3c7', padding: '12px', textAlign: 'center', fontSize: '13px' }}>🎤 {voiceError} You can still type your tasks.</div>}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {session ? (
          <PlanSession
            initialMode={session.mode}
            liveTranscript={transcript}
            isListening={isListening}
            onStartListening={startTaskListening}
            onStopListening={stopTaskListening}
            onClose={closeSession}
            speak={(text) => { window.speechSynthesis.cancel(); speakMessage(text); }}
          />
        ) : (
          <>
            <h2 style={{ fontSize: '14px', color: '#64748b', margin: '0 0 8px' }}>Today</h2>
            {tasksError && <div style={{ background: '#fee2e2', padding: '12px', borderRadius: '6px', marginBottom: '8px' }}>❌ {tasksError}</div>}
            {notionConnected === false ? (
              <p style={{ color: '#64748b', textAlign: 'center', marginTop: '30px' }}>Connect Notion to see today's tasks.</p>
            ) : tasks.length === 0 ? (
              <p style={{ color: '#64748b', textAlign: 'center', marginTop: '30px' }}>No tasks yet. Say "Hey Peter" to start!</p>
            ) : (
              tasks.map((t) => (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'white', padding: '12px', marginBottom: '8px', borderRadius: '6px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={t.done} onChange={() => toggleDone(t)} style={{ width: '18px', height: '18px' }} />
                  <span style={{ textDecoration: t.done ? 'line-through' : 'none', color: t.done ? '#94a3b8' : '#0f172a' }}>{t.title}</span>
                </label>
              ))
            )}
          </>
        )}
      </div>
      {!session && (
        <div style={{ background: 'white', padding: '16px', borderTop: '1px solid #e2e8f0' }}>
          <p style={{ textAlign: 'center', fontSize: '13px', color: '#64748b', margin: 0 }}>Say "Hey Peter" to start planning</p>
          {/* Without voice there's no other way in, so offer the typed flow. */}
          {voiceError && (
            <button onClick={() => openSession()} style={{ display: 'block', margin: '8px auto 0', background: 'none', border: 'none', color: '#2563eb', fontSize: '13px', cursor: 'pointer' }}>Plan by typing instead</button>
          )}
        </div>
      )}
    </div>
  );
}
