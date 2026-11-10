import React, { useState, useRef, useEffect, useCallback } from 'react';
import PlanSession from './PlanSession';

// Picks the plan mode out of what was said with the wake word ("Peter, plan my week").
function modeFromSpeech(text) {
  if (/\bweek\b/.test(text)) return 'week';
  if (/\b(day|today)\b/.test(text)) return 'day';
  return undefined;
}

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
    utterance.rate = 1;
    utterance.onend = () => {
      if (callback) callback();
    };
    window.speechSynthesis.speak(utterance);
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

  // Wake word: waits for a phrase with "Peter" in it.
  const startGlobalListening = () => {
    if (stopGlobalRef.current) return;
    setIsGlobalListening(true);
    stopGlobalRef.current = listen({
      onFinal: (text) => {
        const t = text.toLowerCase();
        if (t.includes('peter')) {
          stopGlobalListening();
          openSession(modeFromSpeech(t));
        }
      },
      onError: onSpeechError,
      onEnd: stopGlobalListening,
    });
  };

  // Mic for the plan session: keeps every finished phrase and shows the one in progress after it.
  const startTaskListening = () => {
    stopTaskRef.current?.();
    finalTranscriptRef.current = '';
    setTranscript('');
    setIsListening(true);

    let stopped = false;
    let stopListening = null;
    // Wait until Peter stops talking, or the mic types out Peter's own words.
    const begin = () => {
      if (stopped) return;
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        setTimeout(begin, 200);
        return;
      }
      stopListening = listen({
        onPartial: (text) => setTranscript(finalTranscriptRef.current + text),
        onFinal: (text) => {
          finalTranscriptRef.current += text + ' ';
          setTranscript(finalTranscriptRef.current);
        },
        onError: onSpeechError,
        onEnd: () => setIsListening(false),
      });
    };
    setTimeout(begin, 300);

    stopTaskRef.current = () => {
      stopped = true;
      stopListening?.();
    };
  };

  const stopTaskListening = () => {
    stopTaskRef.current?.();
    stopTaskRef.current = null;
    setIsListening(false);
  };

  const openSession = (mode) => {
    stopGlobalListening();
    setSession({ mode });
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
    startGlobalListening();
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
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => openSession('day')} style={{ flex: 1, padding: '12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>☀️ Plan my day</button>
            <button onClick={() => openSession('week')} style={{ flex: 1, padding: '12px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>🗓️ Plan my week</button>
          </div>
          <p style={{ textAlign: 'center', fontSize: '12px', color: '#64748b', margin: '10px 0 0' }}>Or say "Hey Peter" to start planning</p>
        </div>
      )}
    </div>
  );
}
