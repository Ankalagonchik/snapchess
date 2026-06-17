import { jsonError } from "@/lib/api";
import { maybeExpireOnClock, serializeGame } from "@/lib/game";
import { getGameRatings } from "@/lib/stats";
import { readState } from "@/lib/store";

export async function GET(_: Request, context: { params: { id: string } }) {
  const state = await readState();
  const game = state.games.find((entry) => entry.id === context.params.id || entry.inviteCode === context.params.id.toUpperCase());

  const result = game
    ? (() => {
        const snapshot = JSON.parse(JSON.stringify(game)) as typeof game;
        maybeExpireOnClock(snapshot);
        return serializeGame(snapshot, new Date(), getGameRatings(state, game));
      })()
    : null;

  if (!result) {
    return jsonError("Game not found.", 404);
  }

  return Response.json({ game: result });
}
