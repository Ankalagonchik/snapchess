import { makeNonce } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { getAccount, makeLoginChallengeTx } from "@/lib/hive";
import { mutateState } from "@/lib/store";

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
  const tx = await makeLoginChallengeTx(username, nonce);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await mutateState((state) => {
    state.challenges = state.challenges.filter((challenge) => Date.parse(challenge.expiresAt) > Date.now());
    state.challenges.push({
      username,
      nonce,
      tx,
      expiresAt,
      createdAt: new Date().toISOString(),
    });
  });

  return Response.json({ nonce, tx, expiresAt });
}
