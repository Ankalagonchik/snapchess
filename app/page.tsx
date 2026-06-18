"use client";

import { useEffect, useRef, useState } from "react";

import type { LeaderboardEntry, PublicGame } from "@/lib/types";

type LobbyPayload = {
  openGames: PublicGame[];
  myGames: PublicGame[];
  me: LeaderboardEntry | null;
  leaderboards: {
    rating: LeaderboardEntry[];
    hive: LeaderboardEntry[];
  };
};

const TOKEN_KEY = "snapchess.token";
const USERNAME_KEY = "snapchess.username";
const TIME_CONTROL_OPTIONS = ["1+0 Bullet", "3+2 Blitz", "5+0 Blitz", "10+5 Rapid", "15+10 Rapid"];

function getTimeControlParts(value: string) {
  const [speed = value, category = ""] = value.split(" ");
  return { speed, category };
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

export default function HomePage() {
  const createPanelRef = useRef<HTMLDivElement | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Lobby ready. Create a challenge and open the board in a new tab.");
  const [error, setError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyPayload>({
    openGames: [],
    myGames: [],
    me: null,
    leaderboards: { rating: [], hive: [] },
  });
  const [timeControl, setTimeControl] = useState("3+2 Blitz");
  const [reservedOpponent, setReservedOpponent] = useState("");
  const [stakeAmount, setStakeAmount] = useState("0");
  const [rated, setRated] = useState(true);
  const [leaderboardView, setLeaderboardView] = useState<"rating" | "hive">("rating");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const activeLeaders = leaderboardView === "rating" ? lobby.leaderboards.rating : lobby.leaderboards.hive;

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
    let active = true;

    const load = async () => {
      try {
        const nextLobby = await api<LobbyPayload>("/api/games", { method: "GET" }, token);
        if (active) {
          setLobby(nextLobby);
        }
      } catch (requestError) {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : "Could not load lobby.");
        }
      }
    };

    void load();
    const interval = window.setInterval(load, 4000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [token]);

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

    setLoading(true);

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
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USERNAME_KEY);
    setToken(null);
    setUsername(null);
    setStatus("Session cleared.");
  }

  async function createChallengeGame() {
    if (!token) {
      setError("Log in with Hive Keychain first.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await api<{ game: PublicGame }>(
        "/api/games",
        {
          method: "POST",
          body: JSON.stringify({
            timeControl,
            reservedOpponent,
            stakeAmount: Number(stakeAmount || 0),
            rated,
          }),
        },
        token,
      );

      window.open(`/game/${payload.game.id}`, "_blank", "noopener,noreferrer");
      setStatus(`Game created and opened in a new tab. Code: ${payload.game.inviteCode}`);
      setCreateModalOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create game.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="site-bar">
        <div className="site-brand">
          <div className="section-eyebrow">Snapie Hive Chess</div>
          <div className="topbar-title">SnapChess</div>
          <div className="site-subtitle">Fast Hive-native play with optional HIVE stakes.</div>
        </div>
        <div className="site-actions">
          <div className="site-status-inline subtle">{status}</div>
          {username ? (
            <a className="ghost link-button" href={`/player/${username}`}>
              Profile @{username}
            </a>
          ) : null}
        </div>
      </section>

      <section className="home-layout">
        <aside className="stack home-left-rail">
          <div className="panel account-panel-compact">
            <div className="panel-heading">
              <h2>Account</h2>
              <span className="panel-hint">Hive session</span>
            </div>
            {username ? (
              <div className="form-grid compact-form-grid">
              <div className="inline-note subtle account-inline-row">
                  <span>Signed in</span>
                  <a className="profile-link mono" href={`/player/${username}`}>@{username}</a>
                </div>
                <div className="button-row compact-actions">
                  <a className="ghost link-button" href={`/player/${username}`}>
                    Open profile
                  </a>
                  <button className="ghost" onClick={logout}>
                    Log out
                  </button>
                </div>
                {lobby.me ? (
                  <div className="stats-grid compact-stats-grid">
                    <div className="stat-box"><span className="stat-label">Rating</span><strong>{lobby.me.rating}</strong></div>
                    <div className="stat-box"><span className="stat-label">Peak</span><strong>{lobby.me.peakRating}</strong></div>
                    <div className="stat-box"><span className="stat-label">Record</span><strong>{lobby.me.wins}-{lobby.me.losses}-{lobby.me.draws}</strong></div>
                    <div className="stat-box"><span className="stat-label">Net HIVE</span><strong>{lobby.me.netHive.toFixed(3)}</strong></div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="form-grid compact-form-grid">
                <div className="field">
                  <label>Hive username</label>
                  <input value={usernameInput} onChange={(event) => setUsernameInput(event.target.value)} placeholder="meno" />
                </div>
                <button className="primary" onClick={loginWithKeychain} disabled={loading}>
                  Connect Hive Keychain
                </button>
              </div>
            )}
          </div>

          <div className="panel compact-side-panel">
            <div className="panel-heading">
              <h2>Leaderboards</h2>
              <span className="panel-hint">Rating and HIVE</span>
            </div>
            <div className="leaderboard-switch" role="tablist" aria-label="Leaderboard view">
              <button type="button" className={`leaderboard-tab ${leaderboardView === "rating" ? "active" : ""}`} onClick={() => setLeaderboardView("rating")}>
                Rating
              </button>
              <button type="button" className={`leaderboard-tab ${leaderboardView === "hive" ? "active" : ""}`} onClick={() => setLeaderboardView("hive")}>
                HIVE Won
              </button>
            </div>
            <div className="leaderboard-list compact-leaderboard-list">
              {activeLeaders.length === 0 ? <div className="subtle">{leaderboardView === "rating" ? "No rated games yet." : "No HIVE results yet."}</div> : null}
              {activeLeaders.map((player, index) => (
                <div className="leaderboard-row" key={`${leaderboardView}-${player.username}`}>
                  <span className="leaderboard-rank">{index + 1}</span>
                  <a className="leaderboard-name profile-link" href={`/player/${player.username}`}>@{player.username}</a>
                  <span className="leaderboard-value">{leaderboardView === "rating" ? player.rating : player.netHive.toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="stack home-center-column">
          <div className="play-shell panel">
            <div className="play-shell-header simple-header">
              <div>
              <div className="section-eyebrow">Quick Pairing</div>
              <div className="play-shell-title">Choose a time control</div>
              </div>
              <div className="panel-hint compact-play-hint">Create or join a room.</div>
            </div>
            <div className="quick-grid">
              {TIME_CONTROL_OPTIONS.map((item) => {
                const { speed, category } = getTimeControlParts(item);
                return (
                  <button
                    key={item}
                    type="button"
                    className={`time-tile ${timeControl === item ? "active" : ""}`}
                    onClick={() => {
                      setTimeControl(item);
                      setStatus(`Selected ${item}. You can join an open table or create a room.`);
                    }}
                  >
                    <span className="time-tile-main">{speed}</span>
                    <span className="time-tile-sub">{category}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className="time-tile time-tile-custom"
                onClick={() => setCreateModalOpen(true)}
              >
                <span className="time-tile-main">Custom</span>
                <span className="time-tile-sub">Create room</span>
              </button>
            </div>
            <div className="selection-bar">
              <div className="selection-copy">
                <span className="selection-label">Selected</span>
                <strong>{timeControl}</strong>
              </div>
              <div className="button-row compact-actions">
                <button className="primary" onClick={() => setCreateModalOpen(true)} disabled={!token}>
                  Create room
                </button>
                <a className="ghost link-button" href={`/computer?timeControl=${encodeURIComponent(timeControl)}`}>
                  Play vs Stockfish
                </a>
              </div>
            </div>
          </div>

          <div className="panel compact-open-games-panel">
            <div className="panel-heading">
              <h2>Open Games</h2>
              <span className="panel-hint">Public pairings and direct invites</span>
            </div>
            <div className="list compact-open-games-list">
              {lobby.openGames.length === 0 ? <div className="empty-state subtle">No open games yet.</div> : null}
              {lobby.openGames.map((game) => (
                <a key={game.id} className="card-button link-card open-game-row" href={`/game/${game.id}`} target="_blank" rel="noreferrer">
                  <div className="card-topline">
                    <h4>{game.timeControl.label}</h4>
                    <div className="card-chip-row">
                      <span className={`card-chip ${game.rated ? "" : "muted"}`}>{game.rated ? "rated" : "casual"}</span>
                      <span className="card-chip">{game.stake.amount > 0 ? `${game.stake.amount.toFixed(3)} HIVE` : "no stake"}</span>
                    </div>
                  </div>
                  <div className="card-meta-row">
                    <span className="mono">{game.inviteCode}</span>
                    <span><a className="profile-link" href={`/player/${game.white}`}>@{game.white}</a>{game.whiteRating ? ` (${game.whiteRating})` : ""}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        <aside className="stack home-right-rail">
          <div className="panel action-panel home-action-panel" ref={createPanelRef}>
            <div className="panel-heading">
              <h2>Create Game</h2>
              <span className="panel-hint">Create room</span>
            </div>
            <div className="create-summary-stack">
              <div className="summary-chip-row">
                <span className="summary-chip">{timeControl}</span>
                <span className="summary-chip muted">{rated ? "Rated" : "Casual"}</span>
              </div>
              <button className="primary big-action" onClick={() => setCreateModalOpen(true)} disabled={!token}>
                Open create room dialog
              </button>
              <div className="compact-side-note subtle">4% fee on stake rooms, 0.002 HIVE minimum.</div>
            </div>
          </div>

          <div className="panel compact-side-panel">
            <div className="panel-heading">
              <h2>My Games</h2>
              <span className="panel-hint">Resume in a new tab</span>
            </div>
            <div className="list compact-game-list">
              {lobby.myGames.length === 0 ? <div className="empty-state subtle">Your games will appear here.</div> : null}
              {lobby.myGames.map((game) => (
                <a key={game.id} className="card-button link-card compact-game-card" href={`/game/${game.id}`} target="_blank" rel="noreferrer">
                  <div className="card-topline">
                    <h4>{game.white} vs {game.black ?? "..."}</h4>
                    <span className="card-chip muted">{game.result ? game.result.winner === "draw" ? "Draw" : `${game.result.winner} won` : game.status}</span>
                  </div>
                  <div className="card-meta-row">
                    <span>{game.timeControl.label}</span>
                    <span className="mono">{game.inviteCode}</span>
                  </div>
                  {game.result ? <div className="subtle compact-row clamp-two-lines">{game.result.message}</div> : null}
                </a>
              ))}
            </div>
          </div>
        </aside>
      </section>

      {createModalOpen ? (
        <div className="modal-backdrop" onClick={() => setCreateModalOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading modal-heading">
              <h2>Create Game</h2>
              <button className="ghost small-button" onClick={() => setCreateModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Time control</label>
                <select value={timeControl} onChange={(event) => setTimeControl(event.target.value)}>
                  {TIME_CONTROL_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Invite username</label>
                <input value={reservedOpponent} onChange={(event) => setReservedOpponent(event.target.value)} placeholder="eddiespino" />
              </div>
              <div className="two-col action-panel-grid">
                <div className="field">
                  <label>Stake in HIVE</label>
                  <input value={stakeAmount} onChange={(event) => setStakeAmount(event.target.value)} placeholder="0" />
                </div>
                <div className="field">
                  <label>Rating mode</label>
                  <select value={rated ? "rated" : "casual"} onChange={(event) => setRated(event.target.value === "rated")}>
                    <option value="rated">Rated</option>
                    <option value="casual">Casual</option>
                  </select>
                </div>
              </div>
              <button className="primary big-action" onClick={createChallengeGame} disabled={!token || loading}>
                Create and open table
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
