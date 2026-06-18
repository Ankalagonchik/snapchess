"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

import { useStockfish } from "@/hooks/useStockfish";

function formatClock(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseTimeControl(value?: string) {
  const mapping: Record<string, { initialMs: number; label: string }> = {
    "1+0 Bullet": { initialMs: 60_000, label: "1+0 Bullet" },
    "3+2 Blitz": { initialMs: 180_000, label: "3+2 Blitz" },
    "5+0 Blitz": { initialMs: 300_000, label: "5+0 Blitz" },
    "10+5 Rapid": { initialMs: 600_000, label: "10+5 Rapid" },
    "15+10 Rapid": { initialMs: 900_000, label: "15+10 Rapid" },
  };

  return mapping[value || ""] || mapping["3+2 Blitz"];
}

export function ComputerGameClient({ timeControl }: { timeControl?: string }) {
  const gameRef = useRef(new Chess());
  const boardColumnRef = useRef<HTMLDivElement | null>(null);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [moves, setMoves] = useState<string[]>([]);
  const [status, setStatus] = useState("Your move");
  const [boardWidth, setBoardWidth] = useState(720);
  const [playerTime] = useState(parseTimeControl(timeControl).initialMs);
  const [engineTime] = useState(parseTimeControl(timeControl).initialMs);
  const [enginePendingFen, setEnginePendingFen] = useState<string | null>(null);
  const { analysis, analyzeFen, stopAnalysis } = useStockfish();

  useEffect(() => {
    const columnElement = boardColumnRef.current;
    if (!columnElement) {
      return;
    }

    const update = () => {
      const rect = columnElement.getBoundingClientRect();
      const availableHeight = Math.max(260, Math.floor(window.innerHeight - rect.top - 72));
      const availableWidth = Math.max(260, Math.floor(columnElement.clientWidth));
      setBoardWidth(Math.max(260, Math.min(920, availableWidth, availableHeight)));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(columnElement);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (!enginePendingFen || analysis.thinking || !analysis.bestMove) {
      return;
    }

    const bestMove = analysis.bestMove;
    const move = gameRef.current.move({
      from: bestMove.slice(0, 2),
      to: bestMove.slice(2, 4),
      promotion: bestMove[4] || "q",
    });

    if (!move) {
      return;
    }

    setFen(gameRef.current.fen());
    setMoves((current) => [...current, move.san]);
    setEnginePendingFen(null);
    setStatus(gameRef.current.isGameOver() ? "Game over" : "Your move");
  }, [analysis.bestMove, analysis.thinking, enginePendingFen]);

  const evalText = useMemo(() => {
    if (analysis.scoreMate !== null) {
      return `Mate ${analysis.scoreMate}`;
    }
    if (analysis.scoreCp !== null) {
      return (analysis.scoreCp / 100).toFixed(2);
    }
    return "--";
  }, [analysis.scoreCp, analysis.scoreMate]);

  function onPieceDrop(sourceSquare: string, targetSquare: string) {
    const move = gameRef.current.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
    if (!move) {
      return false;
    }

    setFen(gameRef.current.fen());
    setMoves((current) => [...current, move.san]);

    if (gameRef.current.isGameOver()) {
      setStatus("Game over");
      return true;
    }

    const nextFen = gameRef.current.fen();
    setEnginePendingFen(nextFen);
    setStatus("Stockfish is thinking...");
    analyzeFen(nextFen, 12);
    return true;
  }

  return (
    <main className="page-shell game-page-shell">
      <div className="topbar">
        <div>
          <div className="section-eyebrow">Play vs Computer</div>
          <div className="topbar-title">Stockfish</div>
        </div>
        <div className="topbar-actions">
          <a className="ghost link-button" href="/">
            Back to lobby
          </a>
        </div>
      </div>

      <section className="game-layout page-game-layout">
        <aside className="stack game-meta-column">
          <div className="panel game-summary-card">
            <div className="section-eyebrow">Game</div>
            <div className="game-summary-title">Local computer game</div>
            <div className="game-summary-line">Mode: Casual only</div>
            <div className="game-summary-line">Time control: {parseTimeControl(timeControl).label}</div>
            <div className="game-summary-line emphasis-text">{status}</div>
          </div>

          <div className="panel compact-side-panel">
            <div className="panel-heading">
              <h2>Analysis</h2>
              <span className="panel-hint">Runs in your browser</span>
            </div>
            <div className="compact-table-box">
              <div><strong>Eval:</strong> {evalText}</div>
              <div><strong>Depth:</strong> {analysis.depth}</div>
              <div><strong>Best move:</strong> <span className="mono">{analysis.bestMove || "--"}</span></div>
            </div>
            <div className="button-row top-gap">
              <button className="ghost small-button" onClick={() => analyzeFen(fen, 12)}>
                Analyze position
              </button>
              <button className="ghost small-button" onClick={stopAnalysis}>
                Stop
              </button>
            </div>
          </div>
        </aside>

        <div className="board-column" ref={boardColumnRef}>
          <div className="board-wrap clean-board-wrap">
            <div className="board-stage">
              <Chessboard
                id="stockfish-board"
                position={fen}
                boardWidth={boardWidth}
                boardOrientation="white"
                arePiecesDraggable={!analysis.thinking && !gameRef.current.isGameOver()}
                onPieceDrop={onPieceDrop}
                customDarkSquareStyle={{ backgroundColor: "#8754a0" }}
                customLightSquareStyle={{ backgroundColor: "#a99aba" }}
              />
            </div>
          </div>
        </div>

        <aside className="stack game-rail">
          <div className="player-card top active">
            <div className="player-card-head">
              <div className="player-card-name-row">
                <span className="presence-dot" />
                <span className="player-card-title">Stockfish</span>
                <span className="player-card-rating">BOT</span>
              </div>
            </div>
            <div className="rail-clock">{formatClock(engineTime)}</div>
          </div>

          <div className="panel notation-panel">
            <div className="notation-header">
              <span className="panel-hint">Moves</span>
              <span className="panel-hint mono">Local</span>
            </div>
            <div className="notation-table">
              {moves.length === 0 ? <div className="empty-state subtle">No moves yet.</div> : null}
              {moves.map((move, index) => (
                <div className="notation-row" key={`${move}-${index}`}>
                  <div className="notation-index">{index + 1}</div>
                  <div className="notation-move" style={{ gridColumn: "span 2" }}>{move}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="player-card bottom">
            <div className="player-card-head">
              <div className="player-card-name-row">
                <span className="presence-dot" />
                <span className="player-card-title">You</span>
              </div>
            </div>
            <div className="rail-clock">{formatClock(playerTime)}</div>
          </div>
        </aside>
      </section>
    </main>
  );
}
