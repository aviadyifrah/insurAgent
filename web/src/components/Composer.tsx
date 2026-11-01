import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { useDictation } from "../useDictation";

interface Props {
  claimId?: string;
  placeholder: string;
  busy: boolean;
  onSend: (text: string, documentIds: string[]) => Promise<void>;
}

const FILE_TYPES = "image/*,application/pdf";
const MAX_TEXTAREA_PX = 140;

/**
 * WhatsApp-style message bar: a wide rounded box with attach and camera inside it, and one round
 * button that is a mic when the box is empty and send when there's text. A photo or file is sent
 * as soon as it's picked (with any text already typed).
 */
export function Composer({ claimId, placeholder, busy, onSend }: Props) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(0);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(setText);
  // Text in the box before recording started, restored if the recording is cancelled.
  const beforeRecording = useRef("");
  // No typing while a document uploads (here or from a task card, which sets `busy`), so a message
  // can't race ahead of the document it refers to.
  const locked = uploading > 0 || busy;
  const hasText = text.trim().length > 0;

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  async function sendFiles(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length === 0) return;
    dictation.stop();
    setUploading(files.length);
    try {
      const docs = await Promise.all(files.map((f) => api.upload(f, claimId)));
      const t = text.trim();
      setText("");
      await onSend(t, docs.map((d) => d.id));
    } catch (err) {
      alert(errorMessage(err, "ההעלאה נכשלה. אפשר לנסות שוב (תמונה או PDF)."));
    } finally {
      setUploading(0);
    }
  }

  async function sendText(t = text) {
    if (locked || !t.trim()) return;
    dictation.stop();
    setText("");
    await onSend(t.trim(), []);
  }

  function startRecording() {
    beforeRecording.current = text;
    dictation.start(text);
  }

  function cancelRecording() {
    dictation.stop();
    setText(beforeRecording.current);
  }

  function editRecording() {
    dictation.stop();
    setTimeout(() => textarea.current?.focus(), 0);
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        sendText();
      }}
    >
      {uploading > 0 && (
        <p className="small working">{uploading > 1 ? `מעלה ${uploading} מסמכים ובודק אותם…` : "מעלה את המסמך ובודק אותו…"}</p>
      )}

      {dictation.listening ? (
        <div className="wa-row">
          <div className="wa-pill recording" onClick={editRecording} role="button" aria-label="עצור ועבור לעריכה">
            <span className="rec-dot" aria-hidden="true" />
            <span className="rec-text">{text.slice(beforeRecording.current.length).trim() || "מקשיב… אפשר לדבר"}</span>
            <button type="button" className="wa-icon" onClick={(e) => (e.stopPropagation(), cancelRecording())} aria-label="בטל הקלטה">
              🗑
            </button>
          </div>
          <button type="button" className="wa-round" onClick={() => sendText()} aria-label="שלח">
            <SendIcon />
          </button>
        </div>
      ) : (
        <div className="wa-row">
          <div className={`wa-pill${locked ? " locked" : ""}`}>
            <textarea
              ref={textarea}
              rows={1}
              value={text}
              disabled={locked}
              placeholder={uploading > 0 ? "רגע, מעלה את המסמך…" : busy ? "רגע…" : placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendText();
                }
              }}
            />
            <button type="button" className="wa-icon" onClick={() => fileInput.current?.click()} disabled={locked} aria-label="צירוף קובץ">
              📎
            </button>
            {!hasText && (
              <button type="button" className="wa-icon" onClick={() => cameraInput.current?.click()} disabled={locked} aria-label="צילום מסמך">
                📷
              </button>
            )}
          </div>
          {hasText || !dictation.supported ? (
            <button type="submit" className="wa-round" disabled={locked || !hasText} aria-label="שלח">
              <SendIcon />
            </button>
          ) : (
            <button type="button" className="wa-round" onClick={startRecording} disabled={locked} aria-label="הקלטה קולית">
              <MicIcon />
            </button>
          )}
        </div>
      )}

      {dictation.error && <p className="small error">{dictation.error}</p>}
      {/* capture opens the camera directly on phones; the other input offers files and the gallery */}
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => sendFiles(e.target)} />
      <input ref={fileInput} type="file" accept={FILE_TYPES} multiple hidden onChange={(e) => sendFiles(e.target)} />
    </form>
  );
}

function SendIcon() {
  // Points left: the direction text flows in Hebrew.
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M21.4 20.6 3 12l18.4-8.6c.5-.2 1 .3.8.8L19.8 11H11v2h8.8l2.4 6.8c.2.5-.3 1-.8.8z" transform="scale(-1,1) translate(-24,0)" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1a7 7 0 0 0 6-6.9h-2z" />
    </svg>
  );
}
