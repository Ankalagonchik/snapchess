import { promises as fs } from "fs";
import path from "path";

import { hasSupabase, supabase } from "@/lib/supabase";
import type { AppState } from "@/lib/types";

function resolveDataDir() {
  if (process.env.SNAPCHESS_DATA_DIR) {
    return process.env.SNAPCHESS_DATA_DIR;
  }

  if (process.env.VERCEL) {
    return path.join("/tmp", "snapchess-data");
  }

  return path.join(process.cwd(), "data");
}

const DATA_DIR = resolveDataDir();
const STATE_FILE = path.join(DATA_DIR, "snapchess-state.json");

const EMPTY_STATE: AppState = {
  challenges: [],
  games: [],
  players: [],
};

let writeQueue: Promise<unknown> = Promise.resolve();

const SUPABASE_STATE_KEY = "app-state";

async function ensureStateFile() {
  if (hasSupabase) {
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STATE_FILE);
  } catch {
    await fs.writeFile(STATE_FILE, JSON.stringify(EMPTY_STATE, null, 2), "utf8");
  }
}

export async function readState(): Promise<AppState> {
  if (hasSupabase && supabase) {
    const { data, error } = await supabase
      .from("snapchess_state")
      .select("value")
      .eq("key", SUPABASE_STATE_KEY)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase read failed: ${error.message}`);
    }

    const parsed = (data?.value as AppState | null) ?? EMPTY_STATE;
    return {
      challenges: parsed.challenges ?? [],
      games: (parsed.games ?? []).map((game) => ({
        ...game,
        rated: game.rated ?? true,
      })),
      players: parsed.players ?? [],
    };
  }

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
  if (hasSupabase && supabase) {
    const { error } = await supabase.from("snapchess_state").upsert(
      {
        key: SUPABASE_STATE_KEY,
        value: nextState,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

    if (error) {
      throw new Error(`Supabase write failed: ${error.message}`);
    }

    return;
  }

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
