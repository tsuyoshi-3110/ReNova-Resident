"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../lib/firebaseClient";
import LaundryResidentSectionBoard from "./LaundryResidentSectionBoard";

type ResidentMember = {
  uid: string;
  email?: string;
  displayName?: string;

  projectId?: string;
  projectName?: string | null;
  shareCode?: string;

  roomNo?: string | number;
  roomNumber?: string | number;
  room?: string | number;
};

type OverallScheduleRow = {
  label?: string;
  groupTitle?: string;
  startYmd?: string;
  endYmd?: string;
  color?: string;
};

type LaundryConfigDoc = {
  roomNos?: unknown[];
  [key: string]: unknown;
};

type OverallScheduleDoc = {
  holidayText?: string;
  rows?: OverallScheduleRow[];
};

type LaundryStatusDoc = {
  workNotesByLabel?: Record<string, unknown>;
};

function todayYmdJst(): string {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${day}`;
}

function isActiveToday(row: OverallScheduleRow, todayYmd: string): boolean {
  const start = toNonEmptyString(row.startYmd);
  const end = toNonEmptyString(row.endYmd);
  if (!start || !end) return false;
  return start <= todayYmd && todayYmd <= end;
}

function toNonEmptyString(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function toYmdJst(date: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${day}`;
}

function ymdToDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDaysYmd(ymd: string, days: number): string {
  const d = ymdToDate(ymd);
  if (!d) return ymd;
  d.setDate(d.getDate() + days);
  return toYmdJst(d);
}

function getSelectedLaundryDateYmd(): string {
  if (typeof window === "undefined") return todayYmdJst();

  const candidates = [
    "renova:laundry:selectedDate:v1",
    "resident:laundry:selectedDate:v1",
    "laundry:selectedDate",
  ];

  for (const key of candidates) {
    const value = window.localStorage.getItem(key);
    const ymd = toNonEmptyString(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  }

  const input = document.querySelector<HTMLInputElement>('input[type="date"]');
  const inputYmd = toNonEmptyString(input?.value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(inputYmd)) return inputYmd;

  return todayYmdJst();
}

function getSelectedLaundryRoomNo(): string {
  if (typeof window === "undefined") return "";

  const candidates = [
    "renova:laundry:selectedRoomNo:v1",
    "resident:laundry:selectedRoomNo:v1",
    "laundry:selectedRoomNo",
  ];

  for (const key of candidates) {
    const value = window.localStorage.getItem(key);
    const roomNo = toNonEmptyString(value);
    if (roomNo) return roomNo;
  }

  const input = document.querySelector<HTMLInputElement>(
    'input[name="roomNo"]',
  );
  const inputRoomNo = toNonEmptyString(input?.value);
  if (inputRoomNo) return inputRoomNo;

  return "";
}

function getRoomNoFromMember(member: ResidentMember | null): string {
  if (!member) return "";
  const candidates = [member.roomNo, member.roomNumber, member.room];
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    const s = toNonEmptyString(v);
    if (s) return s;
  }
  return "";
}

function findGroupTitleByRoomNo(
  config: LaundryConfigDoc,
  roomNo: string,
): string {
  const normalizedRoomNo = roomNo.trim();
  if (!normalizedRoomNo) return "";

  // Current config shape:
  // sections[] -> floors[] -> roomKukus: { [roomNo]: "1工区" }
  const sections = Array.isArray(config.sections) ? config.sections : [];
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const sectionObj = section as Record<string, unknown>;
    const floors = Array.isArray(sectionObj.floors) ? sectionObj.floors : [];

    for (const floor of floors) {
      if (!floor || typeof floor !== "object") continue;
      const floorObj = floor as Record<string, unknown>;
      const roomKukus =
        floorObj.roomKukus && typeof floorObj.roomKukus === "object"
          ? (floorObj.roomKukus as Record<string, unknown>)
          : null;

      const groupTitle = roomKukus
        ? toNonEmptyString(roomKukus[normalizedRoomNo])
        : "";
      if (groupTitle) return groupTitle;
    }
  }

  // Legacy config shape: roomNos array + index-based top-level mapping.
  const roomNos = Array.isArray(config.roomNos) ? config.roomNos : [];
  const idx = roomNos.findIndex((v) => String(v).trim() === normalizedRoomNo);
  if (idx >= 0) {
    const byIndex = toNonEmptyString(config[String(idx)]);
    if (byIndex) return byIndex;
  }

  // Legacy direct mapping: { "304": "2工区" }
  const direct = toNonEmptyString(config[normalizedRoomNo]);
  if (direct) return direct;

  return "";
}

function isRowForGroup(row: OverallScheduleRow, groupTitle: string): boolean {
  const rowGroup = toNonEmptyString(row.groupTitle);
  if (!rowGroup || !groupTitle) return false;
  return rowGroup === groupTitle;
}

function isActiveOnDate(row: OverallScheduleRow, ymd: string): boolean {
  const start = toNonEmptyString(row.startYmd);
  const end = toNonEmptyString(row.endYmd);
  if (!start || !end) return false;
  return start <= ymd && ymd <= end;
}

function findWorkNoteByLabel(
  notesByLabel: Record<string, string>,
  rawLabel: unknown,
): string {
  const label = toNonEmptyString(rawLabel);
  if (!label) return "";

  const exact = notesByLabel[label];
  if (exact) return exact;

  const matched = Object.entries(notesByLabel).find(([key]) => {
    const normalizedKey = toNonEmptyString(key);
    return normalizedKey.includes(label) || label.includes(normalizedKey);
  });

  return matched?.[1] ?? "";
}

export default function LaundryClient() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState<ResidentMember | null>(null);
  const [selectedWorkDateYmd, setSelectedWorkDateYmd] = useState(todayYmdJst);
  const [residentGroupTitle, setResidentGroupTitle] = useState("");
  const [todayWorks, setTodayWorks] = useState<OverallScheduleRow[]>([]);
  const [todayWorksLoading, setTodayWorksLoading] = useState(false);
  const [workNotesByLabel, setWorkNotesByLabel] = useState<
    Record<string, string>
  >({});

  const [selectedRoomNo, setSelectedRoomNo] = useState("");
  const [configRoomNo, setConfigRoomNo] = useState("");
  const [configGroupTitle, setConfigGroupTitle] = useState("");
  const [configGroupLoading, setConfigGroupLoading] = useState(false);

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

  useEffect(() => {
    const projectId = toNonEmptyString(member?.projectId);
    if (!projectId) {
      setConfigRoomNo("");
      setConfigGroupTitle("");
      return;
    }

    let cancelled = false;

    async function loadOwnRoomGroup() {
      setConfigGroupLoading(true);
      try {
        const configSnap = await getDoc(
          doc(db, "projects", projectId, "laundry", "config"),
        );
        if (cancelled) return;

        const config = configSnap.exists()
          ? (configSnap.data() as LaundryConfigDoc)
          : ({} as LaundryConfigDoc);

        const roomNo = getRoomNoFromMember(member);
        const groupTitle = findGroupTitleByRoomNo(config, roomNo);

        setConfigRoomNo(roomNo);
        setConfigGroupTitle(groupTitle);
        setResidentGroupTitle(groupTitle);
        setSelectedWorkDateYmd((prev) => `${prev}`);
      } catch (e) {
        console.error("laundry config group load error:", e);
        if (!cancelled) {
          setConfigRoomNo("");
          setConfigGroupTitle("");
        }
      } finally {
        if (!cancelled) setConfigGroupLoading(false);
      }
    }

    void loadOwnRoomGroup();

    const interval = window.setInterval(() => {
      const nextYmd = getSelectedLaundryDateYmd();
      const nextRoomNo = getRoomNoFromMember(member);
      setSelectedWorkDateYmd((prev) => (prev === nextYmd ? prev : nextYmd));
      setSelectedRoomNo((prev) => (prev === nextRoomNo ? prev : nextRoomNo));
      setConfigRoomNo((prev) => {
        if (prev === nextRoomNo) return prev;
        void (async () => {
          try {
            const configSnap = await getDoc(
              doc(db, "projects", projectId, "laundry", "config"),
            );
            const config = configSnap.exists()
              ? (configSnap.data() as LaundryConfigDoc)
              : ({} as LaundryConfigDoc);
            const groupTitle = findGroupTitleByRoomNo(config, nextRoomNo);
            if (!cancelled) {
              setConfigGroupTitle(groupTitle);
              setResidentGroupTitle(groupTitle);
              setSelectedWorkDateYmd((prev) => `${prev}`);
            }
          } catch (e) {
            console.error("laundry config group reload error:", e);
          }
        })();
        return nextRoomNo;
      });
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [member]);

  useEffect(() => {
    const projectId = toNonEmptyString(member?.projectId);
    const groupTitle = configGroupTitle || residentGroupTitle;

    if (!projectId || !groupTitle) {
      setTodayWorks([]);
      return;
    }

    let cancelled = false;

    async function reloadForSelectedDate() {
      setTodayWorksLoading(true);
      try {
        const overallSnap = await getDoc(
          doc(db, "projects", projectId, "scheduleData", "overall"),
        );
        if (cancelled) return;

        if (!overallSnap.exists()) {
          setTodayWorks([]);
          return;
        }

        const data = overallSnap.data() as OverallScheduleDoc;
        const rows = Array.isArray(data.rows) ? data.rows : [];
        const activeRows = rows.filter(
          (row) =>
            isRowForGroup(row, groupTitle) &&
            isActiveOnDate(row, selectedWorkDateYmd),
        );

        setTodayWorks(activeRows);
      } catch (e) {
        console.error("overall schedule selected date reload error:", e);
        if (!cancelled) {
          setTodayWorks([]);
        }
      } finally {
        if (!cancelled) setTodayWorksLoading(false);
      }
    }

    void reloadForSelectedDate();

    return () => {
      cancelled = true;
    };
  }, [configGroupTitle, member, residentGroupTitle, selectedWorkDateYmd]);

  useEffect(() => {
    const projectId = toNonEmptyString(member?.projectId);
    if (!projectId || !selectedWorkDateYmd) {
      setWorkNotesByLabel({});
      return;
    }

    const ref = doc(
      db,
      "projects",
      projectId,
      "laundryStatus",
      selectedWorkDateYmd,
    );

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setWorkNotesByLabel({});
          return;
        }

        const data = snap.data() as LaundryStatusDoc;
        const rawNotes = data.workNotesByLabel;
        const nextNotes: Record<string, string> = {};

        if (rawNotes && typeof rawNotes === "object") {
          for (const [label, note] of Object.entries(rawNotes)) {
            const labelText = toNonEmptyString(label);
            const noteText = toNonEmptyString(note);
            if (labelText && noteText) nextNotes[labelText] = noteText;
          }
        }

        setWorkNotesByLabel(nextNotes);
      },
      (error) => {
        console.error("laundryStatus notes snapshot error:", error);
        setWorkNotesByLabel({});
      },
    );

    return () => unsub();
  }, [member?.projectId, selectedWorkDateYmd]);

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
        {/* ボード表示 */}
        <LaundryResidentSectionBoard
          projectId={member.projectId}
          initialRoomNo={getRoomNoFromMember(member)}
          readOnlyRoomNo
          residentGroupTitle={configGroupTitle || residentGroupTitle}
        />

        <section className="mb-4 rounded-2xl border bg-white p-4 dark:border-gray-800 dark:bg-gray-900 mt-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-extrabold text-gray-900 dark:text-gray-100">
              本日のバルコニー内作業内容
            </h2>
            <div className="text-xs font-bold text-gray-500 dark:text-gray-400">
              {selectedWorkDateYmd}
            </div>
            {configGroupTitle || residentGroupTitle ? (
              <div className="text-xs font-bold text-gray-500 dark:text-gray-400">
                {configGroupTitle || residentGroupTitle}
              </div>
            ) : null}
          </div>

          {todayWorksLoading ? (
            <div className="mt-3 text-sm font-bold text-gray-500 dark:text-gray-400">
              読み込み中...
            </div>
          ) : todayWorks.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed p-3 text-sm font-bold text-gray-500 dark:border-gray-800 dark:text-gray-400">
              選択日の該当工区の作業予定はありません。
            </div>
          ) : (
            <div className="mt-3 grid gap-2">
              {todayWorks.map((row, idx) => {
                const note = findWorkNoteByLabel(workNotesByLabel, row.label);

                return (
                  <div
                    key={`${row.groupTitle ?? "group"}-${row.label ?? "work"}-${idx}`}
                    className="rounded-xl border p-3 dark:border-gray-800"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1 h-3 w-3 shrink-0 rounded-full border dark:border-gray-700"
                        style={{ backgroundColor: row.color || "#9E9E9E" }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
                          {row.label || "作業名未設定"}
                        </div>
                        <div className="mt-1 text-xs font-bold text-gray-500 dark:text-gray-400">
                          {row.startYmd || "---- -- --"}〜
                          {row.endYmd || "---- -- --"}
                        </div>
                        {note ? (
                          <div className="mt-2 rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200">
                            注意事項：{note}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
