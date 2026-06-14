import { randomUUID } from "crypto";

import { jsonError, requireUsername } from "@/lib/api";
import { createGame, maybeExpireOnClock, parseTimeControl, serializeGame } from "@/lib/game";
import { getEscrowAccount } from "@/lib/hive";
import { settleFinishedGame } from "@/lib/settlement";
import { applyCompletedGameStats, buildLeaderboards, ensurePlayer, getGameRatings, getPlayerStats } from "@/lib/stats";
import { mutateState } from "@/lib/store";

export async function GET(request: Request) {
  let username: string | null = null;

  try {
    username = requireUsername(request);
  } catch {
    username = null;
  }

  const state = await mutateState(async (draft) => {
    if (username) {
      ensurePlayer(draft, username);
    }
    for (const game of draft.games) {
      maybeExpireOnClock(game);
      applyCompletedGameStats(draft, game);
      await settleFinishedGame(game);
    }
    return draft;
  });

  const openGames = state.games
    .filter((game) => ["waiting", "awaiting-stakes"].includes(game.status) && !game.black)
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((game) => serializeGame(game, new Date(), getGameRatings(state, game)));

  const myGames = username
    ? state.games
        .filter((game) => game.white === username || game.black === username)
        .slice()
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map((game) => serializeGame(game, new Date(), getGameRatings(state, game)))
    : [];

  return Response.json({
    openGames,
    myGames,
    me: getPlayerStats(state, username),
    leaderboards: buildLeaderboards(state),
  });
}

export async function POST(request: Request) {
  let username: string;
  try {
    username = requireUsername(request);
  } catch {
    return jsonError("Login required.", 401);
  }

  const body = (await request.json()) as {
    timeControl?: string;
    reservedOpponent?: string;
    stakeAmount?: number;
    rated?: boolean;
  };

  const reservedOpponent = body.reservedOpponent?.trim().toLowerCase() || undefined;
  if (reservedOpponent === username) {
    return jsonError("You cannot invite yourself.");
  }

  const stakeAmount = Math.max(0, Number(body.stakeAmount || 0));
  const game = createGame({
    id: randomUUID(),
    createdBy: username,
    reservedOpponent,
    rated: body.rated !== false,
    timeControl: parseTimeControl(body.timeControl),
    escrowAccount: getEscrowAccount(),
    stakeAmount,
  });

  const created = await mutateState((state) => {
    const player = ensurePlayer(state, username);
    state.games.unshift(game);
    return serializeGame(game, new Date(), { whiteRating: player.rating });
  });

  return Response.json({ game: created }, { status: 201 });
}
