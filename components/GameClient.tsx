"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

import type { PublicGame } from "@/lib/types";

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
  const [usernameInput, setUsernameInput] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [game, setGame] = useState<PublicGame | null>(null);
  const [status, setStatus] = useState("Loading board...");
  const [error, setError] = useState<string | null>(null);
  const [stakeMemo, setStakeMemo] = useState("");
  const [tableCollapsed, setTableCollapsed] = useState(false);
  const [tick, setTick] = useState(0);
  const [boardWidth, setBoardWidth] = useState(720);
  const [stakeVerifying, setStakeVerifying] = useState(false);

  const myColor = getMyColor(game, username);
  const displayTimes = useMemo(() => getLiveDisplayTimes(game), [game, tick]);
  const moveRows = useMemo(() => buildMoveRows(game), [game]);
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
    const element = boardStageRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      const viewportCap = typeof window === "undefined" ? 860 : Math.max(280, Math.floor(window.innerHeight - 170));
      const nextWidth = Math.max(260, Math.min(900, Math.min(Math.floor(element.clientWidth - 8), viewportCap)));
      setBoardWidth(nextWidth);
    };

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(element);
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
    const username = usernameInput.trim().toLowerCase();
    if (!username) {
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
          body: JSON.stringify({ username }),
        },
      );

      const signedTx = await new Promise<Record<string, unknown>>((resolve, reject) => {
        window.hive_keychain!.requestSignTx(username, challenge.tx, "Posting", (response) => {
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
          body: JSON.stringify({ username, challengeToken: challenge.challengeToken, signedTx }),
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

  return (
    <main className="page-shell">
      <div className="topbar">
        <div>
          <div className="section-eyebrow">Game Room</div>
          <div className="topbar-title">Board {game?.inviteCode || gameId}</div>
        </div>
        <div className="topbar-actions">
          <div className="subtle topbar-status">{status}</div>
          <a className="ghost link-button" href="/">
            Back to lobby
          </a>
        </div>
      </div>

      <section className="game-layout page-game-layout">
        <div className="panel board-wrap board-panel">
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
            </>
          )}
        </div>

        <div className="stack game-rail">
          <div className={`player-card top ${game?.turn === "b" && game?.status === "active" ? "active" : ""}`}>
            <div className="player-card-head">
              <div className="player-card-name-row">
                <span className="presence-dot" />
                <span className="player-card-title">@{game?.black || "waiting"}</span>
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
                <span className="player-card-title">@{game?.white || "waiting"}</span>
                {game?.whiteRating ? <span className="player-card-rating">{game.whiteRating}</span> : null}
              </div>
            </div>
            <div className="rail-clock">{formatMs(displayTimes.white)}</div>
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
                <div className="status-box top-gap">
                  <div>
                    <strong>Mode:</strong> {game?.rated ? "Rated" : "Casual"}
                  </div>
                  <div>
                    <strong>Invite code:</strong> <span className="mono">{game?.inviteCode || gameId}</span>
                  </div>
                  <div>
                    <strong>Share link:</strong> <span className="mono">{sharePath}</span>
                  </div>
                  <div>
                    <strong>Status:</strong> {game?.status || "loading"}
                  </div>
                  <div>
                    <strong>Abort window:</strong> {game?.isAbortable ? "Open" : "Closed"}
                  </div>
                  {game?.result?.ratingDelta ? (
                    <div>
                      <strong>Rating:</strong> White {game.result.ratingDelta.white >= 0 ? "+" : ""}
                      {game.result.ratingDelta.white}, Black {game.result.ratingDelta.black >= 0 ? "+" : ""}
                      {game.result.ratingDelta.black}
                    </div>
                  ) : null}
                  {game?.result?.stakeDeltaHive ? (
                    <div>
                      <strong>Stake result:</strong> White {game.result.stakeDeltaHive.white >= 0 ? "+" : ""}
                      {game.result.stakeDeltaHive.white.toFixed(3)} HIVE, Black {game.result.stakeDeltaHive.black >= 0 ? "+" : ""}
                      {game.result.stakeDeltaHive.black.toFixed(3)} HIVE
                    </div>
                  ) : null}
                </div>

                <div className="divider" />

                <div className="form-grid">
                  <div className="field">
                    <label>Hive username</label>
                    <input value={usernameInput} onChange={(event) => setUsernameInput(event.target.value)} placeholder="meno" />
                  </div>
                  <div className="button-row">
                    <button className="primary" onClick={loginWithKeychain}>
                      Connect Hive Keychain
                    </button>
                    <button className="ghost" onClick={logout} disabled={!token}>
                      Log out
                    </button>
                  </div>
                  <div className="inline-note subtle">
                    User: <span className="mono">{username ? `@${username}` : "guest"}</span>
                  </div>
                </div>
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
              <div className="status-box top-gap">
                <div>
                  <strong>Fee:</strong> 4% of the total pot, minimum 0.002 HIVE, retained by @{game.stake.escrowAccount}
                </div>
                <div>
                  <strong>Hold status:</strong> {game.stake.settlementStatus}
                </div>
                <div>
                  <strong>Settlement:</strong> {game.stake.settlementMemo || "Stake is not funded yet."}
                </div>
                {game.stake.payoutTxId ? (
                  <div>
                    <strong>Payout tx:</strong> <span className="mono">{game.stake.payoutTxId}</span>
                  </div>
                ) : null}
                {game.stake.whiteRefundTxId ? (
                  <div>
                    <strong>White refund tx:</strong> <span className="mono">{game.stake.whiteRefundTxId}</span>
                  </div>
                ) : null}
                {game.stake.blackRefundTxId ? (
                  <div>
                    <strong>Black refund tx:</strong> <span className="mono">{game.stake.blackRefundTxId}</span>
                  </div>
                ) : null}
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
                <div className="subtle">white funded: {game.stake.whiteConfirmed ? "yes" : "no"}</div>
                <div className="subtle">black funded: {game.stake.blackConfirmed ? "yes" : "no"}</div>
                <div className="inline-note subtle">
                  Stake flow: players transfer HIVE into the escrow account. Funds stay held there until settlement. When the game finishes, the winner receives the pot minus the 4% platform fee, with a minimum fee of 0.002 HIVE. If both sides have not committed moves yet, cancel or leave triggers refund settlement and no rating is applied.
                </div>
              </div>
            </div>
          ) : null}

          {error ? <div className="status-box error">{error}</div> : null}
        </div>
      </section>
    </main>
  );
}
