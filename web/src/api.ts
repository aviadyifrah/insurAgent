import type { AdminOverview, Claim, ClaimSummary, DocumentRow, User } from "./types";
import { documentStore } from "./documentStore";
import { auth } from "./firebase";
import { xlsxToText } from "@insuragent/shared/xlsx";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** User-facing text for a failed request. */
export function errorMessage(err: unknown, fallback = "משהו השתבש. אפשר לנסות שוב."): string {
  if (err instanceof ApiError && err.message === "daily_limit") return "הגעת למכסה היומית. אפשר להמשיך מחר.";
  if (err instanceof ApiError && err.message === "service_busy") return "השירות עמוס היום. אפשר לנסות שוב מחר.";
  if (err instanceof ApiError && err.message === "claim_limit") return "בגרסת הניסיון אפשר לפתוח תיק אחד. לתיק נוסף אפשר לפנות אלינו בוואטסאפ.";
  if (err instanceof ApiError && err.message === "not_a_policy_report") return "לא מצאנו בקובץ רשימת פוליסות. צריך את הקובץ מהר הביטוח.";
  if (err instanceof ApiError && err.message === "unreadable_spreadsheet")
    return "לא הצלחנו לקרוא את קובץ האקסל. אפשר לשמור אותו כ-xlsx, או להעלות צילום מסך או PDF של הדוח.";
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const token = await auth.currentUser?.getIdToken();
  const headers: Record<string, string> = isForm ? {} : { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/** Shrinks phone photos before upload; PDFs pass through untouched. */
async function prepareFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/png") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** First message of a new claim, handed from the home screen to the claim screen. */
export const pendingFirstMessage = new Map<string, { text: string; documentIds: string[] }>();

export const api = {
  config: () => request<{ access_code_required: boolean }>("/config"),
  me: () => request<User>("/me"),
  consent: (access_code: string) => post<User>("/consent", { consent: true, access_code }),
  updateMe: (patch: Partial<User>) => request<User>("/me", { method: "PUT", body: JSON.stringify(patch) }),

  claims: () => request<ClaimSummary[]>("/claims"),
  createClaim: () => post<Claim>("/claims"),
  sendMessage: (claimId: string, text: string, document_ids: string[]) =>
    post<{ ok: boolean }>(`/claims/${claimId}/messages`, { text, document_ids }),
  markSubmitted: (claimId: string) => post<{ ok: boolean }>(`/claims/${claimId}/submitted`),

  /** Keeps the file in the document store and sends it to the server once, for analysis only. */
  async upload(file: File, claimId?: string): Promise<DocumentRow> {
    const prepared = await prepareFile(file);
    const ref = await documentStore.put(prepared, prepared.name);
    const form = new FormData();
    form.append("file", prepared);
    form.append("storage", documentStore.kind);
    form.append("storage_ref", ref);
    if (claimId) form.append("claim_id", claimId);
    return request<DocumentRow>("/documents", { method: "POST", body: form });
  },

  /**
   * Uploads the Har HaBituach policy report. A spreadsheet is read here on the device and only its
   * text is sent; a PDF or screenshot is sent as is. Only the extracted list is kept, not the file.
   */
  async uploadPolicies(file: File): Promise<User> {
    const form = new FormData();
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      form.append("text", await file.text());
    } else if (/\.xlsx?$/i.test(file.name) || file.type.includes("spreadsheet") || file.type.includes("excel")) {
      try {
        form.append("text", await xlsxToText(new Uint8Array(await file.arrayBuffer())));
      } catch {
        throw new ApiError(400, "unreadable_spreadsheet");
      }
    } else {
      form.append("file", await prepareFile(file));
    }
    return request<User>("/me/policies", { method: "POST", body: form });
  },
  deletePolicies: () => request<User>("/me/policies", { method: "DELETE" }),

  completeTask: (claimId: string, taskId: string, document_ids: string[] = [], note?: string) =>
    post<{ ok: boolean }>(`/claims/${claimId}/tasks/${taskId}/complete`, { document_ids, note }),
  async sign(claimId: string, taskId: string, pngDataUrl: string) {
    const blob = await (await fetch(pngDataUrl)).blob();
    const ref = await documentStore.put(blob, "signature.png");
    return post<{ ok: boolean }>(`/claims/${claimId}/tasks/${taskId}/signature`, { storage: documentStore.kind, storage_ref: ref });
  },
  setReminder: (claimId: string, reminderId: string, status: "added" | "dismissed") =>
    post<{ ok: boolean }>(`/claims/${claimId}/reminders/${reminderId}`, { status }),
  patchClaim: (claimId: string, patch: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/claims/${claimId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  setOutcome: (claimId: string, outcome: string, amount: number | null, note: string) =>
    post<{ ok: boolean }>(`/claims/${claimId}/outcome`, { outcome, amount, note }),
  replaceDocument: (claimId: string, requirementId: string, documentId: string) =>
    post<{ ok: boolean }>(`/claims/${claimId}/requirements/${requirementId}/replace`, { document_id: documentId }),

  removeRequirement: (claimId: string, requirementId: string) =>
    request<{ ok: boolean }>(`/claims/${claimId}/requirements/${requirementId}`, { method: "DELETE" }),

  /** Deletes on the server, then removes the files kept on this device. */
  async deleteDocument(documentId: string) {
    const r = await request<{ storage_ref: string }>(`/documents/${documentId}`, { method: "DELETE" });
    await documentStore.remove(r.storage_ref).catch(() => {});
  },
  async deleteClaim(claimId: string) {
    const r = await request<{ storage_refs: string[] }>(`/claims/${claimId}`, { method: "DELETE" });
    await Promise.all(r.storage_refs.map((ref) => documentStore.remove(ref).catch(() => {})));
  },
  async deleteAccount() {
    const r = await request<{ storage_refs: string[] }>("/me", { method: "DELETE" });
    await Promise.all(r.storage_refs.map((ref) => documentStore.remove(ref).catch(() => {})));
  },

  adminOverview: () => request<AdminOverview>("/admin/overview"),
  adminSetLimit: (uid: string, claim_limit: number) => post<{ ok: boolean }>(`/admin/users/${uid}`, { claim_limit }),

  emailSent: (claimId: string, emailId: string) => post<{ ok: boolean }>(`/claims/${claimId}/emails/${emailId}/sent`),
};
