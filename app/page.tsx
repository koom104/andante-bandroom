"use client";

import { useMemo, useState } from "react";

type Day = "월" | "화" | "수" | "목" | "금" | "토";

type Member = {
  id: string;
  name: string;
  role: string;
};

type Team = {
  id: string;
  name: string;
  song: string;
  color: string;
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

const days: Day[] = ["월", "화", "수", "목", "금", "토"];
const timeSlots = ["15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];

const teams: Team[] = [
  {
    id: "afterglow",
    name: "Afterglow",
    song: "축제 오프닝 3곡",
    color: "bg-red-600",
    members: [
      { id: "minseo", name: "민서", role: "보컬" },
      { id: "jiho", name: "지호", role: "기타" },
      { id: "yuna", name: "유나", role: "베이스" },
      { id: "taeho", name: "태호", role: "드럼" },
      { id: "arin", name: "아린", role: "키보드" },
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
    members: [
      { id: "seojun", name: "서준", role: "보컬" },
      { id: "haru", name: "하루", role: "기타" },
      { id: "narin", name: "나린", role: "카혼" },
      { id: "doha", name: "도하", role: "건반" },
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
    members: [
      { id: "sian", name: "시안", role: "보컬" },
      { id: "june", name: "준", role: "기타" },
      { id: "rio", name: "리오", role: "베이스" },
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

function toBusyByTeam() {
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
          ? "기존 예약과 팀원 시간표가 모두 비어 있습니다."
          : `${available.length}명 가능, 불참 예상: ${absentText}`,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

export default function Home() {
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0].id);
  const [selectedMemberId, setSelectedMemberId] = useState(teams[0].members[0].id);
  const [duration, setDuration] = useState(2);
  const [busyByTeam, setBusyByTeam] = useState(toBusyByTeam);
  const [reservations, setReservations] = useState(initialReservations);
  const [draft, setDraft] = useState<Suggestion | null>(null);
  const [status, setStatus] = useState("AI가 팀 시간표와 예약표를 비교하고 있습니다.");

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const selectedMember = selectedTeam.members.find((member) => member.id === selectedMemberId) ?? selectedTeam.members[0];
  const busy = busyByTeam[selectedTeam.id];

  const suggestions = useMemo(
    () => buildSuggestions(selectedTeam, busy, reservations, duration),
    [selectedTeam, busy, reservations, duration],
  );

  const hasAllIn = suggestions.some((suggestion) => suggestion.isAllIn);
  const topSuggestion = suggestions[0];

  function changeTeam(teamId: string) {
    const nextTeam = teams.find((team) => team.id === teamId) ?? teams[0];
    setSelectedTeamId(nextTeam.id);
    setSelectedMemberId(nextTeam.members[0].id);
    setDraft(null);
    setStatus(`${nextTeam.name} 시간표로 추천을 다시 계산했습니다.`);
  }

  function toggleBusy(day: Day, time: string) {
    const key = slotKey(day, time);
    setBusyByTeam((current) => {
      const teamBusy = current[selectedTeam.id];
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
    setStatus(`${selectedMember.name} 시간표 변경을 반영했습니다.`);
  }

  function reserveDraft() {
    if (!draft) {
      setStatus("추천 시간 중 하나를 먼저 선택해 주세요.");
      return;
    }

    if (!isOpenWindow(reservations, draft.day, draft.start, duration)) {
      setStatus("방금 다른 예약과 겹쳤습니다. 추천을 다시 확인해 주세요.");
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
    setStatus(`${selectedTeam.name} 예약 요청이 추가되었습니다.`);
    setDraft(null);
  }

  const upcomingReservations = reservations
    .slice()
    .sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || hourOf(a.start) - hourOf(b.start));

  return (
    <main className="min-h-screen bg-[#f6f7f9] text-slate-950">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-red-700">BandRoom AI</p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">밴드부 합주실 예약 보드</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              단톡방에서 모두의 시간을 다시 묻지 않아도, 팀 시간표와 빈 예약표를 비교해 가장 현실적인 합주 시간을 고릅니다.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm sm:min-w-[420px]">
            <Stat label="이번 주 예약" value={`${reservations.length}건`} tone="border-red-200 bg-red-50" />
            <Stat label="최고 참여" value={topSuggestion ? `${topSuggestion.available.length}/${selectedTeam.members.length}` : "-"} tone="border-emerald-200 bg-emerald-50" />
            <Stat label="알림" value={`${news.length}개`} tone="border-blue-200 bg-blue-50" />
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
          <aside className="flex flex-col gap-4">
            <Panel title="팀 선택">
              <div className="flex flex-col gap-2">
                {teams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => changeTeam(team.id)}
                    className={`flex min-h-16 items-center justify-between rounded-lg border px-3 py-3 text-left transition ${
                      selectedTeam.id === team.id
                        ? "border-slate-900 bg-white shadow-sm"
                        : "border-slate-200 bg-transparent hover:border-slate-400"
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-semibold">{team.name}</span>
                      <span className="mt-1 block text-xs text-slate-500">{team.song}</span>
                    </span>
                    <span className={`h-3 w-3 rounded-sm ${team.color}`} />
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="예약 조건">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500">합주 길이</label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[1, 2].map((hours) => (
                      <button
                        key={hours}
                        type="button"
                        onClick={() => {
                          setDuration(hours);
                          setDraft(null);
                        }}
                        className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                          duration === hours ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"
                        }`}
                      >
                        {hours}시간
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                  {!hasAllIn && suggestions.length > 0
                    ? "전원 가능 시간이 없어 최대 참여 인원 기준으로 추천 중입니다."
                    : "전원 가능 후보를 우선으로 정렬했습니다."}
                </div>
              </div>
            </Panel>
          </aside>

          <section className="flex min-w-0 flex-col gap-4">
            <Panel title="합주실 예약표">
              <div className="overflow-x-auto">
                <div className="grid min-w-[780px] grid-cols-[56px_repeat(7,minmax(88px,1fr))] gap-1">
                  <div className="h-9" />
                  {timeSlots.map((time) => (
                    <div key={time} className="flex h-9 items-center justify-center text-xs font-semibold text-slate-500">
                      {time}
                    </div>
                  ))}
                  {days.map((day) => (
                    <ScheduleRow key={day} day={day} reservations={reservations} selectedTeamId={selectedTeam.id} />
                  ))}
                </div>
              </div>
            </Panel>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Panel title="AI 추천 시간">
                <div className="flex flex-col gap-3">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.day}-${suggestion.start}`}
                      type="button"
                      onClick={() => {
                        setDraft(suggestion);
                        setStatus(`${suggestion.day}요일 ${suggestion.start} 추천을 선택했습니다.`);
                      }}
                      className={`rounded-lg border p-4 text-left transition ${
                        draft?.day === suggestion.day && draft?.start === suggestion.start
                          ? "border-red-500 bg-red-50"
                          : "border-slate-200 bg-white hover:border-slate-400"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white">
                            {index + 1}
                          </span>
                          <span className="text-base font-semibold">
                            {suggestion.day} {suggestion.start}-{suggestion.end}
                          </span>
                        </div>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            suggestion.isAllIn ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
                          }`}
                        >
                          {suggestion.isAllIn ? "전원 가능" : "최대 참여"}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{suggestion.reason}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {suggestion.available.map((member) => (
                          <span key={member.id} className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                            {member.name} 가능
                          </span>
                        ))}
                        {suggestion.absent.map((member) => (
                          <span key={member.id} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500">
                            {member.name} 불가
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="예약 요청">
                <div className="flex h-full flex-col gap-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold text-slate-500">선택한 시간</p>
                    <p className="mt-2 text-xl font-semibold">
                      {draft ? `${draft.day} ${draft.start}-${draft.end}` : "추천을 선택하세요"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {draft
                        ? `${draft.available.length}명이 참여할 수 있고 ${draft.absent.length}명은 불참 가능성이 있습니다.`
                        : "AI 추천 목록에서 시간을 고르면 예약 요청으로 이어집니다."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={reserveDraft}
                    className="rounded-lg bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
                  >
                    팀 예약 요청
                  </button>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                    {status}
                  </p>
                </div>
              </Panel>
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <Panel title="팀원 시간표 입력">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {selectedTeam.members.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedMemberId(member.id)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${
                        selectedMember.id === member.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"
                      }`}
                    >
                      <span className="block font-semibold">{member.name}</span>
                      <span className={selectedMember.id === member.id ? "text-slate-300" : "text-slate-500"}>{member.role}</span>
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <div className="grid min-w-[300px] grid-cols-[42px_repeat(6,1fr)] gap-1">
                    <div />
                    {days.map((day) => (
                      <div key={day} className="text-center text-xs font-semibold text-slate-500">
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
                </div>
              </div>
            </Panel>

            <Panel title="동아리 소식">
              <div className="flex flex-col divide-y divide-slate-200">
                {news.map((item) => (
                  <article key={item.title} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white">{item.tag}</span>
                      <h2 className="text-sm font-semibold">{item.title}</h2>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
                  </article>
                ))}
              </div>
            </Panel>

            <Panel title="다가오는 예약">
              <div className="flex flex-col gap-2">
                {upcomingReservations.slice(0, 5).map((reservation) => (
                  <div key={reservation.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-sm font-semibold">
                      {reservation.day} {reservation.start}-{addHours(reservation.start, reservation.duration)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{reservation.teamName}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white/80 p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function ScheduleRow({
  day,
  reservations,
  selectedTeamId,
}: {
  day: Day;
  reservations: Reservation[];
  selectedTeamId: string;
}) {
  return (
    <>
      <div className="flex h-14 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">
        {day}
      </div>
      {timeSlots.map((time) => {
        const reservation = findReservation(reservations, day, time);
        const isMine = reservation?.teamId === selectedTeamId;

        return (
          <div
            key={`${day}-${time}`}
            className={`flex h-14 items-center justify-center rounded-md border px-2 text-center text-xs ${
              reservation
                ? isMine
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-slate-300 bg-slate-100 text-slate-600"
                : "border-slate-200 bg-white text-slate-400"
            }`}
          >
            {reservation ? (
              <span className="line-clamp-2">
                {reservation.teamName}
              </span>
            ) : (
              "비어 있음"
            )}
          </div>
        );
      })}
    </>
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
      <div className="flex h-9 items-center text-xs font-semibold text-slate-500">{time}</div>
      {days.map((day) => {
        const key = slotKey(day, time);
        const isBusy = busy.includes(key);

        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(day, time)}
            className={`h-9 rounded-md border text-xs font-semibold transition ${
              isBusy
                ? "border-red-200 bg-red-100 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
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
