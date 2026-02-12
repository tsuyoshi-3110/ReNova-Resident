// src/app/laundry/types.ts

export type LaundryStatus = "ok" | "limited" | "ng";

export type LaundryFloorDef = {
  floor: number;
  roomsCount: number;

  /**
   * startNo は「自動生成用の開始番号」
   * 例: 2F なら 201 をstartにして生成
   */
  startNo?: number;

  /**
   * ★重要：号室の実体
   * 例: [101,102,103,105]
   */
  roomNos: number[];
};

export type LaundryBoardConfig = {
  version: 1;
  updatedAt: number;

  /**
   * floors は必ず roomNos を含む（Firestoreに undefined を入れない）
   */
  floors: LaundryFloorDef[];

  /**
   * ★追加：工事名（未ログインでも表示したい）
   * 無い場合もあるので optional
   */
  projectName?: string;
};
