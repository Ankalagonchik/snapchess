import { jsonError, requireUsername } from "@/lib/api";
import { isAbortableGame, serializeGame } from "@/lib/game";
import { getStakeMemo, verifyStakeTransfer } from "@/lib/hive";
import { settleAbortedGame } from "@/lib/settlement";
import { getGameRatings } from "@/lib/stats";
import { mutateState } from "@/lib/store";

async function hydrateStakeConfirmations(target: Parameters<typeof serializeGame>[0]) {
  if (target.stake.amount <= 0) {
    return;
  }

  if (!target.stake.whiteConfirmed) {
    const whiteMemo = target.stake.whiteMemo || getStakeMemo(target.id, target.white);
    const found = await verifyStakeTransfer(
      {
        from: target.white,
        to: target.stake.escrowAccount,
        amount: target.stake.amount,
        memo: whiteMemo,
      },
      { attempts: 1, delayMs: 0 },
    );
    if (found) {
      target.stake.whiteConfirmed = true;
      target.stake.whiteMemo = whiteMemo;
    }
  }

  if (target.black && !target.stake.blackConfirmed) {
    const blackMemo = target.stake.blackMemo || getStakeMemo(target.id, target.black);
    const found = await verifyStakeTransfer(
      {
        from: target.black,
        to: target.stake.escrowAccount,
        amount: target.stake.amount,
        memo: blackMemo,
      },
      { attempts: 1, delayMs: 0 },
    );
    if (found) {
      target.stake.blackConfirmed = true;
      target.stake.blackMemo = blackMemo;
    }
  }
}

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
      if (target.createdBy !== username) {
        throw new Error("FORBIDDEN");
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
        message: "Game cancelled by the creator before both sides committed moves.",
      };

      await hydrateStakeConfirmations(target);
      await settleAbortedGame(target);
      return serializeGame(target, new Date(), getGameRatings(state, target));
    });

    return Response.json({ game });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return jsonError("Game not found.", 404);
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return jsonError("Only the game creator can cancel this game.", 403);
    }
    if (error instanceof Error && error.message === "TOO_LATE") {
      return jsonError("This game can no longer be cancelled without penalties.", 400);
    }
    return jsonError(error instanceof Error ? error.message : "Could not cancel game.", 400);
  }
}
