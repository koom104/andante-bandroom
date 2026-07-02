"use client";

import type { Session as SupabaseSession } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ADMIN_EMAIL, supabase } from "./supabase";

type Day = "월" | "화" | "수" | "목" | "금" | "토";
type Tab = "booking" | "suggestions" | "my" | "team" | "news" | "admin";
type Role = "member" | "admin";
type ProfileStatus = "pending" | "approved" | "rejected" | "suspended";
type SessionRole = "보컬" | "리드기타" | "세컨기타" | "어쿠스틱" | "드럼" | "피아노" | "신디";

type Profile = {
  id: string;
  email: string;
  name: string;
  cohort: string;
  student_no: string;
  role: Role;
  status: ProfileStatus;
  created_at?: string;
};

type Member = {
  id: string;
  name: string;
  role: SessionRole;
  cohort?: string;
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
  status: "confirmed" | "cancelled";
};

type Suggestion = {
  day: Day;
  start: string;
  end: string;
  available: Member[];
  absent: Member[];
  absentReasons: Record<string, string>;
  score: number;
  isAllIn: boolean;
  reason: string;
};

type NewsItem = {
  id: string;
  title: string;
  body: string;
  tag: string;
  created_at?: string;
};

type TeamMemberDraft = {
  userId: string;
  name: string;
  role: SessionRole;
};

type NewTeamPayload = {
  teamName: string;
  song: string;
  leaderId: string;
  leaderRole: SessionRole;
  members: TeamMemberDraft[];
};

const days: Day[] = ["월", "화", "수", "목", "금", "토"];
const timeSlots = ["15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
const sessionOptions: SessionRole[] = ["보컬", "리드기타", "세컨기타", "어쿠스틱", "드럼", "피아노", "신디"];

const colorPalette = [
  { color: "bg-red-600", accent: "#ef6351" },
  { color: "bg-blue-600", accent: "#2563eb" },
  { color: "bg-emerald-600", accent: "#059669" },
  { color: "bg-violet-600", accent: "#7c3aed" },
  { color: "bg-amber-600", accent: "#d97706" },
  { color: "bg-slate-700", accent: "#334155" },
];

const emptyBusy: Record<string, string[]> = {};

const baseTabs: Array<{ id: Tab; label: string; short: string }> = [
  { id: "booking", label: "예약", short: "R" },
  { id: "suggestions", label: "추천", short: "A" },
  { id: "my", label: "마이", short: "M" },
  { id: "team", label: "팀", short: "+" },
  { id: "news", label: "소식", short: "N" },
];

const adminTab = { id: "admin" as const, label: "관리", short: "!" };

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
  return reservation.status === "confirmed" && reservation.day === day && reservationSlots(reservation.start, reservation.duration).includes(time);
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
  rehearsalBusy: Record<string, string[]>,
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

      const absentReasons: Record<string, string> = {};
      const available = team.members.filter((member) => {
        const manualBusy = busy[member.id] ?? [];
        const rehearsalSlots = rehearsalBusy[member.id] ?? [];
        const blockedByRehearsal = slots.some((slot) => rehearsalSlots.includes(slotKey(day, slot)));
        const blockedManually = slots.some((slot) => manualBusy.includes(slotKey(day, slot)));

        if (blockedByRehearsal) {
          absentReasons[member.id] = "합주 있음";
          return false;
        }

        if (blockedManually) {
          absentReasons[member.id] = "불가";
          return false;
        }

        return true;
      });
      const absent = team.members.filter((member) => !available.includes(member));
      const eveningBonus = hourOf(start) >= 18 && hourOf(start) <= 20 ? 8 : 0;
      const weekendPenalty = day === "토" ? 3 : 0;
      const score = available.length * 100 + eveningBonus - weekendPenalty - index;
      const isAllIn = absent.length === 0;
      const absentText =
        absent.length > 0
          ? absent.map((member) => `${member.name} ${absentReasons[member.id] ?? "불가"}`).join(", ")
          : "없음";

      candidates.push({
        day,
        start,
        end: addHours(start, duration),
        available,
        absent,
        absentReasons,
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

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "알 수 없는 오류가 발생했습니다.");
  }

  return "알 수 없는 오류가 발생했습니다.";
}

function isMissingSchemaError(message: string) {
  return message.includes("relation") || message.includes("does not exist") || message.includes("schema");
}

export default function Home() {
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [busyByUser, setBusyByUser] = useState<Record<string, string[]>>({});
  const [rehearsalByUser, setRehearsalByUser] = useState<Record<string, string[]>>({});
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [duration, setDuration] = useState(2);
  const [draft, setDraft] = useState<Suggestion | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("booking");
  const [status, setStatus] = useState("로그인 후 팀 예약을 시작할 수 있어요.");
  const [authNotice, setAuthNotice] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const loadProfile = useCallback(async (authSession: SupabaseSession) => {
    setIsBooting(true);
    setDbError(null);

    const user = authSession.user;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      const message = getErrorMessage(error);
      if (isMissingSchemaError(message)) {
        setDbError("Supabase 테이블이 아직 만들어지지 않았습니다. supabase/schema.sql을 SQL Editor에서 먼저 실행해 주세요.");
      } else {
        setDbError(message);
      }
      setIsBooting(false);
      return;
    }

    if (data) {
      setProfile(data as Profile);
      setStatus((data as Profile).status === "approved" ? "승인된 계정으로 접속했어요." : "관리자 승인을 기다리고 있어요.");
      setIsBooting(false);
      return;
    }

    const metadata = user.user_metadata ?? {};
    const { data: inserted, error: insertError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email ?? "",
        name: metadata.name ?? user.email?.split("@")[0] ?? "이름 미입력",
        cohort: metadata.cohort ?? "-",
        student_no: metadata.student_no ?? "-",
      })
      .select("*")
      .single();

    if (insertError) {
      setDbError(getErrorMessage(insertError));
      setIsBooting(false);
      return;
    }

    setProfile(inserted as Profile);
    setStatus("가입 신청이 접수됐어요. 관리자 승인을 기다려 주세요.");
    setIsBooting(false);
  }, []);

  const refreshData = useCallback(async () => {
    if (!profile || profile.status !== "approved") {
      return;
    }

    setIsLoadingData(true);
    setDbError(null);

    const [profileResult, teamResult, memberResult, scheduleResult, bookingResult, newsResult] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: true }),
      supabase.from("teams").select("*").order("created_at", { ascending: true }),
      supabase.from("team_members").select("*").order("created_at", { ascending: true }),
      supabase.from("member_schedules").select("*"),
      supabase.from("bookings").select("*").order("created_at", { ascending: false }),
      supabase.from("news_items").select("*").order("created_at", { ascending: false }),
    ]);

    const firstError = [profileResult, teamResult, memberResult, scheduleResult, bookingResult, newsResult].find((result) => result.error)?.error;
    if (firstError) {
      setDbError(getErrorMessage(firstError));
      setIsLoadingData(false);
      return;
    }

    const nextProfiles = (profileResult.data ?? []) as Profile[];
    const profileMap = new Map(nextProfiles.map((item) => [item.id, item]));
    const scheduleRows = (scheduleResult.data ?? []) as Array<{ user_id: string; day_of_week: Day; start_time: string }>;
    const scheduleMap: Record<string, string[]> = {};

    for (const row of scheduleRows) {
      scheduleMap[row.user_id] = [...(scheduleMap[row.user_id] ?? []), slotKey(row.day_of_week, row.start_time)];
    }

    const memberRows = (memberResult.data ?? []) as Array<{
      team_id: string;
      user_id: string;
      session: SessionRole;
      is_leader: boolean;
    }>;

    const rawTeams = (teamResult.data ?? []) as Array<{
      id: string;
      name: string;
      song: string;
      color_index: number;
    }>;

    const teamMembersByTeam = new Map<string, string[]>();
    for (const row of memberRows) {
      teamMembersByTeam.set(row.team_id, [...(teamMembersByTeam.get(row.team_id) ?? []), row.user_id]);
    }

    const nextTeams = rawTeams
      .map((team, index) => {
        const palette = colorPalette[(team.color_index ?? index) % colorPalette.length];
        const rows = memberRows.filter((member) => member.team_id === team.id);
        const members = rows
          .map((member) => {
            const memberProfile = profileMap.get(member.user_id);
            if (!memberProfile) {
              return null;
            }

            return {
              id: member.user_id,
              name: memberProfile.name,
              role: member.session,
              cohort: memberProfile.cohort,
            };
          })
          .filter(Boolean) as Member[];
        const leaderRow = rows.find((member) => member.is_leader);

        return {
          id: team.id,
          name: team.name,
          song: team.song,
          color: palette.color,
          accent: palette.accent,
          leaderId: leaderRow?.user_id ?? members[0]?.id ?? "",
          members,
          busy: Object.fromEntries(members.map((member) => [member.id, scheduleMap[member.id] ?? []])),
        };
      })
      .filter((team) => profile.role === "admin" || team.members.some((member) => member.id === profile.id));

    const teamNameById = new Map(rawTeams.map((team) => [team.id, team.name]));
    const bookingRows = (bookingResult.data ?? []) as Array<{
      id: string;
      team_id: string;
      day_of_week: Day;
      start_time: string;
      duration: number;
      purpose: string;
      status: "confirmed" | "cancelled";
    }>;

    const nextReservations = bookingRows.map((booking) => ({
        id: booking.id,
        teamId: booking.team_id,
        teamName: teamNameById.get(booking.team_id) ?? "삭제된 팀",
        day: booking.day_of_week,
        start: booking.start_time,
        duration: booking.duration,
        purpose: booking.purpose,
        status: booking.status,
    }));
    const rehearsalMap: Record<string, string[]> = {};
    for (const booking of nextReservations) {
      if (booking.status !== "confirmed") {
        continue;
      }

      const memberIds = teamMembersByTeam.get(booking.teamId) ?? [];
      for (const memberId of memberIds) {
        rehearsalMap[memberId] = [
          ...(rehearsalMap[memberId] ?? []),
          ...reservationSlots(booking.start, booking.duration).map((slot) => slotKey(booking.day, slot)),
        ];
      }
    }

    setProfiles(nextProfiles);
    setBusyByUser(scheduleMap);
    setRehearsalByUser(rehearsalMap);
    setTeams(nextTeams);
    setReservations(nextReservations);
    setNewsItems((newsResult.data ?? []) as NewsItem[]);
    setIsLoadingData(false);
  }, [profile]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return;
      }

      setSession(data.session);
      if (!data.session) {
        setIsBooting(false);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setTeams([]);
        setProfiles([]);
        setBusyByUser({});
        setRehearsalByUser({});
        setReservations([]);
        setNewsItems([]);
        setIsBooting(false);
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session) {
      const timeout = window.setTimeout(() => {
        void loadProfile(session);
      }, 0);

      return () => window.clearTimeout(timeout);
    }
  }, [session, loadProfile]);

  useEffect(() => {
    if (profile?.status === "approved") {
      const timeout = window.setTimeout(() => {
        void refreshData();
      }, 0);

      return () => window.clearTimeout(timeout);
    }
  }, [profile?.status, refreshData]);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null;
  const busy = useMemo(() => selectedTeam?.busy ?? emptyBusy, [selectedTeam]);
  const selectedTeamRehearsals = useMemo(
    () => Object.fromEntries((selectedTeam?.members ?? []).map((member) => [member.id, rehearsalByUser[member.id] ?? []])),
    [selectedTeam, rehearsalByUser],
  );
  const visibleTabs = profile?.role === "admin" ? [...baseTabs, adminTab] : baseTabs;
  const approvedProfiles = profiles.filter((item) => item.status === "approved");
  const pendingProfiles = profiles.filter((item) => item.status === "pending");

  const suggestions = useMemo(
    () => (selectedTeam ? buildSuggestions(selectedTeam, busy, selectedTeamRehearsals, reservations, duration) : []),
    [selectedTeam, busy, selectedTeamRehearsals, reservations, duration],
  );

  const topSuggestion = suggestions[0];
  const hasAllIn = suggestions.some((suggestion) => suggestion.isAllIn);
  const upcomingReservations = reservations
    .filter((reservation) => reservation.status === "confirmed")
    .slice()
    .sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || hourOf(a.start) - hourOf(b.start));

  async function signIn(email: string, password: string) {
    setAuthNotice("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setAuthNotice(getErrorMessage(error));
      return;
    }

    setAuthNotice("로그인했습니다.");
  }

  async function signUp(payload: {
    email: string;
    password: string;
    name: string;
    cohort: string;
    studentNo: string;
  }) {
    setAuthNotice("");
    const { error } = await supabase.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        data: {
          name: payload.name,
          cohort: payload.cohort,
          student_no: payload.studentNo,
        },
      },
    });

    if (error) {
      setAuthNotice(getErrorMessage(error));
      return;
    }

    setAuthNotice("가입 신청이 접수됐어요. 관리자 승인을 기다려 주세요.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setStatus("로그인 후 팀 예약을 시작할 수 있어요.");
  }

  function changeTeam(teamId: string) {
    const nextTeam = teams.find((team) => team.id === teamId) ?? teams[0];
    if (!nextTeam) {
      return;
    }

    setSelectedTeamId(nextTeam.id);
    setDraft(null);
    setStatus(`${nextTeam.name} 시간표로 다시 계산했어요.`);
  }

  async function toggleSchedule(userId: string, day: Day, time: string) {
    if (!profile) {
      return;
    }

    const key = slotKey(day, time);
    const isBusy = busyByUser[userId]?.includes(key);

    if (isBusy) {
      const { error } = await supabase
        .from("member_schedules")
        .delete()
        .eq("user_id", userId)
        .eq("day_of_week", day)
        .eq("start_time", time);

      if (error) {
        setStatus(getErrorMessage(error));
        return;
      }
    } else {
      const { error } = await supabase.from("member_schedules").insert({
        user_id: userId,
        day_of_week: day,
        start_time: time,
        updated_by: profile.id,
      });

      if (error) {
        setStatus(getErrorMessage(error));
        return;
      }
    }

    setDraft(null);
    setStatus("시간표 변경을 반영했어요.");
    await refreshData();
  }

  function selectSuggestion(suggestion: Suggestion) {
    setDraft(suggestion);
    setActiveTab("suggestions");
    setStatus(`${suggestion.day}요일 ${suggestion.start} 추천을 선택했어요.`);
  }

  async function addTeam(payload: NewTeamPayload) {
    const members = [
      {
        user_id: payload.leaderId,
        session: payload.leaderRole,
        is_leader: true,
      },
      ...payload.members
        .filter((member) => member.userId !== payload.leaderId)
        .map((member) => ({
          user_id: member.userId,
          session: member.role,
          is_leader: false,
        })),
    ];

    const { data, error } = await supabase.rpc("create_team", {
      p_name: payload.teamName,
      p_song: payload.song,
      p_leader_id: payload.leaderId,
      p_members: members,
    });

    if (error) {
      setStatus(getErrorMessage(error));
      return;
    }

    await refreshData();
    if (typeof data === "string") {
      setSelectedTeamId(data);
    }
    setDraft(null);
    setActiveTab("booking");
    setStatus(`${payload.teamName} 팀이 추가됐어요.`);
  }

  async function reserveDraft() {
    if (!selectedTeam) {
      setActiveTab("team");
      setStatus("먼저 팀을 만들어 주세요.");
      return;
    }

    if (!draft) {
      setActiveTab("suggestions");
      setStatus("추천 시간 중 하나를 먼저 선택해 주세요.");
      return;
    }

    const { error } = await supabase.rpc("create_booking", {
      p_team_id: selectedTeam.id,
      p_day: draft.day,
      p_start_time: draft.start,
      p_duration: duration,
      p_purpose: selectedTeam.song,
    });

    if (error) {
      setStatus(getErrorMessage(error));
      setDraft(null);
      await refreshData();
      return;
    }

    setStatus(`${selectedTeam.name} 예약이 확정됐어요.`);
    setDraft(null);
    setActiveTab("booking");
    await refreshData();
  }

  function handlePrimaryAction() {
    if (activeTab === "team" || activeTab === "admin") {
      setActiveTab("booking");
      return;
    }

    void reserveDraft();
  }

  async function approveProfile(profileId: string, nextStatus: "approved" | "rejected") {
    if (!profile) {
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        status: nextStatus,
        approved_by: profile.id,
        approved_at: nextStatus === "approved" ? new Date().toISOString() : null,
      })
      .eq("id", profileId);

    if (error) {
      setStatus(getErrorMessage(error));
      return;
    }

    setStatus(nextStatus === "approved" ? "가입을 승인했어요." : "가입을 거절했어요.");
    await refreshData();
  }

  async function addNews(payload: { title: string; body: string; tag: string }) {
    if (!profile) {
      return;
    }

    const { error } = await supabase.from("news_items").insert({
      title: payload.title,
      body: payload.body,
      tag: payload.tag,
      created_by: profile.id,
    });

    if (error) {
      setStatus(getErrorMessage(error));
      return;
    }

    setStatus("새 소식을 올렸어요.");
    await refreshData();
  }

  async function deleteNews(newsId: string) {
    const { error } = await supabase.from("news_items").delete().eq("id", newsId);

    if (error) {
      setStatus(getErrorMessage(error));
      return;
    }

    setStatus("소식을 삭제했어요.");
    await refreshData();
  }

  async function cancelBooking(bookingId: string, reason: string) {
    if (!profile) {
      return;
    }

    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
      p_reason: reason || "예약 취소",
    });

    if (error) {
      const message = getErrorMessage(error);
      if (profile.role === "admin" && message.includes("cancel_booking")) {
        const fallback = await supabase
          .from("bookings")
          .update({
            status: "cancelled",
            cancelled_by: profile.id,
            cancelled_at: new Date().toISOString(),
            cancel_reason: reason || "관리자 취소",
          })
          .eq("id", bookingId);

        if (fallback.error) {
          setStatus(getErrorMessage(fallback.error));
          return;
        }
      } else {
        setStatus(message);
        return;
      }
    }

    setStatus("예약을 취소했어요.");
    await refreshData();
  }

  const primaryLabel =
    activeTab === "team" || activeTab === "admin"
      ? "예약 화면으로 돌아가기"
      : !selectedTeam
        ? "팀 만들기"
        : draft
          ? `${draft.day} ${draft.start} 예약 확정`
          : "AI 추천 시간 선택하기";

  if (isBooting) {
    return (
      <PhoneShell>
        <CenteredMessage title="BandRoom AI" body="계정 상태를 확인하고 있어요." />
      </PhoneShell>
    );
  }

  if (!session) {
    return (
      <PhoneShell>
        <AuthScreen onSignIn={signIn} onSignUp={signUp} notice={authNotice} />
      </PhoneShell>
    );
  }

  if (dbError) {
    return (
      <PhoneShell>
        <SetupRequired error={dbError} onSignOut={signOut} />
      </PhoneShell>
    );
  }

  if (!profile) {
    return (
      <PhoneShell>
        <CenteredMessage title="프로필 확인 중" body="프로필을 불러오고 있어요." />
      </PhoneShell>
    );
  }

  if (profile.status !== "approved") {
    return (
      <PhoneShell>
        <ApprovalScreen profile={profile} onRefresh={() => loadProfile(session)} onSignOut={signOut} />
      </PhoneShell>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#fff8f4] text-slate-950 sm:bg-[#f9ebe6] sm:px-6 sm:py-5">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-center">
        <section className="relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-[#fff8f4] shadow-sm">
              <AppHeader selectedTeam={selectedTeam} status={status} profile={profile} onSignOut={signOut} />

              <div className="flex-1 overflow-y-auto px-4 pb-32 pt-3">
                {isLoadingData && (
                  <p className="mb-3 rounded-lg border border-[#f0ded7] bg-white px-3 py-2 text-xs text-slate-500">
                    데이터를 새로 불러오는 중입니다.
                  </p>
                )}

                {activeTab === "booking" && (
                  <BookingTab
                    teams={teams}
                    selectedTeam={selectedTeam}
                    reservations={upcomingReservations}
                    suggestions={suggestions}
                    topSuggestion={topSuggestion}
                    duration={duration}
                    setDuration={setDuration}
                    changeTeam={changeTeam}
                    selectSuggestion={selectSuggestion}
                    openTeamTab={() => setActiveTab("team")}
                    currentUserId={profile.id}
                    onCancelBooking={cancelBooking}
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
                    profile={profile}
                    selectedTeam={selectedTeam}
                    teams={teams}
                    ownBusy={busyByUser[profile.id] ?? []}
                    ownRehearsals={rehearsalByUser[profile.id] ?? []}
                    changeTeam={changeTeam}
                    toggleBusy={(day, time) => toggleSchedule(profile.id, day, time)}
                  />
                )}

                {activeTab === "team" && (
                  <TeamTab teams={teams} approvedProfiles={approvedProfiles} onAddTeam={addTeam} currentUserId={profile.id} />
                )}

                {activeTab === "news" && <NewsTab newsItems={newsItems} reservations={upcomingReservations} />}

                {activeTab === "admin" && profile.role === "admin" && (
                  <AdminTab
                    pendingProfiles={pendingProfiles}
                    approvedProfiles={approvedProfiles}
                    reservations={upcomingReservations}
                    newsItems={newsItems}
                    busyByUser={busyByUser}
                    rehearsalByUser={rehearsalByUser}
                    approveProfile={approveProfile}
                    addNews={addNews}
                    deleteNews={deleteNews}
                    cancelBooking={cancelBooking}
                    toggleSchedule={toggleSchedule}
                  />
                )}
              </div>

              <div className="absolute inset-x-0 bottom-0 border-t border-[#f0ded7] bg-[#fff8f4]/95 px-4 pb-3 pt-3 backdrop-blur">
                <button
                  type="button"
                  onClick={handlePrimaryAction}
                  className="flex h-12 w-full items-center justify-center rounded-lg bg-[#ff665a] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(239,99,81,0.28)] transition hover:bg-[#ef5548]"
                >
                  {primaryLabel}
                </button>
                <nav className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }} aria-label="앱 탭">
                  {visibleTabs.map((tab) => (
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
        </section>
      </div>
    </main>
  );
}

function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <main className="h-screen overflow-hidden bg-[#fff8f4] text-slate-950 sm:bg-[#f9ebe6] sm:px-6 sm:py-5">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-center">
        <section className="relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-[#fff8f4] shadow-sm">
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        </section>
      </div>
    </main>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="w-full rounded-lg border border-[#f0ded7] bg-white p-5 text-center">
        <p className="text-xs font-semibold text-[#ef6351]">BandRoom AI</p>
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
      </div>
    </div>
  );
}

function AuthScreen({
  onSignIn,
  onSignUp,
  notice,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (payload: { email: string; password: string; name: string; cohort: string; studentNo: string }) => Promise<void>;
  notice: string;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [cohort, setCohort] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [message, setMessage] = useState("");

  async function submit() {
    if (!email.trim() || !password.trim()) {
      setMessage("이메일과 비밀번호를 입력해 주세요.");
      return;
    }

    if (mode === "signup" && (!name.trim() || !cohort.trim() || !studentNo.trim())) {
      setMessage("이름, 기수, 학번을 모두 입력해 주세요.");
      return;
    }

    setMessage("");

    if (mode === "login") {
      await onSignIn(email.trim(), password);
      return;
    }

    await onSignUp({
      email: email.trim(),
      password,
      name: name.trim(),
      cohort: cohort.trim(),
      studentNo: studentNo.trim(),
    });
  }

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">BandRoom AI</p>
        <h1 className="mt-2 text-2xl font-semibold">동아리방 예약 로그인</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          부원은 가입 신청 후 관리자 승인을 받아야 예약과 시간표 기능을 사용할 수 있습니다.
        </p>
      </MobilePanel>

      <MobilePanel>
        <div className="grid grid-cols-2 gap-2">
          {(["login", "signup"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={`h-10 rounded-lg border text-sm font-semibold ${
                mode === item ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white"
              }`}
            >
              {item === "login" ? "로그인" : "회원가입"}
            </button>
          ))}
        </div>
      </MobilePanel>

      <MobilePanel title={mode === "login" ? "계정 로그인" : "가입 신청"}>
        <div className="space-y-3">
          <LabeledInput label="이메일" value={email} onChange={setEmail} placeholder="name@example.com" type="email" />
          <LabeledInput label="비밀번호" value={password} onChange={setPassword} placeholder="8자 이상" type="password" />

          {mode === "signup" && (
            <>
              <LabeledInput label="이름" value={name} onChange={setName} placeholder="홍길동" />
              <LabeledInput label="기수" value={cohort} onChange={setCohort} placeholder="예: 12기" />
              <LabeledInput label="학번" value={studentNo} onChange={setStudentNo} placeholder="예: 20261234" />
            </>
          )}

          {(notice || message) && (
            <p className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-[#be3d33]">{notice || message}</p>
          )}

          <button type="button" onClick={submit} className="h-12 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white">
            {mode === "login" ? "로그인하기" : "가입 신청하기"}
          </button>
        </div>
      </MobilePanel>
    </div>
  );
}

function SetupRequired({ error, onSignOut }: { error: string; onSignOut: () => void }) {
  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">설정 필요</p>
        <h1 className="mt-2 text-2xl font-semibold">DB 스키마를 먼저 실행해야 합니다</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Supabase Dashboard의 SQL Editor에서 프로젝트의 `supabase/schema.sql` 내용을 한 번 실행하면 로그인, 승인, 예약 기능이 연결됩니다.
        </p>
      </MobilePanel>
      <MobilePanel title="현재 오류">
        <p className="text-xs leading-5 text-slate-600">{error}</p>
      </MobilePanel>
      <button type="button" onClick={onSignOut} className="h-11 w-full rounded-lg border border-slate-950 bg-white text-sm font-semibold">
        로그아웃
      </button>
    </div>
  );
}

function ApprovalScreen({
  profile,
  onRefresh,
  onSignOut,
}: {
  profile: Profile;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const isRejected = profile.status === "rejected";

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">{isRejected ? "가입 거절" : "승인 대기"}</p>
        <h1 className="mt-2 text-2xl font-semibold">{profile.name}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {isRejected
            ? "관리자가 가입 신청을 거절했습니다. 입력 정보가 맞는지 확인해 주세요."
            : "관리자가 가입 신청을 승인하면 예약과 시간표 기능을 사용할 수 있습니다."}
        </p>
      </MobilePanel>
      <MobilePanel title="가입 정보">
        <div className="grid grid-cols-3 gap-2">
          <ProfileStat label="이름" value={profile.name} />
          <ProfileStat label="기수" value={profile.cohort} />
          <ProfileStat label="학번" value={profile.student_no} />
        </div>
      </MobilePanel>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onRefresh} className="h-11 rounded-lg bg-slate-950 text-sm font-semibold text-white">
          상태 새로고침
        </button>
        <button type="button" onClick={onSignOut} className="h-11 rounded-lg border border-slate-950 bg-white text-sm font-semibold">
          로그아웃
        </button>
      </div>
    </div>
  );
}

function AppHeader({
  selectedTeam,
  status,
  profile,
  onSignOut,
}: {
  selectedTeam: Team | null;
  status: string;
  profile: Profile;
  onSignOut: () => void;
}) {
  return (
    <header className="shrink-0 px-4 pb-2 pt-1">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-[#ef6351]">BandRoom AI</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">합주실 예약</h2>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className={`flex h-11 w-11 items-center justify-center rounded-lg ${selectedTeam?.color ?? "bg-slate-800"} text-xs font-bold text-white`}
          aria-label="로그아웃"
        >
          {profile.role === "admin" ? "AD" : "BR"}
        </button>
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
  openTeamTab,
  currentUserId,
  onCancelBooking,
}: {
  teams: Team[];
  selectedTeam: Team | null;
  reservations: Reservation[];
  suggestions: Suggestion[];
  topSuggestion?: Suggestion;
  duration: number;
  setDuration: (duration: number) => void;
  changeTeam: (teamId: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  openTeamTab: () => void;
  currentUserId: string;
  onCancelBooking: (bookingId: string, reason: string) => Promise<void>;
}) {
  if (!selectedTeam) {
    return (
      <div className="space-y-3">
        <MobilePanel>
          <p className="text-xs font-semibold text-[#ef6351]">팀 필요</p>
          <h3 className="mt-1 text-2xl font-semibold">예약할 팀을 먼저 만들어 주세요</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            승인된 부원 목록에서 팀장과 멤버를 선택한 뒤 세션을 지정하면 추천 시간이 계산됩니다.
          </p>
        </MobilePanel>
        <button type="button" onClick={openTeamTab} className="h-12 w-full rounded-lg bg-slate-950 text-sm font-semibold text-white">
          팀 만들기
        </button>
      </div>
    );
  }

  const leader = selectedTeam.members.find((member) => member.id === selectedTeam.leaderId);
  const isLeader = selectedTeam.leaderId === currentUserId;
  const teamReservations = reservations.filter((reservation) => reservation.teamId === selectedTeam.id);

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

      {isLeader && (
        <MobilePanel title="팀장 예약 관리">
          <div className="space-y-2">
            {teamReservations.map((reservation) => (
              <div key={reservation.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#f0ded7] bg-white p-3">
                <div>
                  <p className="text-sm font-semibold">
                    {reservation.day} {reservation.start}-{addHours(reservation.start, reservation.duration)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{reservation.purpose}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onCancelBooking(reservation.id, "팀장 취소")}
                  className="rounded-md bg-[#fff0eb] px-2 py-1 text-xs font-semibold text-[#be3d33]"
                >
                  취소
                </button>
              </div>
            ))}
            {teamReservations.length === 0 && <EmptyText text="취소할 예약이 없습니다." />}
          </div>
        </MobilePanel>
      )}

      <MobilePanel title="추천 후보 미리보기">
        <div className="space-y-2">
          {suggestions.slice(0, 3).map((suggestion) => (
            <SuggestionMiniRow key={`${suggestion.day}-${suggestion.start}`} suggestion={suggestion} onSelect={selectSuggestion} />
          ))}
          {suggestions.length === 0 && <EmptyText text="예약 가능한 시간이 없습니다." />}
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
  selectedTeam: Team | null;
  suggestions: Suggestion[];
  draft: Suggestion | null;
  duration: number;
  hasAllIn: boolean;
  onSelect: (suggestion: Suggestion) => void;
}) {
  if (!selectedTeam) {
    return <EmptyState title="추천할 팀이 없습니다" body="팀 탭에서 먼저 팀을 만들어 주세요." />;
  }

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
                    {member.name} {suggestion.absentReasons[member.id] ?? "불가"}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
        {suggestions.length === 0 && <EmptyText text="예약 가능한 시간이 없습니다." />}
      </div>
    </div>
  );
}

function MyPageTab({
  profile,
  selectedTeam,
  teams,
  ownBusy,
  ownRehearsals,
  changeTeam,
  toggleBusy,
}: {
  profile: Profile;
  selectedTeam: Team | null;
  teams: Team[];
  ownBusy: string[];
  ownRehearsals: string[];
  changeTeam: (teamId: string) => void;
  toggleBusy: (day: Day, time: string) => void;
}) {
  const memberRole = selectedTeam?.members.find((member) => member.id === profile.id)?.role ?? "보컬";
  const busyCount = ownBusy.length;

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">마이페이지</p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold">{profile.name}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {profile.cohort} · {profile.student_no}
            </p>
          </div>
          <span className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs font-semibold text-[#be3d33]">
            {profile.role === "admin" ? "관리자" : "부원"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <ProfileStat label="소속 팀" value={selectedTeam?.name ?? "없음"} />
          <ProfileStat label="내 세션" value={selectedTeam ? memberRole : "미정"} />
          <ProfileStat label="불가 시간" value={`${busyCount}개`} />
        </div>
      </MobilePanel>

      {teams.length > 0 && (
        <MobilePanel title="내 팀 선택">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => changeTeam(team.id)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs font-semibold ${
                  selectedTeam?.id === team.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white"
                }`}
              >
                {team.name}
              </button>
            ))}
          </div>
        </MobilePanel>
      )}

      <MobilePanel title="내 시간표 편집">
        <p className="mb-3 text-xs leading-5 text-slate-500">
          직접 막은 시간은 불가로, 팀 예약으로 막힌 시간은 합주로 표시됩니다.
        </p>
        <ScheduleGrid busy={ownBusy} rehearsals={ownRehearsals} onToggle={toggleBusy} />
      </MobilePanel>
    </div>
  );
}

function TeamTab({
  teams,
  approvedProfiles,
  onAddTeam,
  currentUserId,
}: {
  teams: Team[];
  approvedProfiles: Profile[];
  onAddTeam: (payload: NewTeamPayload) => Promise<void>;
  currentUserId: string;
}) {
  const [teamName, setTeamName] = useState("");
  const [song, setSong] = useState("");
  const [leaderId, setLeaderId] = useState(currentUserId);
  const [leaderRole, setLeaderRole] = useState<SessionRole>("보컬");
  const [memberId, setMemberId] = useState(currentUserId);
  const [memberRole, setMemberRole] = useState<SessionRole>("리드기타");
  const [members, setMembers] = useState<TeamMemberDraft[]>([]);
  const [message, setMessage] = useState("승인된 부원을 선택해 새 팀을 만들 수 있어요.");

  const effectiveLeaderId = approvedProfiles.some((item) => item.id === leaderId) ? leaderId : approvedProfiles[0]?.id ?? "";
  const effectiveMemberId = approvedProfiles.some((item) => item.id === memberId) ? memberId : approvedProfiles[0]?.id ?? "";
  const leader = approvedProfiles.find((item) => item.id === effectiveLeaderId);

  function addMemberDraft() {
    const target = approvedProfiles.find((item) => item.id === effectiveMemberId);
    if (!target) {
      setMessage("추가할 부원을 선택해 주세요.");
      return;
    }
    if (target.id === effectiveLeaderId) {
      setMessage("팀장은 자동으로 멤버에 포함됩니다.");
      return;
    }
    if (members.some((member) => member.userId === target.id)) {
      setMessage("이미 추가한 멤버입니다.");
      return;
    }

    setMembers((current) => [...current, { userId: target.id, name: target.name, role: memberRole }]);
    setMessage(`${target.name} 멤버를 추가했어요.`);
  }

  function removeDraft(userId: string) {
    setMembers((current) => current.filter((member) => member.userId !== userId));
  }

  async function submitTeam() {
    const trimmedTeamName = teamName.trim();
    if (!trimmedTeamName) {
      setMessage("팀 이름을 먼저 입력해 주세요.");
      return;
    }
    if (!leader) {
      setMessage("팀장을 선택해 주세요.");
      return;
    }
    if (teams.some((team) => team.name.toLowerCase() === trimmedTeamName.toLowerCase())) {
      setMessage("이미 같은 이름의 팀이 있어요.");
      return;
    }

    await onAddTeam({
      teamName: trimmedTeamName,
      song,
      leaderId: effectiveLeaderId,
      leaderRole,
      members,
    });
    setTeamName("");
    setSong("");
    setMembers([]);
    setMessage("팀 등록 요청을 보냈어요.");
  }

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">팀 추가</p>
        <h3 className="mt-1 text-xl font-semibold">새 합주 팀 만들기</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          승인된 부원 중 팀장과 멤버를 선택하고, 각 멤버의 세션을 지정합니다.
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
          <ProfileSelect label="팀장" value={effectiveLeaderId} onChange={setLeaderId} profiles={approvedProfiles} />
          <SessionSelect label="팀장 세션" value={leaderRole} onChange={setLeaderRole} />
        </div>
      </MobilePanel>

      <MobilePanel title="멤버 추가">
        <div className="space-y-3">
          <ProfileSelect label="멤버" value={effectiveMemberId} onChange={setMemberId} profiles={approvedProfiles} />
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
            <EmptyText text="추가 멤버가 없으면 팀장 1명만 있는 팀으로도 만들 수 있어요." />
          ) : (
            members.map((member) => (
              <div key={member.userId} className="flex items-center justify-between rounded-lg border border-[#f0ded7] bg-white p-3">
                <div>
                  <p className="text-sm font-semibold">{member.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{member.role}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeDraft(member.userId)}
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
            const leaderProfile = team.members.find((member) => member.id === team.leaderId);

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
                  팀장 {leaderProfile?.name ?? "-"} · {leaderProfile?.role ?? "-"}
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
          {teams.length === 0 && <EmptyText text="아직 등록된 팀이 없습니다." />}
        </div>
      </MobilePanel>
    </div>
  );
}

function AdminTab({
  pendingProfiles,
  approvedProfiles,
  reservations,
  newsItems,
  busyByUser,
  rehearsalByUser,
  approveProfile,
  addNews,
  deleteNews,
  cancelBooking,
  toggleSchedule,
}: {
  pendingProfiles: Profile[];
  approvedProfiles: Profile[];
  reservations: Reservation[];
  newsItems: NewsItem[];
  busyByUser: Record<string, string[]>;
  rehearsalByUser: Record<string, string[]>;
  approveProfile: (profileId: string, nextStatus: "approved" | "rejected") => Promise<void>;
  addNews: (payload: { title: string; body: string; tag: string }) => Promise<void>;
  deleteNews: (newsId: string) => Promise<void>;
  cancelBooking: (bookingId: string, reason: string) => Promise<void>;
  toggleSchedule: (userId: string, day: Day, time: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tag, setTag] = useState("공지");
  const [selectedUserId, setSelectedUserId] = useState("");

  const effectiveSelectedUserId = approvedProfiles.some((item) => item.id === selectedUserId) ? selectedUserId : approvedProfiles[0]?.id ?? "";
  const selectedProfile = approvedProfiles.find((item) => item.id === effectiveSelectedUserId);

  async function submitNews() {
    if (!title.trim() || !body.trim()) {
      return;
    }

    await addNews({ title: title.trim(), body: body.trim(), tag: tag.trim() || "공지" });
    setTitle("");
    setBody("");
    setTag("공지");
  }

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">관리자</p>
        <h3 className="mt-1 text-xl font-semibold">승인과 운영 관리</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          가입 승인, 소식 작성, 예약 취소, 부원 시간표 수정을 처리합니다.
        </p>
      </MobilePanel>

      <MobilePanel title="가입 승인">
        <div className="space-y-2">
          {pendingProfiles.map((item) => (
            <div key={item.id} className="rounded-lg border border-[#f0ded7] bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{item.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.cohort} · {item.student_no}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">{item.email}</p>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => approveProfile(item.id, "approved")} className="rounded-md bg-slate-950 px-2 py-1 text-xs font-semibold text-white">
                    승인
                  </button>
                  <button type="button" onClick={() => approveProfile(item.id, "rejected")} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                    거절
                  </button>
                </div>
              </div>
            </div>
          ))}
          {pendingProfiles.length === 0 && <EmptyText text="승인 대기 중인 부원이 없습니다." />}
        </div>
      </MobilePanel>

      <MobilePanel title="소식 작성">
        <div className="space-y-3">
          <LabeledInput label="태그" value={tag} onChange={setTag} placeholder="공지" />
          <LabeledInput label="제목" value={title} onChange={setTitle} placeholder="소식 제목" />
          <LabeledTextarea label="내용" value={body} onChange={setBody} placeholder="소식 내용을 입력하세요." />
          <button type="button" onClick={submitNews} className="h-10 w-full rounded-lg bg-slate-950 text-sm font-semibold text-white">
            소식 올리기
          </button>
        </div>
      </MobilePanel>

      <MobilePanel title="소식 관리">
        <div className="space-y-2">
          {newsItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#f0ded7] bg-white p-3">
              <div>
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-xs text-slate-500">{item.tag}</p>
              </div>
              <button type="button" onClick={() => deleteNews(item.id)} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                삭제
              </button>
            </div>
          ))}
          {newsItems.length === 0 && <EmptyText text="등록된 소식이 없습니다." />}
        </div>
      </MobilePanel>

      <MobilePanel title="예약 취소">
        <div className="space-y-2">
          {reservations.map((reservation) => (
            <div key={reservation.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#f0ded7] bg-white p-3">
              <div>
                <p className="text-sm font-semibold">{reservation.teamName}</p>
                <p className="mt-1 text-xs text-slate-500">
                {reservation.day} {reservation.start} · {reservation.duration}시간
                </p>
              </div>
              <button
                type="button"
                onClick={() => cancelBooking(reservation.id, "관리자 취소")}
                className="rounded-md bg-[#fff0eb] px-2 py-1 text-xs font-semibold text-[#be3d33]"
              >
                취소
              </button>
            </div>
          ))}
          {reservations.length === 0 && <EmptyText text="확정된 예약이 없습니다." />}
        </div>
      </MobilePanel>

      <MobilePanel title="부원 시간표 수정">
        <div className="space-y-3">
          <ProfileSelect label="부원" value={effectiveSelectedUserId} onChange={setSelectedUserId} profiles={approvedProfiles} />
          {selectedProfile ? (
            <>
              <p className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-slate-700">
                {selectedProfile.name} 부원의 불가 시간을 관리자 권한으로 수정합니다. 합주 시간은 예약 취소로만 풀립니다.
              </p>
              <ScheduleGrid
                busy={busyByUser[selectedProfile.id] ?? []}
                rehearsals={rehearsalByUser[selectedProfile.id] ?? []}
                onToggle={(day, time) => toggleSchedule(selectedProfile.id, day, time)}
              />
            </>
          ) : (
            <EmptyText text="승인된 부원이 없습니다." />
          )}
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
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none transition focus:border-[#ff665a]"
      />
    </label>
  );
}

function LabeledTextarea({
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
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 min-h-24 w-full resize-none rounded-lg border border-[#f0ded7] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#ff665a]"
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
  value: SessionRole;
  onChange: (value: SessionRole) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SessionRole)}
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

function ProfileSelect({
  label,
  value,
  onChange,
  profiles,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  profiles: Profile[];
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none transition focus:border-[#ff665a]"
      >
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · {profile.cohort}
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
  newsItems: NewsItem[];
  reservations: Reservation[];
}) {
  return (
    <div className="space-y-3">
      <MobilePanel title="동아리 소식">
        <div className="space-y-2">
          {newsItems.map((item) => (
            <article key={item.id} className="rounded-lg border border-[#f0ded7] bg-white p-3">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-slate-950 px-2 py-1 text-[11px] font-semibold text-white">{item.tag}</span>
                <h3 className="text-sm font-semibold">{item.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
            </article>
          ))}
          {newsItems.length === 0 && <EmptyText text="아직 올라온 소식이 없습니다." />}
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
          {reservations.length === 0 && <EmptyText text="다가오는 예약이 없습니다." />}
        </div>
      </MobilePanel>
    </div>
  );
}

function MobilePanel({ title, children }: { title?: string; children: ReactNode }) {
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

function ScheduleGrid({
  busy,
  rehearsals = [],
  onToggle,
}: {
  busy: string[];
  rehearsals?: string[];
  onToggle: (day: Day, time: string) => void;
}) {
  return (
    <div className="grid grid-cols-[44px_repeat(6,minmax(38px,1fr))] gap-1">
      <div />
      {days.map((day) => (
        <div key={day} className="flex h-8 items-center justify-center text-xs font-semibold text-slate-500">
          {day}
        </div>
      ))}
      {timeSlots.map((time) => (
        <MemberScheduleRow key={time} time={time} busy={busy} rehearsals={rehearsals} onToggle={onToggle} />
      ))}
    </div>
  );
}

function MemberScheduleRow({
  time,
  busy,
  rehearsals,
  onToggle,
}: {
  time: string;
  busy: string[];
  rehearsals: string[];
  onToggle: (day: Day, time: string) => void;
}) {
  return (
    <>
      <div className="flex h-9 items-center text-[11px] font-semibold text-slate-500">{time}</div>
      {days.map((day) => {
        const key = slotKey(day, time);
        const hasRehearsal = rehearsals.includes(key);
        const isBusy = busy.includes(key);

        return (
          <button
            key={key}
            type="button"
            disabled={hasRehearsal}
            onClick={() => onToggle(day, time)}
            className={`h-9 rounded-md border text-[10px] font-semibold transition ${
              hasRehearsal
                ? "border-amber-100 bg-amber-50 text-amber-800"
                : isBusy
                ? "border-[#ffb3aa] bg-[#fff0eb] text-[#be3d33]"
                : "border-emerald-100 bg-emerald-50 text-emerald-700"
            }`}
            aria-label={`${day} ${time} ${hasRehearsal ? "합주 있음" : isBusy ? "불가" : "가능"}`}
          >
            {hasRehearsal ? "합주" : isBusy ? "불가" : "가능"}
          </button>
        );
      })}
    </>
  );
}

function EmptyText({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed border-[#f0ded7] bg-white p-3 text-xs leading-5 text-slate-500">
      {text}
    </p>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <MobilePanel>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </MobilePanel>
  );
}
