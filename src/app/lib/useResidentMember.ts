// src/app/lib/useResidentMember.ts
"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "./firebaseClient";
import {
  subscribeResidentMember,
  type ResidentMember,
} from "./residentMember";

type State =
  | { status: "loading"; user: null; member: null }
  | { status: "signedOut"; user: null; member: null }
  | { status: "ready"; user: User; member: ResidentMember }
  | { status: "needsProfile"; user: User; member: null } // residentMembersが未作成
  | { status: "error"; user: null; member: null; message: string };

export function useResidentMember(): State {
  const [state, setState] = useState<State>({
    status: "loading",
    user: null,
    member: null,
  });

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(
      auth,
      (user) => {
        if (!user) {
          setState({ status: "signedOut", user: null, member: null });
          return;
        }

        // Auth OK → residentMembers を購読
        const unsubMember = subscribeResidentMember(
          user.uid,
          (member) => {
            if (!member) {
              setState({ status: "needsProfile", user, member: null });
              return;
            }
            setState({ status: "ready", user, member });
          },
          (e) => {
            setState({
              status: "error",
              user: null,
              member: null,
              message: e instanceof Error ? e.message : "unknown error",
            });
          }
        );

        // ここで member unsubscribe を返す形にする
        return () => {
          unsubMember();
        };
      },
      (e) => {
        setState({
          status: "error",
          user: null,
          member: null,
          message: e instanceof Error ? e.message : "unknown error",
        });
      }
    );

    return () => {
      unsubAuth();
    };
  }, []);

  return state;
}
