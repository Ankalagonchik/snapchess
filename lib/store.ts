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

function normalizeState(parsed: AppState): AppState {
  return {
    challenges: parsed.challenges ?? [],
    games: (parsed.games ?? []).map((game) => ({
      ...game,
      rated: game.rated ?? true,
    })),
    players: parsed.players ?? [],
  };
}

async function readSupabaseStateRecord() {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("snapchess_state")
    .select("value, updated_at")
    .eq("key", SUPABASE_STATE_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase read failed: ${error.message}`);
  }

  return data as { value: AppState; updated_at: string } | null;
}

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
    const record = await readSupabaseStateRecord();
    return normalizeState(record?.value ?? EMPTY_STATE);
  }

  await ensureStateFile();
  const raw = await fs.readFile(STATE_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw) as AppState;
    return normalizeState(parsed);
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
  if (hasSupabase && supabase) {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const record = await readSupabaseStateRecord();
      const current = normalizeState(record?.value ?? EMPTY_STATE);
      const beforeJson = JSON.stringify(current);
      const result = await mutator(current);
      const afterJson = JSON.stringify(current);

      if (beforeJson === afterJson) {
        return result;
      }

      const nextUpdatedAt = new Date().toISOString();

      if (!record) {
        const { error } = await supabase.from("snapchess_state").insert({
          key: SUPABASE_STATE_KEY,
          value: current,
          updated_at: nextUpdatedAt,
        });

        if (!error) {
          return result;
        }

        lastError = new Error(`Supabase insert failed: ${error.message}`);
        continue;
      }

      const { data, error } = await supabase
        .from("snapchess_state")
        .update({
          value: current,
          updated_at: nextUpdatedAt,
        })
        .eq("key", SUPABASE_STATE_KEY)
        .eq("updated_at", record.updated_at)
        .select("updated_at");

      if (error) {
        lastError = new Error(`Supabase update failed: ${error.message}`);
        continue;
      }

      if (data && data.length > 0) {
        return result;
      }

      lastError = new Error("Supabase state write conflicted with another request.");
    }

    throw lastError ?? new Error("Supabase state mutation failed.");
  }

  const resultPromise = writeQueue.then(async () => {
    const current = await readState();
    const beforeJson = JSON.stringify(current);
    const result = await mutator(current);
    const afterJson = JSON.stringify(current);
    if (beforeJson === afterJson) {
      return result;
    }
    await writeState(current);
    return result;
  });

  writeQueue = resultPromise.then(
    () => undefined,
    () => undefined,
  );

  return resultPromise;
}
