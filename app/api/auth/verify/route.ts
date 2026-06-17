import { createSessionToken, readChallengeToken } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { verifySignedTx } from "@/lib/hive";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    username?: string;
    challengeToken?: string;
    signedTx?: Record<string, unknown>;
  };

  const username = body.username?.trim().toLowerCase();
  const challengeToken = body.challengeToken;
  const signedTx = body.signedTx;

  if (!username || !challengeToken || !signedTx) {
    return jsonError("username, challengeToken and signedTx are required.");
  }

  const challenge = readChallengeToken(challengeToken);

  if (!challenge || challenge.username !== username) {
    return jsonError("Challenge expired or invalid.", 400);
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

  let operationPayload: { username?: string; nonce?: string; expiresAt?: string } | null = null;
  try {
    operationPayload = JSON.parse(operation[1]?.json || "null") as { username?: string; nonce?: string; expiresAt?: string };
  } catch {
    return jsonError("Challenge payload mismatch.");
  }

  if (
    !operationPayload ||
    operationPayload.username !== challenge.username ||
    operationPayload.nonce !== challenge.nonce ||
    operationPayload.expiresAt !== challenge.expiresAt
  ) {
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
