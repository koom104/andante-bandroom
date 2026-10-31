"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, ImagePlus, Music2, Share2, X } from "lucide-react";
import { LoadingStatus } from "./loading-state";
import { formatRecapMinutes, isCoverUrl, recapBackgroundSongs, type RecapData } from "./recap-model";
import { createRecapStory, recapStoryPages, type StoryPage } from "./recap-story";
import { automaticRecapCover } from "./recap-client";

export default function RecapStoryPanel({ data, name, year, backgroundTeamId, onBackgroundChange }: {
  data: RecapData; name: string; year: number | null;
  backgroundTeamId: string | null; onBackgroundChange: (teamId: string | null) => void;
}) {
  const [index, setIndex] = useState(0);
  const pages = useMemo(() => recapStoryPages(data), [data]);
  return <div className="recap-story-panel recap-story-deck">
    <div className="recap-story-pagination"><button className="recap-icon-button" type="button" title="이전 장" aria-label="이전 장" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={18} /></button>
      <span>{index + 1} / {pages.length} · {pages[index].kind === "goals" ? "공연별 시간" : "참여 곡"}</span>
      <button className="recap-icon-button" type="button" title="다음 장" aria-label="다음 장" disabled={index === pages.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight size={18} /></button></div>
    <StoryImage key={`${index}:${backgroundTeamId ?? "auto"}`} data={data} name={name} year={year} page={pages[index]} index={index} total={pages.length} backgroundTeamId={backgroundTeamId} onBackgroundChange={onBackgroundChange} />
  </div>;
}

function StoryImage({ data, name, year, page, index, total, backgroundTeamId, onBackgroundChange }: {
  data: RecapData; name: string; year: number | null; page: StoryPage; index: number; total: number;
  backgroundTeamId: string | null; onBackgroundChange: (teamId: string | null) => void;
}) {
  const [image, setImage] = useState<{ url: string; file: File } | null>(null);
  const [error, setError] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [choosingBackground, setChoosingBackground] = useState(false);
  useEffect(() => {
    let active = true, url = "";
    function publish(blob: Blob) {
      if (!active) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      const file = new File([blob], `andante-recap-${year ?? "all"}-${index + 1}.png`, { type: "image/png" });
      setImage({ url, file });
      setCanShare(Boolean(navigator.canShare?.({ files: [file] })));
    }
    createRecapStory(data, name, year, page, index + 1, total, backgroundTeamId).then(async (blob) => {
      publish(blob);
      if (!active || page.kind !== "songs") return;
      const visibleTeams = data.teams.slice(page.offset, page.offset + page.count);
      const covers = await Promise.all(visibleTeams.map(async (team) => {
        if (team.cover) return null;
        const cover = await automaticRecapCover(team.team_name);
        return cover ? { id: team.team_id, cover } : null;
      }));
      if (!active || !covers.some(Boolean)) return;
      const updated = { ...data, teams: data.teams.map((team) => {
        const match = covers.find((entry) => entry?.id === team.team_id);
        return match ? { ...team, cover: match.cover } : team;
      }) };
      publish(await createRecapStory(updated, name, year, page, index + 1, total, backgroundTeamId));
    }).catch((err) => { if (active) setError(err instanceof Error ? err.message : "이미지를 만들지 못했습니다. 다시 시도해 주세요."); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [data, name, year, page, index, total, backgroundTeamId]);
  async function share() {
    if (!image || sharing) return;
    setSharing(true); setError("");
    try { await navigator.share({ files: [image.file] }); }
    catch (err) { if (!(err instanceof DOMException && err.name === "AbortError")) setError("공유할 수 없습니다. 이미지 저장을 이용해 주세요."); }
    finally { setSharing(false); }
  }
  return <div className="recap-story-panel recap-story-slide" aria-live="polite">
    {image ? <div className="recap-story-image-frame"><img className="recap-story-preview" src={image.url} width={1080} height={1920} alt={`${name}님의 ${year ?? "전체"} 합주 리캡 ${index + 1}장`} /></div>
      : !error && <LoadingStatus className="recap-status" label="리캡 이미지를 만들고 있어요." />}
    {error && <p className="recap-error" role="alert">{error}</p>}
    {image && <div className="recap-story-actions"><a className="recap-primary" href={image.url} download={image.file.name}><Download size={18} /> 이미지 저장</a>
      {canShare && <button className="recap-secondary" type="button" disabled={sharing} onClick={() => void share()}><Share2 size={18} /> 공유</button>}
      {index === 0 && <button className="recap-secondary" type="button" onClick={() => setChoosingBackground(true)}><ImagePlus size={18} /> 배경 곡 변경</button>}
    </div>}
    {choosingBackground && <BackgroundSongDialog data={data} selectedId={backgroundTeamId} onClose={() => setChoosingBackground(false)}
      onSelect={(id) => { setChoosingBackground(false); onBackgroundChange(id); }} />}
  </div>;
}

function BackgroundSongDialog({ data, selectedId, onClose, onSelect }: {
  data: RecapData; selectedId: string | null; onClose: () => void; onSelect: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const songs = useMemo(() => recapBackgroundSongs(data.teams), [data.teams]);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="recap-modal recap-background-dialog" aria-label="배경 곡 선택" onClose={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="recap-modal-header"><h2>배경 곡 선택</h2><button type="button" className="recap-icon-button" title="닫기" aria-label="닫기" onClick={onClose}><X size={20} /></button></div>
    <div className="recap-background-list">
      <button type="button" className="recap-background-option" aria-pressed={selectedId === null} onClick={() => onSelect(null)}>
        <span className="recap-background-art"><Music2 size={22} /></span>
        <span className="recap-background-copy"><strong>자동</strong><small>가장 많이 합주한 곡</small></span>
        {selectedId === null && <Check size={18} aria-hidden="true" />}
      </button>
      {songs.map((song) => <button key={song.team_id} type="button" className="recap-background-option" aria-pressed={selectedId === song.team_id} onClick={() => onSelect(song.team_id)}>
        <span className="recap-background-art">{song.cover && isCoverUrl(song.cover.artwork_url)
          ? <img src={song.cover.artwork_url} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" /> : <Music2 size={22} />}</span>
        <span className="recap-background-copy"><strong>{song.team_name}</strong><small>{song.cover ? `${song.cover.artist_name} · ` : ""}{formatRecapMinutes(song.minutes)}</small></span>
        {selectedId === song.team_id && <Check size={18} aria-hidden="true" />}
      </button>)}
    </div>
  </dialog>;
}
