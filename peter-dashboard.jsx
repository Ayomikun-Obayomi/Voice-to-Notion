const startListening = () => {
  if (isListening) {
    recognitionRef.current?.stop();
    setIsListening(false);
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('Speech Recognition not available'); return; }
  
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onstart = () => setIsListening(true);
  recognition.onend = () => setIsListening(false);
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        setTranscript(t);
      } else {
        interim += t;
      }
    }
    if (interim) setTranscript(interim);
  };
  recognition.start();
  recognitionRef.current = recognition;
};
