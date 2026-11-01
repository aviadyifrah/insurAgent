import { useEffect, useRef, useState } from "react";

// The Web Speech API isn't in every TypeScript DOM lib yet; this is the slice we use.
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined =
  (window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

/**
 * Hebrew speech-to-text via the browser's speech service. `onText` receives the full dictated
 * text so far (final + in-progress), to show live in the message box.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => recognition.current?.stop(), []);

  function start(prefix: string) {
    if (!Ctor || listening) return;
    setError("");
    const r = new Ctor();
    r.lang = "he-IL";
    r.continuous = true;
    r.interimResults = true;
    let finalText = prefix ? `${prefix.trimEnd()} ` : "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      onTextRef.current(finalText + interim);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("אין הרשאה למיקרופון. אפשר לאשר בהגדרות הדפדפן.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("ההקלטה נעצרה. אפשר לנסות שוב.");
    };
    r.onend = () => {
      setListening(false);
      recognition.current = null;
    };
    recognition.current = r;
    r.start();
    setListening(true);
  }

  /** Stops listening. Results that arrive after this are dropped, so the text stays as shown. */
  function stop() {
    const r = recognition.current;
    if (!r) return;
    r.onresult = null;
    r.stop();
    setListening(false);
  }

  return { supported: !!Ctor, listening, error, start, stop };
}
