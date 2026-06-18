"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

import { useStockfish } from "@/hooks/useStockfish";
import type { PublicGame } from "@/lib/types";

type MoveReview = {
  ply: number;
  moveNumber: number;
  color: "w" | "b";
  san: string;
  scoreBefore: number;
  scoreAfter: number;
  centipawnLoss: number;
  verdict: "best" | "inaccuracy" | "mistake" | "blunder";
};

type PlayerAnalysisSummary = {
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  averageCentipawnLoss: number;
  accuracy: number;
};

type PostGameAnalysis = {
  timeline: number[];
  reviews: MoveReview[];
  white: PlayerAnalysisSummary;
  black: PlayerAnalysisSummary;
};

function getStakeMemo(gameId: string, username: string) {
  return `stake:${gameId}:${username.trim().toLowerCase()}`;
}

const TOKEN_KEY = "snapchess.token";
const USERNAME_KEY = "snapchess.username";

function formatMs(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getMyColor(game: PublicGame | null, username: string | null) {
  if (!game || !username) {
    return null;
  }
  if (game.white === username) {
    return "white";
  }
  if (game.black === username) {
    return "black";
  }
  return null;
}

function getLiveDisplayTimes(game: PublicGame | null) {
  if (!game) {
    return { white: 0, black: 0 };
  }

  const elapsed = game.status === "active" ? Math.max(0, Date.now() - Date.parse(game.clockSnapshotAt)) : 0;
  if (game.status !== "active") {
    return { white: game.liveWhiteTimeMs, black: game.liveBlackTimeMs };
  }

  if (game.turn === "w") {
    return {
      white: Math.max(0, game.liveWhiteTimeMs - elapsed),
      black: game.liveBlackTimeMs,
    };
  }

  return {
    white: game.liveWhiteTimeMs,
    black: Math.max(0, game.liveBlackTimeMs - elapsed),
  };
}

function buildMoveRows(game: PublicGame | null) {
  if (!game) {
    return [] as Array<{ moveNumber: number; white?: string; black?: string }>;
  }

  const rows: Array<{ moveNumber: number; white?: string; black?: string }> = [];

  for (let index = 0; index < game.moves.length; index += 1) {
    const whiteMove = game.moves[index];
    const blackMove = game.moves[index + 1];
    rows.push({
      moveNumber: Math.floor(index / 2) + 1,
      white: whiteMove?.san,
      black: blackMove?.san,
    });
  }

  return rows;
}

function toWhitePerspectiveScore(fen: string, result: { scoreCp: number | null; scoreMate: number | null }) {
  const turn = new Chess(fen).turn();
  const sign = turn === "w" ? 1 : -1;
  if (result.scoreMate !== null) {
    return sign * result.scoreMate * 1000;
  }
  if (result.scoreCp !== null) {
    return sign * result.scoreCp;
  }
  return 0;
}

function classifyLoss(loss: number): MoveReview["verdict"] {
  if (loss >= 300) {
    return "blunder";
  }
  if (loss >= 120) {
    return "mistake";
  }
  if (loss >= 50) {
    return "inaccuracy";
  }
  return "best";
}

function buildSummary(reviews: MoveReview[], color: "w" | "b"): PlayerAnalysisSummary {
  const mine = reviews.filter((review) => review.color === color);
  const inaccuracies = mine.filter((review) => review.verdict === "inaccuracy").length;
  const mistakes = mine.filter((review) => review.verdict === "mistake").length;
  const blunders = mine.filter((review) => review.verdict === "blunder").length;
  const totalLoss = mine.reduce((sum, review) => sum + review.centipawnLoss, 0);
  const averageCentipawnLoss = mine.length ? totalLoss / mine.length : 0;
  const accuracy = mine.length
    ? Math.max(0, Math.min(100, Math.round(mine.reduce((sum, review) => sum + Math.max(0, 100 - Math.min(100, review.centipawnLoss / 4)), 0) / mine.length)))
    : 100;

  return { inaccuracies, mistakes, blunders, averageCentipawnLoss, accuracy };
}

function buildAnalysisPath(values: number[], width: number, height: number) {
  if (values.length === 0) {
    return "";
  }

  const clamped = values.map((value) => Math.max(-800, Math.min(800, value)));
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  return clamped
    .map((value, index) => {
      const x = stepX * index;
      const normalized = (value + 800) / 1600;
      const y = height - normalized * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

async function api<T>(url: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("content-type", "application/json");
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers, cache: "no-store" });
  const raw = await response.text();
  let payload: (T & { error?: string }) | null = null;

  if (raw) {
    try {
      payload = JSON.parse(raw) as T & { error?: string };
    } catch {
      if (!response.ok) {
        throw new Error(raw || `Request failed with status ${response.status}`);
      }
      throw new Error("The server returned an invalid JSON response.");
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error || raw || `Request failed with status ${response.status}`);
  }

  if (!payload) {
    throw new Error("The server returned an empty response.");
  }

  return payload;
}

export function GameClient({ gameId }: { gameId: string }) {
  const sharePath = `/game/${gameId}`;
  const boardStageRef = useRef<HTMLDivElement | null>(null);
  const boardColumnRef = useRef<HTMLDivElement | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [game, setGame] = useState<PublicGame | null>(null);
  const [status, setStatus] = useState("Loading board...");
  const [error, setError] = useState<string | null>(null);
  const [stakeMemo, setStakeMemo] = useState("");
  const [tableCollapsed, setTableCollapsed] = useState(true);
  const [tick, setTick] = useState(0);
  const [boardWidth, setBoardWidth] = useState(720);
  const [stakeVerifying, setStakeVerifying] = useState(false);
  const [postGameAnalysis, setPostGameAnalysis] = useState<PostGameAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const { analysis, analyzeFen, analyzeFenOnce, stopAnalysis } = useStockfish();

  const myColor = getMyColor(game, username);
  const displayTimes = useMemo(() => getLiveDisplayTimes(game), [game, tick]);
  const moveRows = useMemo(() => buildMoveRows(game), [game]);
  const evalText = useMemo(() => {
    if (analysis.scoreMate !== null) {
      return `Mate ${analysis.scoreMate}`;
    }
    if (analysis.scoreCp !== null) {
      return (analysis.scoreCp / 100).toFixed(2);
    }
    return "--";
  }, [analysis.scoreCp, analysis.scoreMate]);
  const analysisPath = useMemo(() => buildAnalysisPath(postGameAnalysis?.timeline || [], 720, 180), [postGameAnalysis]);
  const canMove = game && game.status === "active" && ((game.turn === "w" && myColor === "white") || (game.turn === "b" && myColor === "black"));
  const canJoin = Boolean(game && username && game.white !== username && !game.black);
  const canAbort = Boolean(game && username && game.createdBy === username && game.isAbortable && game.status !== "finished");
  const canLeave = Boolean(game && username && myColor && game.isAbortable && game.status !== "finished");

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_KEY);
    const storedUser = window.localStorage.getItem(USERNAME_KEY);
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUsername(storedUser);
      setUsernameInput(storedUser);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const stageElement = boardStageRef.current;
    const columnElement = boardColumnRef.current;
    if (!stageElement || !columnElement) {
      return;
    }

    const update = () => {
      const rect = stageElement.getBoundingClientRect();
      const availableHeight = Math.max(260, Math.floor(window.innerHeight - rect.top - 72));
      const availableWidth = Math.max(260, Math.floor(columnElement.clientWidth));
      const nextWidth = Math.max(260, Math.min(920, availableWidth, availableHeight));
      setBoardWidth(nextWidth);
    };

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(columnElement);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [game?.id]);

  useEffect(() => {
    if (game && username) {
      setStakeMemo(getStakeMemo(game.id, username));
    }
  }, [game?.id, username]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const payload = await api<{ game: PublicGame }>(`/api/games/${gameId}/sync`, { method: "POST", body: JSON.stringify({}) }, token);
        if (active) {
          setGame(payload.game);
          setStatus(`Board ${payload.game.inviteCode}`);
        }
      } catch (requestError) {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : "Could not load game.");
        }
      }
    };

    void load();
    const interval = window.setInterval(load, 2000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [gameId, token]);

  async function loginWithKeychain() {
    setError(null);
    const fallbackPrompt = typeof window !== "undefined" ? window.prompt("Enter your Hive username") || "" : "";
    const targetUsername = (usernameInput || username || fallbackPrompt).trim().toLowerCase();
    if (!targetUsername) {
      setError("Enter a Hive username.");
      return;
    }

    if (!window.hive_keychain) {
      setError("Hive Keychain was not found in this browser.");
      return;
    }

    try {
      const challenge = await api<{ challengeToken: string; tx: Record<string, unknown> }>(
        "/api/auth/challenge",
        {
          method: "POST",
          body: JSON.stringify({ username: targetUsername }),
        },
      );

      const signedTx = await new Promise<Record<string, unknown>>((resolve, reject) => {
        window.hive_keychain!.requestSignTx(targetUsername, challenge.tx, "Posting", (response) => {
          if (response.success && response.result) {
            resolve(response.result);
            return;
          }
          reject(new Error(response.error || "The login challenge signature was cancelled."));
        });
      });

      const verified = await api<{ token: string; username: string }>(
        "/api/auth/verify",
        {
          method: "POST",
          body: JSON.stringify({ username: targetUsername, challengeToken: challenge.challengeToken, signedTx }),
        },
      );

      window.localStorage.setItem(TOKEN_KEY, verified.token);
      window.localStorage.setItem(USERNAME_KEY, verified.username);
      setToken(verified.token);
      setUsername(verified.username);
      setStatus(`Connected as @${verified.username}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Login failed.");
    }
  }

  function logout() {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USERNAME_KEY);
    setToken(null);
    setUsername(null);
    setStatus("Session cleared.");
  }

  async function joinGame() {
    try {
      const payload = await api<{ game: PublicGame }>(`/api/games/${gameId}/join`, { method: "POST", body: JSON.stringify({}) }, token);
      setGame(payload.game);
      setStatus("You joined the game.");
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not join game.");
    }
  }

  async function cancelGame() {
    if (!game) {
      return;
    }

    try {
      const payload = await api<{ game: PublicGame }>(`/api/games/${game.id}/abort`, { method: "POST", body: JSON.stringify({}) }, token);
      setGame(payload.game);
      setStatus("Game cancelled. Any confirmed stake is now on the refund path.");
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not cancel game.");
    }
  }

  async function leaveGame() {
    if (!game) {
      return;
    }

    try {
      const payload = await api<{ game: PublicGame }>(`/api/games/${game.id}/leave`, { method: "POST", body: JSON.stringify({}) }, token);
      setGame(payload.game);
      setStatus("Game left. Any confirmed stake is now on the refund path.");
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not leave game.");
    }
  }

  function onPieceDrop(sourceSquare: string, targetSquare: string) {
    if (!game || !token) {
      return false;
    }

    const local = new Chess(game.fen);
    const move = local.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
    if (!move) {
      return false;
    }

    setGame({
      ...game,
      fen: local.fen(),
      pgn: local.pgn(),
      turn: local.turn(),
      moves: [
        ...game.moves,
        {
          by: username || "",
          color: move.color,
          from: move.from,
          to: move.to,
          san: move.san,
          fen: local.fen(),
          createdAt: new Date().toISOString(),
        },
      ],
      clockSnapshotAt: new Date().toISOString(),
    });

    void api<{ game: PublicGame }>(
      `/api/games/${game.id}/move`,
      {
        method: "POST",
        body: JSON.stringify({ from: sourceSquare, to: targetSquare, promotion: "q" }),
      },
      token,
    )
      .then((payload) => {
        setGame(payload.game);
        setError(null);
      })
      .catch(async (requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Move failed.");
        try {
          const fallback = await api<{ game: PublicGame }>(`/api/games/${game.id}`, { method: "GET" }, token);
          setGame(fallback.game);
        } catch {
          // Ignore fallback failure.
        }
      });

    return true;
  }

  function payStake() {
    if (!game || !username || !window.hive_keychain) {
      return;
    }

    const memo = getStakeMemo(game.id, username);
    setStakeMemo(memo);
    window.hive_keychain.requestTransfer(
      username,
      game.stake.escrowAccount,
      Number(game.stake.amount).toFixed(3),
      memo,
      "HIVE",
      (response) => {
        if (!response.success) {
          setError(response.error || "Stake transfer cancelled.");
          return;
        }
        setStatus("Transfer approved. Waiting for blockchain confirmation...");
        void verifyStake(memo, true);
      },
      true,
    );
  }

  async function verifyStake(forcedMemo?: string, silent = false) {
    if (!game) {
      return;
    }

    const memo = forcedMemo || stakeMemo.trim();
    if (!memo) {
      return;
    }

    setStakeVerifying(true);

    try {
      const payload = await api<{ game: PublicGame }>(
        `/api/games/${game.id}/stake`,
        {
          method: "POST",
          body: JSON.stringify({ memo }),
        },
        token,
      );
      setGame(payload.game);
      setStatus("Stake confirmed on Hive.");
      setError(null);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Stake verification failed.";
      if (!silent || !message.includes("not found yet")) {
        setError(message);
      } else {
        setStatus("Still waiting for the stake transfer to appear on-chain...");
      }
    } finally {
      setStakeVerifying(false);
    }
  }

  async function analyzeCompletedGame() {
    if (!game || !game.result) {
      return;
    }

    setAnalysisLoading(true);
    setError(null);

    try {
      const initial = new Chess();
      const fens = [initial.fen(), ...game.moves.map((move) => move.fen)];
      const scores: number[] = [];

      for (const fen of fens) {
        const result = await analyzeFenOnce(fen, 10);
        scores.push(toWhitePerspectiveScore(fen, result));
      }

      const reviews: MoveReview[] = game.moves.map((move, index) => {
        const scoreBefore = scores[index] ?? 0;
        const scoreAfter = scores[index + 1] ?? scoreBefore;
        const centipawnLoss = move.color === "w" ? Math.max(0, scoreBefore - scoreAfter) : Math.max(0, scoreAfter - scoreBefore);
        return {
          ply: index + 1,
          moveNumber: Math.floor(index / 2) + 1,
          color: move.color,
          san: move.san,
          scoreBefore,
          scoreAfter,
          centipawnLoss,
          verdict: classifyLoss(centipawnLoss),
        };
      });

      setPostGameAnalysis({
        timeline: scores,
        reviews,
        white: buildSummary(reviews, "w"),
        black: buildSummary(reviews, "b"),
      });
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Game analysis failed.");
    } finally {
      setAnalysisLoading(false);
    }
  }

  return (
    <main className="page-shell game-page-shell">
      <div className="topbar">
        <div>
          <div className="section-eyebrow">Game Room</div>
          <div className="topbar-title">Board {game?.inviteCode || gameId}</div>
        </div>
        <div className="topbar-actions">
          <div className="subtle topbar-status">{status}</div>
          {token ? (
            <button className="ghost link-button" onClick={logout}>
              Log out @{username}
            </button>
          ) : (
            <button className="primary link-button" onClick={loginWithKeychain}>
              Connect Hive Keychain
            </button>
          )}
          <a className="ghost link-button" href="/">
            Back to lobby
          </a>
        </div>
      </div>

      <section className="game-layout page-game-layout">
        <aside className="stack game-meta-column">
          <div className="panel game-summary-card">
            <div className="section-eyebrow">Game</div>
            <div className="game-summary-title">{game?.rated ? "Rated" : "Casual"} game</div>
            <div className="game-summary-line">@{game?.white || "white"} vs @{game?.black || "black"}</div>
            <div className="game-summary-line">Code: <span className="mono">{game?.inviteCode || gameId}</span></div>
            <div className="game-summary-line">Status: {game?.status || "loading"}</div>
            {game?.result ? <div className="game-summary-line emphasis-text">{game.result.message}</div> : null}
            <div className="button-row compact-actions top-gap">
              <button
                className="ghost small-button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    navigator.clipboard.writeText(`${window.location.origin}${sharePath}`);
                    setStatus("Share link copied.");
                  }
                }}
              >
                Copy link
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Table</h2>
              <span className="panel-hint">Match summary</span>
            </div>
            <div className="button-row compact-actions">
              <button className="ghost small-button" onClick={() => setTableCollapsed((value) => !value)}>
                {tableCollapsed ? "Expand table" : "Collapse table"}
              </button>
              {canJoin ? (
                <button className="secondary small-button" onClick={joinGame}>
                  Join game
                </button>
              ) : null}
              {canAbort ? (
                <button className="danger small-button" onClick={cancelGame}>
                  Cancel game
                </button>
              ) : null}
              {canLeave ? (
                <button className="ghost small-button" onClick={leaveGame}>
                  Leave game
                </button>
              ) : null}
            </div>

            {!tableCollapsed ? (
              <>
                <div className="status-box top-gap compact-table-box">
                  <div><strong>Mode:</strong> {game?.rated ? "Rated" : "Casual"}</div>
                  <div><strong>Window:</strong> {game?.isAbortable ? "Abortable" : "Locked"}</div>
                  {game?.result?.ratingDelta ? (
                    <div><strong>Rating:</strong> W {game.result.ratingDelta.white >= 0 ? "+" : ""}{game.result.ratingDelta.white}, B {game.result.ratingDelta.black >= 0 ? "+" : ""}{game.result.ratingDelta.black}</div>
                  ) : null}
                  {game?.result?.stakeDeltaHive ? (
                    <div><strong>Stake:</strong> W {game.result.stakeDeltaHive.white >= 0 ? "+" : ""}{game.result.stakeDeltaHive.white.toFixed(3)}, B {game.result.stakeDeltaHive.black >= 0 ? "+" : ""}{game.result.stakeDeltaHive.black.toFixed(3)}</div>
                  ) : null}
                </div>

                <div className="inline-note subtle compact-auth-row">Session: <span className="mono">{username ? `@${username}` : "guest"}</span></div>
              </>
            ) : null}
          </div>

          {game?.stake.amount ? (
            <div className="panel">
              <div className="panel-heading">
                <h2>Stake</h2>
                <span className="panel-hint">On-chain confirmation</span>
              </div>
              <div className="inline-note">
                Stake: <strong>{game.stake.amount.toFixed(3)} HIVE</strong> to <span className="mono">{game.stake.escrowAccount}</span>
              </div>
              <div className="status-box top-gap compact-table-box">
                <div><strong>Fee:</strong> 4%, min 0.002</div>
                <div><strong>Hold:</strong> {game.stake.settlementStatus}</div>
                <div><strong>White:</strong> {game.stake.whiteConfirmed ? "funded" : "pending"}</div>
                <div><strong>Black:</strong> {game.stake.blackConfirmed ? "funded" : "pending"}</div>
              </div>
              <div className="form-grid top-gap">
                <div className="field">
                  <label>Stake memo</label>
                  <input value={stakeMemo} onChange={(event) => setStakeMemo(event.target.value)} placeholder={`stake:${game.id}:${username || "user"}`} />
                </div>
                <div className="button-row">
                  <button className="secondary" onClick={payStake} disabled={!myColor}>
                    Pay stake
                  </button>
                  <button className="ghost" onClick={() => void verifyStake()} disabled={!myColor || !stakeMemo.trim() || stakeVerifying}>
                    {stakeVerifying ? "Verifying..." : "Verify stake"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {error ? <div className="status-box error">{error}</div> : null}
        </aside>

        <div className="board-column" ref={boardColumnRef}>
          <div className="board-wrap clean-board-wrap">
          {!game ? (
            <div className="subtle">Loading game...</div>
          ) : (
            <>
              <div className="board-stage" ref={boardStageRef}>
                <Chessboard
                  id="snapchess-board"
                  position={game.fen}
                  boardWidth={boardWidth}
                  boardOrientation={myColor === "black" ? "black" : "white"}
                  arePiecesDraggable={Boolean(canMove)}
                  onPieceDrop={onPieceDrop}
                  customDarkSquareStyle={{ backgroundColor: "#8754a0" }}
                  customLightSquareStyle={{ backgroundColor: "#a99aba" }}
                />
              </div>

              {game.result ? <div className="status-box success result-banner">{game.result.message}</div> : null}
              <div className="analysis-toolbar">
                <button className="ghost small-button" onClick={() => game && analyzeFen(game.fen, 12)}>
                  Analyze game
                </button>
                <button className="ghost small-button" onClick={stopAnalysis}>
                  Stop analysis
                </button>
                <span className="analysis-chip">Eval {evalText}</span>
                <span className="analysis-chip">Depth {analysis.depth || "--"}</span>
                <span className="analysis-chip">Best {analysis.bestMove || "--"}</span>
              </div>
              {game.result ? (
                <div className="panel post-game-analysis-panel">
                  <div className="panel-heading">
                    <h2>Computer Analysis</h2>
                    <span className="panel-hint">Runs locally in your browser</span>
                  </div>
                  <div className="button-row compact-actions">
                    <button className="primary small-button" onClick={() => void analyzeCompletedGame()} disabled={analysisLoading || !analysis.ready}>
                      {analysisLoading ? "Analyzing..." : "Analyze completed game"}
                    </button>
                  </div>
                  {postGameAnalysis ? (
                    <div className="analysis-grid top-gap">
                      <div className="analysis-chart-card">
                        <svg className="analysis-chart" viewBox="0 0 720 180" preserveAspectRatio="none" aria-label="Evaluation chart">
                          <line x1="0" y1="90" x2="720" y2="90" className="analysis-axis" />
                          <path d={analysisPath} className="analysis-line" />
                        </svg>
                      </div>
                      <div className="analysis-summary-card">
                        <div className="analysis-player-summary">
                          <strong>@{game.white}</strong>
                          <span>Accuracy {postGameAnalysis.white.accuracy}%</span>
                          <span>Inaccuracies {postGameAnalysis.white.inaccuracies}</span>
                          <span>Mistakes {postGameAnalysis.white.mistakes}</span>
                          <span>Blunders {postGameAnalysis.white.blunders}</span>
                          <span>Avg CPL {postGameAnalysis.white.averageCentipawnLoss.toFixed(0)}</span>
                        </div>
                        <div className="analysis-player-summary">
                          <strong>@{game.black || "black"}</strong>
                          <span>Accuracy {postGameAnalysis.black.accuracy}%</span>
                          <span>Inaccuracies {postGameAnalysis.black.inaccuracies}</span>
                          <span>Mistakes {postGameAnalysis.black.mistakes}</span>
                          <span>Blunders {postGameAnalysis.black.blunders}</span>
                          <span>Avg CPL {postGameAnalysis.black.averageCentipawnLoss.toFixed(0)}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
        </div>

        <div className="stack game-rail">
          <div className={`player-card top ${game?.turn === "b" && game?.status === "active" ? "active" : ""}`}>
            <div className="player-card-head">
              <div className="player-card-name-row">
                <span className="presence-dot" />
                {game?.black ? <a className="player-card-title profile-link" href={`/player/${game.black}`}>@{game.black}</a> : <span className="player-card-title">@waiting</span>}
                {game?.blackRating ? <span className="player-card-rating">{game.blackRating}</span> : null}
              </div>
            </div>
            <div className="rail-clock">{formatMs(displayTimes.black)}</div>
          </div>

          <div className="panel notation-panel">
            <div className="notation-header">
              <span className="panel-hint">Moves</span>
              <span className="panel-hint mono">{game?.inviteCode || gameId}</span>
            </div>
            <div className="notation-table">
              {moveRows.length === 0 ? <div className="empty-state subtle">No moves yet.</div> : null}
              {moveRows.map((row) => (
                <div className="notation-row" key={`move-row-${row.moveNumber}`}>
                  <div className="notation-index">{row.moveNumber}</div>
                  <div className="notation-move">{row.white || ""}</div>
                  <div className="notation-move emphasis">{row.black || ""}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={`player-card bottom ${game?.turn === "w" && game?.status === "active" ? "active" : ""}`}>
            <div className="player-card-head">
              <div className="player-card-name-row">
                <span className="presence-dot" />
                {game?.white ? <a className="player-card-title profile-link" href={`/player/${game.white}`}>@{game.white}</a> : <span className="player-card-title">@waiting</span>}
                {game?.whiteRating ? <span className="player-card-rating">{game.whiteRating}</span> : null}
              </div>
            </div>
            <div className="rail-clock">{formatMs(displayTimes.white)}</div>
          </div>
        </div>
      </section>
    </main>
  );
}
