import { jsonError } from "@/lib/api";
import { maybeExpireOnClock, serializeGame } from "@/lib/game";
import { settleFinishedGame } from "@/lib/settlement";
import { applyCompletedGameStats, getGameRatings } from "@/lib/stats";
import { mutateState } from "@/lib/store";

export async function GET(_: Request, context: { params: { id: string } }) {
  const result = await mutateState(async (state) => {
    const game = state.games.find((entry) => entry.id === context.params.id || entry.inviteCode === context.params.id.toUpperCase());
    if (!game) {
      return null;
    }
    maybeExpireOnClock(game);
    applyCompletedGameStats(state, game);
    await settleFinishedGame(game);
    return serializeGame(game, new Date(), getGameRatings(state, game));
  });

  if (!result) {
    return jsonError("Game not found.", 404);
  }

  return Response.json({ game: result });
}
