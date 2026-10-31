import { formatRecapMinutes, isCoverUrl, recapBackgroundSong, recapMonths, storyTrackLayout, type RecapData, type StoryPage } from "./recap-model";
import { automaticRecapCover } from "./recap-client";
import { blurredRecapLayer } from "./recap-blur";
export { recapStoryPages, type StoryPage } from "./recap-model";

const font = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function artwork(url: string | undefined, large = false): Promise<HTMLImageElement | null> {
  if (!isCoverUrl(url)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous"; image.referrerPolicy = "no-referrer";
    const timeout = setTimeout(() => finish(null), 4000);
    function finish(value: HTMLImageElement | null) {
      clearTimeout(timeout); image.onload = null; image.onerror = null; resolve(value);
    }
    image.onload = () => finish(image); image.onerror = () => finish(null);
    image.src = large ? url.replace(/\/400x400bb\.(jpg|png)$/, "/1000x1000bb.$1") : url;
  });
}

export async function createRecapStory(data: RecapData, name: string, year: number | null, page: StoryPage, pageNumber: number, pageCount: number, backgroundTeamId: string | null = null): Promise<Blob> {
  if (!data.goals) throw new Error("공연별 집계를 위해 patch-040 SQL 적용이 필요합니다.");
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 만들 수 없습니다.");
  await document.fonts.ready;
  const teams = page.kind === "songs" ? data.teams.slice(page.offset, page.offset + page.count) : [];
  const top = recapBackgroundSong(data.teams, backgroundTeamId);
  const [images, backgroundArt] = await Promise.all([
    Promise.all(teams.map((team) => artwork(team.cover?.artwork_url))),
    page.kind === "goals" && top ? (top.cover ? Promise.resolve(top.cover) : automaticRecapCover(top.team_name)).then((cover) => artwork(cover?.artwork_url, true)) : Promise.resolve(null),
  ]);
  const isOverview = page.kind === "goals";
  const ink = isOverview ? "#f5f7ef" : "#fafafa";
  const secondary = isOverview ? "#d1dbce" : "#b8b8bf";
  const accent = isOverview ? "#e3f5ff" : "#f2f2f5";
  function text(value: string, x: number, y: number, size: number, color = "#f5f7ef", weight = 600, width = 936) {
    ctx!.font = `${weight} ${size}px ${font}`; ctx!.fillStyle = color;
    const characters = Array.from(value); let result = value;
    while (characters.length && ctx!.measureText(result).width > width) { characters.pop(); result = characters.join("") + "…"; }
    ctx!.fillText(result, x, y);
  }
  function rightText(value: string, y: number, size: number, color: string, weight: number, width: number) {
    ctx!.save(); ctx!.textAlign = "right";
    text(value, 1008, y, size, color, weight, width);
    ctx!.restore();
  }
  const line = (y: number) => { ctx.fillStyle = isOverview ? "#ffffff45" : "#ffffff26"; ctx.fillRect(72, y, 936, 2); };
  ctx.fillStyle = isOverview ? "#315c54" : "#080809"; ctx.fillRect(0, 0, 1080, 1920);
  if (isOverview) {
    if (backgroundArt) {
      const scale = Math.max(1080 / backgroundArt.naturalWidth, 1920 / backgroundArt.naturalHeight);
      const width = backgroundArt.naturalWidth * scale, height = backgroundArt.naturalHeight * scale;
      ctx.drawImage(backgroundArt, (1080 - width) / 2, (1920 - height) / 2, width, height);
    }
    ctx.fillStyle = "rgba(8, 15, 18, .67)"; ctx.fillRect(0, 0, 1080, 1920);
    ctx.font = `900 230px ${font}`; ctx.strokeStyle = "rgba(255,255,255,.16)"; ctx.lineWidth = 2;
    ctx.strokeText(year ? String(year) : "RECAP", 440, 290, 640);
  } else {
    // A feathered, directional beam lights the black stage and refracts through the cards.
    const wash = images.find((image) => image !== null);
    const light = document.createElement("canvas");
    light.width = 1080; light.height = 1920;
    const lightCtx = light.getContext("2d");
    if (lightCtx) {
      lightCtx.beginPath();
      lightCtx.moveTo(850, -180); lightCtx.lineTo(1010, -180);
      lightCtx.lineTo(800, 1920); lightCtx.lineTo(-360, 1920);
      lightCtx.closePath(); lightCtx.clip();
      lightCtx.fillStyle = "#bdc8d8"; lightCtx.fillRect(0, 0, 1080, 1920);
      if (wash) {
        lightCtx.globalAlpha = .65;
        lightCtx.drawImage(blurredRecapLayer(wash, 1500, 2400, 110), -200, -200, 1500, 2400);
        lightCtx.globalAlpha = 1;
      }
      lightCtx.globalCompositeOperation = "destination-in";
      const falloff = lightCtx.createLinearGradient(900, 0, 300, 1920);
      falloff.addColorStop(0, "rgba(255,255,255,.65)");
      falloff.addColorStop(.45, "rgba(255,255,255,.35)");
      falloff.addColorStop(1, "rgba(255,255,255,0)");
      lightCtx.fillStyle = falloff; lightCtx.fillRect(0, 0, 1080, 1920);
      ctx.save();
      ctx.globalAlpha = .48; ctx.drawImage(blurredRecapLayer(light, 1080, 1920, 75), 0, 0, 1080, 1920); ctx.restore();
    }
  }
  const backdrop = document.createElement("canvas");
  backdrop.width = canvas.width; backdrop.height = canvas.height;
  backdrop.getContext("2d")?.drawImage(canvas, 0, 0);
  const softBackdrop = isOverview ? backdrop : blurredRecapLayer(backdrop, 1080, 1920, 18);
  function glass(x: number, y: number, width: number, height: number) {
    ctx!.save();
    ctx!.beginPath(); ctx!.roundRect(x, y, width, height, 20);
    ctx!.fillStyle = "rgba(255,255,255,.03)";
    ctx!.shadowColor = isOverview ? "rgba(0,0,0,.19)" : "rgba(36,55,67,.10)";
    ctx!.shadowBlur = 28; ctx!.shadowOffsetY = 9; ctx!.fill();
    ctx!.shadowColor = "transparent"; ctx!.clip();
    if (isOverview && backgroundArt) {
      ctx!.filter = "blur(25px) saturate(135%)";
      ctx!.drawImage(backdrop, x - 24, y - 24, width + 48, height + 48, x - 28, y - 28, width + 56, height + 56);
      ctx!.filter = "none";
    }
    ctx!.fillStyle = isOverview ? "rgba(19,31,43,.16)" : "rgba(255,255,255,.16)";
    ctx!.fillRect(x, y, width, height);
    ctx!.restore();
    ctx!.save(); ctx!.beginPath(); ctx!.roundRect(x + 1, y + 1, width - 2, height - 2, 20);
    const rim = ctx!.createLinearGradient(x, y, x + width, y + height);
    rim.addColorStop(0, "rgba(255,255,255,.52)");
    rim.addColorStop(.24, "rgba(255,255,255,.16)");
    rim.addColorStop(.55, "rgba(255,255,255,.08)");
    rim.addColorStop(.82, "rgba(255,255,255,.18)");
    rim.addColorStop(1, "rgba(255,255,255,.42)");
    ctx!.strokeStyle = rim; ctx!.lineWidth = 1.3; ctx!.stroke();
    ctx!.beginPath(); ctx!.roundRect(x + 3, y + 3, width - 6, height - 6, 18);
    ctx!.strokeStyle = isOverview ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.15)";
    ctx!.lineWidth = .8; ctx!.stroke(); ctx!.restore();
  }
  if (isOverview) {
    ctx.fillStyle = accent; ctx.fillRect(72, 72, 12, 34);
    text(`ANDANTE / ${year ?? "ALL YEARS"} RECAP`, 104, 101, 28, accent, 800);
    text(`${name}님과`, 72, 190, 42, secondary, 650);
    text("공연별 함께한 시간", 72, 263, 58, ink, 850);
  }
  if (page.kind === "goals") {
    text(formatRecapMinutes(data.total_minutes), 72, 411, 86, accent, 850);
    text(`${data.sessions}번의 합주  /  ${data.teams.length}개 팀`, 72, 480, 30, "#7fe2db", 650);
    const maxGoal = Math.max(1, ...data.goals.map((goal) => goal.minutes));
    data.goals.slice(page.offset, page.offset + page.count).forEach((goal, i) => {
      const y = 610 + i * 92;
      const color = ["#c3eaff", "#ffcee5", "#b5f3e5"][i % 3];
      text(String(page.offset + i + 1).padStart(2, "0"), 72, y, 29, color, 750, 65);
      text(goal.name, 158, y, 34, "#f5f7ef", 700, 600);
      text(formatRecapMinutes(goal.minutes), 778, y, 29, "#7fe2db", 700, 230);
      text(`${goal.sessions}회 합주`, 158, y + 34, 24, "#bbc5ae", 450, 600);
      ctx.fillStyle = "#ffffff22"; ctx.fillRect(158, y + 40, 850, 3);
      ctx.fillStyle = color; ctx.fillRect(158, y + 40, 850 * goal.minutes / maxGoal, 3);
    });
    if (top) text(`${backgroundTeamId ? "배경 곡" : "가장 오래 함께한 곡"} / ${top.team_name}${backgroundArt ? "" : " · 커버 미연결"}`, 72, 1372, 26, secondary, 600);
    glass(48, 1400, 984, 310);
    text("월별 합주 시간", 72, 1445, 27, secondary, 650);
    const months = recapMonths(data.months, year);
    const peak = Math.max(1, ...months.map((month) => month.minutes));
    months.forEach((month, i) => {
      const height = Math.max(4, month.minutes / peak * 145);
      ctx.fillStyle = month.minutes === peak ? "#d9efff" : "#b5f3e5";
      const x = 72 + i * (936 / months.length);
      ctx.fillRect(x, 1632 - height, 936 / months.length - 22, height);
      text(year === null ? `${month.month.slice(0, 4)}.${Number(month.month.slice(5))}` : `${Number(month.month.slice(5))}월`, x, 1668, 22, secondary, 500, 936 / months.length - 8);
    });
  } else {
    text("ANDANTE / RECAP", 72, 100, 27, accent, 800);
    rightText(year ? String(year) : "전체 기록", 100, 27, accent, 700, 203);
    text("MY SETLIST", 72, 219, 108, ink, 850);
    text(`${name}님이 연주한 곡들`, 72, 282, 34, secondary, 600, 680);
    rightText(`${String(page.offset + 1).padStart(2, "0")}–${String(Math.min(page.offset + page.count, data.teams.length)).padStart(2, "0")} / ${data.teams.length}곡`, 282, 27, accent, 650, 230);
    ctx.fillStyle = "#ffffff33"; ctx.fillRect(72, 323, 936, 2);
    const maxMinutes = Math.max(1, ...data.teams.map((entry) => entry.minutes));
    teams.forEach((team, i) => {
      const layout = storyTrackLayout(teams.length, i);
      const { roomy, artSize, textX, artY, cardY, cardHeight, numberY, contentY } = layout;
      ctx.save();
      ctx.beginPath(); ctx.roundRect(48, cardY, 984, cardHeight, 20);
      ctx.shadowColor = "rgba(0,0,0,.4)";
      ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
      ctx.fillStyle = "rgba(30,30,33,.36)";
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.clip();
      ctx.drawImage(softBackdrop, 6, (cardY - 16) / 4, 258, (cardHeight + 32) / 4, 18, cardY - 20, 1044, cardHeight + 40);
      ctx.fillStyle = "rgba(20,20,24,.42)"; ctx.fillRect(48, cardY, 984, cardHeight);
      const surface = ctx.createLinearGradient(48, cardY, 1032, cardY + cardHeight);
      surface.addColorStop(0, "rgba(255,255,255,.13)");
      surface.addColorStop(.38, "rgba(255,255,255,.025)");
      surface.addColorStop(.7, "rgba(0,0,0,.05)");
      surface.addColorStop(1, "rgba(255,255,255,.065)");
      ctx.fillStyle = surface; ctx.fillRect(48, cardY, 984, cardHeight);
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.roundRect(49, cardY + 1, 982, cardHeight - 2, 20);
      const edge = ctx.createLinearGradient(48, cardY + cardHeight, 1032, cardY);
      edge.addColorStop(0, "rgba(255,255,255,.38)");
      edge.addColorStop(.25, "rgba(255,255,255,.08)");
      edge.addColorStop(.6, "rgba(255,255,255,.12)");
      edge.addColorStop(1, "rgba(255,255,255,.34)");
      ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.roundRect(52, cardY + 4, 976, cardHeight - 8, 17);
      ctx.strokeStyle = "rgba(0,0,0,.24)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      const ordinal = String(page.offset + i + 1).padStart(2, "0");
      text(ordinal, 72, numberY, roomy ? 48 : 31, "#a2a2aa", 650, 68);
      ctx.save(); ctx.beginPath(); ctx.roundRect(154, artY, artSize, artSize, 12);
      ctx.fillStyle = "#ffffff0d"; ctx.shadowColor = "#00000055"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4; ctx.fill();
      ctx.shadowColor = "transparent"; ctx.clip();
      if (images[i]) ctx.drawImage(images[i]!, 154, artY, artSize, artSize);
      else {
        ctx.save(); ctx.fillStyle = secondary; ctx.textAlign = "center";
        ctx.font = `500 ${artSize * .58}px ${font}`;
        ctx.fillText("♪", 154 + artSize / 2, artY + artSize * .72);
        ctx.restore();
      }
      ctx.restore();
      const subtitle = team.cover ? `${team.cover.artist_name} · ${team.goals.join(" / ")}` : team.goals.join(" / ");
      // A dedicated time column keeps long titles and subtitles out of the duration.
      ctx.save(); ctx.beginPath();
      ctx.rect(textX, cardY + 6, layout.textWidth, cardHeight - 12); ctx.clip();
      text(team.team_name, textX, roomy ? contentY + 52 : layout.titleY, roomy ? 46 : 30, ink, 700, layout.textWidth);
      text(subtitle, textX, roomy ? contentY + 94 : layout.subtitleY, roomy ? 27 : 20, secondary, 500, layout.textWidth);
      ctx.restore();
      if (roomy) text(`${formatRecapMinutes(team.minutes)} · ${team.sessions}회 합주`, textX, contentY + 145, 33, accent, 700, layout.textWidth);
      else {
        ctx.save(); ctx.textAlign = "right";
        text(formatRecapMinutes(team.minutes), layout.timeRight, layout.durationY, 25, accent, 700, layout.timeWidth);
        ctx.restore();
      }
      const meterY = roomy ? contentY + 188 : layout.meterY;
      ctx.fillStyle = "#ffffff14"; ctx.fillRect(textX, meterY, 1008 - textX, roomy ? 5 : 3);
      ctx.fillStyle = "#ffffff80"; ctx.fillRect(textX, meterY, (1008 - textX) * team.minutes / maxMinutes, roomy ? 5 : 3);
    });
    text(`${formatRecapMinutes(data.total_minutes)}의 기록`, 72, 1718, 27, secondary, 650);
  }
  line(1770);
  text(isOverview ? "EVERY REHEARSAL COUNTS." : "OUR YEAR. OUR SETLIST.", 72, 1831, 28, accent, 800, 780);
  rightText(`${pageNumber} / ${pageCount}`, 1831, 28, secondary, 600, 124);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("이미지 생성에 실패했습니다.")), "image/png"));
}
