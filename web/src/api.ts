import type { ClaimSummary, ClaimView, DocumentRow, Task, User } from "./types";

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
  login: (email: string) => post<User>("/login", { email }),
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

  async upload(file: File, claimId?: number): Promise<DocumentRow> {
    const form = new FormData();
    form.append("file", await prepareFile(file));
    if (claimId) form.append("claim_id", String(claimId));
    return request<DocumentRow>("/documents", { method: "POST", body: form });
  },
  fileUrl: (documentId: number) => `/api/documents/${documentId}/file`,

  completeTask: (taskId: number, document_ids: number[] = [], note?: string) =>
    post<ClaimView>(`/tasks/${taskId}/complete`, { document_ids, note }),
  sign: (taskId: number, image: string) => post<ClaimView>(`/tasks/${taskId}/signature`, { image }),
  emailSent: (emailId: number) => post<ClaimView>(`/emails/${emailId}/sent`),
};
