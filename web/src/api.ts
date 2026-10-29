import type { ClaimSummary, ClaimView, DocumentRow, Task, User } from "./types";
import { documentStore } from "./documentStore";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: isForm ? init.headers : { "Content-Type": "application/json", ...init.headers },
  });
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

export const api = {
  login: (email: string, consent: boolean) => post<User>("/login", { email, consent }),
  logout: () => post("/logout"),
  me: () => request<User>("/me"),
  updateMe: (patch: Partial<User>) => request<User>("/me", { method: "PUT", body: JSON.stringify(patch) }),

  claims: () => request<ClaimSummary[]>("/claims"),
  openTasks: () => request<Task[]>("/tasks"),
  claim: (id: number) => request<ClaimView>(`/claims/${id}`),
  createClaim: (text: string, document_ids: number[]) => post<ClaimView>("/claims", { text, document_ids }),
  sendMessage: (claimId: number, text: string, document_ids: number[]) =>
    post<ClaimView>(`/claims/${claimId}/messages`, { text, document_ids }),
  markSubmitted: (claimId: number) => post<ClaimView>(`/claims/${claimId}/submitted`),

  /** Keeps the file in the document store and sends it to the server once, for analysis only. */
  async upload(file: File, claimId?: number): Promise<DocumentRow> {
    const prepared = await prepareFile(file);
    const ref = await documentStore.put(prepared, prepared.name);
    const form = new FormData();
    form.append("file", prepared);
    form.append("storage", documentStore.kind);
    form.append("storage_ref", ref);
    if (claimId) form.append("claim_id", String(claimId));
    return request<DocumentRow>("/documents", { method: "POST", body: form });
  },

  completeTask: (taskId: number, document_ids: number[] = [], note?: string) =>
    post<ClaimView>(`/tasks/${taskId}/complete`, { document_ids, note }),
  async sign(taskId: number, pngDataUrl: string) {
    const blob = await (await fetch(pngDataUrl)).blob();
    const ref = await documentStore.put(blob, "signature.png");
    return post<ClaimView>(`/tasks/${taskId}/signature`, { storage: documentStore.kind, storage_ref: ref });
  },
  emailSent: (emailId: number) => post<ClaimView>(`/emails/${emailId}/sent`),
};
