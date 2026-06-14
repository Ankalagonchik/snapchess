export {};

declare global {
  interface Window {
    hive_keychain?: {
      requestSignTx: (
        account: string,
        tx: Record<string, unknown>,
        key: "Posting" | "Active" | "Memo",
        callback: (response: { success?: boolean; error?: string; result?: Record<string, unknown> }) => void,
      ) => void;
      requestTransfer: (
        account: string,
        to: string,
        amount: string,
        memo: string,
        currency: "HIVE" | "HBD",
        callback: (response: { success?: boolean; error?: string; result?: unknown }) => void,
        enforce?: boolean,
      ) => void;
    };
  }
}
