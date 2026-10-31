import { useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { useDictation } from "../useDictation";

interface Props {
  claimId?: string;
  placeholder: string;
  busy: boolean;
  onSend: (text: string, documentIds: string[]) => Promise<void>;
}

const FILE_TYPES = "image/*,application/pdf";

/**
 * Message box. A photo or file is sent to the agent as soon as it's picked (with any text already
 * typed), so the user doesn't have to tap send after taking a picture.
 */
export function Composer({ claimId, placeholder, busy, onSend }: Props) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(0);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dictation = useDictation(setText);

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

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || uploading || !text.trim()) return;
    dictation.stop();
    const t = text.trim();
    setText("");
    await onSend(t, []);
  }

  return (
    <form className="composer" onSubmit={send}>
      {uploading > 0 && (
        <p className="small working">{uploading > 1 ? `מעלה ${uploading} מסמכים ובודק אותם…` : "מעלה את המסמך ובודק אותו…"}</p>
      )}
      <div className="composer-row">
        <button type="button" className="icon-btn" onClick={() => cameraInput.current?.click()} disabled={uploading > 0} aria-label="צילום מסמך">
          📷
        </button>
        <button type="button" className="icon-btn" onClick={() => fileInput.current?.click()} disabled={uploading > 0} aria-label="צירוף קובץ">
          📎
        </button>
        {dictation.supported && (
          <button
            type="button"
            className={`icon-btn mic-btn${dictation.listening ? " listening" : ""}`}
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start(text))}
            aria-label={dictation.listening ? "עצור הקלטה" : "הקלטה קולית"}
            aria-pressed={dictation.listening}
          >
            {dictation.listening ? "⏹" : "🎤"}
          </button>
        )}
        <textarea
          rows={1}
          value={text}
          placeholder={dictation.listening ? "מקשיב… אפשר לדבר" : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="send-btn" disabled={busy || uploading > 0} aria-label="שלח">
          ➤
        </button>
      </div>
      {dictation.error && <p className="small error">{dictation.error}</p>}
      {/* capture opens the camera directly on phones; the other input offers files and the gallery */}
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => sendFiles(e.target)} />
      <input ref={fileInput} type="file" accept={FILE_TYPES} multiple hidden onChange={(e) => sendFiles(e.target)} />
    </form>
  );
}
