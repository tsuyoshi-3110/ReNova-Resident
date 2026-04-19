// src/app/board/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
} from "firebase/firestore";

import { auth, db } from "../lib/firebaseClient";

type ResidentMember = {
  uid: string;
  email?: string;
  displayName?: string;

  projectId?: string;
  projectName?: string | null;
  shareCode?: string;
};

type BoardPdf = {
  target?: string;
  url?: string;
  fileName?: string;
  uploadedByEmail?: string;
  createdAt?: unknown;
};

function toNonEmptyString(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

export default function BoardPage() {
  const router = useRouter();

  const [loadingMember, setLoadingMember] = useState(true);
  const [member, setMember] = useState<ResidentMember | null>(null);

  const [errorText, setErrorText] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ id: string; data: BoardPdf }>>([]);
  const [busy, setBusy] = useState(true);

  // 1) Auth → residentMembers を取得（projectId を確定）
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          setMember(null);
          setLoadingMember(false);
          router.replace("/login");
          return;
        }

        const ref = doc(db, "residentMembers", user.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setMember(null);
          setLoadingMember(false);
          router.replace("/register");
          return;
        }

        const d = snap.data() as ResidentMember;

        const projectId = toNonEmptyString(d.projectId);
        if (!projectId) {
          setMember(null);
          setLoadingMember(false);
          router.replace("/register");
          return;
        }

        setMember({
          uid: user.uid,
          email: d.email,
          displayName: d.displayName,
          projectId,
          projectName: d.projectName ?? null,
          shareCode: d.shareCode,
        });

        setLoadingMember(false);
      } catch (e) {
        console.log("residentMembers load error:", e);
        setMember(null);
        setLoadingMember(false);
        router.replace("/login");
      }
    });

    return () => unsub();
  }, [router]);

  // 2) projectId が確定したら boardPdfs を取得
  useEffect(() => {
    const run = async () => {
      const pid = member?.projectId;
      if (!pid) return;

      try {
        setBusy(true);
        setErrorText(null);

        const colRef = collection(db, "projects", pid, "boardPdfs");

        // target == resident のみ
        // createdAt があるなら orderBy（無いなら orderBy 行を消してOK）
        const qy = query(
          colRef,
          where("target", "==", "resident"),
          orderBy("createdAt", "desc"),
        );

        const snap = await getDocs(qy);

        const rows: Array<{ id: string; data: BoardPdf }> = [];
        snap.forEach((d) =>
          rows.push({ id: d.id, data: d.data() as BoardPdf }),
        );
        setItems(rows);
      } catch (e) {
        console.log("board list error:", e);
        setErrorText("PDF一覧の取得に失敗しました。");
      } finally {
        setBusy(false);
      }
    };

    void run();
  }, [member?.projectId]);

  if (loadingMember) return null;
  if (!member) return null;

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
              掲示板
            </div>
            <div className="text-xs font-bold text-gray-500 dark:text-gray-400">
              工事：{member.projectName || "（名称未設定）"}
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

        {errorText && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-semibold text-red-700">{errorText}</p>
          </div>
        )}

        <div className="mt-6 grid gap-3">
          {busy ? (
            <div className="rounded-2xl border bg-white p-4 text-sm font-bold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              読み込み中...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border bg-white p-4 text-sm font-bold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              PDFはまだありません。
            </div>
          ) : (
            items.map((it) => {
              const url = toNonEmptyString(it.data.url);
              return (
                <button
                  key={it.id}
                  type="button"
                  disabled={!url}
                  onClick={() => {
                    if (!url) return;
                    // ✅ 同タブで直接PDFを開く（Safari/Chrome標準ビューア）
                    window.location.assign(url);
                  }}
                  className="rounded-2xl border bg-white p-4 text-left hover:bg-gray-50 disabled:opacity-60
                             dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-900/70"
                >
                  <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
                    {it.data.fileName || "PDF"}
                  </div>
                  <div className="mt-1 text-xs font-bold text-gray-500 dark:text-gray-400">
                    {it.data.uploadedByEmail
                      ? `by ${it.data.uploadedByEmail}`
                      : ""}
                  </div>

                  {!url && (
                    <div className="mt-2 text-xs font-bold text-red-600">
                      URLがありません
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-3 text-xs font-bold text-gray-500 dark:text-gray-400">
          ※
          PDFは標準ビューアで開きます。横向きに回転すると横で見れます。ピンチで拡大縮小できます。
        </div>
      </div>
    </main>
  );
}
