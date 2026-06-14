import { Chess } from "chess.js";

import type { GameResult, PublicGame, StoredGame, TimeControl } from "@/lib/types";

const DEFAULT_TIME_CONTROL: TimeControl = {
  label: "3+2 Blitz",
  initialMs: 3 * 60 * 1000,
  incrementMs: 2 * 1000,
};

export const TIME_CONTROLS: TimeControl[] = [
  { label: "1+0 Bullet", initialMs: 60 * 1000, incrementMs: 0 },
  { label: "3+2 Blitz", initialMs: 3 * 60 * 1000, incrementMs: 2 * 1000 },
  { label: "5+0 Blitz", initialMs: 5 * 60 * 1000, incrementMs: 0 },
  { label: "10+5 Rapid", initialMs: 10 * 60 * 1000, incrementMs: 5 * 1000 },
  { label: "15+10 Rapid", initialMs: 15 * 60 * 1000, incrementMs: 10 * 1000 },
];

export function parseTimeControl(value?: string | null) {
  return TIME_CONTROLS.find((control) => control.label === value) ?? DEFAULT_TIME_CONTROL;
}

export function makeInviteCode(id: string) {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function getPlayerColor(game: StoredGame, username: string): "white" | "black" | null {
  if (game.white === username) {
    return "white";
  }
  if (game.black === username) {
    return "black";
  }
  return null;
}

export function createGame(params: {
  id: string;
  createdBy: string;
  reservedOpponent?: string;
  rated: boolean;
  timeControl: TimeControl;
  escrowAccount: string;
  stakeAmount: number;
}) {
  const now = new Date().toISOString();
  const chess = new Chess();

  return {
    id: params.id,
    inviteCode: makeInviteCode(params.id),
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy,
    reservedOpponent: params.reservedOpponent,
    rated: params.rated,
    white: params.createdBy,
    black: undefined,
    status: "waiting",
    timeControl: params.timeControl,
    whiteTimeMs: params.timeControl.initialMs,
    blackTimeMs: params.timeControl.initialMs,
    clockStartedAt: undefined,
    fen: chess.fen(),
    pgn: chess.pgn(),
    turn: "w",
    moves: [],
    stake: {
      amount: params.stakeAmount,
      currency: "HIVE",
      escrowAccount: params.escrowAccount,
      whiteConfirmed: false,
      blackConfirmed: false,
      settlementStatus: params.stakeAmount > 0 ? "idle" : "paid",
    },
  } satisfies StoredGame;
}

export function getMoveColorCoverage(game: StoredGame) {
  const colors = new Set(game.moves.map((move) => move.color));
  return {
    whiteMoved: colors.has("w"),
    blackMoved: colors.has("b"),
  };
}

export function isAbortableGame(game: StoredGame) {
  if (game.status === "finished") {
    return false;
  }

  const { whiteMoved, blackMoved } = getMoveColorCoverage(game);
  return !(whiteMoved && blackMoved);
}

export function startGame(game: StoredGame, now = new Date()) {
  game.status = game.stake.amount > 0 ? "awaiting-stakes" : "active";
  if (game.status === "active") {
    game.startedAt = now.toISOString();
    game.clockStartedAt = now.toISOString();
  }
  game.updatedAt = now.toISOString();
}

export function activateWhenReady(game: StoredGame, now = new Date()) {
  if (
    game.status === "awaiting-stakes" &&
    game.stake.whiteConfirmed &&
    game.stake.blackConfirmed &&
    game.black
  ) {
    game.status = "active";
    game.startedAt = game.startedAt ?? now.toISOString();
    game.clockStartedAt = now.toISOString();
    game.updatedAt = now.toISOString();
  }
}

export function getLiveTimes(game: StoredGame, now = Date.now()) {
  const startedAt = game.clockStartedAt ? Date.parse(game.clockStartedAt) : null;
  if (game.status !== "active" || !startedAt) {
    return { white: game.whiteTimeMs, black: game.blackTimeMs };
  }

  const elapsed = Math.max(0, now - startedAt);
  if (game.turn === "w") {
    return {
      white: Math.max(0, game.whiteTimeMs - elapsed),
      black: game.blackTimeMs,
    };
  }

  return {
    white: game.whiteTimeMs,
    black: Math.max(0, game.blackTimeMs - elapsed),
  };
}

function finalize(game: StoredGame, result: GameResult, now = new Date()) {
  game.status = "finished";
  game.result = result;
  game.clockStartedAt = undefined;
  game.finishedAt = now.toISOString();
  game.updatedAt = now.toISOString();
}

export function maybeExpireOnClock(game: StoredGame, now = new Date()) {
  if (game.status !== "active") {
    return false;
  }

  const { white, black } = getLiveTimes(game, now.getTime());
  if (white <= 0) {
    game.whiteTimeMs = 0;
    game.blackTimeMs = black;
    finalize(game, { winner: "black", reason: "timeout", message: "White flagged on time." }, now);
    return true;
  }
  if (black <= 0) {
    game.whiteTimeMs = white;
    game.blackTimeMs = 0;
    finalize(game, { winner: "white", reason: "timeout", message: "Black flagged on time." }, now);
    return true;
  }
  return false;
}

function buildResultFromChess(chess: Chess): GameResult | null {
  if (chess.isCheckmate()) {
    const winner = chess.turn() === "w" ? "black" : "white";
    return {
      winner,
      reason: "checkmate",
      message: `${winner === "white" ? "White" : "Black"} wins by checkmate.`,
    };
  }

  if (chess.isStalemate()) {
    return { winner: "draw", reason: "stalemate", message: "Game drawn by stalemate." };
  }

  if (chess.isThreefoldRepetition()) {
    return { winner: "draw", reason: "threefold-repetition", message: "Game drawn by repetition." };
  }

  if (chess.isInsufficientMaterial()) {
    return { winner: "draw", reason: "insufficient-material", message: "Game drawn by insufficient material." };
  }

  if (chess.isDraw()) {
    return { winner: "draw", reason: "draw", message: "Game drawn." };
  }

  return null;
}

export function applyMove(game: StoredGame, username: string, from: string, to: string, promotion = "q") {
  const now = new Date();
  maybeExpireOnClock(game, now);

  if (game.status !== "active") {
    throw new Error("Game is not active.");
  }

  const color = getPlayerColor(game, username);
  if (!color) {
    throw new Error("You are not part of this game.");
  }

  const expectedTurn = game.turn === "w" ? "white" : "black";
  if (color !== expectedTurn) {
    throw new Error("It is not your turn.");
  }

  const liveTimes = getLiveTimes(game, now.getTime());
  if (game.turn === "w") {
    game.whiteTimeMs = liveTimes.white + game.timeControl.incrementMs;
    game.blackTimeMs = liveTimes.black;
  } else {
    game.whiteTimeMs = liveTimes.white;
    game.blackTimeMs = liveTimes.black + game.timeControl.incrementMs;
  }

  const chess = new Chess(game.fen);
  const move = chess.move({ from, to, promotion });
  if (!move) {
    throw new Error("Illegal move.");
  }

  game.fen = chess.fen();
  game.pgn = chess.pgn();
  game.turn = chess.turn();
  game.moves.push({
    by: username,
    color: move.color,
    from: move.from,
    to: move.to,
    san: move.san,
    fen: game.fen,
    createdAt: now.toISOString(),
  });
  game.clockStartedAt = now.toISOString();
  game.updatedAt = now.toISOString();

  const result = buildResultFromChess(chess);
  if (result) {
    finalize(game, result, now);
  }
}

export function serializeGame(
  game: StoredGame,
  now = new Date(),
  ratings?: { whiteRating?: number; blackRating?: number },
): PublicGame {
  const liveTimes = getLiveTimes(game, now.getTime());

  return {
    id: game.id,
    inviteCode: game.inviteCode,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    createdBy: game.createdBy,
    reservedOpponent: game.reservedOpponent,
    rated: game.rated,
    white: game.white,
    black: game.black,
    whiteRating: ratings?.whiteRating,
    blackRating: ratings?.blackRating,
    status: game.status,
    timeControl: game.timeControl,
    stake: game.stake,
    isAbortable: isAbortableGame(game),
    fen: game.fen,
    pgn: game.pgn,
    turn: game.turn,
    moves: game.moves,
    result: game.result,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    liveWhiteTimeMs: liveTimes.white,
    liveBlackTimeMs: liveTimes.black,
    clockSnapshotAt: now.toISOString(),
  };
}
