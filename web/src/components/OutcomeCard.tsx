import { useState } from "react";
import { api } from "../api";
import type { Claim } from "../types";
import { WhatsAppButton } from "./WhatsAppButton";

const OUTCOMES = [
  { key: "approved", label: "✅ אושרה" },
  { key: "partial", label: "🟡 אושרה חלקית" },
  { key: "docs_requested", label: "📄 ביקשו עוד מסמכים" },
  { key: "rejected", label: "❌ נדחתה" },
] as const;

type Outcome = (typeof OUTCOMES)[number]["key"];

/** After submission: the user records what the insurer answered. */
export function OutcomeCard({ claimId, claim, act }: { claimId: string; claim: Claim; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [choice, setChoice] = useState<Outcome | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  if (claim.outcome && claim.outcome !== "docs_requested") {
    const label = OUTCOMES.find((o) => o.key === claim.outcome)!.label;
    return (
      <section className="card outcome">
        <strong>{label}</strong>
        {claim.outcome_amount != null && <span> · {claim.outcome_amount.toLocaleString("he-IL")} ₪</span>}
        {claim.outcome === "rejected" && (
          <>
            <p className="small muted">אם יש שאלה על הדחייה או רצון לערער, אפשר לדבר איתנו.</p>
            <WhatsAppButton label="לדבר איתנו על הדחייה" message="שלום, תביעה שהגשתי דרך InsurAgent נדחתה ואשמח להתייעץ." />
          </>
        )}
      </section>
    );
  }

  const needsAmount = choice === "approved" || choice === "partial";
  return (
    <section className="card outcome">
      <strong>מה ענתה חברת הביטוח?</strong>
      <p className="small muted">כשמגיעה תשובה, אפשר לעדכן כאן. אם ביקשו עוד מסמכים, הסוכן יעזור להשלים.</p>
      <div className="outcome-choices">
        {OUTCOMES.map((o) => (
          <button key={o.key} className={choice === o.key ? "primary" : ""} onClick={() => setChoice(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
      {needsAmount && (
        <label>
          כמה אושר? (₪)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
        </label>
      )}
      {choice === "docs_requested" && (
        <label>
          מה ביקשו?
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      {choice && (
        <button
          className="primary wide"
          onClick={() => act(() => api.setOutcome(claimId, choice, needsAmount && amount ? Number(amount.replace(/[^\d.]/g, "")) : null, note))}
        >
          שמירה
        </button>
      )}
    </section>
  );
}
