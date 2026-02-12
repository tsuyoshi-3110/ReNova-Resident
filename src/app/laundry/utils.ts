// src/app/laundry/utils.ts
import type { LaundryStatus } from "./types";

export function yyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isDateKey(v: string): boolean {
  // YYYY-MM-DD の簡易チェック
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export const STATUS_HELP: Record<LaundryStatus, string> = {
  ok: "干してOK",
  limited: "作業時間外はOK",
  ng: "干さないで",
};

export const STATUS_LABEL: Record<LaundryStatus, string> = {
  ok: "◯",
  limited: "△",
  ng: "×",
};

/**
 * 1フロアの部屋数が maxRooms で、実際の roomsLen が少ない時に
 * 右寄せ/中央寄せしたい場合の左パディング数。
 * ※あなたのUI意図に合わせて「中央寄せ」。
 */
export function calcIndent(maxRooms: number, roomsLen: number): number {
  if (maxRooms <= 0) return 0;
  if (roomsLen <= 0) return 0;
  if (roomsLen >= maxRooms) return 0;
  return Math.floor((maxRooms - roomsLen) / 2);
}
