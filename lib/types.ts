export type KeyType = "Posting" | "Active" | "Memo";

export type GameStatus = "waiting" | "awaiting-stakes" | "active" | "finished";

export type StakeSettlementStatus = "idle" | "holding" | "paid" | "refunded" | "manual";

export type GameResultReason =
  | "checkmate"
  | "stalemate"
  | "threefold-repetition"
  | "insufficient-material"
  | "fifty-move-rule"
  | "timeout"
  | "agreed"
  | "aborted"
  | "draw";

export interface TimeControl {
  label: string;
  initialMs: number;
  incrementMs: number;
}

export interface AuthChallengeRecord {
  username: string;
  nonce: string;
  tx: Record<string, unknown>;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
}

export interface StakeState {
  amount: number;
  currency: "HIVE";
  escrowAccount: string;
  whiteConfirmed: boolean;
  blackConfirmed: boolean;
  settlementStatus: StakeSettlementStatus;
  settlementMemo?: string;
  payoutTxId?: string;
  whiteRefundTxId?: string;
  blackRefundTxId?: string;
  whiteMemo?: string;
  blackMemo?: string;
}

export interface MoveRecord {
  by: string;
  color: "w" | "b";
  from: string;
  to: string;
  san: string;
  fen: string;
  createdAt: string;
}

export interface GameResult {
  winner: "white" | "black" | "draw";
  reason: GameResultReason;
  message: string;
  ratingDelta?: {
    white: number;
    black: number;
  };
  stakeDeltaHive?: {
    white: number;
    black: number;
  };
  ratingApplied?: boolean;
}

export interface PlayerStats {
  username: string;
  rating: number;
  peakRating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  hiveWon: number;
  hiveLost: number;
  lastGameAt?: string;
}

export interface LeaderboardEntry extends PlayerStats {
  netHive: number;
}

export interface StoredGame {
  id: string;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  reservedOpponent?: string;
  rated: boolean;
  white: string;
  black?: string;
  status: GameStatus;
  timeControl: TimeControl;
  whiteTimeMs: number;
  blackTimeMs: number;
  clockStartedAt?: string;
  fen: string;
  pgn: string;
  turn: "w" | "b";
  moves: MoveRecord[];
  stake: StakeState;
  result?: GameResult;
  statsAppliedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface AppState {
  challenges: AuthChallengeRecord[];
  games: StoredGame[];
  players: PlayerStats[];
}

export interface SessionPayload {
  username: string;
  issuedAt: string;
  expiresAt: string;
}

export interface PublicGame {
  id: string;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  reservedOpponent?: string;
  rated: boolean;
  white: string;
  black?: string;
  whiteRating?: number;
  blackRating?: number;
  status: GameStatus;
  timeControl: TimeControl;
  stake: StakeState;
  isAbortable: boolean;
  fen: string;
  pgn: string;
  turn: "w" | "b";
  moves: MoveRecord[];
  result?: GameResult;
  startedAt?: string;
  finishedAt?: string;
  liveWhiteTimeMs: number;
  liveBlackTimeMs: number;
  clockSnapshotAt: string;
}
