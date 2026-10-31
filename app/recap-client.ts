import { supabase } from "./supabase";
import { createRecapLoader, parseAlbumMatches, pickAutomaticCover, recapAlbumSearchParams, type RecapData, type RecapCover, type RecapSession } from "./recap-model";

function errorMessage(error: { message?: string; code?: string }) {
  if (error.code === "PGRST202" || error.code === "42P01" || error.code === "PGRST205") {
    return "리캡 준비가 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.";
  }
  return "기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export const loadRecap = createRecapLoader(async (_userId, year) => {
  const { data, error } = await supabase.rpc("get_my_rehearsal_recap", { p_year: year });
  if (error) throw new Error(errorMessage(error));
  return data as RecapData;
});

export async function loadRecapSessions(teamId: string, year: number | null, offset: number) {
  const { data, error } = await supabase.rpc("get_my_team_rehearsal_sessions", {
    p_team_id: teamId, p_year: year, p_offset: offset,
  });
  if (error) throw new Error(errorMessage(error));
  return data as RecapSession[];
}

export async function saveRecapCover(userId: string, teamId: string, cover: RecapCover) {
  const { error } = await supabase.from("member_recap_covers").upsert({ user_id: userId, team_id: teamId, ...cover });
  if (error) throw new Error(errorMessage(error));
}

const searches = new Map<string, RecapCover[]>();
const automatic = new Map<string, Promise<RecapCover | null>>();
let searchQueue: Promise<unknown> = Promise.resolve();
export function automaticRecapCover(name: string): Promise<RecapCover | null> {
  const term = name.trim().slice(0, 120);
  if (!term) return Promise.resolve(null);
  const cached = automatic.get(term);
  if (cached) return cached;
  const pending = searchQueue.then(async () => {
    const delay = Math.max(0, 3300 - (Date.now() - lastSearchAt));
    if (delay && !searches.has(term)) await new Promise((resolve) => setTimeout(resolve, delay));
    const matches = await searchRecapCovers(term, new AbortController().signal);
    return pickAutomaticCover(term, matches);
  }).catch(() => { automatic.delete(term); return null; });
  automatic.set(term, pending);
  while (automatic.size > 100) automatic.delete(automatic.keys().next().value!);
  searchQueue = pending;
  return pending;
}
let lastSearchAt = 0;
export async function searchRecapCovers(query: string, signal: AbortSignal) {
  const term = query.trim().slice(0, 120);
  if (!term) return [];
  if (searches.has(term)) return searches.get(term)!;
  if (Date.now() - lastSearchAt < 1200) throw new Error("잠시 후 다시 검색해 주세요.");
  lastSearchAt = Date.now();
  const params = recapAlbumSearchParams(term);
  // Album searches go directly to Apple; they use no Worker CPU or database bandwidth.
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(cancel, 10_000);
  try {
    const response = await fetch(`https://itunes.apple.com/search?${params}`, {
      signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("음악 검색에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    const results = parseAlbumMatches(await response.json());
    searches.set(term, results);
    while (searches.size > 24) searches.delete(searches.keys().next().value!);
    return results;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}
