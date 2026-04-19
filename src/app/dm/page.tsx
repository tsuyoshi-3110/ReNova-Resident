// src/app/proclink/projects/[projectId]/dm/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { Loader2, Paperclip, Send } from "lucide-react";

import { auth, db } from "../lib/firebaseClient";

type ChatRole = "manager" | "craftsman" | "resident";

type ChatProfile = {
  uid: string;
  role: ChatRole;
  name: string;
  projectId: string;
  projectName?: string | null;
};

type MemberDoc = {
  uid?: string;
  role?: string;
  displayName?: string;
  name?: string;
  email?: string;
  company?: string;
  workType?: string;
  phone?: string;
};

type MediaType = "image" | "video" | "pdf";
type RenderMediaKind = MediaType | "link" | null;

type DmMessage = {
  text?: string;

  senderUid?: string;
  senderName?: string;
  senderRole?: ChatRole;

  toUid?: string;
  readBy?: string[];

  // 新形式
  mediaUrl?: string;
  mediaType?: MediaType | null;
  fileName?: string;

  // 旧形式（互換）
  fileUrl?: string;
  fileType?: string;

  createdAt?: unknown;
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

function inferMediaTypeFromMime(mime: string): MediaType | null {
  const m = toNonEmptyString(mime);
  if (!m) return null;
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf") return "pdf";
  return null;
}

function inferMediaTypeFromFileName(name: string): MediaType | null {
  const n = toNonEmptyString(name).toLowerCase();
  if (!n) return null;
  if (n.endsWith(".pdf")) return "pdf";
  if (
    n.endsWith(".png") ||
    n.endsWith(".jpg") ||
    n.endsWith(".jpeg") ||
    n.endsWith(".webp") ||
    n.endsWith(".gif")
  )
    return "image";
  if (
    n.endsWith(".mp4") ||
    n.endsWith(".mov") ||
    n.endsWith(".webm") ||
    n.endsWith(".m4v")
  )
    return "video";
  return null;
}

/**
 * ✅ ここが重要：URLがあるなら必ず表示できる形にする
 * - mediaType が null/壊れてても link として出す
 * - mime が octet-stream でも fileName 拡張子で推測する
 */
function getRenderableMedia(m: DmMessage): {
  url: string;
  kind: RenderMediaKind;
  name: string;
} {
  const fileName = toNonEmptyString(m.fileName) || "attachment";

  // 1) 新形式優先
  const mediaUrl = toNonEmptyString(m.mediaUrl);
  if (mediaUrl) {
    const direct = m.mediaType ?? null;
    if (direct === "image" || direct === "video" || direct === "pdf") {
      return { url: mediaUrl, kind: direct, name: fileName };
    }

    // mediaType が null/壊れてる場合：mimeや拡張子で推測
    const byMime = inferMediaTypeFromMime(toNonEmptyString(m.fileType));
    const byExt = inferMediaTypeFromFileName(fileName);
    const inferred = byMime ?? byExt;

    return { url: mediaUrl, kind: inferred ?? "link", name: fileName };
  }

  // 2) 旧形式互換
  const fileUrl = toNonEmptyString(m.fileUrl);
  if (fileUrl) {
    const byMime = inferMediaTypeFromMime(toNonEmptyString(m.fileType));
    const byExt = inferMediaTypeFromFileName(fileName);
    const inferred = byMime ?? byExt;

    return { url: fileUrl, kind: inferred ?? "link", name: fileName };
  }

  return { url: "", kind: null, name: "" };
}

export default function DmPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const projectId = useMemo(() => {
    return toNonEmptyString(sp.get("projectId"));
  }, [sp]);

  const projectName = safeDecode(sp.get("projectName"));
  const toUid = toNonEmptyString(sp.get("to"));

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ChatProfile | null>(null);
  const [peer, setPeer] = useState<MemberDoc | null>(null);

  const [errorText, setErrorText] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<
    Array<{ id: string; roomId: string; docId: string; data: DmMessage }>
  >([]);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);

  const roomKey = useMemo(() => {
    if (!profile?.uid || !toUid) return "";
    return makeRoomKey(profile.uid, toUid);
  }, [profile?.uid, toUid]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, 160);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > 160 ? "auto" : "hidden";
  }, []);

  // 1) 自分プロフィール
  useEffect(() => {
    if (!projectId) return;

    let mounted = true;

    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) {
          if (!mounted) return;
          router.replace("/login");
          return;
        }

        const mySnap = await getDoc(
          doc(db, "projects", projectId, "members", u.uid),
        );
        if (!mounted) return;

        if (!mySnap.exists()) {
          setProfile(null);
          setErrorText("現場メンバー情報が見つかりません（members未参加）。");
          setLoading(false);
          return;
        }

        const d = mySnap.data() as MemberDoc;
        const roleRaw = toNonEmptyString(d.role);
        const role: ChatRole =
          roleRaw === "manager" ||
          roleRaw === "craftsman" ||
          roleRaw === "resident"
            ? (roleRaw as ChatRole)
            : "craftsman";

        const name =
          toNonEmptyString(d.displayName) ||
          toNonEmptyString(d.name) ||
          toNonEmptyString(u.displayName) ||
          "（名称未設定）";

        setProfile({
          uid: u.uid,
          role,
          name,
          projectId,
          projectName: projectName || null,
        });

        setLoading(false);
      } catch (e) {
        console.log("dm profile error:", e);
        if (!mounted) return;
        setProfile(null);
        setErrorText("プロフィール取得に失敗しました。");
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, [router, projectId, projectName]);

  // 2) 相手情報
  useEffect(() => {
    if (!projectId || !toUid) return;

    let mounted = true;

    (async () => {
      try {
        const snap = await getDoc(
          doc(db, "projects", projectId, "members", toUid),
        );
        if (!mounted) return;

        if (!snap.exists()) {
          setPeer(null);
          setErrorText("相手のメンバー情報が見つかりません。");
          return;
        }
        setPeer(snap.data() as MemberDoc);
      } catch (e) {
        console.log("dm peer load error:", e);
        if (!mounted) return;
        setPeer(null);
        setErrorText("相手情報の取得に失敗しました。");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [projectId, toUid]);

  // 3) メッセージ購読（canonical/legacy/reverse 統合）
  useEffect(() => {
    if (!projectId || !roomKey || !profile?.uid || !toUid) return;

    setErrorText(null);

    const byRoom = new Map<
      string,
      Array<{ id: string; roomId: string; docId: string; data: DmMessage }>
    >();

    const applyMerged = () => {
      const merged: Array<{
        id: string;
        roomId: string;
        docId: string;
        data: DmMessage;
      }> = [];
      byRoom.forEach((arr) => merged.push(...arr));

      merged.sort((a, b) => {
        const ta =
          (
            a.data.createdAt as { toMillis?: () => number } | undefined
          )?.toMillis?.() ?? 0;
        const tb =
          (
            b.data.createdAt as { toMillis?: () => number } | undefined
          )?.toMillis?.() ?? 0;
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      });

      setMsgs(merged);
    };

    const subOne = (rid: string) => {
      const colRef = collection(
        db,
        "projects",
        projectId,
        "dmRooms",
        rid,
        "messages",
      );
      const qy = query(colRef, orderBy("createdAt", "asc"), limit(300));

      return onSnapshot(
        qy,
        async (snap) => {
          const rows: Array<{
            id: string;
            roomId: string;
            docId: string;
            data: DmMessage;
          }> = [];
          const markReadTasks: Promise<void>[] = [];

          snap.forEach((d) => {
            const data = d.data() as DmMessage;
            rows.push({
              id: `${rid}:${d.id}`,
              roomId: rid,
              docId: d.id,
              data,
            });

            const senderUid = toNonEmptyString(data.senderUid);
            const readBy = Array.isArray(data.readBy) ? data.readBy : [];
            const alreadyRead = readBy.includes(profile.uid);

            if (profile.uid && senderUid && senderUid !== profile.uid && !alreadyRead) {
              markReadTasks.push(
                updateDoc(
                  doc(db, "projects", projectId, "dmRooms", rid, "messages", d.id),
                  {
                    readBy: arrayUnion(profile.uid),
                  },
                ).catch((err) => {
                  console.log("mark read error:", err);
                }) as Promise<void>,
              );
            }
          });

          if (markReadTasks.length > 0) {
            await Promise.all(markReadTasks);
          }

          byRoom.set(rid, rows);
          applyMerged();
        },
        (err) => {
          console.log("dm onSnapshot error:", err);
          setErrorText("DMの取得に失敗しました。");
        },
      );
    };

    const canonical = roomKey;
    const legacy = `${profile.uid}__${toUid}`;
    const legacyReverse = `${toUid}__${profile.uid}`;

    const unsubs: Array<() => void> = [];
    unsubs.push(subOne(canonical));
    if (legacy && legacy !== canonical) unsubs.push(subOne(legacy));
    if (
      legacyReverse &&
      legacyReverse !== canonical &&
      legacyReverse !== legacy
    )
      unsubs.push(subOne(legacyReverse));

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [projectId, roomKey, profile?.uid, toUid]);

  useEffect(() => {
    resizeTextarea();
  }, [text, resizeTextarea]);

  // 4) 下追従
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const threshold = 40;
    stickToBottomRef.current =
      el.scrollHeight - (el.scrollTop + el.clientHeight) < threshold;
  }

  async function uploadAttachment(args: {
    file: File;
    projectId: string;
    roomKey: string;
  }) {
    const f = args.file;

    const isImage = f.type.startsWith("image/");
    const isVideo = f.type.startsWith("video/");
    const isPdf =
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"); // ✅ mime空でもpdf扱い

    if (!isImage && !isVideo && !isPdf) {
      throw new Error("UNSUPPORTED_FILE");
    }

    const ext = toNonEmptyString(f.name.split(".").pop());
    const safeName = `${Date.now()}_${Math.random().toString(16).slice(2)}${ext ? "." + ext : ""}`;

    const storage = getStorage();
    const path = `projects/${args.projectId}/dm/${args.roomKey}/${safeName}`;
    const r = ref(storage, path);

    await uploadBytes(r, f, {
      contentType: f.type || "application/octet-stream",
    });
    const url = await getDownloadURL(r);

    const mediaType: MediaType = isImage ? "image" : isVideo ? "video" : "pdf";

    return {
      mediaUrl: url,
      mediaType,
      fileName: f.name,
      fileUrl: url,
      fileType: f.type || "application/octet-stream",
    };
  }

  async function send() {
    if (!profile) return;
    if (!projectId || !toUid || !roomKey) return;

    const t = toNonEmptyString(text);
    const hasFile = !!file;

    if (!t && !hasFile) return;

    try {
      setSending(true);
      setErrorText(null);

      const colRef = collection(
        db,
        "projects",
        projectId,
        "dmRooms",
        roomKey,
        "messages",
      );

      let media: {
        mediaUrl: string;
        mediaType: MediaType;
        fileName: string;
        fileUrl: string;
        fileType: string;
      } | null = null;

      if (file) {
        media = await uploadAttachment({ file, projectId, roomKey });
      }

      const payload: DmMessage = {
        text: t || "",
        senderUid: profile.uid,
        senderName: profile.name,
        senderRole: profile.role,
        toUid,
        readBy: [profile.uid],
        ...(media ? media : {}),
        createdAt: serverTimestamp(),
      };

      await addDoc(colRef, payload);

      setText("");
      setFile(null);
      stickToBottomRef.current = true;

      requestAnimationFrame(() => {
        resizeTextarea();
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log("dm send error:", e);

      if (msg === "UNSUPPORTED_FILE") {
        setErrorText("画像/動画/PDF以外は添付できません。");
        return;
      }

      setErrorText("送信に失敗しました。通信状況をご確認ください。");
    } finally {
      setSending(false);
    }
  }

  if (!projectId) return null;
  if (loading) return null;
  if (!profile) return null;

  if (!toUid) {
    return (
      <main className="min-h-dvh bg-gray-50 dark:bg-gray-950">
        <div className="mx-auto w-full max-w-2xl px-4 py-10">
          <div className="rounded-2xl border bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-base font-extrabold text-gray-900 dark:text-gray-100">
              DM相手が指定されていません
            </div>
          </div>
        </div>
      </main>
    );
  }

  const peerName =
    toNonEmptyString(peer?.displayName) ||
    toNonEmptyString(peer?.name) ||
    "（相手）";
  const peerRole = toNonEmptyString(peer?.role);

  return (
    <main className="flex min-h-dvh min-h-0 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-gray-900 dark:text-gray-100">
              DM：{peerName}
            </div>
            <div className="truncate text-xs font-bold text-gray-500 dark:text-gray-400">
              工事：{projectName || "（名称未設定）"}
              {peerRole ? ` / 相手：${peerRole}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-3 py-3 pb-[116px]">
        {errorText && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-semibold text-red-700">{errorText}</p>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-white dark:border-gray-800 dark:bg-gray-900">
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-24"
          >
            {msgs.length === 0 ? (
              <div className="rounded-xl border bg-white p-4 text-sm font-bold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                まだメッセージがありません。
              </div>
            ) : (
              <div className="grid gap-2">
                {msgs.map((m) => {
                  const mine = m.data.senderUid === profile.uid;
                  const body = toNonEmptyString(m.data.text);

                  const media = getRenderableMedia(m.data);

                  return (
                    <div
                      key={m.id}
                      className={
                        mine ? "flex justify-end" : "flex justify-start"
                      }
                    >
                      <div
                        className={[
                          "max-w-[90%] rounded-2xl border px-3 py-2",
                          mine
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800",
                        ].join(" ")}
                      >
                        {media.url && media.kind === "image" && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={media.url}
                            alt={media.name}
                            className="mb-2 max-h-70 w-auto rounded-xl"
                            loading="lazy"
                          />
                        )}

                        {media.url && media.kind === "video" && (
                          <video
                            src={media.url}
                            controls
                            className="mb-2 max-h-80 w-full rounded-xl"
                          />
                        )}

                        {/* ✅ pdf でも link でも「必ずリンクを出す」 */}
                        {media.url &&
                          (media.kind === "pdf" || media.kind === "link") && (
                            <a
                              href={media.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mb-2 inline-flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                            >
                              <span className="truncate">
                                {media.kind === "pdf" ? "📄" : "📎"}{" "}
                                {media.name || "添付ファイル"}
                              </span>
                              <span className="shrink-0">開く</span>
                            </a>
                          )}

                        {body && (
                          <div className="whitespace-pre-wrap text-sm font-bold leading-relaxed">
                            {body}
                          </div>
                        )}

                        {mine && (
                          <div className="mt-1 text-right text-[11px] font-extrabold opacity-80">
                            {(Array.isArray(m.data.readBy) ? m.data.readBy : []).includes(toUid)
                              ? "既読"
                              : "未読"}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-white px-3 py-1.5 dark:border-gray-800 dark:bg-gray-900"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 10px)" }}
      >
        <div className="mx-auto w-full max-w-2xl">
          {sending && (
            <div className="mb-2 flex items-center gap-2 text-xs font-extrabold text-gray-600 dark:text-gray-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              送信中...
            </div>
          )}

          {file && (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold dark:border-gray-800">
              <div className="truncate">添付：{file.name}</div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="rounded-lg border px-2 py-1 text-xs font-extrabold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                外す
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="shrink-0 inline-flex cursor-pointer items-center justify-center rounded-xl border bg-white p-2 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900">
              <Paperclip className="h-5 w-5" />
              <input
                type="file"
                accept="image/*,video/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  e.currentTarget.value = "";
                }}
                disabled={sending}
              />
            </label>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onInput={resizeTextarea}
              placeholder="メッセージを入力..."
              rows={1}
              className="min-h-10 max-h-40 w-full resize-none overflow-hidden rounded-xl border px-3 py-1.5 font-bold text-gray-900
                         focus:outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              style={{ fontSize: 16 }}
              disabled={sending}
            />

            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || (!toNonEmptyString(text) && !file)}
              className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-1.5 text-sm font-extrabold text-white disabled:opacity-60"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  送信中
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  送信
                </>
              )}
            </button>
          </div>

          <div className="mt-1 text-[11px] font-bold text-gray-500 dark:text-gray-400">
            ※ 画像/動画/PDFのみ添付可
          </div>
        </div>
      </div>
    </main>
  );
}
