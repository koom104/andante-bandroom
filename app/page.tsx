"use client";

import type { Session as SupabaseSession } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

type Day = "월" | "화" | "수" | "목" | "금" | "토" | "일";
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
  teamSong: string;
  leaderName: string;
  leaderRole?: SessionRole;
  memberCount: number;
  bookingDate?: string | null;
  day: Day;
  start: string;
  duration: number;
  purpose: string;
  status: "confirmed" | "cancelled";
};

type BookingSlot = {
  time: string;
  end: string;
  reservation?: Reservation;
  available: Member[];
  absent: Member[];
  absentReasons: Record<string, string>;
  status: "reserved" | "available" | "limited" | "unavailable";
};

type BookingGroup = {
  start: string;
  end: string;
  duration: number;
  times: string[];
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

const days: Day[] = ["월", "화", "수", "목", "금", "토", "일"];
const dateDayNames: Day[] = ["일", "월", "화", "수", "목", "금", "토"];
const sessionOptions: SessionRole[] = ["보컬", "리드기타", "세컨기타", "어쿠스틱", "드럼", "피아노", "신디"];
const scheduleStartMinutes = 10 * 60;
const scheduleEndMinutes = 24 * 60;
const slotMinutes = 30;
const timeSlots = Array.from({ length: (scheduleEndMinutes - scheduleStartMinutes) / slotMinutes }, (_, index) =>
  formatMinutes(scheduleStartMinutes + index * slotMinutes),
);
const timeBands = [
  { id: "morning", label: "오전", range: "10-14", start: 10 * 60, end: 14 * 60 },
  { id: "afternoon", label: "오후", range: "14-18", start: 14 * 60, end: 18 * 60 },
  { id: "evening", label: "저녁", range: "18-22", start: 18 * 60, end: 22 * 60 },
  { id: "night", label: "밤", range: "22-24", start: 22 * 60, end: 24 * 60 },
];

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
  { id: "booking", label: "메인", short: "홈" },
  { id: "suggestions", label: "예약", short: "R" },
  { id: "my", label: "마이", short: "M" },
  { id: "team", label: "팀", short: "+" },
  { id: "news", label: "소식", short: "N" },
];

const adminTab = { id: "admin" as const, label: "관리", short: "!" };

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function formatMinutes(totalMinutes: number) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addHours(time: string, hours: number) {
  return formatMinutes(timeToMinutes(time) + hours * 60);
}

function toISODate(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const year = copy.getFullYear();
  const month = String(copy.getMonth() + 1).padStart(2, "0");
  const day = String(copy.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseISODate(date: string) {
  return new Date(`${date}T00:00:00`);
}

function addDays(date: string, amount: number) {
  const next = parseISODate(date);
  next.setDate(next.getDate() + amount);
  return toISODate(next);
}

function todayISO() {
  return toISODate(new Date());
}

function dateToDay(date: string): Day {
  return dateDayNames[parseISODate(date).getDay()];
}

function startOfWeek(date: string) {
  const current = parseISODate(date);
  const dayIndex = current.getDay();
  const mondayOffset = dayIndex === 0 ? -6 : 1 - dayIndex;
  current.setDate(current.getDate() + mondayOffset);
  return toISODate(current);
}

function weekDates(anchorDate = todayISO()) {
  const start = startOfWeek(anchorDate);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function formatDateShort(date: string) {
  const parsed = parseISODate(date);
  return `${parsed.getMonth() + 1}.${parsed.getDate()}`;
}

function formatDateLabel(date: string) {
  return `${formatDateShort(date)} ${dateToDay(date)}요일`;
}

function reservationSlots(start: string, duration: number) {
  const startIndex = timeSlots.indexOf(start);
  if (startIndex < 0) {
    return [];
  }

  return timeSlots.slice(startIndex, startIndex + duration * (60 / slotMinutes));
}

function slotKey(day: Day, time: string) {
  return `${day}-${time}`;
}

function dateSlotKey(date: string, time: string) {
  return `${date}-${time}`;
}

function reservationMatchesDate(reservation: Reservation, date: string) {
  if (reservation.bookingDate) {
    return reservation.bookingDate === date;
  }

  return reservation.day === dateToDay(date);
}

function isReserved(reservation: Reservation, date: string, time: string) {
  return (
    reservation.status === "confirmed" &&
    reservationMatchesDate(reservation, date) &&
    reservationSlots(reservation.start, reservation.duration).includes(time)
  );
}

function findReservation(reservations: Reservation[], date: string, time: string) {
  return reservations.find((reservation) => isReserved(reservation, date, time));
}

function formatSlotHours(slotCount: number) {
  const hours = (slotCount * slotMinutes) / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function formatDuration(duration: number) {
  const totalMinutes = Math.round(duration * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}시간 ${minutes}분`;
  }

  if (hours > 0) {
    return `${hours}시간`;
  }

  return `${minutes}분`;
}

function groupBookingTimes(times: string[]): BookingGroup[] {
  const sortedTimes = [...new Set(times)].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  const groups: string[][] = [];

  for (const time of sortedTimes) {
    const currentGroup = groups[groups.length - 1];
    const previousTime = currentGroup?.[currentGroup.length - 1];

    if (!currentGroup || !previousTime || timeToMinutes(time) !== timeToMinutes(previousTime) + slotMinutes) {
      groups.push([time]);
      continue;
    }

    currentGroup.push(time);
  }

  return groups.map((group) => {
    const start = group[0];
    const duration = (group.length * slotMinutes) / 60;

    return {
      start,
      end: addHours(start, duration),
      duration,
      times: group,
    };
  });
}

function buildBookingSlots(
  team: Team,
  busy: Record<string, string[]>,
  rehearsalBusy: Record<string, string[]>,
  reservations: Reservation[],
  date: string,
) {
  const day = dateToDay(date);

  return timeSlots.map((time): BookingSlot => {
    const reservation = findReservation(reservations, date, time);
    const slots = reservationSlots(time, 0.5);

    if (reservation) {
      return {
        time,
        end: addHours(time, 0.5),
        reservation,
        available: [],
        absent: team.members,
        absentReasons: Object.fromEntries(team.members.map((member) => [member.id, "예약 있음"])),
        status: "reserved",
      };
    }

    const absentReasons: Record<string, string> = {};
    const available = team.members.filter((member) => {
      const manualBusy = busy[member.id] ?? [];
      const rehearsalSlots = rehearsalBusy[member.id] ?? [];
      const blockedByRehearsal = slots.some(
        (slot) => rehearsalSlots.includes(dateSlotKey(date, slot)) || rehearsalSlots.includes(slotKey(day, slot)),
      );
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

    return {
      time,
      end: addHours(time, 0.5),
      available,
      absent,
      absentReasons,
      status: available.length === team.members.length ? "available" : available.length > 0 ? "limited" : "unavailable",
    };
  });
}

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "알 수 없는 오류가 발생했습니다.");
  }

  return "알 수 없는 오류가 발생했습니다.";
}

function getScheduleErrorMessage(error: unknown) {
  const message = getErrorMessage(error);

  if (message.includes("member_schedules_start_time_check")) {
    return "DB 시간표 범위가 아직 예전 설정입니다. Supabase SQL Editor에서 patch-003-time-range-30min.sql을 한 번 실행해 주세요.";
  }

  return message;
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
  const [selectedBookingDate, setSelectedBookingDate] = useState(todayISO);
  const [bookingSelection, setBookingSelection] = useState<{ teamId: string; date: string; times: string[] }>({
    teamId: "",
    date: todayISO(),
    times: [],
  });
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

    const allTeams = rawTeams.map((team, index) => {
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
    });
    const teamById = new Map(allTeams.map((team) => [team.id, team]));
    const nextTeams = allTeams.filter((team) => profile.role === "admin" || team.members.some((member) => member.id === profile.id));
    const bookingRows = (bookingResult.data ?? []) as Array<{
      id: string;
      team_id: string;
      booking_date: string | null;
      day_of_week: Day;
      start_time: string;
      duration: number;
      purpose: string;
      status: "confirmed" | "cancelled";
    }>;

    const nextReservations = bookingRows.map((booking) => {
      const team = teamById.get(booking.team_id);
      const leader = team?.members.find((member) => member.id === team.leaderId);

      return {
        id: booking.id,
        teamId: booking.team_id,
        teamName: team?.name ?? "삭제된 팀",
        teamSong: team?.song ?? "",
        leaderName: leader?.name ?? "-",
        leaderRole: leader?.role,
        memberCount: team?.members.length ?? 0,
        bookingDate: booking.booking_date,
        day: booking.day_of_week,
        start: booking.start_time,
        duration: booking.duration,
        purpose: booking.purpose,
        status: booking.status,
      };
    });
    const rehearsalMap: Record<string, string[]> = {};
    for (const booking of nextReservations) {
      if (booking.status !== "confirmed") {
        continue;
      }

      const memberIds = teamMembersByTeam.get(booking.teamId) ?? [];
      for (const memberId of memberIds) {
        const reservationKeys = reservationSlots(booking.start, booking.duration).map((slot) =>
          booking.bookingDate ? dateSlotKey(booking.bookingDate, slot) : slotKey(booking.day, slot),
        );
        rehearsalMap[memberId] = [
          ...(rehearsalMap[memberId] ?? []),
          ...reservationKeys,
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
  const visibleTabs = profile?.role === "admin" ? [...baseTabs, adminTab] : baseTabs;
  const approvedProfiles = profiles.filter((item) => item.status === "approved");
  const pendingProfiles = profiles.filter((item) => item.status === "pending");
  const currentWeekDates = useMemo(() => weekDates(todayISO()), []);
  const leaderTeams = useMemo(() => teams.filter((team) => team.leaderId === profile?.id), [teams, profile?.id]);
  const selectedBookingTeam = leaderTeams.find((team) => team.id === selectedTeamId) ?? leaderTeams[0] ?? null;
  const bookingBusy = useMemo(() => selectedBookingTeam?.busy ?? emptyBusy, [selectedBookingTeam]);
  const selectedBookingTeamRehearsals = useMemo(
    () => Object.fromEntries((selectedBookingTeam?.members ?? []).map((member) => [member.id, rehearsalByUser[member.id] ?? []])),
    [selectedBookingTeam, rehearsalByUser],
  );
  const bookingSlots = useMemo(
    () => (selectedBookingTeam ? buildBookingSlots(selectedBookingTeam, bookingBusy, selectedBookingTeamRehearsals, reservations, selectedBookingDate) : []),
    [selectedBookingTeam, bookingBusy, selectedBookingTeamRehearsals, reservations, selectedBookingDate],
  );
  const selectableBookingTimes = useMemo(
    () => bookingSlots.filter((slot) => slot.status === "available" || slot.status === "limited").map((slot) => slot.time),
    [bookingSlots],
  );
  const selectedBookingTimes = useMemo(() => {
    const rawSelectedBookingTimes =
      bookingSelection.teamId === (selectedBookingTeam?.id ?? "") && bookingSelection.date === selectedBookingDate ? bookingSelection.times : [];
    const selectableTimes = new Set(selectableBookingTimes);
    return rawSelectedBookingTimes.filter((time) => selectableTimes.has(time));
  }, [bookingSelection, selectedBookingTeam?.id, selectedBookingDate, selectableBookingTimes]);
  const upcomingReservations = reservations
    .filter((reservation) => reservation.status === "confirmed")
    .slice()
    .sort((a, b) => {
      const dateCompare = (a.bookingDate ?? "").localeCompare(b.bookingDate ?? "");
      return dateCompare || days.indexOf(a.day) - days.indexOf(b.day) || timeToMinutes(a.start) - timeToMinutes(b.start);
    });

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
    setStatus(`${nextTeam.name} 팀을 선택했어요.`);
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
        setStatus(getScheduleErrorMessage(error));
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
        setStatus(getScheduleErrorMessage(error));
        return;
      }
    }

    setStatus("시간표 변경을 반영했어요.");
    await refreshData();
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
    setActiveTab("booking");
    setStatus(`${payload.teamName} 팀이 추가됐어요.`);
  }

  function getBookingErrorMessage(error: unknown) {
    const message = getErrorMessage(error);

    if (
      message.includes("create_booking") ||
      message.includes("create_bookings") ||
      message.includes("booking_date") ||
      message.includes("duration") ||
      message.includes("day_of_week") ||
      message.includes("bookings_duration_check") ||
      message.includes("예약 길이는")
    ) {
      return "DB 예약 구조가 아직 예전 설정입니다. Supabase SQL Editor에서 patch-005-multi-slot-bookings.sql을 한 번 실행해 주세요.";
    }

    return message;
  }

  function toggleBookingTime(time: string) {
    const teamId = selectedBookingTeam?.id ?? "";

    setBookingSelection((currentSelection) => {
      const currentTimes =
        currentSelection.teamId === teamId && currentSelection.date === selectedBookingDate ? currentSelection.times : [];
      const nextTimes = currentTimes.includes(time)
        ? currentTimes.filter((item) => item !== time)
        : [...currentTimes, time].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

      return {
        teamId,
        date: selectedBookingDate,
        times: nextTimes,
      };
    });
  }

  function clearBookingSelection() {
    setBookingSelection({
      teamId: selectedBookingTeam?.id ?? "",
      date: selectedBookingDate,
      times: [],
    });
  }

  async function reserveSelectedBookingTimes() {
    if (!selectedBookingTeam) {
      setActiveTab("team");
      setStatus("팀장인 팀만 예약할 수 있습니다. 팀 탭에서 팀을 만들거나 팀장에게 예약을 요청해 주세요.");
      return;
    }

    if (selectedBookingTimes.length === 0) {
      setStatus("예약할 시간대를 먼저 선택해 주세요.");
      return;
    }

    const selectableTimes = new Set(selectableBookingTimes);
    const validTimes = selectedBookingTimes.filter((time) => selectableTimes.has(time));

    if (validTimes.length === 0) {
      clearBookingSelection();
      setStatus("선택한 시간대가 이미 예약됐거나 예약할 수 없는 상태입니다.");
      return;
    }

    const bookingDay = dateToDay(selectedBookingDate);
    const bookingGroups = groupBookingTimes(validTimes);

    const { error } = await supabase.rpc("create_bookings", {
      p_team_id: selectedBookingTeam.id,
      p_day: bookingDay,
      p_booking_date: selectedBookingDate,
      p_purpose: selectedBookingTeam.song,
      p_groups: bookingGroups.map((group) => ({
        start_time: group.start,
        duration: group.duration,
      })),
    });

    if (error) {
      setStatus(getBookingErrorMessage(error));
      await refreshData();
      return;
    }

    const groupText = bookingGroups.map((group) => `${group.start}-${group.end}`).join(", ");
    clearBookingSelection();
    setStatus(`${formatDateLabel(selectedBookingDate)} ${groupText} 예약이 확정됐어요.`);
    setActiveTab("booking");
    await refreshData();
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
                    selectedTeam={selectedTeam}
                    reservations={upcomingReservations}
                    weekDates={currentWeekDates}
                    openTeamTab={() => setActiveTab("team")}
                    currentUserId={profile.id}
                    onCancelBooking={cancelBooking}
                  />
                )}

                {activeTab === "suggestions" && (
                  <SuggestionsTab
                    leaderTeams={leaderTeams}
                    selectedTeam={selectedBookingTeam}
                    changeTeam={changeTeam}
                    selectedDate={selectedBookingDate}
                    setSelectedDate={setSelectedBookingDate}
                    slots={bookingSlots}
                    selectedTimes={selectedBookingTimes}
                    onToggleSlot={toggleBookingTime}
                    onReserveSelected={reserveSelectedBookingTimes}
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
                <nav className="grid gap-1" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }} aria-label="앱 탭">
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
  const [email, setEmail] = useState("");
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
          className={`flex h-11 max-w-[120px] items-center justify-center truncate rounded-lg px-3 ${selectedTeam?.color ?? "bg-slate-800"} text-xs font-bold text-white`}
          aria-label="로그아웃"
          title={`${profile.name} 로그아웃`}
        >
          {profile.name}
        </button>
      </div>
      <p className="mt-3 rounded-lg border border-[#f0ded7] bg-white px-3 py-2 text-xs leading-5 text-slate-600">
        {status}
      </p>
    </header>
  );
}

function BookingTab({
  selectedTeam,
  reservations,
  weekDates,
  openTeamTab,
  currentUserId,
  onCancelBooking,
}: {
  selectedTeam: Team | null;
  reservations: Reservation[];
  weekDates: string[];
  openTeamTab: () => void;
  currentUserId: string;
  onCancelBooking: (bookingId: string, reason: string) => Promise<void>;
}) {
  const [selectedReservationDay, setSelectedReservationDay] = useState<string | null>(null);

  if (!selectedTeam) {
    return (
      <div className="space-y-3">
        <MobilePanel>
          <p className="text-xs font-semibold text-[#ef6351]">팀 필요</p>
          <h3 className="mt-1 text-2xl font-semibold">예약할 팀을 먼저 만들어 주세요</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            승인된 부원 목록에서 팀장과 멤버를 선택한 뒤 세션을 지정하면 팀 단위 예약을 만들 수 있습니다.
          </p>
        </MobilePanel>
        <button type="button" onClick={openTeamTab} className="h-12 w-full rounded-lg bg-slate-950 text-sm font-semibold text-white">
          팀 만들기
        </button>
      </div>
    );
  }

  const isLeader = selectedTeam.leaderId === currentUserId;
  const teamReservations = reservations.filter((reservation) => reservation.teamId === selectedTeam.id);
  const weekReservations = reservations
    .filter((reservation) => weekDates.some((date) => reservationMatchesDate(reservation, date)))
    .sort((a, b) => {
      const aDate = a.bookingDate ?? weekDates.find((date) => reservationMatchesDate(a, date)) ?? "";
      const bDate = b.bookingDate ?? weekDates.find((date) => reservationMatchesDate(b, date)) ?? "";
      return aDate.localeCompare(bDate) || timeToMinutes(a.start) - timeToMinutes(b.start);
    });
  const detailDate =
    selectedReservationDay && weekDates.includes(selectedReservationDay)
      ? selectedReservationDay
      : weekDates.find((date) => reservations.some((reservation) => reservationMatchesDate(reservation, date))) ?? weekDates[0];

  return (
    <div className="space-y-3">
      <MobilePanel title="이번 주 합주 일정">
        <div className="space-y-2">
          {weekReservations.slice(0, 5).map((reservation) => {
            const date = reservation.bookingDate ?? weekDates.find((item) => reservationMatchesDate(reservation, item));

            return (
              <div key={reservation.id} className="rounded-lg border border-[#f0ded7] bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{date ? formatDateLabel(date) : `${reservation.day}요일`}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {reservation.teamName} - {reservation.purpose || reservation.teamSong || "합주"}
                    </p>
                  </div>
                  <p className="rounded-lg bg-slate-950 px-3 py-2 text-right text-xs font-semibold text-white">
                    {reservation.start}
                    <br />
                    {addHours(reservation.start, reservation.duration)}
                  </p>
                </div>
              </div>
            );
          })}
          {weekReservations.length === 0 && <EmptyText text="이번 주에 잡힌 합주가 없습니다." />}
        </div>
      </MobilePanel>

      <MobilePanel title="이번 주 예약 현황">
        <div className="space-y-2">
          {weekDates.map((date) => (
            <CompactDayRow
              key={date}
              date={date}
              reservations={reservations}
              selectedTeamId={selectedTeam.id}
              isSelected={detailDate === date}
              onSelect={() => setSelectedReservationDay(date)}
            />
          ))}
        </div>
      </MobilePanel>

      <ReservationDetailPanel date={detailDate} reservations={reservations} selectedTeamId={selectedTeam.id} />

      {isLeader && (
        <MobilePanel title="팀장 예약 관리">
          <div className="space-y-2">
            {teamReservations.map((reservation) => (
              <div key={reservation.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#f0ded7] bg-white p-3">
                <div>
                  <p className="text-sm font-semibold">
                    {reservation.bookingDate ? formatDateLabel(reservation.bookingDate) : `${reservation.day}요일`} {reservation.start}-
                    {addHours(reservation.start, reservation.duration)}
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

    </div>
  );
}

function SuggestionsTab({
  leaderTeams,
  selectedTeam,
  changeTeam,
  selectedDate,
  setSelectedDate,
  slots,
  selectedTimes,
  onToggleSlot,
  onReserveSelected,
}: {
  leaderTeams: Team[];
  selectedTeam: Team | null;
  changeTeam: (teamId: string) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  slots: BookingSlot[];
  selectedTimes: string[];
  onToggleSlot: (time: string) => void;
  onReserveSelected: () => Promise<void>;
}) {
  const quickDates = Array.from({ length: 21 }, (_, index) => addDays(todayISO(), index));
  const availableCount = slots.filter((slot) => slot.status === "available").length;
  const limitedCount = slots.filter((slot) => slot.status === "limited").length;
  const reservedCount = slots.filter((slot) => slot.status === "reserved").length;
  const selectedGroups = groupBookingTimes(selectedTimes);
  const selectedDuration = selectedTimes.length * 0.5;

  return (
    <div className="space-y-3">
      <MobilePanel title="예약 팀 선택">
        {leaderTeams.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {leaderTeams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => changeTeam(team.id)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs font-semibold ${
                  selectedTeam?.id === team.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white"
                }`}
              >
                <span className="block">{team.name}</span>
                <span className="mt-1 block opacity-75">{team.song || "합주 목표 없음"}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyText text="팀장인 팀만 예약할 수 있습니다. 팀 탭에서 팀을 만들거나 팀장에게 예약을 요청해 주세요." />
        )}
      </MobilePanel>

      {!selectedTeam && <EmptyState title="예약할 수 있는 팀이 없습니다" body="팀장인 팀이 있을 때만 합주실 예약을 만들 수 있습니다." />}

      {selectedTeam && (
        <>
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">합주 예약</p>
        <h3 className="mt-1 text-2xl font-semibold">{formatDateLabel(selectedDate)}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {selectedTeam.name} 팀 기준으로 예약 가능한 30분 단위 시간대를 표시합니다.
        </p>
      </MobilePanel>

      <MobilePanel title="날짜 선택">
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">예약 날짜</span>
          <div className="mt-2 flex h-11 w-full items-center rounded-lg border border-[#f0ded7] bg-white px-3 text-sm font-semibold">
            {selectedDate}
          </div>
        </label>
        <p className="mt-3 text-xs font-semibold text-slate-500">오늘부터 3주</p>
        <div className="mt-2 grid grid-cols-7 gap-1">
          {quickDates.map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              className={`h-14 rounded-lg border text-xs font-semibold ${
                selectedDate === date ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white text-slate-600"
              }`}
            >
              <span className="block">{dateToDay(date)}</span>
              <span className="mt-1 block">{formatDateShort(date)}</span>
            </button>
          ))}
        </div>
      </MobilePanel>

      <MobilePanel title="예약 가능 시간">
        <div className="grid grid-cols-3 gap-2">
          <ProfileStat label="전원 가능" value={`${availableCount}개`} />
          <ProfileStat label="일부 가능" value={`${limitedCount}개`} />
          <ProfileStat label="예약 완료" value={`${reservedCount}개`} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">전원 가능</span>
          <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">일부 가능</span>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">예약 완료</span>
        </div>
      </MobilePanel>

      <MobilePanel title="선택한 시간">
        {selectedGroups.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <ProfileStat label="선택 길이" value={formatDuration(selectedDuration)} />
              <ProfileStat label="예약 건수" value={`${selectedGroups.length}건`} />
            </div>
            <div className="space-y-2">
              {selectedGroups.map((group) => (
                <div key={`${group.start}-${group.end}`} className="flex items-center justify-between rounded-lg bg-[#fff0eb] px-3 py-2">
                  <span className="text-sm font-semibold">
                    {group.start}-{group.end}
                  </span>
                  <span className="text-xs font-semibold text-[#be3d33]">{formatDuration(group.duration)}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void onReserveSelected()}
              className="h-12 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(239,99,81,0.24)]"
            >
              선택한 시간 예약하기
            </button>
          </div>
        ) : (
          <EmptyText text="예약할 시간대를 여러 개 선택한 뒤 한 번에 예약할 수 있습니다." />
        )}
      </MobilePanel>

      <div className="space-y-3">
        {timeBands.map((band) => {
          const bandSlots = slots.filter((slot) => {
            const minutes = timeToMinutes(slot.time);
            return minutes >= band.start && minutes < band.end;
          });

          return (
            <MobilePanel key={band.id} title={`${band.label} ${band.range}`}>
              <div className="space-y-2">
                {bandSlots.map((slot) => (
                  <BookingSlotRow
                    key={slot.time}
                    slot={slot}
                    teamSize={selectedTeam.members.length}
                    isSelected={selectedTimes.includes(slot.time)}
                    onToggle={onToggleSlot}
                  />
                ))}
              </div>
            </MobilePanel>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}

function BookingSlotRow({
  slot,
  teamSize,
  isSelected,
  onToggle,
}: {
  slot: BookingSlot;
  teamSize: number;
  isSelected: boolean;
  onToggle: (time: string) => void;
}) {
  const disabled = slot.status === "reserved" || slot.status === "unavailable";
  const statusLabel =
    slot.status === "reserved" ? "예약 완료" : slot.status === "available" ? "전원 가능" : slot.status === "limited" ? "일부 가능" : "불가";
  const badgeClass =
    slot.status === "reserved"
      ? "bg-slate-100 text-slate-500"
      : slot.status === "available"
        ? "bg-emerald-50 text-emerald-700"
        : slot.status === "limited"
          ? "bg-amber-50 text-amber-800"
          : "bg-rose-50 text-rose-700";

  return (
    <div className={`rounded-lg border p-3 ${isSelected ? "border-[#ff665a] bg-[#fff8f4]" : "border-[#f0ded7] bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {slot.time}-{slot.end}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {slot.reservation
              ? `${slot.reservation.teamName} 예약`
              : `${slot.available.length}/${teamSize}명 가능`}
          </p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${badgeClass}`}>{statusLabel}</span>
      </div>

      {slot.absent.length > 0 && slot.status !== "reserved" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {slot.absent.map((member) => (
            <span key={member.id} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
              {member.name} {slot.absentReasons[member.id] ?? "불가"}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onToggle(slot.time)}
        className={`mt-3 h-10 w-full rounded-lg text-sm font-semibold ${
          disabled
            ? "bg-slate-100 text-slate-400"
            : isSelected
              ? "border border-[#ff665a] bg-white text-[#be3d33]"
              : "bg-[#ff665a] text-white"
        }`}
      >
        {slot.status === "reserved" ? "이미 예약됨" : slot.status === "unavailable" ? "예약 불가" : isSelected ? "선택 해제" : "선택"}
      </button>
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
          <ProfileStat label="불가 시간" value={formatSlotHours(busyCount)} />
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
          30분 단위로 편집 가능합니다. 원하는 시간대를 한 번 클릭하면 합주 가능/불가능으로 전환됩니다.
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
                  {reservation.bookingDate ? formatDateLabel(reservation.bookingDate) : `${reservation.day}요일`} {reservation.start} ·{" "}
                  {formatDuration(reservation.duration)}
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
                {reservation.bookingDate ? formatDateShort(reservation.bookingDate) : reservation.day}
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
  date,
  reservations,
  selectedTeamId,
  isSelected,
  onSelect,
}: {
  date: string;
  reservations: Reservation[];
  selectedTeamId: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const day = dateToDay(date);
  const dayReservations = reservations
    .filter((reservation) => reservation.status === "confirmed" && reservationMatchesDate(reservation, date))
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  const reservedSlotCount = new Set(dayReservations.flatMap((reservation) => reservationSlots(reservation.start, reservation.duration))).size;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-3 text-left transition ${
        isSelected ? "border-[#ff665a] bg-[#fff0eb]" : "border-[#f0ded7] bg-white"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          {day}요일 <span className="text-xs text-slate-500">{formatDateShort(date)}</span>
        </span>
        <span className={`text-xs ${isSelected ? "font-semibold text-[#be3d33]" : "text-slate-500"}`}>
          {isSelected ? "상세 보기" : "10:00-24:00"}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>{dayReservations.length > 0 ? `${dayReservations.length}건 예약` : "예약 없음"}</span>
        <span>{reservedSlotCount > 0 ? `${formatSlotHours(reservedSlotCount)} 사용` : "전체 비어 있음"}</span>
      </div>
      <div className="mt-3 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${timeSlots.length}, minmax(0, 1fr))` }}>
        {timeSlots.map((time) => {
          const reservation = findReservation(reservations, date, time);
          const isMine = reservation?.teamId === selectedTeamId;

          return (
            <div
              key={`${day}-${time}`}
              title={`${formatDateLabel(date)} ${time} ${reservation ? reservation.teamName : "빈 시간"}`}
              className={`h-5 rounded-sm ${
                reservation
                  ? isMine
                    ? "bg-[#ff665a]"
                    : "bg-slate-300"
                  : "bg-emerald-100"
              }`}
            >
              <span className="sr-only">{reservation ? reservation.teamName : "빈 시간"}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 space-y-1.5">
        {dayReservations.slice(0, 4).map((reservation) => {
          const isMine = reservation.teamId === selectedTeamId;

          return (
            <div
              key={reservation.id}
              className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs ${
                isMine ? "bg-[#fff0eb] text-[#be3d33]" : "bg-slate-100 text-slate-600"
              }`}
            >
              <span className="font-semibold">
                {reservation.start}-{addHours(reservation.start, reservation.duration)}
              </span>
              <span className="truncate">{reservation.teamName}</span>
            </div>
          );
        })}
        {dayReservations.length > 4 && <p className="text-xs text-slate-500">외 {dayReservations.length - 4}건 더 있음</p>}
      </div>
    </button>
  );
}

function ReservationDetailPanel({
  date,
  reservations,
  selectedTeamId,
}: {
  date: string;
  reservations: Reservation[];
  selectedTeamId: string;
}) {
  const dayReservations = reservations
    .filter((reservation) => reservation.status === "confirmed" && reservationMatchesDate(reservation, date))
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  return (
    <MobilePanel title={`${formatDateLabel(date)} 예약 상세`}>
      <div className="space-y-2">
        {dayReservations.map((reservation) => {
          const isMine = reservation.teamId === selectedTeamId;

          return (
            <article
              key={reservation.id}
              className={`rounded-lg border p-3 ${
                isMine ? "border-[#ffb3aa] bg-[#fff8f4]" : "border-[#f0ded7] bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h4 className="truncate text-base font-semibold">{reservation.teamName}</h4>
                    <span
                      className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                        isMine ? "bg-[#ff665a] text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isMine ? "내 팀" : "다른 팀"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    대표자 {reservation.leaderName}
                    {reservation.leaderRole ? ` · ${reservation.leaderRole}` : ""}
                  </p>
                </div>
                <div className="shrink-0 rounded-lg bg-slate-950 px-3 py-2 text-right text-white">
                  <p className="text-xs text-slate-300">예약 시간</p>
                  <p className="mt-0.5 text-sm font-semibold">
                    {reservation.start}-{addHours(reservation.start, reservation.duration)}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <ReservationMeta label="길이" value={formatDuration(reservation.duration)} />
                <ReservationMeta label="멤버" value={reservation.memberCount > 0 ? `${reservation.memberCount}명` : "-"} />
                <ReservationMeta label="날짜" value={reservation.bookingDate ? formatDateShort(reservation.bookingDate) : `${reservation.day} 반복`} />
              </div>

              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-slate-500">예약 목적</p>
                <p className="mt-1 text-sm leading-5 text-slate-700">{reservation.purpose || reservation.teamSong || "합주 예약"}</p>
              </div>
            </article>
          );
        })}
        {dayReservations.length === 0 && <EmptyText text={`${formatDateLabel(date)}에는 아직 예약이 없습니다.`} />}
      </div>
    </MobilePanel>
  );
}

function ReservationMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-semibold text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950">{value}</p>
    </div>
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
  const [selectedBandId, setSelectedBandId] = useState(timeBands[0].id);
  const selectedBand = timeBands.find((band) => band.id === selectedBandId) ?? timeBands[0];
  const visibleTimeSlots = timeSlots.filter((time) => {
    const minutes = timeToMinutes(time);
    return minutes >= selectedBand.start && minutes < selectedBand.end;
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1">
        {timeBands.map((band) => (
          <button
            key={band.id}
            type="button"
            onClick={() => setSelectedBandId(band.id)}
            className={`h-11 rounded-lg border text-xs font-semibold ${
              selectedBand.id === band.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white text-slate-600"
            }`}
          >
            <span className="block">{band.label}</span>
            <span className="block text-[10px] opacity-75">{band.range}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{selectedBand.label} 시간대</span>
        <span>30분 단위</span>
      </div>
      <div className="grid grid-cols-[42px_repeat(7,minmax(32px,1fr))] gap-1">
        <div />
        {days.map((day) => (
          <div key={day} className="flex h-8 items-center justify-center text-xs font-semibold text-slate-500">
            {day}
          </div>
        ))}
        {visibleTimeSlots.map((time) => (
          <MemberScheduleRow key={time} time={time} busy={busy} rehearsals={rehearsals} onToggle={onToggle} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
        <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">가능</span>
        <span className="rounded-md bg-[#fff0eb] px-2 py-1 text-[#be3d33]">불가</span>
        <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">합주</span>
      </div>
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
