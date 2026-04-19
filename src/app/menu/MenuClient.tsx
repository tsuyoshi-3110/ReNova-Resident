"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../lib/firebaseClient";

type ResidentMember = {
  uid: string;
  email?: string;
  displayName?: string; // 部屋番号
  roomNo?: string;
  projectId?: string;
  projectName?: string | null;
  shareCode?: string;
};

export default function MenuClient() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState<ResidentMember | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          setMember(null);
          setLoading(false);
          router.replace("/login");
          return;
        }

        // residentMembers/{uid} を取得
        const ref = doc(db, "residentMembers", user.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setMember(null);
          setLoading(false);
          router.replace("/register");
          return;
        }

        const data = snap.data() as ResidentMember;

        if (!data.projectId) {
          setMember(null);
          setLoading(false);
          router.replace("/register");
          return;
        }

        setMember({ ...data, uid: user.uid });
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

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut(auth);
      // onAuthStateChanged でも /login に行くが、即時遷移もしておく
      router.replace("/login");
    } catch (e) {
      console.error("logout error:", e);
      setLoggingOut(false);
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

  if (!member) {
    return (
      <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
        <div className="mx-auto w-full max-w-md px-4 py-10">
          <div className="rounded-2xl border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              リダイレクト中...
            </div>
          </div>
        </div>
      </main>
    );
  }

  const projectName = member.projectName ?? null;
  const roomLabel = member.displayName || member.roomNo || "";

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <div className="rounded-2xl border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          {/* ✅ ヘッダー行（ログアウトボタン） */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
                工事：{projectName || "（名称未設定）"}
              </div>

              <div className="mt-1 text-xs font-bold text-gray-500 dark:text-gray-400">
                部屋：{roomLabel || "（未設定）"}
                {member.shareCode ? ` / shareCode: ${member.shareCode}` : ""}
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="shrink-0 rounded-xl border bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 disabled:opacity-60
                         dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
            >
              {loggingOut ? "ログアウト中..." : "ログアウト"}
            </button>
          </div>

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={() => router.push("/board")}
              className="w-full rounded-2xl border bg-white p-4 text-left hover:bg-gray-50
                         dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
            >
              <div className="text-base font-extrabold text-gray-900 dark:text-gray-100">
                掲示板
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                ProcNova/ProclinkでアップしたPDF一覧
              </div>
            </button>

            <button
              type="button"
              onClick={() => router.push("/laundry")}
              className="w-full rounded-2xl border bg-white p-4 text-left hover:bg-gray-50
                         dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
            >
              <div className="text-base font-extrabold text-gray-900 dark:text-gray-100">
                洗濯物情報
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Proclinkでセットアップした洗濯可否を表示
              </div>
            </button>
            <button
              type="button"
              onClick={() => router.push("/managers")}
              className="w-full rounded-2xl border bg-white p-4 text-left hover:bg-gray-50
                         dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
            >
              <div className="text-base font-extrabold text-gray-900 dark:text-gray-100">
                監督一覧
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                現場監督の一覧を表示してDMできます
              </div>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
