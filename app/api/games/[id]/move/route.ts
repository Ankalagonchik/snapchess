import { jsonError, requireUsername } from "@/lib/api";
import { applyMove, serializeGame } from "@/lib/game";
import { settleFinishedGame } from "@/lib/settlement";
import { applyCompletedGameStats, getGameRatings } from "@/lib/stats";
import { mutateState } from "@/lib/store";

export async function POST(request: Request, context: { params: { id: string } }) {
  let username: string;
  try {
    username = requireUsername(request);
  } catch {
    return jsonError("Login required.", 401);
  }

  const body = (await request.json()) as { from?: string; to?: string; promotion?: string };
  if (!body.from || !body.to) {
    return jsonError("from and to are required.");
  }

  try {
    const game = await mutateState(async (state) => {
      const target = state.games.find((entry) => entry.id === context.params.id);
      if (!target) {
        throw new Error("NOT_FOUND");
      }
      applyMove(target, username, body.from!, body.to!, body.promotion || "q");
      applyCompletedGameStats(state, target);
      await settleFinishedGame(target);
      return serializeGame(target, new Date(), getGameRatings(state, target));
    });

    return Response.json({ game });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return jsonError("Game not found.", 404);
    }
    return jsonError(error instanceof Error ? error.message : "Move failed.", 400);
  }
}
