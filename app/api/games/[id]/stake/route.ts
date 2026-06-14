import { jsonError, requireUsername } from "@/lib/api";
import { activateWhenReady, getPlayerColor, serializeGame } from "@/lib/game";
import { verifyStakeTransfer } from "@/lib/hive";
import { ensurePlayer, getGameRatings } from "@/lib/stats";
import { mutateState } from "@/lib/store";

export async function POST(request: Request, context: { params: { id: string } }) {
  let username: string;
  try {
    username = requireUsername(request);
  } catch {
    return jsonError("Login required.", 401);
  }

  const body = (await request.json()) as { memo?: string };
  const memo = body.memo?.trim();
  if (!memo) {
    return jsonError("Stake memo is required.");
  }

  const result = await mutateState(async (state) => {
    const game = state.games.find((entry) => entry.id === context.params.id);
    if (!game) {
      throw new Error("NOT_FOUND");
    }
    if (game.stake.amount <= 0) {
      throw new Error("NO_STAKE");
    }

    const color = getPlayerColor(game, username);
    if (!color) {
      throw new Error("NOT_PLAYER");
    }

    ensurePlayer(state, game.white);
    if (game.black) {
      ensurePlayer(state, game.black);
    }

    const confirmed = await verifyStakeTransfer({
      from: username,
      to: game.stake.escrowAccount,
      amount: game.stake.amount,
      memo,
    });
    if (!confirmed) {
      throw new Error("TRANSFER_NOT_FOUND");
    }

    if (color === "white") {
      game.stake.whiteConfirmed = true;
      game.stake.whiteMemo = memo;
    } else {
      game.stake.blackConfirmed = true;
      game.stake.blackMemo = memo;
    }

    game.stake.settlementStatus = "holding";
    game.stake.settlementMemo = "Stake is held in escrow until the game is settled.";

    activateWhenReady(game);
    return serializeGame(game, new Date(), getGameRatings(state, game));
  }).catch((error: Error) => {
    if (error.message === "NOT_FOUND") {
      return null;
    }
    throw error;
  });

  if (!result) {
    return jsonError("Game not found.", 404);
  }

  return Response.json({ game: result });
}
