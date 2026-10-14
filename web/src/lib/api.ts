export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:3001';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

const TOKEN_KEY = 'studymind.token';
const USER_KEY = 'studymind.user';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
  prefs?: Record<string, unknown>;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: SessionUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Fires when the API reports the session is gone, so the shell can redirect. */
export const SESSION_EXPIRED_EVENT = 'studymind:session-expired';

export async function apiFetch<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = true, headers, ...rest } = opts;

  const finalHeaders: Record<string, string> = {
    ...(headers as Record<string, string> | undefined),
  };

  if (auth) {
    const token = getToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }
  // Only set a JSON content-type when we actually send a JSON body; setting it
  // on FormData breaks the multipart boundary.
  if (rest.body && !(rest.body instanceof FormData) && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...rest, headers: finalHeaders });
  } catch {
    throw new ApiRequestError(0, {
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const error = (body as { error?: ApiError })?.error ?? {
      code: 'UNKNOWN',
      message: 'Something went wrong. Please try again.',
    };

    // An expired/absent session should bounce the user to /login exactly once.
    if (res.status === 401 && (error.code === 'TOKEN_EXPIRED' || error.code === 'INVALID_TOKEN' || error.code === 'NO_TOKEN')) {
      clearSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
    }
    throw new ApiRequestError(res.status, error);
  }

  return body as T;
}

/* ------------------------------ endpoints ------------------------------ */

export interface SourceSummary {
  id: string;
  type: 'pdf' | 'pptx' | 'image' | 'video' | 'audio' | 'text';
  title: string;
  status: 'queued' | 'extracting' | 'indexing' | 'ready' | 'failed';
  statusReason: string | null;
  embeddingStatus: 'queued' | 'pending' | 'ready' | 'failed';
  outline: Array<{ title: string; page: number | null; slide: number | null; level: number }>;
  progress: number;
  pageCount: number | null;
  durationSec: number | null;
  sizeBytes: number | null;
  unitCount: number;
  createdAt: string;
  topics: string[];
}

export interface Citation {
  unitId: string;
  sourceId: string;
  sourceTitle: string;
  label: string;
  excerpt: string;
  location: { page?: number; slide?: number; startSec?: number; endSec?: number };
}

export interface TutorAnswer {
  answer: string;
  citations: Citation[];
  groundingStatus: 'full' | 'partial' | 'outside_material';
  outsideKnowledge: string | null;
  language: 'en' | 'hi';
  topSimilarity: number;
  lexicalOverlap: number;
  audit: {
    citedRequested: number;
    citedVerified: number;
    stripped: number;
    declined: boolean;
  };
  unsearchableCount?: number;
  usingSource?: { id: string; title: string } | null;
  threadId?: string;
  messageId?: string;
  attachment?: { type: 'pdf'; messageId: string; url?: string };
}

export interface TopicNode {
  id: string;
  name: string;
  parentId: string | null;
  prerequisiteIds: string[];
  keyConcepts: string[];
  summary: string | null;
  sourceUnitIds: string[];
  pLearned: number;
  attempts: number;
  children?: TopicNode[];
}

export interface MasteryRow {
  topicId: string;
  name: string;
  pLearned: number;
  retention: number;
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  band: 'weak' | 'developing' | 'strong';
  attempts: number;
  lastReviewedAt: string | null;
  lastReviewedDaysAgo: number;
  stability: number;
  history: Array<{ at: string; pLearned: number; retention: number }>;
  priority: number;
  daysToExam: number | null;
}

export const api = {
  login: (body: { email: string; password: string }) =>
    apiFetch<{ token: string; user: SessionUser }>('/auth/login', {
      method: 'POST',
      auth: false,
      body: JSON.stringify(body),
    }),

  register: (body: { name: string; email: string; phone: string; password: string }) =>
    apiFetch<{ token: string; user: SessionUser }>('/auth/register', {
      method: 'POST',
      auth: false,
      body: JSON.stringify(body),
    }),

  me: () => apiFetch<{ user: SessionUser }>('/auth/me'),
  deleteMyData: () => apiFetch<void>('/auth/me/data', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) }),

  updateMe: (body: Record<string, unknown>) =>
    apiFetch<{ user: SessionUser }>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),

  dashboard: () => apiFetch<any>('/dashboard'),
  sources: () => apiFetch<{ sources: SourceSummary[] }>('/sources'),
  source: (id: string) => apiFetch<any>(`/sources/${id}`),
  deleteSource: (id: string) => apiFetch<void>(`/sources/${id}`, { method: 'DELETE' }),
  /**
   * Exchanges the login JWT for a 5-minute, single-source file token and returns
   * a ready-to-use URL. Media elements cannot send an Authorization header, so
   * this is how <iframe>/<video>/<audio> get access — WITHOUT ever putting the
   * long-lived login JWT in a URL.
   */
  sourceFileUrl: async (id: string): Promise<string> => {
    const res = await apiFetch<{ url: string; expiresInSec: number }>(`/sources/${id}/file-token`, {
      method: 'POST',
    });
    return `${API_URL}${res.url}`;
  },

  uploadSource: (form: FormData, onProgress?: (pct: number) => void) =>
    uploadWithProgress('/sources', form, onProgress),

  topics: () => apiFetch<{ topics: TopicNode[]; flat: TopicNode[] }>('/topics'),

  ask: (body: { question: string; threadId?: string; language?: 'en' | 'hi'; scope?: { sourceIds?: string[]; topicIds?: string[]; sectionTitle?: string } }) =>
    apiFetch<TutorAnswer>('/tutor/ask', { method: 'POST', body: JSON.stringify(body) }),
  generatePdf: async (body: { messageId?: string; threadId?: string; prompt?: string }) => {
    const { url } = await apiFetch<{ url: string }>('/tutor/pdf', { method: 'POST', body: JSON.stringify(body) });
    const token = getToken();
    const res = await fetch(`${API_URL}${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('Could not download the PDF report.');
    return res.blob();
  },
  downloadPdfAttachment: async (messageId: string): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(`${API_URL}/api/tutor/pdf/messages/${encodeURIComponent(messageId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('Could not download the PDF attachment.');
    return res.blob();
  },
  chatHistory: () => apiFetch<{ threads: Array<{ id: string; title: string; scope: any; lastMessageAt: string }> }>('/tutor/threads'),
  chatThread: (id: string) => apiFetch<any>(`/tutor/threads/${id}`),
  renameThread: (id: string, title: string) => apiFetch<any>(`/tutor/threads/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deleteThread: (id: string) => apiFetch<void>(`/tutor/threads/${id}`, { method: 'DELETE' }),

  createAssessment: (body: Record<string, unknown>) =>
    apiFetch<any>('/assessments', { method: 'POST', body: JSON.stringify(body) }),
  assessment: (id: string) => apiFetch<any>(`/assessments/${id}`),
  answer: (id: string, body: { questionId: string; answer: string | number; timeSpentSec?: number }) =>
    apiFetch<any>(`/assessments/${id}/answers`, { method: 'POST', body: JSON.stringify(body) }),
  submit: (id: string) => apiFetch<any>(`/assessments/${id}/submit`, { method: 'POST' }),
  report: (id: string) => apiFetch<any>(`/assessments/${id}/report`),
  assessments: () => apiFetch<{ assessments: any[] }>('/assessments'),

  mastery: () => apiFetch<{ topics: MasteryRow[]; summary: any }>('/mastery'),
  studyPlan: () => apiFetch<{ tasks: any[] }>('/study-plan'),
  completeTask: (id: string) => apiFetch<any>(`/study-plan/tasks/${id}/complete`, { method: 'POST' }),
  revision: (topicId: string) => apiFetch<any>(`/revision/${topicId}`),
  intake: (body: Record<string, unknown>) =>
    apiFetch<any>('/onboarding/intake', { method: 'POST', body: JSON.stringify(body) }),

  evalResults: () => apiFetch<any>('/eval/results'),
};

/**
 * fetch() cannot report upload progress, so XHR is used for the one call that
 * needs a progress bar. Falls back to fetch when XHR is unavailable (SSR/tests).
 */
function uploadWithProgress(path: string, form: FormData, onProgress?: (pct: number) => void) {
  return new Promise<{ sourceId: string; status: string }>((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      apiFetch<{ sourceId: string; status: string }>(path, { method: 'POST', body: form })
        .then(resolve)
        .catch(reject);
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else {
        reject(
          new ApiRequestError(
            xhr.status,
            body?.error ?? { code: 'UPLOAD_FAILED', message: 'Upload failed. Please try again.' }
          )
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new ApiRequestError(0, { code: 'NETWORK_ERROR', message: 'Upload failed. Check your connection.' })
      );
    xhr.send(form);
  });
}