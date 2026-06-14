import { createSessionToken } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { verifySignedTx } from "@/lib/hive";
import { mutateState } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    username?: string;
    nonce?: string;
    signedTx?: Record<string, unknown>;
  };

  const username = body.username?.trim().toLowerCase();
  const nonce = body.nonce?.trim();
  const signedTx = body.signedTx;

  if (!username || !nonce || !signedTx) {
    return jsonError("username, nonce and signedTx are required.");
  }

  const challenge = await mutateState((state) => {
    const found = state.challenges.find(
      (entry) => entry.username === username && entry.nonce === nonce && !entry.usedAt,
    );
    if (found && Date.parse(found.expiresAt) > Date.now()) {
      found.usedAt = new Date().toISOString();
      return found;
    }
    return null;
  });

  if (!challenge) {
    return jsonError("Challenge expired or already used.", 400);
  }

  const signed = signedTx as {
    operations?: Array<[string, { json?: string; required_posting_auths?: string[] }]>
  };
  const operation = signed.operations?.[0];

  if (!operation || operation[0] !== "custom_json") {
    return jsonError("Unexpected login transaction.");
  }

  const auths = operation[1]?.required_posting_auths ?? [];
  if (!auths.includes(username)) {
    return jsonError("The signed transaction does not belong to this user.");
  }

  const expected = JSON.stringify((challenge.tx as { operations?: Array<[string, { json?: string }]> }).operations?.[0]?.[1]?.json);
  const actual = JSON.stringify(operation[1]?.json);
  if (expected !== actual) {
    return jsonError("Challenge payload mismatch.");
  }

  try {
    await verifySignedTx(signedTx);
  } catch {
    return jsonError("Hive could not verify the signed challenge.", 401);
  }

  const token = createSessionToken(username);
  return Response.json({ token, username });
}
