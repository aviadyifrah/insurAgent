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

// Chrome on Android repeats earlier phrases inside later results in continuous mode, which doubles
// and triples words. There we listen one phrase at a time and restart until the user stops.
const ONE_PHRASE_AT_A_TIME = /Android/i.test(navigator.userAgent);

const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(" ");

/**
 * Hebrew speech-to-text via the browser's speech service. `onText` receives the full dictated
 * text so far (final + in-progress), to show live in the message box.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const wantListening = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => recognition.current?.stop(), []);

  /** One recognition session; `committed` is the text from before it (typed text and earlier phrases). */
  function listen(committed: string) {
    const r = new Ctor!();
    r.lang = "he-IL";
    r.continuous = !ONE_PHRASE_AT_A_TIME;
    r.interimResults = true;
    let sessionFinal = "";
    r.onresult = (e) => {
      // Rebuild the session's text from all its results rather than appending, so a result the
      // recognizer sends again can't be added twice.
      let finals = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals = join(finals, res[0].transcript);
        else interim = join(interim, res[0].transcript);
      }
      sessionFinal = finals;
      onTextRef.current(join(committed, join(finals, interim)));
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantListening.current = false;
        setError("אין הרשאה למיקרופון. אפשר לאשר בהגדרות הדפדפן.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        wantListening.current = false;
        setError("ההקלטה נעצרה. אפשר לנסות שוב.");
      }
    };
    r.onend = () => {
      if (recognition.current !== r) return;
      const next = join(committed, sessionFinal);
      if (wantListening.current && ONE_PHRASE_AT_A_TIME) {
        onTextRef.current(next);
        listen(next); // keep going with the next phrase
        return;
      }
      wantListening.current = false;
      recognition.current = null;
      setListening(false);
    };
    recognition.current = r;
    r.start();
  }

  function start(prefix: string) {
    if (!Ctor || listening) return;
    setError("");
    wantListening.current = true;
    setListening(true);
    listen(prefix);
  }

  /** Stops listening. Results that arrive after this are dropped, so the text stays as shown. */
  function stop() {
    wantListening.current = false;
    const r = recognition.current;
    recognition.current = null;
    if (!r) return;
    r.onresult = null;
    r.stop();
    setListening(false);
  }

  return { supported: !!Ctor, listening, error, start, stop };
}
