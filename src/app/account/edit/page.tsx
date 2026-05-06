"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "../../lib/firebaseClient";

type ResidentMember = {
  uid: string;
  email?: string;
  displayName?: string;
  roomNo?: string | null;
  projectId?: string;
  projectName?: string | null;
  shareCode?: string;
  sectionName?: string | null;
};

type LaundryConfigDoc = {
  sections?: Array<{
    floors?: Array<{
      roomNos?: unknown[];
      roomKukus?: Record<string, unknown>;
    }>;
  }>;
};

function normalizeText(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

function roomExistsInLaundryConfig(data: unknown, roomNo: string): boolean {
  if (typeof data !== "object" || data === null) return false;

  const record = data as LaundryConfigDoc;
  const sections = Array.isArray(record.sections) ? record.sections : [];
  const normalizedRoomNo = normalizeText(roomNo);
  if (!normalizedRoomNo) return false;

  for (const section of sections) {
    const floors = Array.isArray(section?.floors) ? section.floors : [];

    for (const floor of floors) {
      const roomNos = Array.isArray(floor?.roomNos)
        ? floor.roomNos
            .map((room) =>
              normalizeText(typeof room === "string" ? room : String(room)),
            )
            .filter(Boolean)
        : [];

      if (roomNos.includes(normalizedRoomNo)) {
        return true;
      }

      const roomKukus =
        floor && typeof floor.roomKukus === "object" && floor.roomKukus !== null
          ? floor.roomKukus
          : {};

      if (
        normalizeText(roomKukus[normalizedRoomNo] as string) ||
        normalizedRoomNo in roomKukus
      ) {
        return true;
      }
    }
  }

  return false;
}

export default function AccountEditPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [member, setMember] = useState<ResidentMember | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [roomNo, setRoomNo] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [laundryConfigData, setLaundryConfigData] = useState<unknown>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        setLoading(true);
        setErrorText(null);

        if (!user) {
          router.replace("/login");
          return;
        }

        const memberRef = doc(db, "residentMembers", user.uid);
        const memberSnap = await getDoc(memberRef);

        if (!memberSnap.exists()) {
          router.replace("/register");
          return;
        }

        const data = memberSnap.data() as ResidentMember;
        const nextMember: ResidentMember = {
          ...data,
          uid: user.uid,
        };

        setMember(nextMember);
        setDisplayName(normalizeText(nextMember.displayName));
        setRoomNo(normalizeText(nextMember.roomNo));

        const projectId = normalizeText(nextMember.projectId);
        if (projectId) {
          const configRef = doc(db, "projects", projectId, "laundry", "config");
          const configSnap = await getDoc(configRef);
          const configData = configSnap.exists() ? configSnap.data() : null;
          setLaundryConfigData(configData);
        } else {
          setLaundryConfigData(null);
        }

        setLoading(false);
      } catch (e) {
        console.error("account edit load error:", e);
        setLaundryConfigData(null);
        setErrorText("登録情報の取得に失敗しました。");
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  const hasLaundryConfig = Boolean(laundryConfigData);
  const normalizedRoomNo = useMemo(() => normalizeText(roomNo), [roomNo]);
  const normalizedDisplayName = useMemo(
    () => normalizeText(displayName),
    [displayName],
  );
  const roomExistsInConfig = useMemo(() => {
    if (!hasLaundryConfig || !normalizedRoomNo) return true;
    return roomExistsInLaundryConfig(laundryConfigData, normalizedRoomNo);
  }, [hasLaundryConfig, laundryConfigData, normalizedRoomNo]);

  async function handleSave() {
    if (!member?.uid) return;

    setErrorText(null);
    setSuccessText(null);

    if (!normalizedDisplayName) {
      setErrorText("お名前を入力してください。");
      return;
    }

    if (!normalizedRoomNo) {
      setErrorText("号室を入力してください。");
      return;
    }

    if (hasLaundryConfig && !roomExistsInConfig) {
      setErrorText("入力した号室が設定に見つかりません。");
      return;
    }

    try {
      setSaving(true);

      const uid = member.uid;
      const projectId = normalizeText(member.projectId);

      await setDoc(
        doc(db, "residentMembers", uid),
        {
          displayName: normalizedDisplayName,
          roomNo: normalizedRoomNo,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      if (projectId) {
        await setDoc(
          doc(db, "projects", projectId, "members", uid),
          {
            displayName: normalizedDisplayName,
            roomNo: normalizedRoomNo,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }

      setMember((prev) =>
        prev
          ? {
              ...prev,
              displayName: normalizedDisplayName,
              roomNo: normalizedRoomNo,
            }
          : prev,
      );

      setSuccessText("登録情報を更新しました。");
    } catch (e) {
      console.error("account edit save error:", e);
      setErrorText("登録情報の更新に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
        <div className="mx-auto w-full max-w-md px-4 py-10">
          <div className="rounded-2xl border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              読み込み中...
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!member) return null;

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <div className="rounded-2xl border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
                登録情報の編集
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                号室などの登録情報を修正できます
              </div>
            </div>

            <button
              type="button"
              onClick={() => router.back()}
              className="shrink-0 rounded-xl border bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
            >
              戻る
            </button>
          </div>

          {errorText && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {errorText}
            </div>
          )}

          {successText && (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-bold text-green-700 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-300">
              {successText}
            </div>
          )}

          <div className="mt-6">
            <label className="mb-1 block text-sm font-bold text-gray-800 dark:text-gray-200">
              お名前
            </label>
            <input
              className="mb-3 w-full rounded-xl border px-3 py-2 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例）西村 博幸"
              disabled={saving}
            />

            <label className="mb-1 block text-sm font-bold text-gray-800 dark:text-gray-200">
              号室
            </label>
            <input
              className="mb-3 w-full rounded-xl border px-3 py-2 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={roomNo}
              onChange={(e) => setRoomNo(e.target.value)}
              placeholder="例）303"
              disabled={saving}
            />
            {hasLaundryConfig && normalizedRoomNo && !roomExistsInConfig && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                入力した号室が設定に見つかりません。
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              <div>メールアドレス：{member.email || "（未設定）"}</div>
              <div className="mt-1">
                シェアコード：{member.shareCode || "（未設定）"}
              </div>
              <div className="mt-1">
                工事名：{member.projectName || "（未設定）"}
              </div>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "保存中..." : "保存する"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
