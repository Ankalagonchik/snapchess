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

export function useStockfish() {
  const workerRef = useRef<Worker | null>(null);
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
        setAnalysis((state) => ({ ...state, ready: true }));
        return;
      }

      if (message.startsWith("info depth ")) {
        const depthMatch = message.match(/depth\s+(\d+)/);
        const cpMatch = message.match(/score cp\s+(-?\d+)/);
        const mateMatch = message.match(/score mate\s+(-?\d+)/);
        const pvMatch = message.match(/ pv\s+(.+)$/);

        setAnalysis((state) => ({
          ...state,
          depth: depthMatch ? Number(depthMatch[1]) : state.depth,
          scoreCp: cpMatch ? Number(cpMatch[1]) : state.scoreCp,
          scoreMate: mateMatch ? Number(mateMatch[1]) : state.scoreMate,
          pv: pvMatch ? pvMatch[1].trim().split(/\s+/) : state.pv,
        }));
        return;
      }

      if (message.startsWith("bestmove ")) {
        const bestMove = message.split(" ")[1] || null;
        setAnalysis((state) => ({
          ...state,
          thinking: false,
          bestMove,
        }));
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

    workerRef.current.postMessage("stop");
    workerRef.current.postMessage("ucinewgame");
    workerRef.current.postMessage(`position fen ${fen}`);
    workerRef.current.postMessage(`go depth ${depth}`);
  }

  function stopAnalysis() {
    if (!workerRef.current) {
      return;
    }
    workerRef.current.postMessage("stop");
    setAnalysis((state) => ({ ...state, thinking: false }));
  }

  return {
    analysis,
    analyzeFen,
    stopAnalysis,
  };
}
