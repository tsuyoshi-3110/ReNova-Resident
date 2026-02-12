// src/app/lib/useResidentSession.ts
"use client";

import { useSyncExternalStore } from "react";
import type { ResidentSession } from "./residentSession";
import {
  RESIDENT_SESSION_STORAGE_KEY,
  loadResidentSession,
} from "./residentSession";

/**
 * ✅ getSnapshot は「同じ状態なら同じ参照」を返さないと
 * 「The result of getSnapshot should be cached」警告や無限ループの原因になる。
 *
 * → localStorage の raw 文字列をキーにキャッシュする。
 */

function subscribe(onStoreChange: () => void): () => void {
  const handler = () => onStoreChange();

  // 同一タブ：明示イベント
  window.addEventListener("residentSession", handler);

  // 別タブ：storageイベント
  window.addEventListener("storage", handler);

  return () => {
    window.removeEventListener("residentSession", handler);
    window.removeEventListener("storage", handler);
  };
}

let lastRaw: string | null = null;
let lastParsed: ResidentSession | null = null;

function getSnapshot(): ResidentSession | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(RESIDENT_SESSION_STORAGE_KEY);

  // ✅ raw が同じなら必ず同じ参照を返す
  if (raw === lastRaw) return lastParsed;

  lastRaw = raw;

  if (!raw) {
    lastParsed = null;
    return lastParsed;
  }

  // 既存のパーサ（型ガード含む）を使う
  const parsed = loadResidentSession();
  lastParsed = parsed;
  return lastParsed;
}

function getServerSnapshot(): ResidentSession | null {
  // SSR中は localStorage が無いので null 固定
  return null;
}

export function useResidentSession(): ResidentSession | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
