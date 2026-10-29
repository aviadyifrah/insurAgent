import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where, type Query } from "firebase/firestore";
import { db } from "./firebase";
import type { ChatMessage, Claim, ClaimView, DocumentRow, EmailDraft, Requirement, Task } from "./types";

const byCreated = (a: { created_at: string }, b: { created_at: string }) => a.created_at.localeCompare(b.created_at);

/**
 * Live view of one claim straight from Firestore: the chat, tasks and checklist update as the
 * agent works. Every query filters on user_id, which the security rules require.
 */
export function useClaimLive(claimId: string, uid: string): ClaimView | null | "not_found" {
  const [parts, setParts] = useState<Partial<ClaimView> & { claimMissing?: boolean; own?: DocumentRow[]; reusable?: DocumentRow[] }>({});

  useEffect(() => {
    setParts({});
    const sub = (name: string) => query(collection(db, "claims", claimId, name), where("user_id", "==", uid));
    const listen = <T,>(q: Query, key: string, sort?: (a: T, b: T) => number) =>
      onSnapshot(q, (snap) => {
        const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
        if (sort) rows.sort(sort);
        setParts((p) => ({ ...p, [key]: rows }));
      });

    const unsubs = [
      onSnapshot(
        doc(db, "claims", claimId),
        (snap) => setParts((p) => (snap.exists() ? { ...p, claim: { ...snap.data(), id: snap.id } as Claim } : { ...p, claimMissing: true })),
        () => setParts((p) => ({ ...p, claimMissing: true })),
      ),
      listen<Requirement>(sub("requirements"), "requirements", (a, b) => a.sort - b.sort),
      listen<Task>(sub("tasks"), "tasks", byCreated),
      listen<EmailDraft>(sub("emails"), "emails", byCreated),
      listen<ChatMessage>(sub("chat"), "chat", byCreated),
      listen<DocumentRow>(query(collection(db, "documents"), where("user_id", "==", uid), where("claim_id", "==", claimId)), "own"),
      listen<DocumentRow>(query(collection(db, "documents"), where("user_id", "==", uid), where("reusable", "==", true)), "reusable"),
    ];
    return () => unsubs.forEach((u) => u());
  }, [claimId, uid]);

  if (parts.claimMissing) return "not_found";
  const { claim, requirements, tasks, emails, chat, own, reusable } = parts;
  if (!claim || !requirements || !tasks || !emails || !chat || !own || !reusable) return null;
  const documents = [...new Map([...own, ...reusable].map((d) => [d.id, d])).values()].sort(byCreated);
  return { claim, requirements, tasks, emails, chat, documents };
}
