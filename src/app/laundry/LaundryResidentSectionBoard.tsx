// src/app/laundry/LaundryResidentSectionBoard.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { LaundryStatus } from "./types";
import type {
  LaundryBoardConfigV2,
  LaundrySectionDef,
} from "./laundryFirestore";
import {
  subscribeLaundryConfigByProject,
  subscribeLaundryStatusMapByProject,
} from "./laundryFirestore";

import {
  isDateKey,
  yyyyMmDd,
  STATUS_HELP,
  STATUS_LABEL,
  calcIndent,
} from "./utils";
import StatusMark from "./StatusMark";

const LS_KEY_ROOM_FILTER = "laundry:roomFilterText";

function todayKey(): string {
  return yyyyMmDd(new Date());
}

type Props = {
  projectId: string;
  initialRoomNo?: string;
  readOnlyRoomNo?: boolean;
  residentGroupTitle?: string;
};

function toNonEmptyString(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function maxRoomsInSection(section: LaundrySectionDef): number {
  let max = 0;
  const floors = Array.isArray(section.floors) ? section.floors : [];
  for (const f of floors) {
    const len = Array.isArray(f.roomNos) ? f.roomNos.length : 0;
    if (len > max) max = len;
  }
  return max;
}

function buildRoomsForFloor(
  sectionKey: string,
  floor: number,
  roomNos: number[],
): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const n of roomNos) {
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) continue;
    const roomNo = String(n);
    const id = `${sectionKey}-${floor}-${roomNo}`; // status map key
    out.push({ id, label: roomNo });
  }
  return out;
}

/**
 * 住人入力の「部屋番号」から候補を作る。
 * - 305 のような数値を想定
 * - 3桁以上なら「floor = 305/100 => 3」扱いして絞り込む
 */
function normalizeRoomFilter(
  raw: string,
): { roomNo: string; floorHint: number | null } | null {
  const s = raw.replace(/\s+/g, "").trim();
  if (!s) return null;

  // 数字以外が混じるなら無効（誤入力扱い）
  if (!/^\d+$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;

  const floorHint = s.length >= 3 ? Math.floor(n / 100) : null;
  return {
    roomNo: s,
    floorHint: floorHint && floorHint >= 1 ? floorHint : null,
  };
}

export default function LaundryResidentSectionBoard({
  projectId,
  initialRoomNo = "",
  readOnlyRoomNo = false,
  residentGroupTitle = "",
}: Props) {
  const validProjectId =
    typeof projectId === "string" && projectId.trim().length > 0;

  const [config, setConfig] = useState<LaundryBoardConfigV2 | null>(null);

  // ✅ 画面を開いた時は常に今日
  const [dateKey, setDateKey] = useState<string>(() => todayKey());

  const [exists, setExists] = useState<boolean>(false);
  const [map, setMap] = useState<Record<string, LaundryStatus>>({});

  // ✅ 部屋番号フィルター（入力したらその部屋だけ表示）
  const [roomFilterText, setRoomFilterText] = useState<string>(() => {
    const fixedRoomNo = toNonEmptyString(initialRoomNo);
    if (fixedRoomNo) return fixedRoomNo;
    if (typeof window === "undefined") return "";
    const saved = window.localStorage.getItem(LS_KEY_ROOM_FILTER) ?? "";
    return saved;
  });
  const fixedRoomNo = toNonEmptyString(initialRoomNo);
  const effectiveRoomFilterText = readOnlyRoomNo ? fixedRoomNo : roomFilterText;

  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const openDatePicker = () => {
    const el = dateInputRef.current;
    if (!el) return;

    // Chrome / Edge / Android Chrome などでは、タップ時に明示的にピッカーを開く
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // showPicker が許可されない環境では通常フォーカスにフォールバック
      }
    }

    el.focus();
  };

  // config
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

  // roomFilter persist（画面を離れても保持）
  useEffect(() => {
    if (readOnlyRoomNo) return;
    if (typeof window === "undefined") return;
    const v = roomFilterText;
    if (v && v.trim().length > 0) {
      window.localStorage.setItem(LS_KEY_ROOM_FILTER, v);
    } else {
      window.localStorage.removeItem(LS_KEY_ROOM_FILTER);
    }
  }, [readOnlyRoomNo, roomFilterText]);

  const sections = useMemo(() => config?.sections ?? [], [config]);

  const selectedSection = useMemo(() => {
    if (!sections.length) return null;

    const roomNo = toNonEmptyString(effectiveRoomFilterText);
    if (roomNo) {
      const hit = sections.find((s) => {
        const floors = Array.isArray(s.floors) ? s.floors : [];
        return floors.some((f) => {
          const roomNos = Array.isArray(f.roomNos) ? f.roomNos : [];
          return roomNos.some((n) => String(n) === roomNo);
        });
      });
      if (hit) return hit;
    }

    if (sections.length === 1) return sections[0];
    return sections[0];
  }, [effectiveRoomFilterText, sections]);

  const roomFilter = useMemo(
    () => normalizeRoomFilter(effectiveRoomFilterText),
    [effectiveRoomFilterText],
  );

  if (!validProjectId) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
          projectId が未設定です。
        </div>
      </div>
    );
  }

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

  if (!sections.length) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
          設定情報（sections）が空です。管理側の設定を確認してください。
        </div>
      </div>
    );
  }

  if (!selectedSection) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
        <div className="text-sm font-extrabold text-amber-800 dark:text-amber-200">
          設定が見つかりません。管理側の設定を確認してください。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 操作（日付 + 部屋フィルター） */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-3">
          {residentGroupTitle ? (
            <span className="px-1 py-2 text-sm font-extrabold text-gray-900 dark:text-gray-100">
              {residentGroupTitle}
            </span>
          ) : null}

          {readOnlyRoomNo ? (
            <span className="px-1 py-2 text-sm font-extrabold text-gray-900 dark:text-gray-100">
              {fixedRoomNo ? `${fixedRoomNo}号室` : "未設定"}
            </span>
          ) : (
            <>
              <input
                value={roomFilterText}
                onChange={(e) => setRoomFilterText(e.target.value)}
                placeholder="例）305（空で全表示）"
                className="w-42.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900
                           dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              />

              {roomFilterText && (
                <button
                  type="button"
                  onClick={() => setRoomFilterText("")}
                  className="rounded-xl border bg-white px-3 py-2 text-sm font-extrabold text-gray-900 hover:bg-gray-50
                             dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                >
                  クリア
                </button>
              )}
            </>
          )}

          {!exists && (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-extrabold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
              この日付のデータはありません
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={openDatePicker}
            className="text-sm font-extrabold text-gray-900 dark:text-gray-100"
          >
            日付
          </button>

          <input
            ref={dateInputRef}
            type="date"
            value={dateKey}
            onClick={openDatePicker}
            onChange={(e) => {
              const v = e.target.value;
              if (!isDateKey(v)) return;
              setDateKey(v); // ✅ 手動で選んだ日はそのまま保持（自動で今日に戻さない）
            }}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900
                       dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          />
        </div>
      </div>

      {/* 凡例 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-4 text-sm font-extrabold text-gray-900 dark:text-gray-100">
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

      {!exists ? null : (
        <SectionBoard
          section={selectedSection}
          map={map}
          roomFilter={roomFilter}
        />
      )}
    </div>
  );
}

function SectionBoard({
  section,
  map,
  roomFilter,
}: {
  section: LaundrySectionDef;
  map: Record<string, LaundryStatus>;
  roomFilter: { roomNo: string; floorHint: number | null } | null;
}) {
  const sectionKey = toNonEmptyString(section.sectionKey).toUpperCase();
  const floors = (section.floors ?? [])
    .slice()
    .sort((a, b) => a.floor - b.floor);
  const maxRooms = maxRoomsInSection(section);

  // ✅ 部屋番号フィルターがある場合：該当部屋だけを表示
  const filteredHit = (() => {
    if (!roomFilter) return null;

    const rn = roomFilter.roomNo;
    const fh = roomFilter.floorHint;

    // floorHint があるならその階を優先
    const candidateFloors =
      fh != null ? floors.filter((f) => f.floor === fh) : floors;

    for (const f of candidateFloors) {
      const roomNos = Array.isArray(f.roomNos) ? f.roomNos : [];
      const rooms = buildRoomsForFloor(sectionKey, f.floor, roomNos);

      const hit = rooms.find((r) => r.label === rn);
      if (hit) {
        return { floor: f.floor, room: hit };
      }
    }

    // floorHint 付きで見つからなければ全階でもう一回（305だけど階が例外…等）
    if (fh != null) {
      for (const f of floors) {
        const roomNos = Array.isArray(f.roomNos) ? f.roomNos : [];
        const rooms = buildRoomsForFloor(sectionKey, f.floor, roomNos);
        const hit = rooms.find((r) => r.label === rn);
        if (hit) {
          return { floor: f.floor, room: hit };
        }
      }
    }

    return {
      floor: null as number | null,
      room: null as { id: string; label: string } | null,
    };
  })();

  return (
    <div className="space-y-2">
      {/* ✅ フィルター表示 */}
      {roomFilter ? (
        filteredHit?.room ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              {filteredHit.floor}F / {filteredHit.room.label}号室
            </div>

            <div className="mt-3">
              {(() => {
                const status: LaundryStatus = map[filteredHit.room.id] ?? "ok";
                return (
                  <div
                    className="min-w-11.5 rounded-2xl border border-gray-200 bg-white p-3 text-center
                               dark:border-gray-800 dark:bg-gray-950"
                    title={`${filteredHit.floor}F / ${filteredHit.room.label}号室 / ${STATUS_HELP[status]}`}
                  >
                    <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
                      {filteredHit.room.label}
                    </div>
                    <div className="mt-1 text-2xl font-extrabold leading-7 text-gray-900 dark:text-gray-100">
                      {STATUS_LABEL[status]}
                    </div>
                    <div className="mt-2 flex items-center justify-center gap-2">
                      <StatusMark status={status} />
                      <div className="text-xs font-bold text-gray-700 dark:text-gray-200">
                        {STATUS_HELP[status]}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
            <div className="text-sm font-extrabold text-amber-800 dark:text-amber-200">
              入力した部屋番号が設定に見つかりません。
            </div>
            <div className="mt-2 text-sm text-amber-700 dark:text-amber-200/80">
              例：305 のように数字だけで入力してください。
            </div>
          </div>
        )
      ) : (
        // ✅ 通常表示（全室ボード）
        <>
          {floors.map((f) => {
            const roomNos = Array.isArray(f.roomNos) ? f.roomNos : [];
            const rooms = buildRoomsForFloor(sectionKey, f.floor, roomNos);
            const indent = calcIndent(maxRooms, rooms.length);

            return (
              <div
                key={`${sectionKey}-${f.floor}`}
                className="flex items-start gap-2"
              >
                <div className="w-12 pt-2 text-right text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  {f.floor}F
                </div>

                <div
                  className="grid gap-1"
                  style={{
                    gridTemplateColumns: `repeat(${maxRooms}, minmax(0, 1fr))`,
                  }}
                >
                  {Array.from({ length: indent }).map((_, i) => (
                    <div key={`pad-${sectionKey}-${f.floor}-${i}`} />
                  ))}

                  {rooms.map((r) => {
                    const status: LaundryStatus = map[r.id] ?? "ok";

                    return (
                      <div
                        key={r.id}
                        className="min-w-11.5 rounded-xl border border-gray-200 bg-white p-1 text-center dark:border-gray-800 dark:bg-gray-900"
                        title={`${f.floor}F / ${r.label}号室 / ${STATUS_HELP[status]}`}
                      >
                        <div className="text-[10px] font-bold text-gray-600 dark:text-gray-300">
                          {r.label}
                        </div>
                        <div className="text-lg font-extrabold leading-6 text-gray-900 dark:text-gray-100">
                          {STATUS_LABEL[status]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
