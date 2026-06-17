import { jsonError } from "@/lib/api";
import { maybeExpireOnClock, serializeGame } from "@/lib/game";
import { settleFinishedGame } from "@/lib/settlement";
import { applyCompletedGameStats, getGameRatings } from "@/lib/stats";
import { mutateState } from "@/lib/store";

export async function POST(_: Request, context: { params: { id: string } }) {
  try {
    const game = await mutateState(async (state) => {
      const target = state.games.find((entry) => entry.id === context.params.id);
      if (!target) {
        throw new Error("NOT_FOUND");
      }

      maybeExpireOnClock(target);
      applyCompletedGameStats(state, target);
      await settleFinishedGame(target);
      return serializeGame(target, new Date(), getGameRatings(state, target));
    });

    return Response.json(
      { game },
      {
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return jsonError("Game not found.", 404);
    }

    return jsonError(error instanceof Error ? error.message : "Could not sync game.", 400);
  }
}
