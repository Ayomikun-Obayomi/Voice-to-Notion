// peter-speech: listens to the microphone with Apple's speech recognizer and prints what it hears
// to stdout, one JSON object per line. Peter's main process (public/peter-speech.js) runs it.
//
//   {"type":"ready"}                            listening started
//   {"type":"partial","text":"plan my"}         words so far in the current phrase
//   {"type":"final","text":"Plan my week."}     the phrase is finished (after a short pause)
//   {"type":"error","code":"...","message":"..."}  then the helper exits
//
// It exits when stdin closes (Peter quit or stopped listening).
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj),
        let line = String(data: data, encoding: .utf8) else { return }
  print(line)
  fflush(stdout)
}

// Set PETER_SPEECH_DEBUG=1 to log recognizer results to stderr.
let debugOn = ProcessInfo.processInfo.environment["PETER_SPEECH_DEBUG"] != nil
func debug(_ message: String) {
  if debugOn { FileHandle.standardError.write(("[peter-speech] " + message + "\n").data(using: .utf8)!) }
}

func fail(_ code: String, _ message: String) -> Never {
  emit(["type": "error", "code": code, "message": message])
  exit(1)
}

// A phrase ends after this much silence, like the browser's speech API.
let pauseSeconds = 1.2
let maxPhraseSeconds = 15.0

final class Listener {
  let recognizer: SFSpeechRecognizer
  let engine = AVAudioEngine()
  var request: SFSpeechAudioBufferRecognitionRequest?
  var task: SFSpeechRecognitionTask?
  var lastText = ""
  var phraseStart = Date()
  var pauseTimer: Timer?
  var failuresInARow = 0

  init(recognizer: SFSpeechRecognizer) {
    self.recognizer = recognizer
  }

  func start() {
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0 else { fail("audio-capture", "No microphone found.") }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.request?.append(buffer)
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      fail("audio-capture", "Couldn't start the microphone: \(error.localizedDescription)")
    }
    newPhrase()
    emit(["type": "ready"])
  }

  func newPhrase() {
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    req.addsPunctuation = true
    // Keep audio on the Mac when the on-device model is available.
    if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
    request = req
    lastText = ""
    phraseStart = Date()
    task = recognizer.recognitionTask(with: req) { [weak self] result, error in
      DispatchQueue.main.async { self?.handle(req, result, error) }
    }
  }

  // Ends the current phrase after a pause. Sends its text as final ourselves: once a request
  // ends, the recognizer often answers "No speech detected" instead of a final result.
  func finishPhrase() {
    pauseTimer?.invalidate()
    if !lastText.isEmpty { emit(["type": "final", "text": lastText]) }
    let oldTask = task
    request?.endAudio()
    newPhrase()
    oldTask?.cancel()
  }

  func handle(_ req: SFSpeechAudioBufferRecognitionRequest, _ result: SFSpeechRecognitionResult?, _ error: Error?) {
    let isCurrent = req === request
    debug("result current=\(isCurrent) final=\(result?.isFinal ?? false) text=\(result?.bestTranscription.formattedString ?? "-") error=\(error.map { "\($0)" } ?? "-")")

    // Phrases we already finished were sent as final in finishPhrase().
    guard isCurrent else { return }

    if let result = result {
      failuresInARow = 0
      let text = result.bestTranscription.formattedString
      if result.isFinal {
        pauseTimer?.invalidate()
        if !text.isEmpty { emit(["type": "final", "text": text]) }
        newPhrase()
        return
      }
      guard text != lastText else { return }
      lastText = text
      emit(["type": "partial", "text": text])
      // With constant background talk there's never a pause, so cap how long a phrase runs.
      if Date().timeIntervalSince(phraseStart) > maxPhraseSeconds {
        finishPhrase()
        return
      }
      pauseTimer?.invalidate()
      pauseTimer = Timer.scheduledTimer(withTimeInterval: pauseSeconds, repeats: false) { [weak self] _ in
        self?.finishPhrase()
      }
      return
    }

    // Errors also happen normally (for example "no speech detected"): keep the words we had
    // and start a fresh phrase. Only give up if it keeps failing without hearing anything.
    guard error != nil else { return }
    pauseTimer?.invalidate()
    if !lastText.isEmpty { emit(["type": "final", "text": lastText]) }
    // Silence ("No speech detected", code 1110) is normal while waiting for the wake word.
    let nsError = error! as NSError
    let isSilence = nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 1110
    if !isSilence { failuresInARow += 1 }
    if failuresInARow >= 5 {
      fail("recognizer-failed", "Speech recognition keeps failing: \(error!.localizedDescription)")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.newPhrase() }
  }
}

// Stop when Peter closes our stdin.
FileHandle.standardInput.readabilityHandler = { handle in
  if handle.availableData.isEmpty { exit(0) }
}

let localeId = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "en-US"
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else {
  fail("language-not-supported", "Speech recognition doesn't support \(localeId).")
}

var listener: Listener?

SFSpeechRecognizer.requestAuthorization { status in
  DispatchQueue.main.async {
    guard status == .authorized else {
      fail("not-allowed", "Speech recognition is turned off for Peter. Allow it in System Settings → Privacy & Security → Speech Recognition.")
    }
    AVCaptureDevice.requestAccess(for: .audio) { granted in
      DispatchQueue.main.async {
        guard granted else {
          fail("not-allowed", "Peter can't use the microphone. Allow it in System Settings → Privacy & Security → Microphone.")
        }
        guard recognizer.isAvailable else { fail("unavailable", "Speech recognition isn't available right now.") }
        listener = Listener(recognizer: recognizer)
        listener?.start()
      }
    }
  }
}

RunLoop.main.run()
