import { Buffer } from "buffer";

import { Client, PrivateKey } from "@hiveio/dhive";

const HIVE_NODES = (process.env.HIVE_NODES || "https://api.hive.blog,https://api.openhive.network,https://api.hivekings.com")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

export const hiveClient = new Client(HIVE_NODES);

function getEscrowActiveKey() {
  return process.env.ESCROW_ACTIVE_KEY;
}

export function hasEscrowAutomation() {
  return Boolean(getEscrowActiveKey());
}

export function getEscrowAccount() {
  return process.env.NEXT_PUBLIC_HIVE_ESCROW_ACCOUNT || "snapchess.escrow";
}

export function getStakeMemo(gameId: string, username: string) {
  return `stake:${gameId}:${username.trim().toLowerCase()}`;
}

export async function transferFromEscrow(input: { to: string; amount: number; memo: string }) {
  const activeKey = getEscrowActiveKey();
  if (!activeKey) {
    throw new Error("Escrow automation is not configured.");
  }

  const confirmation = await hiveClient.broadcast.transfer(
    {
      from: getEscrowAccount(),
      to: input.to,
      amount: `${input.amount.toFixed(3)} HIVE`,
      memo: input.memo,
    },
    PrivateKey.fromString(activeKey),
  );

  return confirmation.id || `${confirmation.block_num}:${confirmation.trx_num}`;
}

export async function getAccount(username: string) {
  const accounts = await hiveClient.database.getAccounts([username]);
  return accounts[0] ?? null;
}

export async function makeLoginChallengeTx(username: string, nonce: string, expiresAt?: string) {
  const props = await hiveClient.database.getDynamicGlobalProperties();
  const issuedAt = new Date();
  const computedExpiresAt = expiresAt ?? new Date(issuedAt.getTime() + 5 * 60 * 1000).toISOString();
  const json = JSON.stringify({
    app: "snapchess",
    nonce,
    username,
    issuedAt: issuedAt.toISOString(),
    expiresAt: computedExpiresAt,
  });

  return {
    ref_block_num: props.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(props.head_block_id, "hex").readUInt32LE(4),
    expiration: computedExpiresAt.replace(/\.\d{3}Z$/, ""),
    operations: [
      [
        "custom_json",
        {
          required_auths: [],
          required_posting_auths: [username],
          id: "snapchess-login",
          json,
        },
      ],
    ],
    extensions: [],
  };
}

export async function verifySignedTx(tx: Record<string, unknown>) {
  return hiveClient.database.verifyAuthority(tx as never);
}

async function callAccountHistory(account: string, limit = 200) {
  const body = {
    jsonrpc: "2.0",
    method: "account_history_api.get_account_history",
    params: {
      account,
      start: -1,
      limit,
      include_reversible: true,
    },
    id: 1,
  };

  for (const node of HIVE_NODES) {
    try {
      const response = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      const json = (await response.json()) as {
        result?: { history?: Array<[number, { op: unknown }]> };
      };

      return json.result?.history ?? [];
    } catch {
      continue;
    }
  }

  throw new Error("Failed to query Hive account history");
}

function unpackTransferOperation(op: unknown): {
  from: string;
  to: string;
  amount: string;
  memo: string;
} | null {
  if (Array.isArray(op) && op[0] === "transfer") {
    return op[1] as { from: string; to: string; amount: string; memo: string };
  }

  if (op && typeof op === "object" && "type" in op && "value" in op) {
    const typed = op as { type: string; value: { from: string; to: string; amount: string; memo: string } };
    if (typed.type === "transfer_operation") {
      return typed.value;
    }
  }

  return null;
}

async function hasMatchingStakeTransfer(input: {
  from: string;
  to: string;
  amount: number;
  memo: string;
}) {
  const history = await callAccountHistory(input.from, 250);
  const expectedAmount = `${input.amount.toFixed(3)} HIVE`;

  return history.some(([, entry]) => {
    const transfer = unpackTransferOperation(entry.op);
    if (!transfer) {
      return false;
    }

    return (
      transfer.from === input.from &&
      transfer.to === input.to &&
      transfer.amount === expectedAmount &&
      transfer.memo === input.memo
    );
  });
}

export async function verifyStakeTransfer(
  input: {
    from: string;
    to: string;
    amount: number;
    memo: string;
  },
  options?: {
    attempts?: number;
    delayMs?: number;
  },
) {
  const attempts = options?.attempts ?? 5;
  const delayMs = options?.delayMs ?? 1500;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const confirmed = await hasMatchingStakeTransfer(input);
    if (confirmed) {
      return true;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}
