import { promises as fs } from "fs";
import path from "path";

import type { AppState } from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "snapchess-state.json");

const EMPTY_STATE: AppState = {
  challenges: [],
  games: [],
  players: [],
};

let writeQueue: Promise<unknown> = Promise.resolve();

async function ensureStateFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STATE_FILE);
  } catch {
    await fs.writeFile(STATE_FILE, JSON.stringify(EMPTY_STATE, null, 2), "utf8");
  }
}

export async function readState(): Promise<AppState> {
  await ensureStateFile();
  const raw = await fs.readFile(STATE_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw) as AppState;
    return {
      challenges: parsed.challenges ?? [],
      games: (parsed.games ?? []).map((game) => ({
        ...game,
        rated: game.rated ?? true,
      })),
      players: parsed.players ?? [],
    };
  } catch {
    return EMPTY_STATE;
  }
}

export async function writeState(nextState: AppState) {
  await ensureStateFile();
  await fs.writeFile(STATE_FILE, JSON.stringify(nextState, null, 2), "utf8");
}

export async function mutateState<T>(mutator: (state: AppState) => Promise<T> | T): Promise<T> {
  const resultPromise = writeQueue.then(async () => {
    const current = await readState();
    const result = await mutator(current);
    await writeState(current);
    return result;
  });

  writeQueue = resultPromise.then(
    () => undefined,
    () => undefined,
  );

  return resultPromise;
}
