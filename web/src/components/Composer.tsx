import { useRef, useState } from "react";
import { api, errorMessage } from "../api";
import type { DocumentRow } from "../types";
import { useDictation } from "../useDictation";

interface Props {
  claimId?: string;
  placeholder: string;
  busy: boolean;
  onSend: (text: string, documentIds: string[]) => Promise<void>;
}

/** Message box with attachments; files upload as soon as they're picked. */
export function Composer({ claimId, placeholder, busy, onSend }: Props) {
  const [text, setText] = useState("");
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dictation = useDictation(setText);

  async function pickFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all([...files].map((f) => api.upload(f, claimId)));
      setDocs((d) => [...d, ...uploaded]);
    } catch (err) {
      alert(errorMessage(err, "ההעלאה נכשלה. אפשר לנסות שוב (תמונה או PDF)."));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || uploading || (!text.trim() && docs.length === 0)) return;
    dictation.stop();
    const [t, ids] = [text.trim(), docs.map((d) => d.id)];
    setText("");
    setDocs([]);
    await onSend(t, ids);
  }

  return (
    <form className="composer" onSubmit={send}>
      {docs.length > 0 && (
        <div className="chips">
          {docs.map((d) => (
            <span key={d.id} className="chip">
              📎 {d.filename}
              <button type="button" onClick={() => setDocs((all) => all.filter((x) => x.id !== d.id))} aria-label="הסר">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-row">
        <button type="button" className="icon-btn" onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="צרף מסמך">
          {uploading ? "⏳" : "📎"}
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
        <button className="send-btn" disabled={busy || uploading} aria-label="שלח">
          ➤
        </button>
      </div>
      {dictation.error && <p className="small error">{dictation.error}</p>}
      <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => pickFiles(e.target.files)} />
    </form>
  );
}
