"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "../lib/firebaseClient";

function normalizeCode(input: string): string {
  return input.replace(/\s+/g, "").trim().toUpperCase();
}

function normalizeText(input: string): string {
  return input.trim();
}

type ShareCodeDoc = {
  projectId?: string;
  projectName?: string; // あっても無くてもOK（無い場合は projects から取る）
  enabled?: boolean;
};

type ProjectMeta = {
  name?: string;
};

export default function RegisterPage() {
  const router = useRouter();

  // ✅ 入力はこれだけ
  const [name, setName] = useState("");
  const [shareCodeRaw, setShareCodeRaw] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const shareCode = useMemo(() => normalizeCode(shareCodeRaw), [shareCodeRaw]);

  async function register() {
    setErrorText(null);

    const displayName = normalizeText(name);

    if (!displayName) {
      setErrorText("名前を入力してください");
      return;
    }
    if (!shareCode) {
      setErrorText("シェアコードを入力してください");
      return;
    }
    if (!email || !password) {
      setErrorText("メールとパスワードを入力してください");
      return;
    }

    try {
      setBusy(true);

      // 1) shareCode → projectId
      const scRef = doc(db, "shareCodes", shareCode);
      const scSnap = await getDoc(scRef);

      if (!scSnap.exists()) {
        setErrorText("シェアコードが見つかりません。管理者に確認してください。");
        return;
      }

      const sc = scSnap.data() as ShareCodeDoc;

      if (sc.enabled === false) {
        setErrorText("このシェアコードは無効です。");
        return;
      }

      const projectId = typeof sc.projectId === "string" ? sc.projectId : "";
      if (!projectId) {
        setErrorText("シェアコードの設定が不完全です（projectIdなし）。");
        return;
      }

      // 2) projectName を確実に取得（shareCodesに無ければ projects を読む）
      let projectName = typeof sc.projectName === "string" ? sc.projectName : "";

      if (!projectName) {
        const pRef = doc(db, "projects", projectId);
        const pSnap = await getDoc(pRef);
        if (pSnap.exists()) {
          const p = pSnap.data() as ProjectMeta;
          projectName = typeof p.name === "string" ? p.name : "";
        }
      }

      // 3) Auth 作成
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // 4) Firebase Auth の displayName を「名前」にする
      await updateProfile(cred.user, { displayName });

      const uid = cred.user.uid;

      // 5) Firestore: residentMembers に保存（部屋情報は持たない）
      await setDoc(
        doc(db, "residentMembers", uid),
        {
          uid,
          email,
          displayName,

          shareCode,
          projectId,
          projectName: projectName || null,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      // 6) projects/{projectId}/members/{uid} も作る（部屋情報は持たない）
      await setDoc(
        doc(db, "projects", projectId, "members", uid),
        {
          uid,
          role: "resident",
          displayName,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      router.replace("/menu");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg.includes("auth/email-already-in-use")) {
        setErrorText("このメールは既に使われています。ログインしてください。");
        return;
      }

      setErrorText("アカウント作成に失敗しました。入力内容や通信状況をご確認ください。");
      console.error("register error:", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h1 className="text-xl font-extrabold mb-2 text-gray-900 dark:text-gray-100">
          住人アカウント作成
        </h1>

        {errorText && <div className="mb-3 text-sm text-red-600 font-bold">{errorText}</div>}

        <label className="block text-sm font-bold mb-1 text-gray-800 dark:text-gray-200">
          名前
        </label>
        <input
          className="w-full mb-3 rounded-xl border px-3 py-2 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例）山田 太郎"
          disabled={busy}
        />

        <label className="block text-sm font-bold mb-1 text-gray-800 dark:text-gray-200">
          シェアコード
        </label>
        <input
          className="w-full mb-3 rounded-xl border px-3 py-2 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
          value={shareCodeRaw}
          onChange={(e) => setShareCodeRaw(e.target.value)}
          placeholder="例）B4WMSG"
          disabled={busy}
        />

        <label className="block text-sm font-bold mb-1 text-gray-800 dark:text-gray-200">
          メールアドレス
        </label>
        <input
          className="w-full mb-3 rounded-xl border px-3 py-2 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="例）aaa@example.com"
          disabled={busy}
        />

        <label className="block text-sm font-bold mb-1 text-gray-800 dark:text-gray-200">
          パスワード
        </label>
        <input
          type="password"
          className="w-full mb-4 rounded-xl border px-3 py-2 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="8文字以上推奨"
          disabled={busy}
        />

        <button
          type="button"
          onClick={() => void register()}
          disabled={busy}
          className="w-full rounded-xl bg-blue-600 py-2 text-white font-bold disabled:opacity-60"
        >
          {busy ? "作成中..." : "アカウント作成"}
        </button>

        <button
          type="button"
          onClick={() => router.push("/login")}
          className="mt-3 w-full text-sm text-blue-600 font-bold"
          disabled={busy}
        >
          ▶ すでにアカウントがある方（ログイン）
        </button>
      </div>
    </main>
  );
}
