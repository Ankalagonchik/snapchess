import { jsonError, requireUsername } from "@/lib/api";
import { activateWhenReady, getPlayerColor, serializeGame } from "@/lib/game";
import { getStakeMemo, verifyStakeTransfer } from "@/lib/hive";
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

  try {
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

      const confirmed = await verifyStakeTransfer(
        {
        from: username,
        to: game.stake.escrowAccount,
        amount: game.stake.amount,
        memo,
        },
        { attempts: 6, delayMs: 1500 },
      );
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
    });

    return Response.json({ game: result });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return jsonError("Game not found.", 404);
    }
    if (error instanceof Error && error.message === "NO_STAKE") {
      return jsonError("This game does not use HIVE stake.", 400);
    }
    if (error instanceof Error && error.message === "NOT_PLAYER") {
      return jsonError("You are not part of this game.", 403);
    }
    if (error instanceof Error && error.message === "TRANSFER_NOT_FOUND") {
      return jsonError("The stake transfer was not found yet. Wait a bit and try Verify stake again.", 400);
    }
    return jsonError(error instanceof Error ? error.message : "Stake verification failed.", 400);
  }
}
