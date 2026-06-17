"use client";

import { useEffect, useState } from "react";

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
        </div>
        <div className="site-actions">
          <div className="site-status-pill">{status}</div>
        </div>
      </section>

      <section className="lobby-layout">
        <div className="stack lobby-side">
          <div className="panel">
            <div className="panel-heading">
              <h2>Account</h2>
              <span className="panel-hint">Hive Keychain session</span>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Hive username</label>
                <input value={usernameInput} onChange={(event) => setUsernameInput(event.target.value)} placeholder="meno" />
              </div>
              <div className="button-row">
                <button className="primary" onClick={loginWithKeychain} disabled={loading}>
                  Connect Hive Keychain
                </button>
                <button className="ghost" onClick={logout} disabled={!token}>
                  Log out
                </button>
              </div>
              <div className="inline-note subtle">
                Current user: <span className="mono">{username ? `@${username}` : "not connected"}</span>
              </div>
              {lobby.me ? (
                <div className="stats-grid">
                  <div className="stat-box">
                    <span className="stat-label">Rating</span>
                    <strong>{lobby.me.rating}</strong>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">Peak</span>
                    <strong>{lobby.me.peakRating}</strong>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">Record</span>
                    <strong>
                      {lobby.me.wins}-{lobby.me.losses}-{lobby.me.draws}
                    </strong>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">Net HIVE</span>
                    <strong>{lobby.me.netHive.toFixed(3)}</strong>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Create Game</h2>
              <span className="panel-hint">Quick pairing</span>
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

              <div className="two-col">
                <div className="field">
                  <label>Invite username</label>
                  <input value={reservedOpponent} onChange={(event) => setReservedOpponent(event.target.value)} placeholder="eddiespino" />
                </div>
                <div className="field">
                  <label>Stake in HIVE</label>
                  <input value={stakeAmount} onChange={(event) => setStakeAmount(event.target.value)} placeholder="0" />
                </div>
              </div>

              <div className="field">
                <label>Rating mode</label>
                <select value={rated ? "rated" : "casual"} onChange={(event) => setRated(event.target.value === "rated")}>
                  <option value="rated">Rated</option>
                  <option value="casual">Casual</option>
                </select>
              </div>

              <button className="primary" onClick={createChallengeGame} disabled={!token || loading}>
                Create and open table
              </button>

              <div className="inline-note subtle">
                Games open in a dedicated tab. Stake games use the `justdebateonline` escrow account and retain a 4% platform fee with a 0.002 HIVE minimum before payout.
              </div>
            </div>
          </div>

          {error ? <div className="status-box error">{error}</div> : null}
        </div>

        <div className="stack lobby-main">
          <section className="hero hero-lobby">
            <div className="hero-main">
              <div className="hero-kicker-row">
                <span className="hero-kicker-pill">Play</span>
                <span className="hero-kicker-pill">Compete</span>
                <span className="hero-kicker-pill">Stake</span>
              </div>
              <div className="hero-badges">
                <span className="hero-badge">Hive Keychain</span>
                <span className="hero-badge">Rated and casual</span>
                <span className="hero-badge">Dedicated game tabs</span>
              </div>
              <h1 className="page-title">Play fast, clean, Hive-native chess.</h1>
              <p className="hero-copy">A tighter chess lobby inspired by the structure of Lichess, restyled with Snapie colors and Hive account flows.</p>
            </div>
            <aside className="hero-card hero-card-compact">
              <div className="section-eyebrow">Live Status</div>
              <div className="status-ticker">{status}</div>
            </aside>
          </section>

          <div className="panel">
            <div className="panel-heading">
              <h2>Open Games</h2>
              <span className="panel-hint">Public pairings and direct invites</span>
            </div>
            <div className="list">
              {lobby.openGames.length === 0 ? <div className="empty-state subtle">No open games yet.</div> : null}
              {lobby.openGames.map((game) => (
                <a key={game.id} className="card-button link-card" href={`/game/${game.id}`} target="_blank" rel="noreferrer">
                  <div className="card-topline">
                    <h4>
                      {game.timeControl.label} {game.whiteRating ? <span className="subtle">@{game.white} ({game.whiteRating})</span> : null}
                    </h4>
                    <div className="card-chip-row">
                      <span className={`card-chip ${game.rated ? "" : "muted"}`}>{game.rated ? "rated" : "casual"}</span>
                      <span className="card-chip">{game.stake.amount > 0 ? `${game.stake.amount.toFixed(3)} HIVE` : "no stake"}</span>
                    </div>
                  </div>
                  <div className="card-meta-row">
                    <span className="mono">{game.inviteCode}</span>
                    <span>White: @{game.white}</span>
                  </div>
                  <div className="subtle">Invite: {game.reservedOpponent ? `@${game.reservedOpponent}` : "public"}</div>
                </a>
              ))}
            </div>
          </div>

        </div>

        <div className="stack lobby-side">
          <div className="panel">
            <div className="panel-heading">
              <h2>My Games</h2>
              <span className="panel-hint">Resume in a new tab</span>
            </div>
            <div className="list">
              {lobby.myGames.length === 0 ? <div className="empty-state subtle">Your games will appear here.</div> : null}
              {lobby.myGames.map((game) => (
                <a key={game.id} className="card-button link-card" href={`/game/${game.id}`} target="_blank" rel="noreferrer">
                  <div className="card-topline">
                    <h4>
                      {game.white} vs {game.black ?? "..."}
                    </h4>
                    <span className="card-chip muted">{game.result ? game.result.winner === "draw" ? "Draw" : `${game.result.winner} won` : game.status}</span>
                  </div>
                  <div className="card-meta-row">
                    <span>{game.timeControl.label}</span>
                    <span className="mono">{game.inviteCode}</span>
                  </div>
                  {game.result ? <div className="subtle compact-row">{game.result.message}</div> : null}
                  <div className="subtle compact-row">
                    {game.rated ? "Rated" : "Casual"}
                    {game.stake.amount > 0 ? ` • ${game.stake.amount.toFixed(3)} HIVE` : " • No stake"}
                  </div>
                </a>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Leaderboards</h2>
              <span className="panel-hint">Switch between rating and HIVE won</span>
            </div>
            <div className="leaderboard-switch" role="tablist" aria-label="Leaderboard view">
              <button
                type="button"
                className={`leaderboard-tab ${leaderboardView === "rating" ? "active" : ""}`}
                onClick={() => setLeaderboardView("rating")}
              >
                Rating
              </button>
              <button
                type="button"
                className={`leaderboard-tab ${leaderboardView === "hive" ? "active" : ""}`}
                onClick={() => setLeaderboardView("hive")}
              >
                HIVE Won
              </button>
            </div>
            <div className="leaderboard-list">
              {activeLeaders.length === 0 ? (
                <div className="subtle">{leaderboardView === "rating" ? "No rated games yet." : "No HIVE results yet."}</div>
              ) : null}
              {activeLeaders.map((player, index) => (
                <div className="leaderboard-row" key={`${leaderboardView}-${player.username}`}>
                  <span className="leaderboard-rank">{index + 1}</span>
                  <span className="leaderboard-name">@{player.username}</span>
                  <span className="leaderboard-value">{leaderboardView === "rating" ? player.rating : player.netHive.toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
