import { jsonError, requireUsername } from "@/lib/api";
import { activateWhenReady, serializeGame, startGame } from "@/lib/game";
import { ensurePlayer, getGameRatings } from "@/lib/stats";
import { mutateState } from "@/lib/store";

export async function POST(request: Request, context: { params: { id: string } }) {
  let username: string;
  try {
    username = requireUsername(request);
  } catch {
    return jsonError("Login required.", 401);
  }

  const game = await mutateState((state) => {
    const target = state.games.find((entry) => entry.id === context.params.id || entry.inviteCode === context.params.id.toUpperCase());
    if (!target) {
      throw new Error("NOT_FOUND");
    }
    if (target.white === username) {
      throw new Error("SELF_JOIN");
    }
    if (target.black) {
      throw new Error("ALREADY_JOINED");
    }
    if (target.reservedOpponent && target.reservedOpponent !== username) {
      throw new Error("RESERVED");
    }

    target.black = username;
    ensurePlayer(state, target.white);
    ensurePlayer(state, username);
    startGame(target);
    activateWhenReady(target);
    return serializeGame(target, new Date(), getGameRatings(state, target));
  }).catch((error: Error) => {
    if (error.message === "NOT_FOUND") {
      return null;
    }
    throw error;
  });

  if (!game) {
    return jsonError("Game not found.", 404);
  }

  return Response.json({ game });
}
