"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createUserWithEmailAndPassword,
  updateProfile,
  type AuthError,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "../lib/firebaseClient";

function isAuthError(e: unknown): e is AuthError {
  return typeof e === "object" && e !== null && "code" in e;
}

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

type LaundryConfigDoc = {
  sections?: Array<{
    sectionName?: string;
    name?: string;
  }>;
};

type LaundrySectionOption = {
  sectionName: string;
};

function parseLaundrySectionOptions(data: unknown): LaundrySectionOption[] {
  if (typeof data !== "object" || data === null) return [];

  const record = data as LaundryConfigDoc;
  const sections = Array.isArray(record.sections) ? record.sections : [];
  const seen = new Set<string>();
  const options: LaundrySectionOption[] = [];

  sections.forEach((section) => {
    const rawName =
      typeof section?.sectionName === "string"
        ? section.sectionName
        : typeof section?.name === "string"
          ? section.name
          : "";
    const sectionName = normalizeText(rawName);
    if (!sectionName || seen.has(sectionName)) return;
    seen.add(sectionName);
    options.push({ sectionName });
  });

  return options;
}

export default function RegisterPage() {
  const router = useRouter();

  // ✅ 入力はこれだけ
  const [name, setName] = useState("");
  const [roomNo, setRoomNo] = useState("");
  const [shareCodeRaw, setShareCodeRaw] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [resolvedProjectId, setResolvedProjectId] = useState("");
  const [laundrySections, setLaundrySections] = useState<LaundrySectionOption[]>([]);
  const [sectionName, setSectionName] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const shareCode = useMemo(() => normalizeCode(shareCodeRaw), [shareCodeRaw]);
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const code = normalizeCode(params.get("code") || "");
    if (!code) return;

    setShareCodeRaw((prev) => (normalizeCode(prev) ? prev : code));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLaundryConfig() {
      setResolvedProjectId("");
      setLaundrySections([]);
      setSectionName("");

      if (!shareCode) return;

      try {
        const scRef = doc(db, "shareCodes", shareCode);
        const scSnap = await getDoc(scRef);
        if (!scSnap.exists()) return;

        const sc = scSnap.data() as ShareCodeDoc;
        const projectId = typeof sc.projectId === "string" ? sc.projectId : "";
        if (!projectId) return;

        const configRef = doc(db, "projects", projectId, "laundry", "config");
        const configSnap = await getDoc(configRef);
        const options = configSnap.exists()
          ? parseLaundrySectionOptions(configSnap.data())
          : [];

        if (cancelled) return;

        setResolvedProjectId(projectId);
        setLaundrySections(options);
        setSectionName((prev) => {
          if (!options.length) return "";
          return options.some((option) => option.sectionName === prev)
            ? prev
            : options[0]?.sectionName ?? "";
        });
      } catch (e) {
        if (cancelled) return;
        console.error("load laundry config error:", e);
        setResolvedProjectId("");
        setLaundrySections([]);
        setSectionName("");
      }
    }

    void loadLaundryConfig();

    return () => {
      cancelled = true;
    };
  }, [shareCode]);

  async function register() {
    setErrorText(null);

    const displayName = normalizeText(name);
    const normalizedRoomNo = normalizeText(roomNo);

    if (!displayName) {
      setErrorText("名前を入力してください");
      return;
    }
    if (!normalizedRoomNo) {
      setErrorText("部屋番号を入力してください");
      return;
    }
    if (!shareCode) {
      setErrorText("シェアコードを入力してください");
      return;
    }
    if (laundrySections.length > 0 && !normalizeText(sectionName)) {
      setErrorText("棟名を選択してください");
      return;
    }

    const mail = normalizeText(email).toLowerCase();
    const pass = password;

    if (!mail || !pass) {
      setErrorText("メールとパスワードを入力してください");
      return;
    }
    if (pass.length < 6) {
      setErrorText("パスワードは6文字以上で入力してください");
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
      const normalizedSectionName = normalizeText(sectionName);
      if (!projectId) {
        setErrorText("シェアコードの設定が不完全です（projectIdなし）。");
        return;
      }

      // 2) shareCodes に projectName があれば使う
      let projectName = typeof sc.projectName === "string" ? sc.projectName : "";

      // 3) Auth 作成
      const cred = await createUserWithEmailAndPassword(auth, mail, pass);

      // 4) Firebase Auth の displayName を「名前」にする
      await updateProfile(cred.user, { displayName });

      // 4.5) projectName が無い時だけ、ログイン後に projects から読む
      if (!projectName) {
        const pRef = doc(db, "projects", projectId);
        const pSnap = await getDoc(pRef);
        if (pSnap.exists()) {
          const p = pSnap.data() as ProjectMeta;
          projectName = typeof p.name === "string" ? p.name : "";
        }
      }

      const uid = cred.user.uid;

      // 5) Firestore: residentMembers に保存（部屋情報は持たない）
      await setDoc(
        doc(db, "residentMembers", uid),
        {
          uid,
          email: mail,
          displayName,
          roomNo: normalizedRoomNo,

          shareCode,
          projectId,
          projectName: projectName || null,
          sectionName: normalizedSectionName || null,

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
          roomNo: normalizedRoomNo,
          sectionName: normalizedSectionName || null,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      router.replace("/menu");

      // 念のため: 本番で replace 後に画面が更新されないケースのフォールバック
      window.setTimeout(() => {
        try {
          if (window.location.pathname !== "/menu") {
            window.location.href = "/menu";
          }
        } catch {
          // ignore
        }
      }, 400);
    } catch (e: unknown) {
      console.error("register error:", e);

      // Firebase/Auth の代表的なエラーは code で分かるように表示
      if (isAuthError(e)) {
        if (e.code === "auth/email-already-in-use") {
          setErrorText("このメールは既に使われています。ログインしてください。");
          return;
        }
        setErrorText(`アカウント作成に失敗しました（${e.code}）。`);
        return;
      }

      const msg = e instanceof Error ? e.message : String(e);

      if (msg.includes("auth/email-already-in-use")) {
        setErrorText("このメールは既に使われています。ログインしてください。");
        return;
      }

      setErrorText(`アカウント作成に失敗しました：${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-extrabold text-gray-900 dark:text-gray-100">
            住人アカウント作成
          </h1>

          <button
            type="button"
            onClick={() => router.back()}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm font-extrabold text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            戻る
          </button>
        </div>

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
          部屋番号
        </label>
        <input
          className="w-full mb-3 rounded-xl border px-3 py-2 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
          value={roomNo}
          onChange={(e) => setRoomNo(e.target.value)}
          placeholder="例）101"
          disabled={busy}
        />

        <label className="block text-sm font-bold mb-1 text-gray-800 dark:text-gray-200">
          シェアコード
        </label>
        <input
          className="w-full mb-3 rounded-xl border px-3 py-2 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
          value={shareCodeRaw}
          onChange={(e) => setShareCodeRaw(e.target.value.toUpperCase())}
          placeholder="例）B4WMSG"
          autoComplete="off"
          disabled={busy}
        />
        {laundrySections.length > 0 && (
          <>
            <label className="block text-sm font-bold mb-1 text-gray-800 dark:text-gray-200">
              棟名
            </label>
            <select
              className="w-full mb-3 rounded-xl border px-3 py-2 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              disabled={busy}
            >
              {laundrySections.map((option) => (
                <option key={option.sectionName} value={option.sectionName}>
                  {option.sectionName}
                </option>
              ))}
            </select>
          </>
        )}

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
