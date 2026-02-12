// src/app/lib/residentSession.ts
export type ResidentSession = {
  shareCode: string;
  projectId: string;
  projectName?: string;
};

// ✅ これが STORAGE_KEY（探す場所はここに統一）
export const RESIDENT_SESSION_STORAGE_KEY = "residentSession";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseSession(raw: string): ResidentSession | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return null;

    const shareCode = typeof v.shareCode === "string" ? v.shareCode : "";
    const projectId = typeof v.projectId === "string" ? v.projectId : "";
    const projectName = typeof v.projectName === "string" ? v.projectName : undefined;

    if (!shareCode || !projectId) return null;

    const out: ResidentSession = { shareCode, projectId };
    if (projectName) out.projectName = projectName;
    return out;
  } catch {
    return null;
  }
}

export function loadResidentSession(): ResidentSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(RESIDENT_SESSION_STORAGE_KEY);
  if (!raw) return null;
  return parseSession(raw);
}

export function saveResidentSession(session: ResidentSession): void {
  if (typeof window === "undefined") return;

  // undefined を混ぜない（Firestoreじゃないが、データ品質のため）
  const safe: ResidentSession = {
    shareCode: session.shareCode,
    projectId: session.projectId,
    ...(session.projectName ? { projectName: session.projectName } : {}),
  };

  window.localStorage.setItem(RESIDENT_SESSION_STORAGE_KEY, JSON.stringify(safe));

  // ✅ 同一タブに通知（useSyncExternalStore 用）
  window.dispatchEvent(new Event("residentSession"));
}

export function clearResidentSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(RESIDENT_SESSION_STORAGE_KEY);
  window.dispatchEvent(new Event("residentSession"));
}
