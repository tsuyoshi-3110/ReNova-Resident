// src/app/laundry/LaundryResidentBoard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

import type { LaundryStatus } from "./types";
import type { LaundryBoardConfigV2 } from "./laundryFirestore";
import {
  subscribeLaundryConfigByProject,
  subscribeLaundryStatusMapByProject,
  subscribeProjectNameById,
} from "./laundryFirestore";

import { isDateKey, yyyyMmDd, STATUS_HELP } from "./utils";
import StatusMark from "./StatusMark";

function todayKey(): string {
  return yyyyMmDd(new Date());
}

/* =========================
   Props
========================= */

type Props = {
  projectId: string;

  // 形式: `${sectionKey}-${floor}-${roomNo}` 例: "A-3-305"
  roomKey: string;
};

/* =========================
   helpers
========================= */

function toNonEmptyString(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function parseRoomKey(
  roomKey: string,
): { sectionKey: string; floor: number; roomNo: string } | null {
  const raw = toNonEmptyString(roomKey);
  if (!raw) return null;

  const parts = raw.split("-");
  if (parts.length !== 3) return null;

  const sectionKey = toNonEmptyString(parts[0]).toUpperCase();
  const floorNum = Number(parts[1]);
  const roomNo = toNonEmptyString(parts[2]);

  if (!sectionKey) return null;
  if (!Number.isFinite(floorNum) || !Number.isInteger(floorNum) || floorNum < 1)
    return null;
  if (!roomNo) return null;

  return { sectionKey, floor: floorNum, roomNo };
}

function findSectionNameFromConfig(
  config: LaundryBoardConfigV2 | null,
  sectionKey: string,
): string | null {
  if (!config) return null;

  const key = toNonEmptyString(sectionKey).toUpperCase();
  if (!key) return null;

  const sec = (config.sections ?? []).find(
    (s) => toNonEmptyString(s.sectionKey).toUpperCase() === key,
  );

  if (!sec) return null;

  const name = toNonEmptyString(sec.sectionName);
  return name ? name : key;
}

function existsRoomInConfig(
  config: LaundryBoardConfigV2 | null,
  sectionKey: string,
  floor: number,
  roomNo: string,
): boolean {
  if (!config) return false;

  const sk = toNonEmptyString(sectionKey).toUpperCase();
  const rn = toNonEmptyString(roomNo);
  if (!sk || !rn) return false;

  const sec = (config.sections ?? []).find(
    (s) => toNonEmptyString(s.sectionKey).toUpperCase() === sk,
  );
  if (!sec) return false;

  const fl = (sec.floors ?? []).find((f) => f.floor === floor);
  if (!fl) return false;

  const n = Number(rn);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return false;

  return Array.isArray(fl.roomNos) ? fl.roomNos.some((x) => x === n) : false;
}

/* =========================
   Component
========================= */

export default function LaundryResidentBoard({ projectId, roomKey }: Props) {
  const validProjectId =
    typeof projectId === "string" && projectId.trim().length > 0;

  const parsed = useMemo(() => parseRoomKey(roomKey), [roomKey]);

  const [projectName, setProjectName] = useState<string | null>(null);
  const [config, setConfig] = useState<LaundryBoardConfigV2 | null>(null);

  const [dateKey, setDateKey] = useState<string>(() => todayKey());
  const [exists, setExists] = useState<boolean>(false);
  const [map, setMap] = useState<Record<string, LaundryStatus>>({});

  // project meta
  useEffect(() => {
    if (!validProjectId) return;
    const unsub = subscribeProjectNameById(projectId, (name) =>
      setProjectName(name),
    );
    return () => unsub();
  }, [projectId, validProjectId]);

  // config（ここは "normalize済み" が入ってくる前提）
  useEffect(() => {
    if (!validProjectId) return;

    const unsub = subscribeLaundryConfigByProject(projectId, (c) => {
      setConfig(c);
    });

    return () => unsub();
  }, [projectId, validProjectId]);

  // status
  useEffect(() => {
    if (!validProjectId) return;
    if (!isDateKey(dateKey)) return;

    const unsub = subscribeLaundryStatusMapByProject(
      projectId,
      dateKey,
      (res) => {
        setExists(res.exists);
        setMap(res.map);
      },
    );

    return () => unsub();
  }, [projectId, validProjectId, dateKey]);

  if (!validProjectId) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
          projectId が未設定です。
        </div>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <div className="text-sm font-extrabold text-amber-800 dark:text-amber-200">
            部屋情報の形式が不正です（roomKey）。
          </div>
          <div className="mt-2 text-sm text-amber-700 dark:text-amber-200/80">
            登録し直してください。
          </div>
        </div>
      </div>
    );
  }

  const secName = findSectionNameFromConfig(config, parsed.sectionKey);
  const roomLabel = secName
    ? `${secName} ${parsed.floor}F ${parsed.roomNo}`
    : `${parsed.floor}F ${parsed.roomNo}`;

  if (!config) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
            まだ掲示板が作成されていません。
          </div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            管理側で掲示板を作成すると表示されます。
          </div>
        </div>
      </div>
    );
  }

  const isInConfig = existsRoomInConfig(
    config,
    parsed.sectionKey,
    parsed.floor,
    parsed.roomNo,
  );
  if (!isInConfig) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <div className="text-sm font-extrabold text-amber-800 dark:text-amber-200">
            {roomLabel} が見つかりません（管理側の部屋設定を確認してください）
          </div>
        </div>
      </div>
    );
  }

  // ✅ データが無い日は号室を表示しない（あなたの要件）
  if (!exists) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              日付
            </div>

            <input
              type="date"
              value={dateKey}
              onChange={(e) => {
                const v = e.target.value;
                if (!isDateKey(v)) return;
                setDateKey(v);
              }}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900
                         dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            />

            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-extrabold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
              この日付のデータはありません
            </span>
          </div>
        </div>
      </div>
    );
  }

  const status: LaundryStatus = map[roomKey] ?? "ok";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
            日付
          </div>

          <input
            type="date"
            value={dateKey}
            onChange={(e) => {
              const v = e.target.value;
              if (!isDateKey(v)) return;
              setDateKey(v);
            }}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900
                       dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          />

          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            表示中
          </span>
        </div>
      </div>

      {/* 凡例 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-5 text-sm font-extrabold text-gray-900 dark:text-gray-100">
          <span className="inline-flex items-center gap-2">
            <StatusMark status="ok" />
            <span className="text-gray-700 dark:text-gray-200">
              {STATUS_HELP.ok}
            </span>
          </span>
          <span className="inline-flex items-center gap-2">
            <StatusMark status="limited" />
            <span className="text-gray-700 dark:text-gray-200">
              {STATUS_HELP.limited}
            </span>
          </span>
          <span className="inline-flex items-center gap-2">
            <StatusMark status="ng" />
            <span className="text-gray-700 dark:text-gray-200">
              {STATUS_HELP.ng}
            </span>
          </span>
        </div>
      </div>

      {/* 自分の号室カード */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
          {roomLabel}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <StatusMark status={status} />
          <div className="text-sm font-bold text-gray-700 dark:text-gray-200">
            {STATUS_HELP[status]}
          </div>
        </div>
      </div>
    </div>
  );
}
