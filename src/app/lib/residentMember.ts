// src/app/lib/residentMember.ts
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "./firebaseClient";

export type ResidentMember = {
  uid: string;
  email: string;
  displayName: string; // 部屋番号を想定
  roomNo: string; // 同上（displayNameと揃える）
  roomKey: string; // ✅ "1-105" など（必須）
  shareCode: string;
  projectId: string;
  projectName?: string; // optional
  createdAt?: number;
  updatedAt?: number;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function toSafeInt(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return v;
}

function buildRoomKey(floor: number, roomNo: string): string {
  const f = Math.max(1, Math.floor(floor));
  const r = roomNo.trim();
  if (!r) return "";
  return `${f}-${r}`;
}

export function subscribeResidentMember(
  uid: string,
  onData: (member: ResidentMember | null) => void,
  onError?: (e: unknown) => void,
): Unsubscribe {
  const ref = doc(db, "residentMembers", uid);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }

      const d = snap.data() as Record<string, unknown>;

      const email = isNonEmptyString(d.email) ? d.email.trim() : "";
      const displayName = isNonEmptyString(d.displayName) ? d.displayName.trim() : "";

      // roomNo: roomNo があればそれ、なければ displayName
      const roomNo = isNonEmptyString(d.roomNo) ? d.roomNo.trim() : displayName;

      const shareCode = isNonEmptyString(d.shareCode) ? d.shareCode.trim() : "";
      const projectId = isNonEmptyString(d.projectId) ? d.projectId.trim() : "";
      const projectName = isNonEmptyString(d.projectName) ? d.projectName.trim() : undefined;

      // ✅ roomKey: Firestore優先 → 無ければ floor + roomNo から生成
      const roomKeyFromDb = isNonEmptyString(d.roomKey) ? d.roomKey.trim() : "";
      const floorFromDb = toSafeInt(d.floor, 1); // floor が無ければ暫定で 1
      const roomKey = roomKeyFromDb ? roomKeyFromDb : buildRoomKey(floorFromDb, roomNo);

      // uid は docId を優先
      const member: ResidentMember = {
        uid: snap.id,
        email,
        displayName: displayName || roomNo, // 表示名が空なら roomNo
        roomNo,
        roomKey, // ✅ 必須
        shareCode,
        projectId,
        ...(projectName ? { projectName } : {}),
        createdAt: typeof d.createdAt === "number" ? d.createdAt : undefined,
        updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : undefined,
      };

      onData(member);
    },
    (err) => {
      onError?.(err);
      onData(null);
    },
  );
}
