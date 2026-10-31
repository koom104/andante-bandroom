"use client";
import "./recap.css";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUpRight, CalendarDays, Check, Disc3, ImagePlus, LoaderCircle, Maximize2, Music2, RefreshCw, Search, Users, X } from "lucide-react";
import RecapStoryPanel from "./recap-story-panel";
import { LoadingStatus } from "./loading-state";
import { automaticRecapCover, loadRecap, loadRecapSessions, saveRecapCover, searchRecapCovers } from "./recap-client";
import { formatRecapMinutes, isCoverUrl, isTrackUrl, recapMonths, type RecapCover, type RecapData, type RecapSession, type RecapTeam } from "./recap-model";

const currentYear = () => Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Seoul" }).format(new Date()));
const message = (error: unknown) => error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.";
const shortDate = (date: string) => date.replaceAll("-", ".");

function AlbumArt({ cover, name, index = 0, onAutomatic }: { cover: RecapCover | null; name: string; index?: number; onAutomatic?: (cover: RecapCover) => void }) {
  const [failed, setFailed] = useState("");
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (cover || !onAutomatic || !container.current) return;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void automaticRecapCover(name).then((match) => { if (active && match) onAutomatic(match); });
    }, { rootMargin: "120px" });
    observer.observe(container.current);
    return () => { active = false; observer.disconnect(); };
  }, [cover, name, onAutomatic]);
  let content: ReactNode;
  if (cover && isCoverUrl(cover.artwork_url) && failed !== cover.artwork_url) {
    content = <img className="recap-art" src={cover.artwork_url} alt={`${cover.track_name} 앨범 커버`} width={400} height={400}
      loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(cover.artwork_url)} />;
  } else content = <div className={`recap-art recap-art-fallback recap-tone-${index % 4}`} aria-label={`${name} 커버 미연결`}>
    <Music2 size={28} aria-hidden="true" />
  </div>;
  return <div className="recap-art-slot" ref={container}>{content}</div>;
}

export default function RecapTab({ userId, name }: { userId: string; name: string }) {
  const [year, setYear] = useState<number | null>(currentYear);
  const [view, setView] = useState<"story" | "details">("story");
  const [data, setData] = useState<RecapData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<{ kind: "sessions" | "cover"; team: RecapTeam } | null>(null);
  const [storyData, setStoryData] = useState<RecapData | null>(null);
  const [backgroundTeamId, setBackgroundTeamId] = useState<string | null>(null);
  const acceptAutomatic = useCallback((teamId: string, cover: RecapCover) => {
    setData((current) => current ? { ...current, teams: current.teams.map((team) => team.team_id === teamId && !team.cover ? { ...team, cover } : team) } : current);
  }, []);
  const requestId = useRef(0);
  async function refresh(force = false) {
    const id = ++requestId.current;
    try {
      const next = await loadRecap(userId, year, force);
      if (requestId.current === id) setData(next);
    } catch (err) {
      if (requestId.current === id) setError(message(err));
    } finally {
      if (requestId.current === id) setIsLoading(false);
    }
  }
  useEffect(() => {
    const id = ++requestId.current;
    loadRecap(userId, year).then((next) => {
      if (requestId.current === id) setData(next);
    }).catch((err) => {
      if (requestId.current === id) setError(message(err));
    }).finally(() => {
      if (requestId.current === id) setIsLoading(false);
    });
    return () => { requestId.current += 1; };
  }, [userId, year]);

  function manualRefresh() {
    setIsLoading(true); setError(""); void refresh(true);
  }

  const top = data?.teams[0];
  const months = recapMonths(data?.months ?? [], year);
  const maxMonth = Math.max(1, ...months.map((m) => m.minutes));
  const years = [...new Set([currentYear(), ...(data?.years ?? [])])].sort((a, b) => b - a);

  async function connectCover(teamId: string, cover: RecapCover) {
    await saveRecapCover(userId, teamId, cover);
    const next = await loadRecap(userId, year, true);
    setData(next);
    setModal(null);
  }

  return <div className={`recap-page ${view === "story" ? "recap-summary-page" : ""}`}
    style={{ "--recap-cover": top?.cover && isCoverUrl(top.cover.artwork_url) ? `url("${top.cover.artwork_url}")` : "none" } as CSSProperties}>
    <div className="recap-toolbar">
      <div className="recap-view-toggle" role="group" aria-label="리캡 보기">
        <button type="button" aria-pressed={view === "story"} onClick={() => setView("story")}>스토리</button>
        <button type="button" aria-pressed={view === "details"} onClick={() => setView("details")}>상세 기록</button>
      </div>
      <div className="recap-toolbar-actions">
        <label className="recap-period"><span className="sr-only">리캡 기간</span>
          <select value={year ?? "all"} disabled={isLoading} onChange={(event) => {
            setData(null); setModal(null); setBackgroundTeamId(null); setError(""); setIsLoading(true); setYear(event.target.value === "all" ? null : Number(event.target.value));
          }}>
            {years.map((y) => <option key={y} value={y}>{y}년</option>)}
            <option value="all">전체 기록</option>
          </select>
        </label>
        <button type="button" className="recap-icon-button" disabled={isLoading} title="리캡 새로고침" aria-label="리캡 새로고침" onClick={manualRefresh}>
          <RefreshCw size={18} className={isLoading ? "recap-loading" : ""} />
        </button>
        <button type="button" className="recap-icon-button" disabled={isLoading || !data?.teams.length || Boolean(error)} title="스토리 크게 보기" aria-label="스토리 크게 보기" onClick={() => setStoryData(data)}><Maximize2 size={18} /></button>
      </div>
    </div>

    {error ? <div className="recap-state" role="alert"><Disc3 size={38} /><h2>기록을 불러오지 못했어요</h2><p>{error}</p>
      <button className="recap-primary" type="button" onClick={manualRefresh}>다시 시도</button></div>
      : isLoading ? <div className="recap-state"><LoadingStatus label="합주 기록을 모으고 있어요." /></div>
      : data && data.teams.length === 0 ? <div className="recap-state"><Disc3 size={52} /><h1>{name}님의 첫 트랙을 기다려요</h1>
        <p>{year ? `${year}년` : "집계 기간"}에 기록된 합주 참여 내역이 없습니다.</p><p>리캡은 오늘 이전 합주와 예약 당시 시간표를 기준으로 집계됩니다.</p></div>
      : data && view === "story" ? <section className="recap-summary-body" aria-label="합주 리캡 스토리">
        <RecapStoryPanel key={`${userId}:${year}:${data.total_minutes}`} data={data} name={name} year={year} backgroundTeamId={backgroundTeamId} onBackgroundChange={setBackgroundTeamId} />
      </section> : data && <>
        <section className="recap-hero" aria-labelledby="recap-title">
          <div className="recap-hero-copy">
            <p className="recap-kicker">{year ? `${year} REHEARSAL ARCHIVE` : "YOUR REHEARSAL ARCHIVE"}</p>
            <h1 id="recap-title">{name}님과<br />함께 쌓은 시간.</h1>
            <div className="recap-big-number"><strong>{Math.floor(data.total_minutes / 60).toLocaleString()}</strong><span>시간{data.total_minutes % 60 ? ` ${data.total_minutes % 60}분` : ""}</span></div>
            <p className="recap-hero-caption">{data.teams.length}개의 팀, {data.sessions}번의 합주.<br />우리의 연주가 기록이 되었어요.</p>
            <a className="recap-jump" href="#recap-teams">내 합주 트랙 <ArrowDown size={16} aria-hidden="true" /></a>
          </div>
          {top && <div className="recap-featured">
            <p className="recap-kicker">가장 오래 함께한 팀 · 01</p>
            <div className="recap-featured-art"><AlbumArt cover={top.cover} name={top.team_name} onAutomatic={(cover) => acceptAutomatic(top.team_id, cover)} /></div>
            <h2>{top.team_name}</h2><p>{formatRecapMinutes(top.minutes)} · {top.sessions}회</p>
            {top.cover && isTrackUrl(top.cover.track_url) && <a className="recap-source" href={top.cover.track_url} target="_blank" rel="noopener noreferrer">{top.cover.artist_name} · Apple Music <ArrowUpRight size={13} /></a>}
          </div>}
        </section>

        <div className="recap-stats">
          <div><Users size={18} /><span>함께한 팀</span><strong>{data.teams.length}<small>팀</small></strong></div>
          <div><Disc3 size={18} /><span>합주 세션</span><strong>{data.sessions}<small>회</small></strong></div>
          <div><CalendarDays size={18} /><span>연주한 날</span><strong>{data.active_days}<small>일</small></strong></div>
        </div>

        <section className="recap-months" aria-labelledby="recap-months-title">
          <div className="recap-section-heading"><div><p className="recap-kicker">YOUR REHEARSAL HOURS</p><h2 id="recap-months-title">월별 합주 시간</h2></div><span>{year ? `${year}년 1~12월 · 활동한 달만` : "전체 연도 · 활동한 달만"}</span></div>
          <div className="recap-chart" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(12, months.length))}, minmax(0, 1fr))` }}>
            {months.map((m) => <div className="recap-chart-column" key={m.month} title={`${m.month} · ${formatRecapMinutes(m.minutes)}`}>
              <div className="recap-chart-track"><div className={`recap-chart-bar ${m.minutes === maxMonth ? "recap-chart-peak" : ""}`}
                role="img" aria-label={`${m.month} ${formatRecapMinutes(m.minutes)}`} style={{ height: `${m.minutes ? Math.max(4, m.minutes / maxMonth * 100) : 2}%` }} /></div>
              <span>{year === null ? `${m.month.slice(0, 4)}.${Number(m.month.slice(5))}` : `${Number(m.month.slice(5))}월`}</span>
            </div>)}
          </div>
        </section>

        <section className="recap-teams" id="recap-teams" aria-labelledby="recap-teams-title">
          <div className="recap-section-heading"><div><p className="recap-kicker">YOUR SETLIST</p><h2 id="recap-teams-title">함께한 모든 팀</h2></div><span>{data.teams.length} TRACKS</span></div>
          <div className="recap-team-grid">
            {data.teams.map((team, index) => <article className="recap-team-card" key={team.team_id}>
              <div className="recap-track-number">{String(index + 1).padStart(2, "0")} <span>{team.sessions}회 합주</span></div>
              <div className="recap-team-main"><div className="recap-team-cover"><AlbumArt cover={team.cover} name={team.team_name} index={index} onAutomatic={(cover) => acceptAutomatic(team.team_id, cover)} /></div>
                <div className="recap-team-copy"><h3>{team.team_name}</h3><p>{team.goals.join(" · ")}</p><strong>{formatRecapMinutes(team.minutes)}</strong>
                  <div className="recap-team-meter" aria-hidden="true"><span style={{ width: `${Math.max(2, team.minutes / (top?.minutes || 1) * 100)}%` }} /></div>
                </div>
              </div>
              {team.cover && isTrackUrl(team.cover.track_url) && <a className="recap-source" href={team.cover.track_url} target="_blank" rel="noopener noreferrer">{team.cover.track_name} · {team.cover.artist_name} <span>Apple Music <ArrowUpRight size={12} /></span></a>}
              <div className="recap-team-actions"><button type="button" onClick={() => setModal({ kind: "sessions", team })}>합주 기록 <ArrowUpRight size={15} /></button>
                <button type="button" title={`${team.team_name} 커버 ${team.cover ? "변경" : "연결"}`} aria-label={`${team.team_name} 커버 ${team.cover ? "변경" : "연결"}`} onClick={() => setModal({ kind: "cover", team })}><ImagePlus size={17} /><span>커버 {team.cover ? "변경" : "연결"}</span></button></div>
            </article>)}
          </div>
        </section>
        <footer className="recap-footer"><span>ANDANTE / EVERY REHEARSAL COUNTS</span><p>{year ? `${year}년 전체 공연·합주 목표` : "전체 연도·공연·합주 목표"} · 오늘 이전 합주</p>
          <p>예약 당시 시간표에 따른 참여시간 · 누적시간 초기화와 별도 집계</p>
          {!!data.historical_sessions && <p>과거 {data.historical_sessions}건은 노션 예약·셋리스트 기준 참여 시간입니다.</p>}</footer>
      </>}

    {storyData && <RecapDialog title="리캡 스토리" fullscreen onClose={() => setStoryData(null)}><RecapStoryPanel data={storyData} name={name} year={year} backgroundTeamId={backgroundTeamId} onBackgroundChange={setBackgroundTeamId} /></RecapDialog>}
    {modal && <RecapDialog title={modal.kind === "sessions" ? `${modal.team.team_name} 합주 기록` : "곡과 앨범 커버 연결"} onClose={() => setModal(null)}>
      {modal.kind === "sessions" ? <SessionHistory key={`${modal.team.team_id}:${year}`} team={modal.team} year={year} />
        : <CoverSearch key={modal.team.team_id} team={modal.team} onSave={(cover) => connectCover(modal.team.team_id, cover)} />}
    </RecapDialog>}
  </div>;
}

function RecapDialog({ title, children, onClose, fullscreen = false }: { title: string; children: ReactNode; onClose: () => void; fullscreen?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`recap-modal ${fullscreen ? "recap-story-modal" : ""}`} aria-label={title} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="recap-modal-header"><h2>{title}</h2><button type="button" className="recap-icon-button" onClick={onClose} aria-label="닫기" title="닫기"><X size={20} /></button></div>
    {children}
  </dialog>;
}

function SessionHistory({ team, year }: { team: RecapTeam; year: number | null }) {
  const [rows, setRows] = useState<RecapSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canLoadMore, setCanLoadMore] = useState(true);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    loadRecapSessions(team.team_id, year, 0).then((next) => {
      if (active) { setRows(next); setCanLoadMore(next.length === 25); }
    }).catch((err) => { if (active) setError(message(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [team.team_id, year]);
  async function more() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true); setError("");
    try {
      const next = await loadRecapSessions(team.team_id, year, rows.length);
      setRows((current) => [...current, ...next]); setCanLoadMore(next.length === 25);
    } catch (err) { setError(message(err)); }
    finally { pending.current = false; setLoading(false); }
  }
  return <div className="recap-history"><p className="recap-history-total">{formatRecapMinutes(team.minutes)} · {team.sessions}회</p>
    {rows.map((row) => <div className="recap-history-row" key={row.booking_id}><div><strong>{shortDate(row.booking_date)}</strong><p>{row.start_time} · {row.purpose}{row.booking_location === "external" ? " · 외부" : row.booking_location === "notion_history" ? " · 과거 예약 기준" : ""}</p></div><div><strong>{formatRecapMinutes(row.participated_minutes)}</strong><p>내 참여시간</p></div></div>)}
    {error && <p className="recap-error" role="alert">{error}</p>}
    {loading && <LoadingStatus className="recap-status" label="기록을 불러오고 있어요." />}
    {!loading && rows.length < team.sessions && canLoadMore && <button className="recap-secondary" type="button" onClick={() => void more()}>{error ? "다시 시도" : "이전 기록 더 보기"}</button>}
  </div>;
}

function CoverSearch({ team, onSave }: { team: RecapTeam; onSave: (cover: RecapCover) => Promise<void> }) {
  const [query, setQuery] = useState(team.cover ? `${team.cover.track_name} ${team.cover.artist_name}` : team.team_name);
  const [results, setResults] = useState<RecapCover[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function search(event: FormEvent) {
    event.preventDefault();
    if (loading || saving) return;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError("");
    try { setResults(await searchRecapCovers(query, controller.signal)); }
    catch (err) { if (!controller.signal.aborted) setError(message(err)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  async function save(cover: RecapCover) {
    if (saving) return;
    setSaving(cover.track_id); setError("");
    try { await onSave(cover); }
    catch (err) { setError(message(err)); setSaving(null); }
  }
  return <div><p className="recap-status">{team.team_name}</p><form className="recap-search" onSubmit={(event) => void search(event)}>
    <label><span>곡명·아티스트</span><input value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} disabled={saving !== null} /></label>
    <button type="submit" className="recap-icon-button" aria-label="곡 검색" title="곡 검색" disabled={loading || saving !== null || !query.trim()}>{loading ? <LoaderCircle size={20} className="recap-loading" /> : <Search size={20} />}</button>
  </form>
    {error && <p className="recap-error" role="alert">{error}</p>}
    {results?.length === 0 && <p className="recap-status">검색 결과가 없습니다. 곡명과 아티스트를 함께 입력해 주세요.</p>}
    <div className="recap-search-results">{results?.map((cover) => <div className="recap-search-result" key={cover.track_id}>
      <AlbumArt cover={cover} name={cover.track_name} /><div><strong>{cover.track_name}</strong><p>{cover.artist_name}</p><a href={cover.track_url} target="_blank" rel="noopener noreferrer">Apple Music에서 보기 <ArrowUpRight size={12} /></a></div>
      <button type="button" className="recap-icon-button" disabled={saving !== null} aria-label={`${cover.track_name} · ${cover.artist_name} 커버 선택`} title="이 커버 선택" onClick={() => void save(cover)}>{saving === cover.track_id ? <LoaderCircle size={19} className="recap-loading" /> : <Check size={19} />}</button>
    </div>)}</div>
  </div>;
}
