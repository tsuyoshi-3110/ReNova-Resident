"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../lib/firebaseClient";
import LaundryResidentSectionBoard from "./LaundryResidentSectionBoard";

type ResidentMember = {
  uid: string;
  email?: string;
  displayName?: string;

  projectId?: string;
  projectName?: string | null;
  shareCode?: string;
};

function toNonEmptyString(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

export default function LaundryClient() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState<ResidentMember | null>(null);

  const projectName = useMemo(() => member?.projectName ?? null, [member]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          setMember(null);
          setLoading(false);
          router.replace("/login");
          return;
        }

        const ref = doc(db, "residentMembers", user.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setMember(null);
          setLoading(false);
          router.replace("/register");
          return;
        }

        const d = snap.data() as ResidentMember;
        const pid = toNonEmptyString(d.projectId);

        if (!pid) {
          setMember(null);
          setLoading(false);
          router.replace("/register");
          return;
        }

        setMember({ ...d, uid: user.uid });
        setLoading(false);
      } catch (e) {
        console.error("residentMembers load error:", e);
        setMember(null);
        setLoading(false);
        router.replace("/login");
      }
    });

    return () => unsub();
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
        <div className="mx-auto w-full max-w-5xl px-4 py-8">
          <div className="rounded-2xl border bg-white p-4 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
            読み込み中...
          </div>
        </div>
      </main>
    );
  }

  if (!member?.projectId) return null; // リダイレクト待ち

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
              洗濯物情報
            </h1>
            <div className="mt-1 text-md font-bold text-gray-500 dark:text-gray-400">
              工事：{projectName || "（名称未設定）"}
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.push("/menu")}
            className="rounded-xl border bg-white px-3 py-2 text-sm font-extrabold text-gray-900 hover:bg-gray-50
                       dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
          >
            戻る
          </button>
        </div>

        {/* ✅ 新仕様：棟ピッカー → 選択した棟のボード表示 */}
        <LaundryResidentSectionBoard projectId={member.projectId} />
      </div>
    </main>
  );
}
