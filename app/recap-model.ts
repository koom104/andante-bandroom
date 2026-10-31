export type RecapCover = {
  track_id: number; track_name: string; artist_name: string; artwork_url: string; track_url: string;
};

const normalizedSongName = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
// Confirmed localized titles only; automatic matching still requires the original artist.
const localizedSongs = [
  { names: ["히치콕"], titles: ["ヒッチコック", "Hitchcock"], artists: ["ヨルシカ", "Yorushika"], koreanArtists: ["요루시카"] },
  { names: ["친애하는 소년이여"], titles: ["拝啓、少年よ", "Haikei Shounenyo"], artists: ["Hump Back"], koreanArtists: ["험프백", "헴프백"] },
  { names: ["스키다카라"], titles: ["好きだから。", "Sukidakara"], artists: ["『ユイカ』", "Yuika"], koreanArtists: ["유이카"] },
  { names: ["예뻤어"], titles: ["You Were Beautiful", "예뻤어"], artists: ["DAY6"], koreanArtists: ["데이식스"] },
  { names: ["밤편지"], titles: ["Through the Night", "밤편지"], artists: ["IU"], koreanArtists: ["아이유"] },
];
function localizedSong(query: string) {
  const key = normalizedSongName(query);
  return localizedSongs.find((song) => song.names.some((name) => {
    const title = normalizedSongName(name);
    return key === title || [...song.artists, ...song.koreanArtists].some((artist) =>
      key === title + normalizedSongName(artist) || key === normalizedSongName(artist) + title);
  }));
}

export function recapAlbumSearchParams(query: string): URLSearchParams {
  const alias = localizedSong(query);
  const term = (alias ? `${alias.titles[0]} ${alias.artists[0]}` : query.trim().normalize("NFKC")).slice(0, 120);
  const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u.test(term);
  const params = new URLSearchParams({ term, country: japanese ? "JP" : "US", entity: "song", limit: "8" });
  if (japanese) params.set("lang", "ja_jp");
  return params;
}
export type RecapTeam = {
  team_id: string; team_name: string; minutes: number; sessions: number;
  first_date: string; last_date: string; goals: string[]; cover: RecapCover | null;
};
export type RecapData = {
  count_from_date: string; years: number[]; total_minutes: number; sessions: number; active_days: number;
  teams: RecapTeam[]; months: Array<{ month: string; minutes: number }>;
  goals?: Array<{ name: string; minutes: number; sessions: number }>;
  historical_sessions?: number;
};
export type RecapSession = {
  booking_id: string; booking_date: string; start_time: string; duration: number;
  participated_minutes: number; purpose: string; booking_location: string;
};

export type StoryPage = { kind: "goals" | "songs"; offset: number; count: number };
export function storyTrackLayout(count: number, index: number) {
  const step = Math.min(300, 1270 / Math.max(1, count));
  const roomy = step >= 210;
  const artSize = Math.max(64, Math.min(160, step - 48));
  const y = 378 + index * step;
  const cardY = y - 2, cardHeight = step - 10;
  const textX = 154 + artSize + 26;
  const timeWidth = 192, timeRight = 1008;
  const textWidth = roomy ? timeRight - textX : timeRight - timeWidth - 28 - textX;
  const centerY = cardY + cardHeight / 2;
  return { step, roomy, artSize, y, cardY, cardHeight,
    artY: cardY + (cardHeight - artSize) / 2,
    numberY: centerY + (roomy ? 17 : 11),
    contentY: y + (roomy ? Math.max(0, (cardHeight - 212) / 2) : 0),
    textX, textWidth, timeWidth, timeRight,
    titleY: centerY - 3, subtitleY: centerY + 22, durationY: centerY + 9,
    meterY: cardY + cardHeight - 13 };
}
export function mostRehearsedSong(teams: RecapTeam[]): RecapTeam | null {
  return recapBackgroundSongs(teams)[0] ?? null;
}
export function recapBackgroundSongs(teams: RecapTeam[]): RecapTeam[] {
  const songs = new Map<string, RecapTeam>();
  for (const team of teams) {
    const key = team.team_name.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
    const previous = songs.get(key);
    songs.set(key, previous ? { ...previous, minutes: previous.minutes + team.minutes, sessions: previous.sessions + team.sessions, cover: previous.cover ?? team.cover } : { ...team });
  }
  return [...songs.values()].sort((a, b) => b.minutes - a.minutes);
}
export function recapBackgroundSong(teams: RecapTeam[], teamId: string | null = null): RecapTeam | null {
  const songs = recapBackgroundSongs(teams);
  return songs.find((song) => song.team_id === teamId) ?? songs[0] ?? null;
}
export function recapStoryTheme(teams: Pick<RecapTeam, "goals">[]) {
  const counts = new Map<string, number>();
  for (const team of teams) for (const goal of new Set(team.goals)) counts.set(goal, (counts.get(goal) ?? 0) + 1);
  const goal = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
  const palettes = ["#d8eee0", "#f7d9cf", "#dce9f5", "#eadff4", "#f4dce8"];
  let index = [...goal].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % palettes.length;
  if (/여름/.test(goal)) index = 0;
  else if (/가을|축제/.test(goal)) index = 1;
  else if (/겨울/.test(goal)) index = 2;
  else if (/동연/.test(goal)) index = 3;
  else if (/봄/.test(goal)) index = 4;
  return { goal, background: palettes[index], ink: "#202b35", secondary: "#52606a", accent: "#265e53" };
}
export function recapStoryPages(data: Pick<RecapData, "teams" | "goals">): StoryPage[] {
  return [
    ...Array.from({ length: Math.max(1, Math.ceil((data.goals?.length ?? 0) / 8)) }, (_, i) => ({ kind: "goals" as const, offset: i * 8, count: 8 })),
    ...Array.from({ length: Math.max(1, Math.ceil(data.teams.length / 14)) }, (_, i) => ({ kind: "songs" as const, offset: i * 14, count: 14 })),
  ];
}

export function formatRecapMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return `${hours > 0 ? `${hours}시간` : ""}${remainder > 0 ? `${hours > 0 ? " " : ""}${remainder}분` : ""}` || "0분";
}

export function isCoverUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && /^is\d+(-ssl)?\.mzstatic\.com$/.test(u.hostname)
      && !u.username && !u.password && !u.port;
  } catch { return false; }
}

export function isTrackUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && ["music.apple.com", "itunes.apple.com"].includes(u.hostname)
      && !u.username && !u.password && !u.port;
  } catch { return false; }
}

export function parseAlbumMatches(raw: unknown): RecapCover[] {
  if (!raw || typeof raw !== "object" || !("results" in raw) || !Array.isArray(raw.results)) return [];
  return raw.results.slice(0, 8).flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    if (r.kind !== "song" || typeof r.trackId !== "number" || !Number.isSafeInteger(r.trackId) || r.trackId <= 0
      || typeof r.trackName !== "string" || !r.trackName || r.trackName.length > 200
      || typeof r.artistName !== "string" || !r.artistName || r.artistName.length > 200
      || !isCoverUrl(r.artworkUrl100) || !isTrackUrl(r.trackViewUrl)) return [];
    return [{ track_id: r.trackId, track_name: r.trackName, artist_name: r.artistName,
      artwork_url: r.artworkUrl100.replace(/\/100x100bb\.(jpg|png)$/, "/400x400bb.$1"), track_url: r.trackViewUrl }];
  });
}

export function pickAutomaticCover(name: string, matches: RecapCover[]): RecapCover | null {
  const normalize = normalizedSongName;
  const alias = localizedSong(name);
  if (alias) {
    const titles = new Set(alias.titles.map(normalize));
    const artists = new Set(alias.artists.map(normalize));
    return matches.find((match) => titles.has(normalize(match.track_name)) && artists.has(normalize(match.artist_name))) ?? null;
  }
  const title = normalize(name);
  if (!title) return null;
  const exact = matches.filter((match) => normalize(match.track_name) === title);
  if (!exact.length) return null;
  // Prefer an exact title at the provider's top rank; otherwise avoid ambiguous artists.
  if (matches[0] !== exact[0] && new Set(exact.map((match) => normalize(match.artist_name))).size !== 1) return null;
  return exact[0];
}

export function recapMonths(months: RecapData["months"], year: number | null) {
  const totals = new Map<string, number>();
  for (const item of months) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month) || !Number.isFinite(item.minutes) || item.minutes <= 0) continue;
    if (year !== null && Number(item.month.slice(0, 4)) !== year) continue;
    totals.set(item.month, (totals.get(item.month) ?? 0) + item.minutes);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([month, minutes]) => ({ month, minutes }));
}

// Personal data stays in memory, scoped by account and date; concurrent opens share one request.
export function createRecapLoader<T>(fetcher: (userId: string, year: number | null) => Promise<T>, ttl = 300_000) {
  const cache = new Map<string, { promise: Promise<T>; expires: number }>();
  return (userId: string, year: number | null, force = false): Promise<T> => {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${userId}:${year ?? "all"}:${day}`;
    const previous = cache.get(key);
    if (!force && previous && previous.expires > Date.now()) return previous.promise;
    const promise = Promise.resolve().then(() => fetcher(userId, year));
    const entry = { promise, expires: Date.now() + ttl };
    cache.set(key, entry);
    while (cache.size > 12) cache.delete(cache.keys().next().value!);
    void promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    return promise;
  };
}
