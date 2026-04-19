"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../lib/firebaseClient";

type MemberDoc = {
  uid?: string;
  role?: string; // "manager" | "craftsman" | "resident"
  displayName?: string;
  name?: string;
  email?: string;
  company?: string;
  memberRole?: string;
};

type ResidentMemberDoc = {
  projectId?: string;
  projectName?: string;
};

function toNonEmptyString(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function safeDecode(v: string | null): string {
  if (!v) return "";
  try {
    return decodeURIComponent(v);
  } catch {
    return v ?? "";
  }
}

function makeRoomKey(a: string, b: string): string {
  return [a, b].sort().join("__");
}

function countUnreadForMe(
  rows: Array<{ id: string; data: Record<string, unknown> }>,
  myUid: string,
): number {
  return rows.filter((row) => {
    const data = row.data;
    const toUid = toNonEmptyString(data.toUid);
    const senderUid = toNonEmptyString(data.senderUid);
    const readBy = Array.isArray(data.readBy)
      ? data.readBy.filter((v): v is string => typeof v === "string")
      : [];

    return (
      !!myUid &&
      toUid === myUid &&
      senderUid !== myUid &&
      !readBy.includes(myUid)
    );
  }).length;
}

export default function ManagersListPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();

  const [projectNameFromQuery, setProjectNameFromQuery] = useState("");

  const routeProjectId = useMemo(() => {
    const raw = params?.projectId;
    return typeof raw === "string" ? raw : "";
  }, [params]);

  const [fallbackProjectId, setFallbackProjectId] = useState("");
  const [fallbackProjectName, setFallbackProjectName] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    setProjectNameFromQuery(safeDecode(params.get("projectName")));
  }, []);

  const projectId = routeProjectId || fallbackProjectId;
  const projectName = projectNameFromQuery || fallbackProjectName;

  const [busy, setBusy] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ id: string; data: MemberDoc }>>(
    [],
  );
  const [actionOpen, setActionOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<{
    id: string;
    data: MemberDoc;
  } | null>(null);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [isOwnerLogin, setIsOwnerLogin] = useState(false);
  const [unreadByUid, setUnreadByUid] = useState<Record<string, number>>({});
  const [removing, setRemoving] = useState(false);

  const currentUid = auth.currentUser?.uid ?? "";

  useEffect(() => {
    if (routeProjectId) return;
    if (!currentUid) return;

    let mounted = true;

    (async () => {
      try {
        const snap = await getDoc(doc(db, "residentMembers", currentUid));
        if (!mounted) return;
        if (!snap.exists()) return;

        const data = snap.data() as ResidentMemberDoc;
        setFallbackProjectId(toNonEmptyString(data.projectId));
        setFallbackProjectName(toNonEmptyString(data.projectName));
      } catch (e) {
        console.log("residentMembers project fallback error:", e);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [currentUid, routeProjectId]);

  function openActions(row: { id: string; data: MemberDoc }) {
    setSelectedRow(row);
    setActionOpen(true);
  }

  function closeActions() {
    setActionOpen(false);
  }

  function closeRoleModal() {
    setRoleModalOpen(false);
    setSelectedRow(null);
  }

  function openDmForRow(row: { id: string; data: MemberDoc }) {
    if (!projectId) return;

    const toUid = toNonEmptyString(row.data.uid) || row.id;
    if (!toUid) {
      window.alert("相手のUIDが取得できませんでした。");
      return;
    }

    const qs = new URLSearchParams();
    if (projectName) qs.set("projectName", projectName);
    qs.set("projectId", projectId);
    qs.set("to", toUid);
    router.push(`/dm?${qs.toString()}`);
  }

  function goDm() {
    if (!selectedRow) return;
    openDmForRow(selectedRow);
    closeActions();
    setSelectedRow(null);
  }

  async function changeRole(nextRole: "admin" | "member" | "viewer") {
    if (!projectId) return;
    if (!selectedRow) return;

    const targetUid = toNonEmptyString(selectedRow.data.uid) || selectedRow.id;
    if (!targetUid) {
      window.alert("対象ユーザーのUIDが取得できませんでした。");
      return;
    }

    try {
      setRoleSaving(true);

      await updateDoc(
        doc(db, "projects", projectId, "members", selectedRow.id),
        {
          role: nextRole,
        },
      );

      await updateDoc(doc(db, "users", targetUid, "myProjects", projectId), {
        role: nextRole,
      });

      setItems((prev) =>
        prev.map((row) =>
          row.id === selectedRow.id
            ? {
                ...row,
                data: {
                  ...row.data,
                  role: nextRole,
                },
              }
            : row,
        ),
      );

      closeRoleModal();
    } catch (e) {
      console.log("change role error:", e);
      window.alert("役職の変更に失敗しました。");
    } finally {
      setRoleSaving(false);
    }
  }

  async function removeManagerFromProject() {
    if (!projectId) return;
    if (!selectedRow) return;
    if (!isOwnerLogin) {
      window.alert("ownerのみ追放できます。");
      return;
    }

    const targetUid = toNonEmptyString(selectedRow.data.uid) || selectedRow.id;
    if (!targetUid) {
      window.alert("対象ユーザーのUIDが取得できませんでした。");
      return;
    }

    const ok = window.confirm("この監督を当工事から追放します。よろしいですか？");
    if (!ok) return;

    try {
      setRemoving(true);

      await deleteDoc(doc(db, "projects", projectId, "members", selectedRow.id));
      await deleteDoc(doc(db, "users", targetUid, "myProjects", projectId));

      setItems((prev) => prev.filter((row) => row.id !== selectedRow.id));
      setActionOpen(false);
      setSelectedRow(null);
    } catch (e) {
      console.log("remove manager error:", e);
      window.alert("追放に失敗しました。");
    } finally {
      setRemoving(false);
    }
  }

  useEffect(() => {
    const uid = auth.currentUser?.uid ?? "";
    if (!projectId || !uid) {
      setIsOwnerLogin(false);
      return;
    }

    let mounted = true;

    (async () => {
      try {
        const mySnap = await getDoc(
          doc(db, "projects", projectId, "members", uid),
        );
        if (!mounted) return;

        if (!mySnap.exists()) {
          setIsOwnerLogin(false);
          return;
        }

        const data = mySnap.data() as MemberDoc;
        setIsOwnerLogin(data.role === "owner");
      } catch (e) {
        console.log("owner check error:", e);
        if (!mounted) return;
        setIsOwnerLogin(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [projectId, currentUid]);

  useEffect(() => {
    if (!projectId) return;

    let mounted = true;

    (async () => {
      try {
        setBusy(true);
        setErrorText(null);

        const colRef = collection(db, "projects", projectId, "members");
        const qy = query(colRef, orderBy("displayName", "asc"));

        const snap = await getDocs(qy);
        const allRows: Array<{ id: string; data: MemberDoc }> = [];
        snap.forEach((d) =>
          allRows.push({ id: d.id, data: d.data() as MemberDoc }),
        );

        const managerRows: Array<{ id: string; data: MemberDoc }> = [];

        for (const row of allRows) {
          const uid = toNonEmptyString(row.data.uid) || row.id;
          if (!uid) continue;
          if (currentUid && uid === currentUid) continue;

          const managerSnap = await getDoc(doc(db, "reNovaMember", uid));
          if (!managerSnap.exists()) continue;

          managerRows.push(row);
        }

        managerRows.sort((a, b) => {
          const an =
            toNonEmptyString(a.data.displayName) ||
            toNonEmptyString(a.data.name) ||
            "（名称未設定）";
          const bn =
            toNonEmptyString(b.data.displayName) ||
            toNonEmptyString(b.data.name) ||
            "（名称未設定）";
          return an.localeCompare(bn, "ja");
        });

        if (!mounted) return;
        setItems(managerRows);
      } catch (e) {
        console.log("managers list error:", e);
        if (!mounted) return;
        setErrorText("監督一覧の取得に失敗しました。");
      } finally {
        if (!mounted) return;
        setBusy(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [projectId, currentUid]);

  useEffect(() => {
    if (!projectId) return;
    if (!currentUid) {
      setUnreadByUid({});
      return;
    }
    if (items.length === 0) {
      setUnreadByUid({});
      return;
    }

    const unsubscribers: Array<() => void> = [];

    items.forEach((it) => {
      const peerUid = toNonEmptyString(it.data.uid) || it.id;
      if (!peerUid || peerUid === currentUid) return;

      const roomKey = makeRoomKey(currentUid, peerUid);
      const colRef = collection(
        db,
        "projects",
        projectId,
        "dmRooms",
        roomKey,
        "messages",
      );
      const qy = query(colRef, orderBy("createdAt", "asc"), limit(300));

      const unsub = onSnapshot(
        qy,
        (snap) => {
          const rows: Array<{ id: string; data: Record<string, unknown> }> = [];
          snap.forEach((d) =>
            rows.push({ id: d.id, data: d.data() as Record<string, unknown> }),
          );

          const unread = countUnreadForMe(rows, currentUid);
          setUnreadByUid((prev) => {
            if ((prev[peerUid] ?? 0) === unread) return prev;
            return { ...prev, [peerUid]: unread };
          });
        },
        (err) => {
          console.log("resident managers unread snapshot error:", err);
        },
      );

      unsubscribers.push(unsub);
    });

    return () => {
      unsubscribers.forEach((fn) => fn());
    };
  }, [currentUid, items, projectId]);

  if (!projectId) {
    return (
      <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
        <div className="mx-auto w-full max-w-3xl px-4 py-8">
          <div className="rounded-2xl border bg-white p-4 text-sm font-bold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            読み込み中...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              監督一覧
            </h1>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              工事：{projectName || "（名称未設定）"}
            </div>
          </div>
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
              監督がまだ登録されていません。
            </div>
          ) : (
            items.map((it) => {
              const name =
                toNonEmptyString(it.data.displayName) ||
                toNonEmptyString(it.data.name) ||
                "（名称未設定）";
              const company = toNonEmptyString(it.data.company);
              const email = toNonEmptyString(it.data.email);
              const targetUid = toNonEmptyString(it.data.uid) || it.id;
              const unreadCount = unreadByUid[targetUid] ?? 0;

              return (
                <div
                  key={it.id}
                  onClick={() => openDmForRow(it)}
                  onContextMenu={(e) => {
                    if (!isOwnerLogin) return;
                    e.preventDefault();
                    openActions(it);
                  }}
                  className="rounded-2xl border bg-white p-4 cursor-pointer hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                  title={isOwnerLogin ? "右クリックでメンバー操作" : undefined}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-base font-extrabold text-gray-900 dark:text-gray-100">
                      {name}
                    </div>
                    {unreadCount > 0 && (
                      <div className="inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-extrabold text-white">
                        {unreadCount}
                      </div>
                    )}
                  </div>
                  {(company || email) && (
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {company ? company : ""}
                      {company && email ? " / " : ""}
                      {email ? email : ""}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {actionOpen && selectedRow && (
          <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3">
            <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-950 dark:shadow-none dark:ring-1 dark:ring-gray-800">
              <div className="text-base font-extrabold text-gray-900 dark:text-gray-100">
                {toNonEmptyString(selectedRow.data.displayName) ||
                  toNonEmptyString(selectedRow.data.name) ||
                  "（名称未設定）"}
              </div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                操作を選択してください
              </div>

              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={goDm}
                  className={[
                    "inline-flex w-full items-center justify-center rounded-xl border px-4 py-3 text-sm font-extrabold transition",
                    "border-gray-200 bg-white text-gray-900 hover:bg-gray-50",
                    "dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900",
                  ].join(" ")}
                >
                  メッセージ
                </button>

                {isOwnerLogin && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setActionOpen(false);
                        setRoleModalOpen(true);
                      }}
                      className={[
                        "inline-flex w-full items-center justify-center rounded-xl border px-4 py-3 text-sm font-extrabold transition",
                        "border-gray-200 bg-white text-gray-900 hover:bg-gray-50",
                        "dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900",
                      ].join(" ")}
                    >
                      役職を変更
                    </button>

                    <button
                      type="button"
                      onClick={() => void removeManagerFromProject()}
                      disabled={removing}
                      className={[
                        "inline-flex w-full items-center justify-center rounded-xl border px-4 py-3 text-sm font-extrabold transition disabled:opacity-50",
                        "border-red-200 bg-red-600 text-white hover:bg-red-700",
                        "dark:border-red-900/50 dark:bg-red-700 dark:text-white dark:hover:bg-red-800",
                      ].join(" ")}
                    >
                      {removing ? "追放中..." : "追放"}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (removing) return;
                    setActionOpen(false);
                    setSelectedRow(null);
                  }}
                  disabled={removing}
                  className={[
                    "mt-1 inline-flex w-full items-center justify-center rounded-xl border px-4 py-3 text-sm font-extrabold transition disabled:opacity-50",
                    "border-gray-200 bg-white text-gray-900 hover:bg-gray-50",
                    "dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900",
                  ].join(" ")}
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}
        {roleModalOpen && selectedRow && (
          <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3">
            <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-950 dark:shadow-none dark:ring-1 dark:ring-gray-800">
              <div className="text-base font-extrabold text-gray-900 dark:text-gray-100">
                {toNonEmptyString(selectedRow.data.displayName) ||
                  toNonEmptyString(selectedRow.data.name) ||
                  "（名称未設定）"}
              </div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                役職を選択してください
              </div>

              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={() => void changeRole("admin")}
                  disabled={roleSaving}
                  className={[
                    "inline-flex w-full items-center justify-center rounded-xl border px-4 py-3 text-sm font-extrabold transition disabled:opacity-50",
                    "border-gray-200 bg-white text-gray-900 hover:bg-gray-50",
                    "dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900",
                  ].join(" ")}
                >
                  管理
                </button>

                <button
                  type="button"
                  onClick={() => void changeRole("member")}
                  disabled={roleSaving}
                  className={[
                    "inline-flex w-full items-center justify-center rounded-xl border px-4 py-3 text-sm font-extrabold transition disabled:opacity-50",
                    "border-gray-200 bg-white text-gray-900 hover:bg-gray-50",
                    "dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900",
                  ].join(" ")}
                >
                  一般
                </button>

                <button
                  type="button"
                  onClick={closeRoleModal}
                  disabled={roleSaving}
                  className={[
                    "mt-1 inline-flex w-full items-center justify-center rounded-xl border px-4 py-3 text-sm font-extrabold transition disabled:opacity-50",
                    "border-gray-200 bg-white text-gray-900 hover:bg-gray-50",
                    "dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900",
                  ].join(" ")}
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
