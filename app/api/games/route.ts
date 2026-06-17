import { randomUUID } from "crypto";

import { jsonError, requireUsername } from "@/lib/api";
import { createGame, maybeExpireOnClock, parseTimeControl, serializeGame } from "@/lib/game";
import { getEscrowAccount } from "@/lib/hive";
import { buildLeaderboards, ensurePlayer, getGameRatings, toLeaderboardEntry } from "@/lib/stats";
import { mutateState, readState } from "@/lib/store";

function cloneGame<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function GET(request: Request) {
  let username: string | null = null;

  try {
    username = requireUsername(request);
  } catch {
    username = null;
  }

  const state = await readState();

  const openGames = state.games
    .filter((game) => ["waiting", "awaiting-stakes"].includes(game.status) && !game.black)
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((game) => {
      const snapshot = cloneGame(game);
      maybeExpireOnClock(snapshot);
      return serializeGame(snapshot, new Date(), getGameRatings(state, game));
    });

  const myGames = username
    ? state.games
        .filter((game) => game.white === username || game.black === username)
        .slice()
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map((game) => {
          const snapshot = cloneGame(game);
          maybeExpireOnClock(snapshot);
          return serializeGame(snapshot, new Date(), getGameRatings(state, game));
        })
    : [];

  const me = username ? state.players.find((entry) => entry.username === username) : null;

  return Response.json({
    openGames,
    myGames,
    me: me ? toLeaderboardEntry(me) : null,
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
