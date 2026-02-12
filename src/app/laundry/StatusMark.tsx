// src/app/laundry/StatusMark.tsx
"use client";


import type { LaundryStatus } from "./types";

export default function StatusMark({ status }: { status: LaundryStatus }) {
  const common = "h-5 w-5";
  const stroke = 2;

  if (status === "ok") {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth={stroke} />
      </svg>
    );
  }

  if (status === "limited") {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" aria-hidden="true">
        <path
          d="M12 5 L20 19 H4 Z"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={common} fill="none" aria-hidden="true">
      <path
        d="M7 7 L17 17 M17 7 L7 17"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </svg>
  );
}
