import React, { useState, useRef, useEffect } from 'react';

export default function PeterDashboard() {
  const [tasks, setTasks] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [parsedTask, setParsedTask] = useState(null);
  const [notionKey, setNotionKey] = useState(localStorage.getItem('notionKey') || '');
  const [databaseId, setDatabaseId] = useState(localStorage.getItem('databaseId') || '');
  const [anthropicKey, setAnthropicKey] = useState(localStorage.getItem('anthropicKey') || '');
  const [confirmationMode, setConfirmationMode] = useState(localStorage.getItem('confirmationMode') === 'true');
  const [status, setStatus] = useState('idle');
  const [isGlobalListening, setIsGlobalListening] = useState(false);
  
  const recognitionRef = useRef(null);
  const globalRecognitionRef = useRef(null);
  const finalTranscriptRef = useRef('');

  const speakMessage = (text, callback) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onend = () => {
      if (callback) callback();
    };
    window.speechSynthesis.speak(utterance);
  };

  const startGlobalListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsGlobalListening(true);
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript.toLowerCase();
        if (event.results[i].isFinal) interim = t;
      }
      if (interim.includes('peter')) {
        recognition.stop();
        setIsGlobalListening(false);
        speakMessage('Hey, how can I help you today?', () => {
          startTaskListening();
        });
      }
    };

    recognition.onerror = () => {};
    recognition.onend = () => {
      if (isGlobalListening) setTimeout(() => recognition.start(), 500);
    };

    recognition.start();
    globalRecognitionRef.current = recognition;
  };

  const startTaskListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setStatus('listening');
    };

    recognition.onresult = (event) => {
      let interim = '', final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t + ' ';
        else interim += t;
      }
      if (final) finalTranscriptRef.current = final;
      setTranscript(finalTranscriptRef.current + interim);
      if (final.trim().length > 5) {
        recognition.stop();
        parseTask(final.trim());
      }
    };

    recognition.onend = () => setIsListening(false);
    recognition.start();
    recognitionRef.current = recognition;
  };

  const parseTask = async (text) => {
    if (!anthropicKey) {
      setStatus('error');
      speakMessage('Set API keys first');
      return;
    }
    try {
      setStatus('parsing');
      const res = await fetch('http://localhost:3001/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: anthropicKey,
          payload: {
            model: 'claude-sonnet-4-6',
            max_tokens: 500,
            messages: [{ role: 'user', content: `Parse: "${text}"\nReturn JSON: {"title":"task","dueDate":null}` }]
          }
        })
      });
      const data = await res.json();
      let jsonStr = data.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      setParsedTask(parsed);
      
      if (confirmationMode) {
        setShowReview(true);
        setStatus('review');
        speakMessage('Confirm: ' + parsed.title);
      } else {
        saveTask(parsed);
      }
    } catch (err) {
      setStatus('error');
      speakMessage('Error parsing');
    }
  };

  const saveTask = async (taskToSave) => {
    if (!notionKey || !databaseId) return;
    try {
      setStatus('saving');
      await fetch('http://localhost:3001/api/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: notionKey,
          payload: {
            parent: { database_id: databaseId },
            properties: {
              Title: { title: [{ text: { content: taskToSave.title } }] },
              Status: { select: { name: 'Not Started' } }
            }
          }
        })
      });
      setTasks([...tasks, taskToSave.title]);
      setShowReview(false);
      setTranscript('');
      finalTranscriptRef.current = '';
      setParsedTask(null);
      setStatus('success');
      speakMessage('Task saved!', () => {
        setStatus('idle');
        startGlobalListening();
      });
    } catch (err) {
      setStatus('error');
    }
  };

  const handleSave = () => {
    localStorage.setItem('notionKey', notionKey);
    localStorage.setItem('databaseId', databaseId);
    localStorage.setItem('anthropicKey', anthropicKey);
    localStorage.setItem('confirmationMode', confirmationMode);
    setShowSettings(false);
  };

  useEffect(() => {
    startGlobalListening();
    return () => {
      globalRecognitionRef.current?.stop();
      recognitionRef.current?.stop();
    };
  }, []);

  if (showSettings) {
    return (
      <div style={{ padding: '20px', fontFamily: 'system-ui', height: '100vh', background: '#f1f5f9' }}>
        <button onClick={() => setShowSettings(false)} style={{ fontSize: '20px', background: 'none', border: 'none', cursor: 'pointer' }}>←</button>
        <h1>Settings</h1>
        <input placeholder="Notion API Key" type="password" value={notionKey} onChange={(e) => setNotionKey(e.target.value)} style={{ width: '100%', padding: '10px', marginTop: '10px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px' }} />
        <input placeholder="Database ID" value={databaseId} onChange={(e) => setDatabaseId(e.target.value)} style={{ width: '100%', padding: '10px', marginTop: '10px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px' }} />
        <input placeholder="Anthropic API Key" type="password" value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} style={{ width: '100%', padding: '10px', marginTop: '10px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px' }} />
        
        <div style={{ marginTop: '20px', padding: '15px', background: 'white', borderRadius: '4px', border: '1px solid #ccc' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={confirmationMode} 
              onChange={(e) => setConfirmationMode(e.target.checked)} 
              style={{ marginRight: '10px', width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span>Confirmation Mode (for accessibility)</span>
          </label>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '8px 0 0 28px' }}>Show review screen before saving. Peter will repeat the task back to you.</p>
        </div>
        
        <button onClick={handleSave} style={{ width: '100%', padding: '10px', marginTop: '20px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Save</button>
      </div>
    );
  }

  if (showReview && parsedTask) {
    return (
      <div style={{ padding: '20px', fontFamily: 'system-ui', height: '100vh', background: '#f1f5f9', display: 'flex', flexDirection: 'column' }}>
        <h1>Review Task</h1>
        <div style={{ flex: 1, background: 'white', padding: '20px', borderRadius: '8px', marginTop: '10px' }}>
          <p><strong>Task:</strong> {parsedTask.title}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button onClick={() => { setShowReview(false); setStatus('idle'); startGlobalListening(); }} style={{ flex: 1, padding: '10px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => saveTask(parsedTask)} style={{ flex: 1, padding: '10px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>✓ Save</button>
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
      {isGlobalListening && <div style={{ background: '#d1fae5', padding: '12px', textAlign: 'center' }}>🌍 Listening for "Peter"...</div>}
      {isListening && <div style={{ background: '#e0f2fe', padding: '12px', textAlign: 'center', minHeight: '40px' }}>🎤 {transcript || 'Listening...'}</div>}
      {status === 'parsing' && <div style={{ background: '#fef3c7', padding: '12px', textAlign: 'center' }}>🤔 Parsing...</div>}
      {status === 'success' && <div style={{ background: '#dcfce7', padding: '12px', textAlign: 'center' }}>✅ Saved!</div>}
      {status === 'error' && <div style={{ background: '#fee2e2', padding: '12px', textAlign: 'center' }}>❌ Error</div>}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {tasks.length === 0 ? <p style={{ color: '#64748b', textAlign: 'center', marginTop: '30px' }}>No tasks yet. Say "Hey Peter" to start!</p> : tasks.map((t, i) => <div key={i} style={{ background: 'white', padding: '12px', marginBottom: '8px', borderRadius: '6px' }}>✓ {t}</div>)}
      </div>
      <div style={{ background: 'white', padding: '16px', borderTop: '1px solid #e2e8f0' }}>
        <p style={{ textAlign: 'center', fontSize: '12px', color: '#64748b' }}>Say "Hey Peter" to start planning</p>
      </div>
    </div>
  );
}
