"use client";

import { useMemo, useState } from "react";

type Day = "월" | "화" | "수" | "목" | "금" | "토";
type Tab = "booking" | "suggestions" | "my" | "team" | "news";
type Session = "보컬" | "리드기타" | "세컨기타" | "어쿠스틱" | "드럼" | "피아노" | "신디";

type Member = {
  id: string;
  name: string;
  role: Session;
};

type Team = {
  id: string;
  name: string;
  song: string;
  color: string;
  accent: string;
  leaderId: string;
  members: Member[];
  busy: Record<string, string[]>;
};

type Reservation = {
  id: string;
  teamId: string;
  teamName: string;
  day: Day;
  start: string;
  duration: number;
  purpose: string;
};

type Suggestion = {
  day: Day;
  start: string;
  end: string;
  available: Member[];
  absent: Member[];
  score: number;
  isAllIn: boolean;
  reason: string;
};

type MemberDraft = {
  id: string;
  name: string;
  role: Session;
};

type NewTeamPayload = {
  teamName: string;
  song: string;
  leaderName: string;
  leaderRole: Session;
  members: MemberDraft[];
};

const days: Day[] = ["월", "화", "수", "목", "금", "토"];
const timeSlots = ["15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
const sessionOptions: Session[] = ["보컬", "리드기타", "세컨기타", "어쿠스틱", "드럼", "피아노", "신디"];

const colorPalette = [
  { color: "bg-red-600", accent: "#ef6351" },
  { color: "bg-blue-600", accent: "#2563eb" },
  { color: "bg-emerald-600", accent: "#059669" },
  { color: "bg-violet-600", accent: "#7c3aed" },
  { color: "bg-amber-600", accent: "#d97706" },
  { color: "bg-slate-700", accent: "#334155" },
];

const defaultTeams: Team[] = [
  {
    id: "afterglow",
    name: "Afterglow",
    song: "축제 오프닝 3곡",
    color: "bg-red-600",
    accent: "#ef6351",
    leaderId: "minseo",
    members: [
      { id: "minseo", name: "민서", role: "보컬" },
      { id: "jiho", name: "지호", role: "리드기타" },
      { id: "yuna", name: "유나", role: "세컨기타" },
      { id: "taeho", name: "태호", role: "드럼" },
      { id: "arin", name: "아린", role: "신디" },
    ],
    busy: {
      minseo: ["월-17:00", "화-18:00", "수-19:00", "목-18:00", "금-16:00"],
      jiho: ["월-18:00", "화-19:00", "수-17:00", "목-20:00", "토-16:00"],
      yuna: ["월-19:00", "화-16:00", "수-18:00", "금-19:00", "토-18:00"],
      taeho: ["화-17:00", "수-20:00", "목-17:00", "금-18:00", "토-19:00"],
      arin: ["월-16:00", "수-16:00", "목-19:00", "금-20:00", "토-17:00"],
    },
  },
  {
    id: "blueprint",
    name: "Blue Print",
    song: "어쿠스틱 커버 세트",
    color: "bg-blue-600",
    accent: "#2563eb",
    leaderId: "seojun",
    members: [
      { id: "seojun", name: "서준", role: "보컬" },
      { id: "haru", name: "하루", role: "어쿠스틱" },
      { id: "narin", name: "나린", role: "드럼" },
      { id: "doha", name: "도하", role: "피아노" },
    ],
    busy: {
      seojun: ["월-16:00", "화-19:00", "목-18:00"],
      haru: ["수-17:00", "금-17:00"],
      narin: ["월-18:00", "수-19:00", "토-16:00"],
      doha: ["화-17:00", "목-19:00", "금-20:00"],
    },
  },
  {
    id: "rhythm",
    name: "Rhythm Lab",
    song: "자작곡 편곡",
    color: "bg-emerald-600",
    accent: "#059669",
    leaderId: "sian",
    members: [
      { id: "sian", name: "시안", role: "보컬" },
      { id: "june", name: "준", role: "리드기타" },
      { id: "rio", name: "리오", role: "세컨기타" },
      { id: "haeun", name: "하은", role: "드럼" },
    ],
    busy: {
      sian: ["월-19:00", "수-18:00", "금-17:00"],
      june: ["화-16:00", "목-20:00"],
      rio: ["월-17:00", "수-20:00", "토-18:00"],
      haeun: ["화-18:00", "금-18:00"],
    },
  },
];

const initialReservations: Reservation[] = [
  {
    id: "r1",
    teamId: "blueprint",
    teamName: "Blue Print",
    day: "월",
    start: "18:00",
    duration: 2,
    purpose: "어쿠스틱 커버 합주",
  },
  {
    id: "r2",
    teamId: "rhythm",
    teamName: "Rhythm Lab",
    day: "수",
    start: "16:00",
    duration: 2,
    purpose: "자작곡 드럼 편곡",
  },
  {
    id: "r3",
    teamId: "afterglow",
    teamName: "Afterglow",
    day: "금",
    start: "20:00",
    duration: 1,
    purpose: "보컬 마이크 체크",
  },
  {
    id: "r4",
    teamId: "blueprint",
    teamName: "Blue Print",
    day: "토",
    start: "17:00",
    duration: 2,
    purpose: "공연 전 런스루",
  },
];

const news = [
  {
    title: "금요일까지 축제 셋리스트 제출",
    body: "팀장은 최종 곡명, 러닝타임, 필요한 장비를 함께 등록해 주세요.",
    tag: "공지",
  },
  {
    title: "드럼 페달 교체 완료",
    body: "새 페달은 A룸에 보관됩니다. 합주 후 장력은 기본값으로 돌려주세요.",
    tag: "장비",
  },
  {
    title: "신입부원 잼데이",
    body: "토요일 15시에 자유 합주가 열립니다. 예약 없는 팀도 참관 가능합니다.",
    tag: "행사",
  },
];

const tabs: Array<{ id: Tab; label: string; short: string }> = [
  { id: "booking", label: "예약", short: "R" },
  { id: "suggestions", label: "추천", short: "A" },
  { id: "my", label: "마이", short: "M" },
  { id: "team", label: "팀", short: "+" },
  { id: "news", label: "소식", short: "N" },
];

function toBusyByTeam(teams: Team[]) {
  return Object.fromEntries(teams.map((team) => [team.id, team.busy])) as Record<
    string,
    Record<string, string[]>
  >;
}

function hourOf(time: string) {
  return Number(time.split(":")[0]);
}

function addHours(time: string, hours: number) {
  return `${String(hourOf(time) + hours).padStart(2, "0")}:00`;
}

function reservationSlots(start: string, duration: number) {
  const startIndex = timeSlots.indexOf(start);
  return timeSlots.slice(startIndex, startIndex + duration);
}

function slotKey(day: Day, time: string) {
  return `${day}-${time}`;
}

function isReserved(reservation: Reservation, day: Day, time: string) {
  return reservation.day === day && reservationSlots(reservation.start, reservation.duration).includes(time);
}

function findReservation(reservations: Reservation[], day: Day, time: string) {
  return reservations.find((reservation) => isReserved(reservation, day, time));
}

function isOpenWindow(reservations: Reservation[], day: Day, start: string, duration: number) {
  return reservationSlots(start, duration).every((time) => !findReservation(reservations, day, time));
}

function makeId(prefix: string, value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${normalized || "item"}-${Date.now().toString(36)}`;
}

function buildSuggestions(
  team: Team,
  busy: Record<string, string[]>,
  reservations: Reservation[],
  duration: number,
) {
  const candidates: Suggestion[] = [];

  for (const day of days) {
    for (let index = 0; index <= timeSlots.length - duration; index += 1) {
      const start = timeSlots[index];
      const slots = reservationSlots(start, duration);

      if (!isOpenWindow(reservations, day, start, duration)) {
        continue;
      }

      const available = team.members.filter((member) =>
        slots.every((slot) => !busy[member.id]?.includes(slotKey(day, slot))),
      );
      const absent = team.members.filter((member) => !available.includes(member));
      const eveningBonus = hourOf(start) >= 18 && hourOf(start) <= 20 ? 8 : 0;
      const weekendPenalty = day === "토" ? 3 : 0;
      const score = available.length * 100 + eveningBonus - weekendPenalty - index;
      const isAllIn = absent.length === 0;
      const absentText = absent.length > 0 ? absent.map((member) => member.name).join(", ") : "없음";

      candidates.push({
        day,
        start,
        end: addHours(start, duration),
        available,
        absent,
        score,
        isAllIn,
        reason: isAllIn
          ? "예약표와 팀원 시간표가 모두 비어 있어요."
          : `${available.length}명 가능, 불참 예상: ${absentText}`,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

export default function Home() {
  const [teams, setTeams] = useState(defaultTeams);
  const [selectedTeamId, setSelectedTeamId] = useState(defaultTeams[0].id);
  const [selectedMemberId, setSelectedMemberId] = useState(defaultTeams[0].members[0].id);
  const [duration, setDuration] = useState(2);
  const [busyByTeam, setBusyByTeam] = useState(() => toBusyByTeam(defaultTeams));
  const [reservations, setReservations] = useState(initialReservations);
  const [draft, setDraft] = useState<Suggestion | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("booking");
  const [status, setStatus] = useState("팀 시간표와 예약표를 비교하고 있어요.");

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const selectedMember = selectedTeam.members.find((member) => member.id === selectedMemberId) ?? selectedTeam.members[0];
  const busy = useMemo(
    () => busyByTeam[selectedTeam.id] ?? {},
    [busyByTeam, selectedTeam.id],
  );

  const suggestions = useMemo(
    () => buildSuggestions(selectedTeam, busy, reservations, duration),
    [selectedTeam, busy, reservations, duration],
  );

  const topSuggestion = suggestions[0];
  const hasAllIn = suggestions.some((suggestion) => suggestion.isAllIn);
  const upcomingReservations = reservations
    .slice()
    .sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || hourOf(a.start) - hourOf(b.start));

  function changeTeam(teamId: string) {
    const nextTeam = teams.find((team) => team.id === teamId) ?? teams[0];
    setSelectedTeamId(nextTeam.id);
    setSelectedMemberId(nextTeam.members[0].id);
    setDraft(null);
    setStatus(`${nextTeam.name} 시간표로 다시 계산했어요.`);
  }

  function toggleBusy(day: Day, time: string) {
    const key = slotKey(day, time);
    setBusyByTeam((current) => {
      const teamBusy = current[selectedTeam.id] ?? {};
      const memberBusy = teamBusy[selectedMember.id] ?? [];
      const nextMemberBusy = memberBusy.includes(key)
        ? memberBusy.filter((item) => item !== key)
        : [...memberBusy, key];

      return {
        ...current,
        [selectedTeam.id]: {
          ...teamBusy,
          [selectedMember.id]: nextMemberBusy,
        },
      };
    });
    setDraft(null);
    setStatus(`${selectedMember.name} 시간표 변경을 반영했어요.`);
  }

  function selectSuggestion(suggestion: Suggestion) {
    setDraft(suggestion);
    setActiveTab("suggestions");
    setStatus(`${suggestion.day}요일 ${suggestion.start} 추천을 선택했어요.`);
  }

  function addTeam(payload: NewTeamPayload) {
    const leaderId = makeId("member", payload.leaderName);
    const memberList: Member[] = [
      {
        id: leaderId,
        name: payload.leaderName.trim(),
        role: payload.leaderRole,
      },
      ...payload.members.map((member) => ({
        id: makeId("member", member.name),
        name: member.name,
        role: member.role,
      })),
    ];
    const palette = colorPalette[teams.length % colorPalette.length];
    const teamId = makeId("team", payload.teamName);
    const team: Team = {
      id: teamId,
      name: payload.teamName.trim(),
      song: payload.song.trim() || "새 합주 준비",
      color: palette.color,
      accent: palette.accent,
      leaderId,
      members: memberList,
      busy: Object.fromEntries(memberList.map((member) => [member.id, []])),
    };

    setTeams((current) => [...current, team]);
    setBusyByTeam((current) => ({
      ...current,
      [team.id]: team.busy,
    }));
    setSelectedTeamId(team.id);
    setSelectedMemberId(leaderId);
    setDraft(null);
    setActiveTab("booking");
    setStatus(`${team.name} 팀이 추가됐어요. 팀장 ${payload.leaderName.trim()} 기준으로 추천을 시작합니다.`);
  }

  function handlePrimaryAction() {
    if (activeTab === "team") {
      setActiveTab("booking");
      return;
    }
    reserveDraft();
  }

  function reserveDraft() {
    if (!draft) {
      setActiveTab("suggestions");
      setStatus("추천 시간 중 하나를 먼저 선택해 주세요.");
      return;
    }

    if (!isOpenWindow(reservations, draft.day, draft.start, duration)) {
      setStatus("방금 다른 예약과 겹쳤어요. 추천을 다시 확인해 주세요.");
      setDraft(null);
      return;
    }

    setReservations((current) => [
      ...current,
      {
        id: `r-${Date.now()}`,
        teamId: selectedTeam.id,
        teamName: selectedTeam.name,
        day: draft.day,
        start: draft.start,
        duration,
        purpose: selectedTeam.song,
      },
    ]);
    setStatus(`${selectedTeam.name} 예약 요청이 추가됐어요.`);
    setDraft(null);
    setActiveTab("booking");
  }

  const primaryLabel =
    activeTab === "team"
      ? "예약 화면으로 돌아가기"
      : draft
        ? `${draft.day} ${draft.start} 예약 요청`
        : "AI 추천 시간 선택하기";

  return (
    <main className="h-screen overflow-hidden bg-[#f9ebe6] px-4 py-5 text-slate-950 sm:px-6">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-center gap-10 lg:justify-between">
        <section className="hidden max-w-md lg:block">
          <p className="text-sm font-semibold text-[#ef6351]">BandRoom AI</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            밴드부 합주실 예약을 휴대폰 앱처럼 빠르게.
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            팀 생성, 팀장 지정, 세션별 멤버 관리, 시간표 추천까지 한 화면 흐름 안에 묶은 모바일 프로토타입입니다.
          </p>
        </section>

        <section className="relative w-full max-w-[430px]">
          <div className="absolute -left-8 top-20 hidden h-28 w-28 rounded-full bg-[#ffd7cc] blur-3xl sm:block" />
          <div className="absolute -right-8 bottom-20 hidden h-32 w-32 rounded-full bg-[#ffe7a8] blur-3xl sm:block" />

          <div className="relative rounded-[42px] border-[10px] border-slate-950 bg-slate-950 shadow-2xl">
            <div className="absolute left-1/2 top-0 z-20 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-slate-950" />
            <div className="relative flex h-[calc(100vh-60px)] min-h-[620px] max-h-[820px] flex-col overflow-hidden rounded-[30px] bg-[#fff8f4]">
              <PhoneStatusBar />
              <AppHeader selectedTeam={selectedTeam} status={status} />

              <div className="flex-1 overflow-y-auto px-4 pb-32 pt-3">
                {activeTab === "booking" && (
                  <BookingTab
                    teams={teams}
                    selectedTeam={selectedTeam}
                    reservations={reservations}
                    suggestions={suggestions}
                    topSuggestion={topSuggestion}
                    duration={duration}
                    setDuration={setDuration}
                    changeTeam={changeTeam}
                    selectSuggestion={selectSuggestion}
                  />
                )}

                {activeTab === "suggestions" && (
                  <SuggestionsTab
                    selectedTeam={selectedTeam}
                    suggestions={suggestions}
                    draft={draft}
                    duration={duration}
                    hasAllIn={hasAllIn}
                    onSelect={selectSuggestion}
                  />
                )}

                {activeTab === "my" && (
                  <MyPageTab
                    teams={teams}
                    selectedTeam={selectedTeam}
                    selectedMember={selectedMember}
                    selectedMemberId={selectedMemberId}
                    changeTeam={changeTeam}
                    setSelectedMemberId={setSelectedMemberId}
                    busy={busy}
                    toggleBusy={toggleBusy}
                  />
                )}

                {activeTab === "team" && <TeamTab teams={teams} onAddTeam={addTeam} />}

                {activeTab === "news" && <NewsTab newsItems={news} reservations={upcomingReservations} />}
              </div>

              <div className="absolute inset-x-0 bottom-0 border-t border-[#f0ded7] bg-[#fff8f4]/95 px-4 pb-3 pt-3 backdrop-blur">
                <button
                  type="button"
                  onClick={handlePrimaryAction}
                  className="flex h-12 w-full items-center justify-center rounded-lg bg-[#ff665a] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(239,99,81,0.28)] transition hover:bg-[#ef5548]"
                >
                  {primaryLabel}
                </button>
                <nav className="mt-3 grid grid-cols-5 gap-1" aria-label="앱 탭">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex h-12 flex-col items-center justify-center rounded-lg text-xs font-semibold transition ${
                        activeTab === tab.id ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-[#f7e8e1]"
                      }`}
                    >
                      <span className="text-[11px]">{tab.short}</span>
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function PhoneStatusBar() {
  return (
    <div className="flex h-9 shrink-0 items-end justify-between px-6 pb-2 text-[11px] font-semibold text-slate-900">
      <span>9:41</span>
      <div className="flex items-center gap-1">
        <span className="h-2 w-3 rounded-sm border border-slate-900" />
        <span className="h-2 w-4 rounded-sm bg-slate-900" />
      </div>
    </div>
  );
}

function AppHeader({ selectedTeam, status }: { selectedTeam: Team; status: string }) {
  return (
    <header className="shrink-0 px-4 pb-2 pt-1">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-[#ef6351]">BandRoom AI</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">합주실 예약</h2>
        </div>
        <div className={`h-11 w-11 rounded-lg ${selectedTeam.color} flex items-center justify-center text-sm font-bold text-white`}>
          BR
        </div>
      </div>
      <p className="mt-3 rounded-lg border border-[#f0ded7] bg-white px-3 py-2 text-xs leading-5 text-slate-600">
        {status}
      </p>
    </header>
  );
}

function BookingTab({
  teams,
  selectedTeam,
  reservations,
  suggestions,
  topSuggestion,
  duration,
  setDuration,
  changeTeam,
  selectSuggestion,
}: {
  teams: Team[];
  selectedTeam: Team;
  reservations: Reservation[];
  suggestions: Suggestion[];
  topSuggestion?: Suggestion;
  duration: number;
  setDuration: (duration: number) => void;
  changeTeam: (teamId: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
}) {
  const leader = selectedTeam.members.find((member) => member.id === selectedTeam.leaderId);

  return (
    <div className="space-y-3">
      <MobilePanel>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-500">현재 팀</p>
            <h3 className="mt-1 text-xl font-semibold">{selectedTeam.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{selectedTeam.song}</p>
            {leader && (
              <p className="mt-2 text-xs font-semibold text-[#be3d33]">
                팀장 {leader.name} · {leader.role}
              </p>
            )}
          </div>
          <div className="rounded-lg bg-[#fff0eb] px-3 py-2 text-right">
            <p className="text-xs text-slate-500">최고 참여</p>
            <p className="text-lg font-semibold">
              {topSuggestion ? `${topSuggestion.available.length}/${selectedTeam.members.length}` : "-"}
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => changeTeam(team.id)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs font-semibold ${
                selectedTeam.id === team.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white"
              }`}
            >
              {team.name}
            </button>
          ))}
        </div>
      </MobilePanel>

      <MobilePanel title="합주 길이">
        <div className="grid grid-cols-2 gap-2">
          {[1, 2].map((hours) => (
            <button
              key={hours}
              type="button"
              onClick={() => setDuration(hours)}
              className={`h-10 rounded-lg border text-sm font-semibold ${
                duration === hours ? "border-[#ff665a] bg-[#ff665a] text-white" : "border-[#f0ded7] bg-white"
              }`}
            >
              {hours}시간
            </button>
          ))}
        </div>
      </MobilePanel>

      {topSuggestion && (
        <MobilePanel title="가장 좋은 시간">
          <button
            type="button"
            onClick={() => selectSuggestion(topSuggestion)}
            className="w-full rounded-lg bg-slate-950 p-4 text-left text-white"
          >
            <p className="text-xs text-slate-300">{topSuggestion.isAllIn ? "전원 가능" : "최대 참여 추천"}</p>
            <p className="mt-1 text-2xl font-semibold">
              {topSuggestion.day} {topSuggestion.start}-{topSuggestion.end}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{topSuggestion.reason}</p>
          </button>
        </MobilePanel>
      )}

      <MobilePanel title="이번 주 예약표">
        <div className="space-y-2">
          {days.map((day) => (
            <CompactDayRow key={day} day={day} reservations={reservations} selectedTeamId={selectedTeam.id} />
          ))}
        </div>
      </MobilePanel>

      <MobilePanel title="추천 후보 미리보기">
        <div className="space-y-2">
          {suggestions.slice(0, 3).map((suggestion) => (
            <SuggestionMiniRow key={`${suggestion.day}-${suggestion.start}`} suggestion={suggestion} onSelect={selectSuggestion} />
          ))}
        </div>
      </MobilePanel>
    </div>
  );
}

function SuggestionsTab({
  selectedTeam,
  suggestions,
  draft,
  duration,
  hasAllIn,
  onSelect,
}: {
  selectedTeam: Team;
  suggestions: Suggestion[];
  draft: Suggestion | null;
  duration: number;
  hasAllIn: boolean;
  onSelect: (suggestion: Suggestion) => void;
}) {
  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">AI 시간 추천</p>
        <h3 className="mt-1 text-2xl font-semibold">{selectedTeam.name}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {duration}시간 연속으로 비어 있는 예약표를 찾고, 팀원 시간표와 비교해 참여 인원이 많은 순서로 정렬했어요.
        </p>
        <p className="mt-3 rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-slate-700">
          {hasAllIn ? "전원 가능 시간이 먼저 표시됩니다." : "전원 가능 시간이 없어 최대 참여 인원 기준으로 추천합니다."}
        </p>
      </MobilePanel>

      <div className="space-y-3">
        {suggestions.map((suggestion, index) => {
          const selected = draft?.day === suggestion.day && draft?.start === suggestion.start;

          return (
            <button
              key={`${suggestion.day}-${suggestion.start}`}
              type="button"
              onClick={() => onSelect(suggestion)}
              className={`w-full rounded-lg border p-4 text-left transition ${
                selected ? "border-[#ff665a] bg-[#fff0eb]" : "border-[#f0ded7] bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <span
                  className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                    suggestion.isAllIn ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {suggestion.isAllIn ? "전원 가능" : "최대 참여"}
                </span>
              </div>
              <p className="mt-3 text-xl font-semibold">
                {suggestion.day} {suggestion.start}-{suggestion.end}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{suggestion.reason}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {suggestion.available.map((member) => (
                  <span key={member.id} className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                    {member.name} 가능
                  </span>
                ))}
                {suggestion.absent.map((member) => (
                  <span key={member.id} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                    {member.name} 불가
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MyPageTab({
  teams,
  selectedTeam,
  selectedMember,
  selectedMemberId,
  changeTeam,
  setSelectedMemberId,
  busy,
  toggleBusy,
}: {
  teams: Team[];
  selectedTeam: Team;
  selectedMember: Member;
  selectedMemberId: string;
  changeTeam: (teamId: string) => void;
  setSelectedMemberId: (memberId: string) => void;
  busy: Record<string, string[]>;
  toggleBusy: (day: Day, time: string) => void;
}) {
  const leaderId = selectedTeam.leaderId;
  const busyCount = busy[selectedMember.id]?.length ?? 0;
  const isLeader = selectedMember.id === leaderId;

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">마이페이지</p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold">{selectedMember.name}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {selectedTeam.name} · {selectedMember.role}
            </p>
          </div>
          <span className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs font-semibold text-[#be3d33]">
            {isLeader ? "팀장" : "멤버"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <ProfileStat label="소속 팀" value={selectedTeam.name} />
          <ProfileStat label="내 세션" value={selectedMember.role} />
          <ProfileStat label="불가 시간" value={`${busyCount}개`} />
        </div>
      </MobilePanel>

      <MobilePanel title="내 팀 선택">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => changeTeam(team.id)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs font-semibold ${
                selectedTeam.id === team.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white"
              }`}
            >
              {team.name}
            </button>
          ))}
        </div>
      </MobilePanel>

      <MobilePanel title="내 프로필 선택">
        <p className="mb-3 text-xs leading-5 text-slate-500">
          공모전 프로토타입에서는 로그인 대신 팀원 중 내 프로필을 선택해 시간표를 수정합니다.
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {selectedTeam.members.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setSelectedMemberId(member.id)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs ${
                selectedMemberId === member.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white"
              }`}
            >
              <span className="block font-semibold">
                {member.name}
                {member.id === leaderId ? " 팀장" : ""}
              </span>
              <span className={selectedMemberId === member.id ? "text-slate-300" : "text-slate-500"}>{member.role}</span>
            </button>
          ))}
        </div>
      </MobilePanel>

      <MobilePanel title="내 시간표 편집">
        <p className="mb-3 text-xs leading-5 text-slate-500">
          불가능한 시간을 누르면 AI 추천 시간이 바로 다시 계산됩니다.
        </p>
        <div className="grid grid-cols-[44px_repeat(6,minmax(38px,1fr))] gap-1">
          <div />
          {days.map((day) => (
            <div key={day} className="flex h-8 items-center justify-center text-xs font-semibold text-slate-500">
              {day}
            </div>
          ))}
          {timeSlots.map((time) => (
            <MemberScheduleRow
              key={time}
              time={time}
              busy={busy[selectedMember.id] ?? []}
              onToggle={toggleBusy}
            />
          ))}
        </div>
      </MobilePanel>
    </div>
  );
}

function TeamTab({ teams, onAddTeam }: { teams: Team[]; onAddTeam: (payload: NewTeamPayload) => void }) {
  const [teamName, setTeamName] = useState("");
  const [song, setSong] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [leaderRole, setLeaderRole] = useState<Session>("보컬");
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<Session>("리드기타");
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [message, setMessage] = useState("팀장과 멤버의 세션을 지정해 새 팀을 만들 수 있어요.");

  function addMemberDraft() {
    const trimmedName = memberName.trim();
    if (!trimmedName) {
      setMessage("추가할 멤버 이름을 입력해 주세요.");
      return;
    }
    setMembers((current) => [
      ...current,
      {
        id: makeId("draft", trimmedName),
        name: trimmedName,
        role: memberRole,
      },
    ]);
    setMemberName("");
    setMemberRole("리드기타");
    setMessage(`${trimmedName} 멤버가 추가 목록에 들어갔어요.`);
  }

  function removeDraft(id: string) {
    setMembers((current) => current.filter((member) => member.id !== id));
  }

  function submitTeam() {
    const trimmedTeamName = teamName.trim();
    const trimmedLeaderName = leaderName.trim();

    if (!trimmedTeamName) {
      setMessage("팀 이름을 먼저 입력해 주세요.");
      return;
    }
    if (!trimmedLeaderName) {
      setMessage("팀장을 맡을 멤버 이름을 입력해 주세요.");
      return;
    }
    if (teams.some((team) => team.name.toLowerCase() === trimmedTeamName.toLowerCase())) {
      setMessage("이미 같은 이름의 팀이 있어요.");
      return;
    }

    onAddTeam({
      teamName: trimmedTeamName,
      song,
      leaderName: trimmedLeaderName,
      leaderRole,
      members,
    });
    setTeamName("");
    setSong("");
    setLeaderName("");
    setLeaderRole("보컬");
    setMembers([]);
    setMessage("팀이 추가됐어요. 예약 화면에서 바로 확인할 수 있습니다.");
  }

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">팀 추가</p>
        <h3 className="mt-1 text-xl font-semibold">새 합주 팀 만들기</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          팀장을 먼저 정하고, 멤버를 추가하면서 각 멤버의 세션을 지정합니다.
        </p>
        <p className="mt-3 rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-slate-700">{message}</p>
      </MobilePanel>

      <MobilePanel title="팀 정보">
        <div className="space-y-3">
          <LabeledInput label="팀 이름" value={teamName} onChange={setTeamName} placeholder="예: Midnight Jam" />
          <LabeledInput label="합주 목표" value={song} onChange={setSong} placeholder="예: 학교 축제 엔딩곡" />
        </div>
      </MobilePanel>

      <MobilePanel title="팀장 지정">
        <div className="space-y-3">
          <LabeledInput label="팀장 이름" value={leaderName} onChange={setLeaderName} placeholder="팀장 이름" />
          <SessionSelect label="팀장 세션" value={leaderRole} onChange={setLeaderRole} />
        </div>
      </MobilePanel>

      <MobilePanel title="멤버 추가">
        <div className="space-y-3">
          <LabeledInput label="멤버 이름" value={memberName} onChange={setMemberName} placeholder="멤버 이름" />
          <SessionSelect label="멤버 세션" value={memberRole} onChange={setMemberRole} />
          <button
            type="button"
            onClick={addMemberDraft}
            className="h-10 w-full rounded-lg border border-slate-950 bg-slate-950 text-sm font-semibold text-white"
          >
            멤버 추가
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#f0ded7] bg-white p-3 text-xs leading-5 text-slate-500">
              추가 멤버가 없으면 팀장 1명만 있는 팀으로도 만들 수 있어요.
            </p>
          ) : (
            members.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded-lg border border-[#f0ded7] bg-white p-3">
                <div>
                  <p className="text-sm font-semibold">{member.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{member.role}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeDraft(member.id)}
                  className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
                >
                  삭제
                </button>
              </div>
            ))
          )}
        </div>
      </MobilePanel>

      <button
        type="button"
        onClick={submitTeam}
        className="h-12 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(239,99,81,0.24)]"
      >
        팀 등록하기
      </button>

      <MobilePanel title="등록된 팀">
        <div className="space-y-2">
          {teams.map((team) => {
            const leader = team.members.find((member) => member.id === team.leaderId);

            return (
              <div key={team.id} className="rounded-lg border border-[#f0ded7] bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{team.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{team.song}</p>
                  </div>
                  <span className={`h-3 w-3 rounded-sm ${team.color}`} />
                </div>
                <p className="mt-2 text-xs font-semibold text-[#be3d33]">
                  팀장 {leader?.name ?? "-"} · {leader?.role ?? "-"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {team.members.map((member) => (
                    <span key={member.id} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                      {member.name} · {member.role}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </MobilePanel>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none transition focus:border-[#ff665a]"
      />
    </label>
  );
}

function SessionSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Session;
  onChange: (value: Session) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Session)}
        className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none transition focus:border-[#ff665a]"
      >
        {sessionOptions.map((session) => (
          <option key={session} value={session}>
            {session}
          </option>
        ))}
      </select>
    </label>
  );
}

function NewsTab({
  newsItems,
  reservations,
}: {
  newsItems: Array<{ title: string; body: string; tag: string }>;
  reservations: Reservation[];
}) {
  return (
    <div className="space-y-3">
      <MobilePanel title="동아리 소식">
        <div className="space-y-2">
          {newsItems.map((item) => (
            <article key={item.title} className="rounded-lg border border-[#f0ded7] bg-white p-3">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-slate-950 px-2 py-1 text-[11px] font-semibold text-white">{item.tag}</span>
                <h3 className="text-sm font-semibold">{item.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
            </article>
          ))}
        </div>
      </MobilePanel>

      <MobilePanel title="다가오는 예약">
        <div className="space-y-2">
          {reservations.slice(0, 6).map((reservation) => (
            <div key={reservation.id} className="flex items-center justify-between rounded-lg border border-[#f0ded7] bg-white p-3">
              <div>
                <p className="text-sm font-semibold">{reservation.teamName}</p>
                <p className="mt-1 text-xs text-slate-500">{reservation.purpose}</p>
              </div>
              <p className="text-right text-sm font-semibold">
                {reservation.day}
                <br />
                {reservation.start}
              </p>
            </div>
          ))}
        </div>
      </MobilePanel>
    </div>
  );
}

function MobilePanel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#f0ded7] bg-white/88 p-4 shadow-sm">
      {title && <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>}
      {children}
    </section>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-16 rounded-lg border border-[#f0ded7] bg-white p-2">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold leading-5 text-slate-950">{value}</p>
    </div>
  );
}

function CompactDayRow({
  day,
  reservations,
  selectedTeamId,
}: {
  day: Day;
  reservations: Reservation[];
  selectedTeamId: string;
}) {
  return (
    <div className="rounded-lg border border-[#f0ded7] bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{day}요일</span>
        <span className="text-xs text-slate-500">15:00-22:00</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {timeSlots.map((time) => {
          const reservation = findReservation(reservations, day, time);
          const isMine = reservation?.teamId === selectedTeamId;

          return (
            <div
              key={`${day}-${time}`}
              className={`min-h-12 rounded-md border px-1.5 py-1.5 text-[10px] leading-4 ${
                reservation
                  ? isMine
                    ? "border-[#ffb3aa] bg-[#fff0eb] text-[#be3d33]"
                    : "border-slate-200 bg-slate-100 text-slate-500"
                  : "border-emerald-100 bg-emerald-50 text-emerald-700"
              }`}
            >
              <span className="block font-semibold">{time}</span>
              <span>{reservation ? reservation.teamName : "빈 시간"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SuggestionMiniRow({
  suggestion,
  onSelect,
}: {
  suggestion: Suggestion;
  onSelect: (suggestion: Suggestion) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(suggestion)}
      className="flex w-full items-center justify-between rounded-lg border border-[#f0ded7] bg-white p-3 text-left"
    >
      <div>
        <p className="text-sm font-semibold">
          {suggestion.day} {suggestion.start}-{suggestion.end}
        </p>
        <p className="mt-1 text-xs text-slate-500">{suggestion.reason}</p>
      </div>
      <span className="rounded-md bg-[#fff0eb] px-2 py-1 text-xs font-semibold text-[#be3d33]">
        {suggestion.available.length}명
      </span>
    </button>
  );
}

function MemberScheduleRow({
  time,
  busy,
  onToggle,
}: {
  time: string;
  busy: string[];
  onToggle: (day: Day, time: string) => void;
}) {
  return (
    <>
      <div className="flex h-9 items-center text-[11px] font-semibold text-slate-500">{time}</div>
      {days.map((day) => {
        const key = slotKey(day, time);
        const isBusy = busy.includes(key);

        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(day, time)}
            className={`h-9 rounded-md border text-[10px] font-semibold transition ${
              isBusy
                ? "border-[#ffb3aa] bg-[#fff0eb] text-[#be3d33]"
                : "border-emerald-100 bg-emerald-50 text-emerald-700"
            }`}
            aria-label={`${day} ${time} ${isBusy ? "불가" : "가능"}`}
          >
            {isBusy ? "불가" : "가능"}
          </button>
        );
      })}
    </>
  );
}
