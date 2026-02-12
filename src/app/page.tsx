// src/app/home/page.tsx
"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "./lib/firebaseClient";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      // 未ログイン → login
      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        // ✅ residentMembers/{uid} を確認
        const ref = doc(db, "residentMembers", user.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          // Authはあるが住人ではない → 強制ログアウトしてlogin
          await signOut(auth);
          router.replace("/login");
          return;
        }

        // 住人OK → menu
        router.replace("/menu");
      } catch (e) {
        console.error("residentMembers check error:", e);
        // 安全側：読めないならログアウト扱い
        await signOut(auth);
        router.replace("/login");
      }
    });

    return () => unsub();
  }, [router]);

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
