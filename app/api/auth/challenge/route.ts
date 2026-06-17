import { createChallengeToken, makeNonce } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { getAccount, makeLoginChallengeTx } from "@/lib/hive";

export async function POST(request: Request) {
  const body = (await request.json()) as { username?: string };
  const username = body.username?.trim().toLowerCase();

  if (!username) {
    return jsonError("Hive username is required.");
  }

  const account = await getAccount(username);
  if (!account) {
    return jsonError("Hive account not found.", 404);
  }

  const nonce = makeNonce();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const tx = await makeLoginChallengeTx(username, nonce, expiresAt);
  const challengeToken = createChallengeToken({ username, nonce, expiresAt });

  return Response.json({ nonce, tx, expiresAt, challengeToken });
}
