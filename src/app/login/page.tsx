"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = async () => {
    setError(null);

    if (!email || !password) {
      setError("メールとパスワードを入力してください");
      return;
    }

    try {
      setBusy(true);

      await signInWithEmailAndPassword(auth, email, password);

      router.replace("/menu");
    } catch {
      setError("ログインに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-6 dark:border-gray-800 dark:bg-gray-900">

        <h1 className="text-xl font-extrabold mb-4">ログイン</h1>

        {error && (
          <div className="mb-3 text-sm text-red-600 font-bold">{error}</div>
        )}

        <input
          placeholder="メール"
          className="w-full mb-2 rounded-xl border px-3 py-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          type="password"
          placeholder="パスワード"
          className="w-full mb-3 rounded-xl border px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={login}
          disabled={busy}
          className="w-full rounded-xl bg-blue-600 py-2 text-white font-bold"
        >
          {busy ? "ログイン中..." : "ログイン"}
        </button>

        <button
          onClick={() => router.push("/register")}
          className="mt-3 w-full text-sm text-blue-600 font-bold"
        >
          ▶ アカウント作成はこちら
        </button>

      </div>
    </main>
  );
}
