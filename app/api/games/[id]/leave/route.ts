import { jsonError, requireUsername } from "@/lib/api";
import { getPlayerColor, isAbortableGame, serializeGame } from "@/lib/game";
import { settleAbortedGame } from "@/lib/settlement";
import { getGameRatings } from "@/lib/stats";
import { mutateState } from "@/lib/store";

export async function POST(request: Request, context: { params: { id: string } }) {
  let username: string;
  try {
    username = requireUsername(request);
  } catch {
    return jsonError("Login required.", 401);
  }

  try {
    const game = await mutateState(async (state) => {
      const target = state.games.find((entry) => entry.id === context.params.id);
      if (!target) {
        throw new Error("NOT_FOUND");
      }
      const playerColor = getPlayerColor(target, username);
      if (!playerColor) {
        throw new Error("NOT_PLAYER");
      }
      if (!isAbortableGame(target)) {
        throw new Error("TOO_LATE");
      }

      target.status = "finished";
      target.finishedAt = new Date().toISOString();
      target.updatedAt = target.finishedAt;
      target.clockStartedAt = undefined;
      target.result = {
        winner: "draw",
        reason: "aborted",
        message: `Game aborted because @${username} left before both sides committed moves.`,
      };

      await settleAbortedGame(target);
      return serializeGame(target, new Date(), getGameRatings(state, target));
    });

    return Response.json({ game });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return jsonError("Game not found.", 404);
    }
    if (error instanceof Error && error.message === "NOT_PLAYER") {
      return jsonError("You are not part of this game.", 403);
    }
    if (error instanceof Error && error.message === "TOO_LATE") {
      return jsonError("You can only leave without penalties before both sides have played a move.", 400);
    }
    return jsonError(error instanceof Error ? error.message : "Could not leave game.", 400);
  }
}
