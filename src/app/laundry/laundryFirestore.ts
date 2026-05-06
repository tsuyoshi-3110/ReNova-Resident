// src/app/laundry/laundryFirestore.ts
import { db } from "../lib/firebaseClient";
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";

import type { LaundryStatus } from "./types";

/* =========================
   Types (v2)
========================= */

export type LaundryFloorDef = {
  floor: number;
  roomsCount: number;
  roomNos: number[];
  startNo?: number;
};

export type LaundrySectionDef = {
  sectionKey: string; // "A" "B" "N" etc
  sectionName: string; // UIには出さないが、互換のため保持
  floors: LaundryFloorDef[];
};

export type LaundryBoardConfigV2 = {
  version: 2;
  sections: LaundrySectionDef[];
  updatedAt?: number;
};

/* =========================
   refs
========================= */

function configRef(projectId: string) {
  return doc(db, "projects", projectId, "laundry", "config");
}

function statusRef(projectId: string, dateKey: string) {
  return doc(db, "projects", projectId, "laundryStatus", dateKey);
}

function projectRef(projectId: string) {
  return doc(db, "projects", projectId);
}

/* =========================
   small helpers
========================= */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Firestoreで「配列のはずが Map { '0':..., '1':... }」になる救済
 */
function toArrayLike(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;

  if (isPlainObject(v)) {
    const entries = Object.entries(v);
    entries.sort((a, b) => {
      const ak = Number(a[0]);
      const bk = Number(b[0]);
      const aIsNum = Number.isFinite(ak);
      const bIsNum = Number.isFinite(bk);
      if (aIsNum && bIsNum) return ak - bk;
      return a[0].localeCompare(b[0]);
    });
    return entries.map(([, val]) => val);
  }

  return [];
}

function normalizeRoomNos(v: unknown): number[] {
  const raw = toArrayLike(v);

  const nums: number[] = raw
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0);

  // uniq
  const out: number[] = [];
  const seen = new Set<number>();
  for (const n of nums) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function normalizeFloors(v: unknown): LaundryFloorDef[] {
  const floorsRaw = toArrayLike(v);

  const floors: LaundryFloorDef[] = floorsRaw
    .map((f) => {
      if (!isPlainObject(f)) return null;

      const floor = Number(f.floor);
      if (!Number.isFinite(floor) || !Number.isInteger(floor) || floor < 1)
        return null;

      const roomNos = normalizeRoomNos(f.roomNos);

      const roomsCountRaw = Number(f.roomsCount);
      const roomsCount =
        Number.isFinite(roomsCountRaw) &&
        Number.isInteger(roomsCountRaw) &&
        roomsCountRaw > 0
          ? roomsCountRaw
          : roomNos.length;

      const startNo =
        typeof f.startNo === "number" && Number.isFinite(f.startNo)
          ? f.startNo
          : undefined;

      const out: LaundryFloorDef = {
        floor,
        roomsCount: roomsCount > 0 ? roomsCount : roomNos.length,
        roomNos,
      };
      if (startNo != null) out.startNo = startNo;

      return out;
    })
    .filter((x): x is LaundryFloorDef => x !== null);

  // floor重複排除 + sort
  return floors
    .filter((f, idx, arr) => arr.findIndex((x) => x.floor === f.floor) === idx)
    .slice()
    .sort((a, b) => a.floor - b.floor);
}

/**
 * ✅ raw(v2 sections) or raw(v1 floors) を受け取り、v2に正規化して返す
 */
function normalizeConfigToV2(raw: unknown): LaundryBoardConfigV2 | null {
  if (!isPlainObject(raw)) return null;

  const updatedAt =
    typeof raw.updatedAt === "number" ? raw.updatedAt : undefined;

  // v2: sections
  if (raw.sections != null) {
    const sectionsRaw = toArrayLike(raw.sections);

    const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    let autoIndex = 0;

    const sections: LaundrySectionDef[] = sectionsRaw
      .map((s) => {
        if (!isPlainObject(s)) return null;

        const floors = normalizeFloors(s.floors);
        if (!floors.length) return null;

        const fallbackKey = keys[autoIndex] ?? `S${autoIndex + 1}`;

        const sectionKey = isNonEmptyString(s.sectionKey)
          ? s.sectionKey.trim().toUpperCase()
          : fallbackKey;

        const sectionName = isNonEmptyString(s.sectionName)
          ? s.sectionName.trim()
          : "共通";

        autoIndex += 1;

        return { sectionKey, sectionName, floors };
      })
      .filter((x): x is LaundrySectionDef => x !== null);

    if (!sections.length) return null;

    return { version: 2, sections, updatedAt };
  }

  // v1: floors → v2で包む
  if (raw.floors != null) {
    const floors = normalizeFloors(raw.floors);
    if (!floors.length) return null;

    return {
      version: 2,
      sections: [{ sectionKey: "A", sectionName: "共通", floors }],
      updatedAt,
    };
  }

  return null;
}

/**
 * status map 正規化
 */
function normalizeStatusMap(v: unknown): Record<string, LaundryStatus> {
  if (!v || typeof v !== "object") return {};
  const rec = v as Record<string, unknown>;

  const out: Record<string, LaundryStatus> = {};
  for (const [k, val] of Object.entries(rec)) {
    if (val === "ok" || val === "limited" || val === "ng") {
      out[k] = val;
    }
  }
  return out;
}

/* =========================
   config
========================= */

export async function getLaundryConfigByProject(
  projectId: string,
): Promise<LaundryBoardConfigV2 | null> {
  const snap = await getDoc(configRef(projectId));
  if (!snap.exists()) return null;
  return normalizeConfigToV2(snap.data());
}

export function subscribeLaundryConfigByProject(
  projectId: string,
  cb: (config: LaundryBoardConfigV2 | null) => void,
): Unsubscribe {
  return onSnapshot(
    configRef(projectId),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      cb(normalizeConfigToV2(snap.data()));
    },
    () => cb(null),
  );
}

/**
 * ※管理側のsetup画面用（住人は使わない想定）
 */
export async function setLaundryConfigByProject(
  projectId: string,
  config: LaundryBoardConfigV2,
): Promise<void> {
  const updatedAt =
    typeof config.updatedAt === "number" ? config.updatedAt : Date.now();

  const sections = toArrayLike(config.sections)
    .map((s) => {
      if (!isPlainObject(s)) return null;
      const sectionKey = isNonEmptyString(s.sectionKey)
        ? s.sectionKey.trim().toUpperCase()
        : "A";
      const sectionName = isNonEmptyString(s.sectionName)
        ? s.sectionName.trim()
        : "共通";
      const floors = normalizeFloors(s.floors);
      if (!floors.length) return null;
      return { sectionKey, sectionName, floors } satisfies LaundrySectionDef;
    })
    .filter((x): x is LaundrySectionDef => x !== null);

  const safe: LaundryBoardConfigV2 = {
    version: 2,
    sections,
    updatedAt,
  };

  await setDoc(configRef(projectId), safe, { merge: true });
}

/* =========================
   status
========================= */

/**
 * ✅ 管理側の保存：未変更の部屋も含めて保存したい
 * → 呼び出し側が「全室分map」を渡す（ここではバリデーションのみ）
 */
export async function setLaundryStatusMapByProject(
  projectId: string,
  dateKey: string,
  map: Record<string, LaundryStatus>,
): Promise<void> {
  const safeMap = normalizeStatusMap(map);

  await setDoc(
    statusRef(projectId, dateKey),
    {
      dateKey,
      map: safeMap,
      updatedAt: Date.now(),
      version: 1,
    },
    { merge: true },
  );
}

export function subscribeLaundryStatusMapByProject(
  projectId: string,
  dateKey: string,
  cb: (res: { exists: boolean; map: Record<string, LaundryStatus> }) => void,
): Unsubscribe {
  return onSnapshot(
    statusRef(projectId, dateKey),
    (snap) => {
      if (!snap.exists()) {
        cb({ exists: false, map: {} });
        return;
      }
      const data = snap.data() as { map?: unknown };
      cb({ exists: true, map: normalizeStatusMap(data.map) });
    },
    () => cb({ exists: false, map: {} }),
  );
}

/* =========================
   project name
========================= */

type ProjectMeta = {
  name?: unknown;
};

function toNonEmptyStringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

export function subscribeProjectNameById(
  projectId: string,
  cb: (name: string | null) => void,
): Unsubscribe {
  return onSnapshot(
    projectRef(projectId),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      const d = snap.data() as ProjectMeta;
      cb(toNonEmptyStringOrNull(d.name));
    },
    () => cb(null),
  );
}
