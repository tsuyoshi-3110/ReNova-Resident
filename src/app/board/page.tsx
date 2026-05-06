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
  roomNo?: string | null;
};

type BoardPdf = {
  target?: string;
  deliveryType?: "all" | "koku";
  sectionName?: string;
  kukus?: string[];
  url?: string;
  fileName?: string;
  uploadedByEmail?: string;
  createdAt?: unknown;
};

type ResidentMessage = {
  text?: string;
  createdAt?: unknown;
  createdBy?: string;
  targetScope?: "all" | "group";
  targetGroupTitle?: string | null;
  templateId?: string | null;
  templateTitle?: string | null;
  updatedAt?: unknown;
};

type LaundryConfigDoc = {
  sections?: Array<{
    floors?: Array<{
      roomKukus?: Record<string, unknown>;
    }>;
  }>;
};

function toNonEmptyString(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => toNonEmptyString(item))
    .filter((item, index, arr) => item && arr.indexOf(item) === index);
}

function formatDateTime(v: unknown): string {
  if (typeof v !== "object" || v === null) return "";

  const maybeTimestamp = v as { toDate?: unknown };
  if (typeof maybeTimestamp.toDate !== "function") return "";

  const date = maybeTimestamp.toDate();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function findResidentKoku(
  config: unknown,
  roomNo: string,
): string {
  if (typeof config !== "object" || config === null) return "";

  const record = config as LaundryConfigDoc;
  const sections = Array.isArray(record.sections) ? record.sections : [];
  const normalizedRoomNo = toNonEmptyString(roomNo);

  if (!normalizedRoomNo) return "";

  for (const section of sections) {
    const floors = Array.isArray(section?.floors) ? section.floors : [];
    for (const floor of floors) {
      const roomKukus =
        floor && typeof floor.roomKukus === "object" && floor.roomKukus !== null
          ? floor.roomKukus
          : {};
      const koku = toNonEmptyString(roomKukus[normalizedRoomNo]);
      if (koku) return koku;
    }
  }

  return "";
}

export default function BoardPage() {
  const router = useRouter();

  const [loadingMember, setLoadingMember] = useState(true);
  const [member, setMember] = useState<ResidentMember | null>(null);

  const [errorText, setErrorText] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ id: string; data: BoardPdf }>>([]);
  const [messageItems, setMessageItems] = useState<
    Array<{ id: string; data: ResidentMessage }>
  >([]);
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
          roomNo: d.roomNo ?? null,
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

  // 2) projectId が確定したら boardPdfs と residentMessages を取得
  useEffect(() => {
    const run = async () => {
      const pid = member?.projectId;
      if (!pid) return;

      try {
        setBusy(true);
        setErrorText(null);

        const residentRoomNo = toNonEmptyString(member?.roomNo);

        let residentKoku = "";
        if (residentRoomNo) {
          try {
            const configRef = doc(db, "projects", pid, "laundry", "config");
            const configSnap = await getDoc(configRef);
            if (configSnap.exists()) {
              residentKoku = findResidentKoku(
                configSnap.data(),
                residentRoomNo,
              );
            }
          } catch (e) {
            console.log("laundry config load error:", e);
          }
        }

        const colRef = collection(db, "projects", pid, "boardPdfs");
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

        const filtered = rows.filter((row) => {
          const deliveryType = row.data.deliveryType === "koku" ? "koku" : "all";
          if (deliveryType === "all") return true;

          if (!residentRoomNo || !residentKoku) {
            return true;
          }

          const pdfKukus = toStringArray(row.data.kukus);

          return pdfKukus.includes(residentKoku);
        });

        setItems(filtered);

        const messageColRef = collection(db, "projects", pid, "residentMessages");
        const messageQy = query(messageColRef, orderBy("createdAt", "desc"));
        const messageSnap = await getDocs(messageQy);

        const messageRows: Array<{ id: string; data: ResidentMessage }> = [];
        messageSnap.forEach((d) =>
          messageRows.push({ id: d.id, data: d.data() as ResidentMessage }),
        );

        const filteredMessages = messageRows.filter((row) => {
          const scope = row.data.targetScope === "group" ? "group" : "all";
          if (scope === "all") return true;

          if (!residentRoomNo || !residentKoku) {
            return true;
          }

          const targetGroupTitle = toNonEmptyString(row.data.targetGroupTitle);
          if (!targetGroupTitle) return true;

          return targetGroupTitle === residentKoku;
        });

        setMessageItems(filteredMessages);
      } catch (e) {
        console.log("board list error:", e);
        setErrorText("PDF一覧の取得に失敗しました。");
        setItems([]);
        setMessageItems([]);
      } finally {
        setBusy(false);
      }
    };

    void run();
  }, [member?.projectId, member?.roomNo]);

  if (loadingMember) return null;
  if (!member) return null;

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
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

        <div className="mt-6 grid w-full grid-cols-1 gap-3">
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
                    window.location.assign(url);
                  }}
                  className="min-h-[96px] w-full rounded-2xl border bg-white p-4 text-left hover:bg-gray-50 disabled:opacity-60 sm:p-5 lg:min-h-[120px]
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

        <section className="mt-8">
          <div className="mb-3">
            <div className="text-base font-extrabold text-gray-900 dark:text-gray-100">
              お知らせメッセージ
            </div>
            <div className="mt-1 text-xs font-bold text-gray-500 dark:text-gray-400">
              全体向けと該当工区向けのお知らせを表示します。
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-3">
            {busy ? (
              <div className="rounded-2xl border bg-white p-4 text-sm font-bold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                読み込み中...
              </div>
            ) : messageItems.length === 0 ? (
              <div className="rounded-2xl border bg-white p-4 text-sm font-bold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                お知らせメッセージはまだありません。
              </div>
            ) : (
              messageItems.map((it) => {
                const text = toNonEmptyString(it.data.text);
                const createdAtText = formatDateTime(it.data.createdAt);
                const templateTitle = toNonEmptyString(it.data.templateTitle);
                const targetGroupTitle = toNonEmptyString(
                  it.data.targetGroupTitle,
                );
                const isGroup =
                  it.data.targetScope === "group" && Boolean(targetGroupTitle);

                return (
                  <article
                    key={it.id}
                    className="min-h-[180px] w-full rounded-2xl border bg-white p-4 text-left dark:border-gray-800 dark:bg-gray-900 sm:p-5 lg:min-h-[220px]"
                  >
                    <div className="mb-2 flex flex-wrap gap-2 text-xs font-extrabold">
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                        {isGroup ? `${targetGroupTitle}向け` : "全体向け"}
                      </span>
                      {templateTitle && (
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">
                          {templateTitle}
                        </span>
                      )}
                    </div>

                    {createdAtText && (
                      <div className="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">
                        {createdAtText}
                      </div>
                    )}

                    <p className="whitespace-pre-line text-sm font-semibold leading-7 text-gray-900 dark:text-gray-100 sm:text-base sm:leading-8">
                      {text || "本文がありません。"}
                    </p>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
