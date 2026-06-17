import type { AppState, LeaderboardEntry, PlayerStats, StoredGame } from "@/lib/types";
import { getStakeSettlementSummary } from "@/lib/settlement";

const DEFAULT_RATING = 1500;

function roundRating(value: number) {
  return Math.round(value);
}

function expectedScore(playerRating: number, opponentRating: number) {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

function getKFactor(player: PlayerStats) {
  return player.gamesPlayed < 30 ? 32 : 24;
}

function getResultScore(game: StoredGame) {
  if (!game.result || game.result.winner === "draw") {
    return { white: 0.5, black: 0.5 };
  }

  return game.result.winner === "white" ? { white: 1, black: 0 } : { white: 0, black: 1 };
}

export function ensurePlayer(state: AppState, username: string) {
  const normalized = username.trim().toLowerCase();
  let player = state.players.find((entry) => entry.username === normalized);
  if (!player) {
    player = {
      username: normalized,
      rating: DEFAULT_RATING,
      peakRating: DEFAULT_RATING,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      hiveWon: 0,
      hiveLost: 0,
    };
    state.players.push(player);
  }
  return player;
}

export function getPlayerStats(state: AppState, username?: string | null): LeaderboardEntry | null {
  if (!username) {
    return null;
  }
  const player = ensurePlayer(state, username);
  return toLeaderboardEntry(player);
}

export function toLeaderboardEntry(player: PlayerStats): LeaderboardEntry {
  return {
    ...player,
    netHive: Number((player.hiveWon - player.hiveLost).toFixed(3)),
  };
}

export function buildLeaderboards(state: AppState, limit = 10) {
  const entries = state.players.map(toLeaderboardEntry);

  return {
    rating: entries
      .slice()
      .sort((a, b) => b.rating - a.rating || b.gamesPlayed - a.gamesPlayed || a.username.localeCompare(b.username))
      .slice(0, limit),
    hive: entries
      .slice()
      .sort((a, b) => b.netHive - a.netHive || b.hiveWon - a.hiveWon || a.username.localeCompare(b.username))
      .slice(0, limit),
  };
}

export function getGameRatings(state: AppState, game: StoredGame) {
  return {
    whiteRating: ensurePlayer(state, game.white).rating,
    blackRating: game.black ? ensurePlayer(state, game.black).rating : undefined,
  };
}

export function applyCompletedGameStats(state: AppState, game: StoredGame) {
  if (game.status !== "finished" || !game.result || game.statsAppliedAt || !game.black) {
    return;
  }

  if (game.result.reason === "aborted") {
    game.result.ratingApplied = false;
    game.statsAppliedAt = new Date().toISOString();
    return;
  }

  const now = new Date().toISOString();
  const white = ensurePlayer(state, game.white);
  const black = ensurePlayer(state, game.black);

  white.gamesPlayed += 1;
  black.gamesPlayed += 1;
  white.lastGameAt = now;
  black.lastGameAt = now;

  if (game.result.winner === "draw") {
    white.draws += 1;
    black.draws += 1;
  } else if (game.result.winner === "white") {
    white.wins += 1;
    black.losses += 1;
  } else {
    black.wins += 1;
    white.losses += 1;
  }

  if (game.rated) {
    const actual = getResultScore(game);
    const expectedWhite = expectedScore(white.rating, black.rating);
    const expectedBlack = expectedScore(black.rating, white.rating);
    const whiteDelta = roundRating(getKFactor(white) * (actual.white - expectedWhite));
    const blackDelta = roundRating(getKFactor(black) * (actual.black - expectedBlack));

    white.rating += whiteDelta;
    black.rating += blackDelta;
    white.peakRating = Math.max(white.peakRating, white.rating);
    black.peakRating = Math.max(black.peakRating, black.rating);
    game.result.ratingDelta = { white: whiteDelta, black: blackDelta };
    game.result.ratingApplied = true;
  } else {
    game.result.ratingApplied = false;
  }

  if (game.stake.amount > 0 && game.result.winner !== "draw") {
    const winnerIsWhite = game.result.winner === "white";
    const { winnerNet } = getStakeSettlementSummary(game);
    const loserNet = Number(game.stake.amount.toFixed(3));

    if (winnerIsWhite) {
      white.hiveWon += winnerNet;
      black.hiveLost += loserNet;
      game.result.stakeDeltaHive = { white: winnerNet, black: -loserNet };
    } else {
      black.hiveWon += winnerNet;
      white.hiveLost += loserNet;
      game.result.stakeDeltaHive = { white: -loserNet, black: winnerNet };
    }
  }

  game.statsAppliedAt = now;
}
