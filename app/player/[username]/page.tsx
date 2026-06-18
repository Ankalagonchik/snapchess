import { readState } from "@/lib/store";
import { toLeaderboardEntry } from "@/lib/stats";

function formatDate(value?: string) {
  if (!value) {
    return "Unknown";
  }

  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function summarizeResult(game: Awaited<ReturnType<typeof readState>>["games"][number], username: string) {
  if (!game.result) {
    return "In progress";
  }
  if (game.result.winner === "draw") {
    return "Draw";
  }

  const won = (game.result.winner === "white" && game.white === username) || (game.result.winner === "black" && game.black === username);
  return won ? "Win" : "Loss";
}

function getOpponent(game: Awaited<ReturnType<typeof readState>>["games"][number], username: string) {
  return game.white === username ? game.black || "waiting" : game.white;
}

export default async function PlayerProfilePage({ params }: { params: { username: string } }) {
  const username = params.username.toLowerCase();
  const state = await readState();
  const player = state.players.find((entry) => entry.username === username);
  const stats = player ? toLeaderboardEntry(player) : null;

  const recentGames = state.games
    .filter((game) => game.white === username || game.black === username)
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 20);

  return (
    <main className="page-shell profile-shell">
      <div className="topbar">
        <div>
          <div className="section-eyebrow">Player Profile</div>
          <div className="topbar-title">@{username}</div>
        </div>
        <div className="topbar-actions">
          <a className="ghost link-button" href="/">
            Back to lobby
          </a>
        </div>
      </div>

      <section className="profile-layout">
        <aside className="stack">
          <div className="panel">
            <div className="panel-heading">
              <h2>Overview</h2>
              <span className="panel-hint">Lichess-style essentials</span>
            </div>
            {stats ? (
              <div className="stats-grid profile-stats-grid">
                <div className="stat-box"><span className="stat-label">Rating</span><strong>{stats.rating}</strong></div>
                <div className="stat-box"><span className="stat-label">Peak</span><strong>{stats.peakRating}</strong></div>
                <div className="stat-box"><span className="stat-label">Games</span><strong>{stats.gamesPlayed}</strong></div>
                <div className="stat-box"><span className="stat-label">Net HIVE</span><strong>{stats.netHive.toFixed(3)}</strong></div>
              </div>
            ) : (
              <div className="empty-state subtle">This player has no SnapChess record yet.</div>
            )}
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Record</h2>
              <span className="panel-hint">Wins, losses, draws</span>
            </div>
            {stats ? (
              <div className="profile-record-list">
                <div className="profile-record-row"><span>Wins</span><strong>{stats.wins}</strong></div>
                <div className="profile-record-row"><span>Losses</span><strong>{stats.losses}</strong></div>
                <div className="profile-record-row"><span>Draws</span><strong>{stats.draws}</strong></div>
                <div className="profile-record-row"><span>HIVE won</span><strong>{stats.hiveWon.toFixed(3)}</strong></div>
                <div className="profile-record-row"><span>HIVE lost</span><strong>{stats.hiveLost.toFixed(3)}</strong></div>
                <div className="profile-record-row"><span>Last game</span><strong>{formatDate(stats.lastGameAt)}</strong></div>
              </div>
            ) : (
              <div className="empty-state subtle">No completed games yet.</div>
            )}
          </div>
        </aside>

        <section className="stack">
          <div className="panel">
            <div className="panel-heading">
              <h2>Recent Games</h2>
              <span className="panel-hint">Latest 20 games</span>
            </div>
            <div className="profile-games-list">
              {recentGames.length === 0 ? <div className="empty-state subtle">No games found for this player.</div> : null}
              {recentGames.map((game) => (
                <a key={game.id} className="card-button profile-game-card" href={`/game/${game.id}`}>
                  <div className="card-topline">
                    <h4>{summarizeResult(game, username)} vs @{getOpponent(game, username)}</h4>
                    <span className="card-chip muted">{game.rated ? "rated" : "casual"}</span>
                  </div>
                  <div className="card-meta-row">
                    <span>{game.timeControl.label}</span>
                    <span>{formatDate(game.finishedAt || game.updatedAt)}</span>
                  </div>
                  <div className="compact-row subtle">{game.result?.message || "Game in progress"}</div>
                </a>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
