import { useEffect, useState } from "react";
import { documentStore } from "../documentStore";
import type { DocumentRow } from "../types";

/** Opens a document from the document store; says so when it isn't on this device. */
export function DocLink({ doc, children }: { doc: DocumentRow; children: React.ReactNode }) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    documentStore.get(doc.storage_ref).then((f) => setAvailable(!!f));
  }, [doc.storage_ref]);

  async function open(e: React.MouseEvent) {
    e.preventDefault();
    const file = await documentStore.get(doc.storage_ref);
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (available === false) return <span className="muted small">לא שמור במכשיר הזה</span>;
  return (
    <a href="#" onClick={open}>
      {children}
    </a>
  );
}
