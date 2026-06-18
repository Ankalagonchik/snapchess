"use client";

import { useEffect, useRef, useState } from "react";

type AnalysisState = {
  ready: boolean;
  thinking: boolean;
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
  bestMove: string | null;
  pv: string[];
};

const INITIAL_STATE: AnalysisState = {
  ready: false,
  thinking: false,
  depth: 0,
  scoreCp: null,
  scoreMate: null,
  bestMove: null,
  pv: [],
};

export type StockfishResult = {
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
  bestMove: string | null;
  pv: string[];
};

export function useStockfish() {
  const workerRef = useRef<Worker | null>(null);
  const latestRef = useRef<AnalysisState>(INITIAL_STATE);
  const pendingRef = useRef<{
    resolve: (value: StockfishResult) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>(INITIAL_STATE);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const worker = new Worker("/stockfish/stockfish-18-lite-single.js");
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<string>) => {
      const message = event.data;

      if (message === "uciok" || message === "readyok") {
        setAnalysis((state) => {
          const next = { ...state, ready: true };
          latestRef.current = next;
          return next;
        });
        return;
      }

      if (message.startsWith("info depth ")) {
        const depthMatch = message.match(/depth\s+(\d+)/);
        const cpMatch = message.match(/score cp\s+(-?\d+)/);
        const mateMatch = message.match(/score mate\s+(-?\d+)/);
        const pvMatch = message.match(/ pv\s+(.+)$/);

        setAnalysis((state) => {
          const next = {
            ...state,
            depth: depthMatch ? Number(depthMatch[1]) : state.depth,
            scoreCp: cpMatch ? Number(cpMatch[1]) : state.scoreCp,
            scoreMate: mateMatch ? Number(mateMatch[1]) : state.scoreMate,
            pv: pvMatch ? pvMatch[1].trim().split(/\s+/) : state.pv,
          };
          latestRef.current = next;
          return next;
        });
        return;
      }

      if (message.startsWith("bestmove ")) {
        const bestMove = message.split(" ")[1] || null;
        setAnalysis((state) => {
          const next = {
            ...state,
            thinking: false,
            bestMove,
          };
          latestRef.current = next;
          return next;
        });

        if (pendingRef.current) {
          pendingRef.current.resolve({
            depth: latestRef.current.depth,
            scoreCp: latestRef.current.scoreCp,
            scoreMate: latestRef.current.scoreMate,
            bestMove,
            pv: latestRef.current.pv,
          });
          pendingRef.current = null;
        }
      }
    };

    worker.postMessage("uci");
    worker.postMessage("setoption name Threads value 1");
    worker.postMessage("setoption name MultiPV value 1");
    worker.postMessage("isready");

    return () => {
      worker.postMessage("quit");
      worker.terminate();
      workerRef.current = null;
      if (pendingRef.current) {
        pendingRef.current.reject(new Error("Stockfish worker terminated."));
        pendingRef.current = null;
      }
    };
  }, []);

  function analyzeFen(fen: string, depth = 12) {
    if (!workerRef.current) {
      return;
    }

    setAnalysis((state) => ({
      ...state,
      thinking: true,
      depth: 0,
      scoreCp: null,
      scoreMate: null,
      bestMove: null,
      pv: [],
    }));
    latestRef.current = {
      ...latestRef.current,
      thinking: true,
      depth: 0,
      scoreCp: null,
      scoreMate: null,
      bestMove: null,
      pv: [],
    };

    workerRef.current.postMessage("stop");
    workerRef.current.postMessage("ucinewgame");
    workerRef.current.postMessage(`position fen ${fen}`);
    workerRef.current.postMessage(`go depth ${depth}`);
  }

  function analyzeFenOnce(fen: string, depth = 12) {
    if (!workerRef.current) {
      return Promise.reject(new Error("Stockfish worker is not ready."));
    }

    if (pendingRef.current) {
      pendingRef.current.reject(new Error("Previous Stockfish request interrupted."));
      pendingRef.current = null;
    }

    analyzeFen(fen, depth);

    return new Promise<StockfishResult>((resolve, reject) => {
      pendingRef.current = { resolve, reject };
    });
  }

  function stopAnalysis() {
    if (!workerRef.current) {
      return;
    }
    workerRef.current.postMessage("stop");
    setAnalysis((state) => ({ ...state, thinking: false }));
    latestRef.current = { ...latestRef.current, thinking: false };
    if (pendingRef.current) {
      pendingRef.current.reject(new Error("Stockfish analysis stopped."));
      pendingRef.current = null;
    }
  }

  return {
    analysis,
    analyzeFen,
    analyzeFenOnce,
    stopAnalysis,
  };
}
