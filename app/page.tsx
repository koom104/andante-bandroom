"use client";

import type { Session as SupabaseSession } from "@supabase/supabase-js";
import { Check, ChevronLeft, ChevronRight, LockKeyhole, LogOut, Plus, Trash2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { supabase } from "./supabase";
import { WorkspaceShell, workspaceTitles } from "./workspace-shell";
import { buildDateScheduleRows, updateDateScheduleDraft, type DateScheduleDrafts } from "./date-schedule-drafts";
import { isAccountChange, restoredTab } from "./session-navigation";
import { syncPushSubscription } from "./push-client";
import { LoadingScreen, LoadingStatus } from "./loading-state";
import { AppearanceSelector } from "./appearance";
import { sessionDisplayOrder, sortTeamMembersBySession } from "./team-member-order";
import { sortGoalCategories } from "./goal-order";

type Day = "월" | "화" | "수" | "목" | "금" | "토" | "일";
const RecapTab = lazy(() => import("./recap-tab"));
type Tab = "booking" | "suggestions" | "calendar" | "my" | "team" | "admin" | "recap";
type Role = "member" | "manager" | "admin";
type ProfileStatus = "pending" | "approved" | "rejected" | "suspended";
type SessionRole = "보컬" | "리드기타" | "리듬기타" | "어쿠스틱" | "베이스" | "드럼" | "피아노" | "신디";
type ScheduleSlotSelection = {
  day: Day;
  time: string;
};

type ScheduleColumn = {
  label: string;
  day: Day;
  date?: string;
};

type ScheduleScope = "weekly" | "date";
type BookingLocation = "club_room" | "external";
type BookingType = "rehearsal" | "room_block";

type Profile = {
  id: string;
  email: string;
  name: string;
  cohort: string;
  student_no: string;
  role: Role;
  status: ProfileStatus;
  password_reset_required?: boolean;
  privacy_consent_at?: string | null;
  privacy_consent_version?: string | null;
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

type ClubRoomStatus = {
  isOpen: boolean;
  updatedAt?: string | null;
  updatedByName?: string;
  updatedByCohort?: string;
};

type GoalCategory = {
  id: string;
  name: string;
  created_at?: string;
};

type PushSubscriptionStatus = {
  userId: string;
  name: string;
  cohort: string;
  hasPush: boolean;
  registeredAt?: string | null;
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
  location: BookingLocation;
  bookingType: BookingType;
  attendanceUserIds?: string[];
  sourceType?: "booking" | "notion_history";
  creditedMinutes?: number;
  isOwnTeam?: boolean;
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

type BookingSlotFilter = "all" | "available" | "limited" | "reserved";

type BookingGroup = {
  start: string;
  end: string;
  duration: number;
  times: string[];
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

type UpdateTeamPayload = NewTeamPayload & {
  teamId: string;
};

type RehearsalStats = {
  totalDuration: number;
  rank: number | null;
  rankedCount: number;
};

type RehearsalRankRow = {
  userId: string;
  name: string;
  cohort: string;
  totalDuration: number;
  rank: number;
};

type TeamRehearsalTotal = {
  totalDuration: number;
  totalSessionDuration: number;
};

const days: Day[] = ["월", "화", "수", "목", "금", "토", "일"];
const dateDayNames: Day[] = ["일", "월", "화", "수", "목", "금", "토"];
const sessionOptions: SessionRole[] = [...sessionDisplayOrder];
const privacyConsentVersion = "2026-07-31-v1";

function normalizeSessionRole(session: string): SessionRole {
  return session === "세컨기타" ? "리듬기타" : (session as SessionRole);
}
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
const allGoalFilterValue = "__all_goals__";

const baseTabs: Array<{ id: Tab; label: string; short: string }> = [
  { id: "booking", label: "메인", short: "홈" },
  { id: "calendar", label: "캘린더", short: "C" },
  { id: "suggestions", label: "예약", short: "R" },
  { id: "my", label: "마이", short: "M" },
  { id: "team", label: "팀", short: "+" },
];

const adminTab = { id: "admin" as const, label: "관리", short: "!" };

function canUseAdminTab(profile?: Profile | null) {
  return profile?.status === "approved" && (profile.role === "admin" || profile.role === "manager");
}

function isSuperAdmin(profile?: Profile | null) {
  return profile?.status === "approved" && profile.role === "admin";
}

function profileRoleLabel(role: Role) {
  if (role === "admin") {
    return "최고 관리자";
  }

  if (role === "manager") {
    return "집기";
  }

  return "부원";
}

function normalizeCohort(value: string) {
  const trimmed = value.trim();
  const numericMatch = trimmed.match(/^0*(\d+)\s*기?$/);

  if (numericMatch) {
    return `${numericMatch[1]}기`;
  }

  return trimmed;
}

async function fetchAllRows<T>(tableName: string, pageSize = 1000): Promise<{ data: T[] | null; error: unknown | null }> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(tableName).select("*").range(from, to);

    if (error) {
      return { data: null, error };
    }

    const pageRows = (data ?? []) as T[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      return { data: rows, error: null };
    }
  }
}

async function fetchRowsByUserIds<T>(
  tableName: string,
  userIds: string[],
  columns = "*",
  pageSize = 1000,
): Promise<{ data: T[] | null; error: unknown | null }> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const rows: T[] = [];

  if (uniqueUserIds.length === 0) {
    return { data: [], error: null };
  }

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(tableName).select(columns).in("user_id", uniqueUserIds).range(from, to);

    if (error) {
      return { data: null, error };
    }

    const pageRows = (data ?? []) as T[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      return { data: rows, error: null };
    }
  }
}

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

function threeWeekCalendarCells(anchorDate = todayISO()) {
  const anchor = parseISODate(anchorDate);
  const leadingEmptyDays = anchor.getDay();
  const futureDates = Array.from({ length: 21 }, (_, index) => addDays(anchorDate, index));

  return [...Array<string | null>(leadingEmptyDays).fill(null), ...futureDates];
}

function nextDateForDay(day: Day, anchorDate = todayISO()) {
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(anchorDate, index);
    if (dateToDay(date) === day) {
      return date;
    }
  }

  return anchorDate;
}

function reservationDisplayDate(reservation: Reservation, anchorDate = todayISO()) {
  return reservation.bookingDate ?? nextDateForDay(reservation.day, anchorDate);
}

function isFutureReservation(reservation: Reservation, anchorDate = todayISO()) {
  return reservation.status === "confirmed" && reservationDisplayDate(reservation, anchorDate) >= anchorDate;
}

function isCancelableReservation(reservation: Reservation, anchorDate = todayISO()) {
  return reservation.status === "confirmed" && reservationDisplayDate(reservation, anchorDate) >= anchorDate;
}

function isReservationPast(reservation: Reservation, now = new Date()) {
  const today = toISODate(now);
  const date = reservationDisplayDate(reservation, today);

  if (date < today) {
    return true;
  }

  if (date > today) {
    return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return timeToMinutes(reservation.start) + reservation.duration * 60 <= currentMinutes;
}

function compareReservationsByDateTime(a: Reservation, b: Reservation) {
  const dateCompare = reservationDisplayDate(a).localeCompare(reservationDisplayDate(b));
  return dateCompare || timeToMinutes(a.start) - timeToMinutes(b.start);
}

function memberRehearsalStats(
  userId: string,
  profiles: Profile[],
  teams: Team[],
  reservations: Reservation[],
  busy: Record<string, string[]> = emptyBusy,
  dateBusy: Record<string, Record<string, string[]>> = {},
  dateOverrides: Record<string, string[]> = {},
  anchorDate = todayISO(),
): RehearsalStats {
  const leaderboard = memberRehearsalLeaderboard(profiles, teams, reservations, busy, dateBusy, dateOverrides, anchorDate);
  const currentRow = leaderboard.find((row) => row.userId === userId);
  const totalDuration = currentRow?.totalDuration ?? 0;
  const rankedCount = leaderboard.length;
  const rank = currentRow?.rank ?? null;

  return { totalDuration, rank, rankedCount };
}

function memberRehearsalLeaderboard(
  profiles: Profile[],
  teams: Team[],
  reservations: Reservation[],
  busy: Record<string, string[]> = emptyBusy,
  dateBusy: Record<string, Record<string, string[]>> = {},
  dateOverrides: Record<string, string[]> = {},
  anchorDate = todayISO(),
): RehearsalRankRow[] {
  const rankedProfiles = profiles.filter((profile) => profile.role !== "admin");
  const profileById = new Map(rankedProfiles.map((profile) => [profile.id, profile]));
  const totals = new Map(rankedProfiles.map((profile) => [profile.id, 0]));
    const teamById = new Map(teams.map((team) => [team.id, team]));

    for (const reservation of reservations) {
      if (reservation.status !== "confirmed" || !reservation.bookingDate || reservation.bookingDate >= anchorDate) {
        continue;
      }

      const team = teamById.get(reservation.teamId);
      if (!team) {
        continue;
      }

      const participantIds = reservation.attendanceUserIds ?? team.members.map((member) => member.id);
      const hasAttendanceSnapshot = reservation.attendanceUserIds !== undefined;

      for (const memberId of participantIds) {
        if (!profileById.has(memberId)) {
          continue;
        }

        if (!hasAttendanceSnapshot && isMemberUnavailableForReservation(memberId, reservation, busy, dateBusy, dateOverrides)) {
          continue;
        }

        totals.set(memberId, (totals.get(memberId) ?? 0) + reservation.duration);
      }
    }

  const rows = [...totals.entries()]
    .map(([userId, totalDuration]) => {
      const profile = profileById.get(userId);

      return {
        userId,
        name: profile?.name ?? "-",
        cohort: profile?.cohort ?? "-",
        totalDuration,
        rank: 0,
      };
    });

  return rankRehearsalLeaderboard(rows);
}

async function fetchDateScheduleRowsByUserIds<T>(
  userIds: string[],
  startDate: string,
  endDate: string,
  pageSize = 1000,
): Promise<{ data: T[] | null; error: unknown | null }> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const rows: T[] = [];

  if (uniqueUserIds.length === 0) {
    return { data: [], error: null };
  }

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("member_schedule_date_slots")
      .select("user_id,schedule_date,start_time,is_busy")
      .in("user_id", uniqueUserIds)
      .gte("schedule_date", startDate)
      .lte("schedule_date", endDate)
      .range(from, to);

    if (error) {
      return { data: null, error };
    }

    const pageRows = (data ?? []) as T[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      return { data: rows, error: null };
    }
  }
}

function rankRehearsalLeaderboard(rows: RehearsalRankRow[]): RehearsalRankRow[] {
  const sortedRows = [...rows].sort(
    (a, b) => b.totalDuration - a.totalDuration || a.cohort.localeCompare(b.cohort) || a.name.localeCompare(b.name),
  );

  let previousDuration: number | null = null;
  let previousRank = 0;

  return sortedRows.map((row) => {
    const rank = previousDuration === row.totalDuration ? previousRank : previousRank + 1;
    previousDuration = row.totalDuration;
    previousRank = rank;

    return { ...row, rank };
  });
}

function isMemberUnavailableForReservation(
  userId: string,
  reservation: Reservation,
  busy: Record<string, string[]>,
  dateBusy: Record<string, Record<string, string[]>>,
  dateOverrides: Record<string, string[]>,
) {
  if (!reservation.bookingDate) {
    return false;
  }

  const date = reservation.bookingDate;
  const day = dateToDay(date);
  const slots = reservationSlots(reservation.start, reservation.duration);
  const hasDateOverride = dateOverrides[userId]?.includes(date);
  const busySlots = hasDateOverride ? dateBusy[userId]?.[date] ?? [] : busy[userId] ?? [];

  return slots.some((slot) => (hasDateOverride ? busySlots.includes(slot) : busySlots.includes(slotKey(day, slot))));
}

function formatDateShort(date: string) {
  const parsed = parseISODate(date);
  return `${parsed.getMonth() + 1}.${parsed.getDate()}`;
}

function formatDateLabel(date: string) {
  return `${formatDateShort(date)} ${dateToDay(date)}요일`;
}

function formatUpdatedAt(value?: string | null) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  const month = parsed.getMonth() + 1;
  const day = parsed.getDate();
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  return `${month}.${day} ${hour}:${minute}`;
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

function weeklyKeyToTime(key: string) {
  return key.slice(2);
}

function scheduleSetsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const leftSet = new Set(left);
  return right.every((item) => leftSet.has(item));
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
  dateBusy: Record<string, Record<string, string[]>>,
  dateOverrides: Record<string, string[]>,
  rehearsalBusy: Record<string, string[]>,
  reservations: Reservation[],
  date: string,
  location: BookingLocation,
) {
  const day = dateToDay(date);

  return timeSlots.map((time): BookingSlot => {
    const reservation =
      location === "club_room"
        ? reservations.find((item) => item.location === "club_room" && isReserved(item, date, time))
        : undefined;
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
      const hasDateOverride = dateOverrides[member.id]?.includes(date);
      const manualBusy = hasDateOverride ? dateBusy[member.id]?.[date] ?? [] : busy[member.id] ?? [];
      const rehearsalSlots = rehearsalBusy[member.id] ?? [];
      const blockedByRehearsal = slots.some(
        (slot) => rehearsalSlots.includes(dateSlotKey(date, slot)) || rehearsalSlots.includes(slotKey(day, slot)),
      );
      const blockedManually = slots.some((slot) => (hasDateOverride ? manualBusy.includes(slot) : manualBusy.includes(slotKey(day, slot))));

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

  if (isMissingSchemaError(message) || message.includes("member_schedule_date_slots")) {
    return "날짜별 시간표 DB 구조가 필요합니다. Supabase SQL Editor에서 patch-010-team-date-schedule-signup.sql을 한 번 실행해 주세요.";
  }

  return message;
}

function isMissingSchemaError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("relation") || normalized.includes("does not exist") || normalized.includes("schema") || normalized.includes("could not find");
}

function useAppViewportHeight() {
  useEffect(() => {
    const syncViewportHeight = () => {
      if (isTextEditingElement(document.activeElement)) {
        return;
      }

      document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
    };
    const syncViewportHeightAfterFocusOut = () => {
      window.setTimeout(syncViewportHeight, 250);
    };

    syncViewportHeight();

    window.addEventListener("resize", syncViewportHeight);
    window.addEventListener("orientationchange", syncViewportHeight);
    document.addEventListener("focusout", syncViewportHeightAfterFocusOut);

    return () => {
      window.removeEventListener("resize", syncViewportHeight);
      window.removeEventListener("orientationchange", syncViewportHeight);
      document.removeEventListener("focusout", syncViewportHeightAfterFocusOut);
    };
  }, []);
}

function isTextEditingElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.tagName === "TEXTAREA") {
    return true;
  }

  if (target.tagName !== "INPUT") {
    return false;
  }

  const input = target as HTMLInputElement;
  const type = input.type || "text";
  return ["email", "number", "password", "search", "tel", "text", "url"].includes(type);
}

function useMobileTextInputFocus() {
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const syncFocusState = () => {
      setIsFocused(isTextEditingElement(document.activeElement));
    };

    const handleFocusOut = () => {
      window.setTimeout(syncFocusState, 50);
    };

    document.addEventListener("focusin", syncFocusState);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      document.removeEventListener("focusin", syncFocusState);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return isFocused;
}

export default function Home() {
  useAppViewportHeight();
  const isTextInputFocused = useMobileTextInputFocus();

  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [clubRoomStatus, setClubRoomStatus] = useState<ClubRoomStatus | null>(null);
  const [isClubRoomStatusReady, setIsClubRoomStatusReady] = useState(true);
  const [goalCategories, setGoalCategories] = useState<GoalCategory[]>([]);
  const [busyByUser, setBusyByUser] = useState<Record<string, string[]>>({});
  const [dateBusyByUser, setDateBusyByUser] = useState<Record<string, Record<string, string[]>>>({});
  const [dateOverrideByUser, setDateOverrideByUser] = useState<Record<string, string[]>>({});
  const [rehearsalByUser, setRehearsalByUser] = useState<Record<string, string[]>>({});
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rehearsalLeaderboardRows, setRehearsalLeaderboardRows] = useState<RehearsalRankRow[]>([]);
  const [teamRehearsalTotals, setTeamRehearsalTotals] = useState<Record<string, TeamRehearsalTotal>>({});
  const [pushSubscriptionStatuses, setPushSubscriptionStatuses] = useState<PushSubscriptionStatus[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedBookingGoal, setSelectedBookingGoal] = useState("");
  const [selectedBookingLocation, setSelectedBookingLocation] = useState<BookingLocation | "">("");
  const [selectedBookingDate, setSelectedBookingDate] = useState(todayISO);
  const [bookingSelection, setBookingSelection] = useState<{
    teamId: string;
    date: string;
    location: BookingLocation | "";
    times: string[];
  }>({
    teamId: "",
    date: todayISO(),
    location: "",
    times: [],
  });
  const [activeTab, setActiveTab] = useState<Tab>("booking");
  const [status, setStatus] = useState("로그인 후 팀 예약을 시작할 수 있어요.");
  const [authNotice, setAuthNotice] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const rehearsalStatsCacheRef = useRef({ profileId: "", loadedAt: 0 });
  const loadedProfileUserRef = useRef("");
  const [pushHealth, setPushHealth] = useState("");

  useEffect(() => {
    if (activeTab === "suggestions") {
      return;
    }

    setBookingSelection((currentSelection) =>
      currentSelection.times.length === 0
        ? currentSelection
        : {
            ...currentSelection,
            times: [],
          },
    );
  }, [activeTab]);

  const loadProfile = useCallback(async (authSession: SupabaseSession) => {
    if (loadedProfileUserRef.current !== authSession.user.id) setIsBooting(true);
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
      loadedProfileUserRef.current = user.id;
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

    loadedProfileUserRef.current = user.id;
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
    const profileRequest = canUseAdminTab(profile)
      ? supabase.from("profiles").select("*").order("created_at", { ascending: true })
      : supabase.rpc("get_member_directory");

    const [
      profileResult,
      teamResult,
      memberResult,
      bookingResult,
      goalCategoryResult,
      clubRoomStatusResult,
      pushSubscriptionStatusResult,
    ] = await Promise.all([
      profileRequest,
      supabase.from("teams").select("id,name,song,color_index,created_at").order("created_at", { ascending: true }),
      supabase.from("team_members").select("team_id,user_id,session,is_leader,created_at").order("created_at", { ascending: true }),
      supabase
        .from("bookings")
        .select("id,team_id,booking_date,day_of_week,start_time,duration,purpose,status,booking_location,booking_type")
        .eq("status", "confirmed")
        .gte("booking_date", todayISO())
        .order("booking_date", { ascending: true })
        .order("start_time", { ascending: true }),
      supabase.from("rehearsal_goal_categories").select("id,name,created_at").order("name", { ascending: true }),
      supabase.from("club_room_status").select("is_open,updated_by,updated_at").eq("id", 1).maybeSingle(),
      isSuperAdmin(profile)
        ? supabase.rpc("get_push_subscription_status")
        : Promise.resolve({ data: [], error: null }),
    ]);

    const firstError = [profileResult, teamResult, memberResult, bookingResult].find((result) => result.error)?.error;
    if (firstError) {
      setDbError(getErrorMessage(firstError));
      setIsLoadingData(false);
      return;
    }
    const goalCategoryError = goalCategoryResult.error ? getErrorMessage(goalCategoryResult.error) : "";
    if (goalCategoryError && !isMissingSchemaError(goalCategoryError)) {
      setDbError(goalCategoryError);
      setIsLoadingData(false);
      return;
    }

    const nextProfiles = ((profileResult.data ?? []) as Array<Partial<Profile> & Pick<Profile, "id" | "name" | "cohort" | "role" | "status">>).map(
      (item) => ({
        ...item,
        email: item.email ?? "",
        student_no: item.student_no ?? "",
      }),
    ) as Profile[];
    const nextGoalCategories = goalCategoryError ? [] : sortGoalCategories((goalCategoryResult.data ?? []) as GoalCategory[]);
    const profileMap = new Map(nextProfiles.map((item) => [item.id, item]));
    const clubRoomStatusError = clubRoomStatusResult.error ? getErrorMessage(clubRoomStatusResult.error) : "";
    if (clubRoomStatusError && !isMissingSchemaError(clubRoomStatusError)) {
      setDbError(clubRoomStatusError);
      setIsLoadingData(false);
      return;
    }
    const pushSubscriptionStatusError = pushSubscriptionStatusResult.error
      ? getErrorMessage(pushSubscriptionStatusResult.error)
      : "";
    if (pushSubscriptionStatusError && !isMissingSchemaError(pushSubscriptionStatusError)) {
      setDbError(pushSubscriptionStatusError);
      setIsLoadingData(false);
      return;
    }
    const rawClubRoomStatus = clubRoomStatusError
      ? null
      : (clubRoomStatusResult.data as { is_open: boolean; updated_by: string | null; updated_at: string | null } | null);
    const clubRoomEditor = rawClubRoomStatus?.updated_by ? profileMap.get(rawClubRoomStatus.updated_by) : null;

    const memberRows = (memberResult.data ?? []) as Array<{
      team_id: string;
      user_id: string;
      session: string;
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

    const visibleTeamIds = new Set(memberRows.filter((member) => member.user_id === profile.id).map((member) => member.team_id));
    const scheduleUserIds =
      canUseAdminTab(profile)
        ? nextProfiles.filter((item) => item.status === "approved").map((item) => item.id)
        : [profile.id, ...memberRows.filter((member) => visibleTeamIds.has(member.team_id)).map((member) => member.user_id)];
    const scheduleStartDate = todayISO();
    const scheduleEndDate = addDays(scheduleStartDate, 20);
    const [scheduleResult, dateScheduleResult] = await Promise.all([
      fetchRowsByUserIds("member_schedules", scheduleUserIds, "user_id,day_of_week,start_time"),
      fetchDateScheduleRowsByUserIds(scheduleUserIds, scheduleStartDate, scheduleEndDate),
    ]);
    if (scheduleResult.error) {
      setDbError(getErrorMessage(scheduleResult.error));
      setIsLoadingData(false);
      return;
    }
    const dateScheduleError = dateScheduleResult.error ? getErrorMessage(dateScheduleResult.error) : "";
    if (dateScheduleError && !isMissingSchemaError(dateScheduleError)) {
      setDbError(dateScheduleError);
      setIsLoadingData(false);
      return;
    }
    const scheduleRows = (scheduleResult.data ?? []) as Array<{ user_id: string; day_of_week: Day; start_time: string }>;
    const scheduleMap: Record<string, string[]> = {};
    const dateScheduleRows = dateScheduleError
      ? []
      : ((dateScheduleResult.data ?? []) as Array<{ user_id: string; schedule_date: string; start_time: string; is_busy: boolean }>);
    const dateScheduleMap: Record<string, Record<string, string[]>> = {};
    const dateOverrideMap: Record<string, string[]> = {};

    for (const row of scheduleRows) {
      scheduleMap[row.user_id] = [...(scheduleMap[row.user_id] ?? []), slotKey(row.day_of_week, row.start_time)];
    }

    for (const row of dateScheduleRows) {
      const date = row.schedule_date;
      dateOverrideMap[row.user_id] = Array.from(new Set([...(dateOverrideMap[row.user_id] ?? []), date]));
      if (row.is_busy) {
        dateScheduleMap[row.user_id] = {
          ...(dateScheduleMap[row.user_id] ?? {}),
          [date]: [...(dateScheduleMap[row.user_id]?.[date] ?? []), row.start_time],
        };
      }
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
            role: normalizeSessionRole(member.session),
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
        members: sortTeamMembersBySession(members),
        busy: Object.fromEntries(members.map((member) => [member.id, scheduleMap[member.id] ?? []])),
      };
    });
    const teamById = new Map(allTeams.map((team) => [team.id, team]));
    const nextTeams = allTeams.filter((team) => canUseAdminTab(profile) || team.members.some((member) => member.id === profile.id));
    const bookingRows = (bookingResult.data ?? []) as Array<{
      id: string;
      team_id: string | null;
      booking_date: string | null;
      day_of_week: Day;
      start_time: string;
      duration: number;
      purpose: string;
      status: "confirmed" | "cancelled";
      booking_location?: BookingLocation | null;
      booking_type?: BookingType | null;
    }>;
    const bookingIds = bookingRows.map((booking) => booking.id);
    const bookingAttendanceResult =
      bookingIds.length > 0
        ? await supabase.from("booking_attendance").select("booking_id,user_id").in("booking_id", bookingIds)
        : { data: [], error: null };
    const bookingAttendanceError = bookingAttendanceResult.error ? getErrorMessage(bookingAttendanceResult.error) : "";
    if (bookingAttendanceError && !isMissingSchemaError(bookingAttendanceError)) {
      setDbError(bookingAttendanceError);
      setIsLoadingData(false);
      return;
    }
    const bookingAttendanceRows = bookingAttendanceError ? [] : ((bookingAttendanceResult.data ?? []) as Array<{ booking_id: string; user_id: string }>);
    const attendanceByBooking = new Map<string, string[]>();

    for (const row of bookingAttendanceRows) {
      attendanceByBooking.set(row.booking_id, [...(attendanceByBooking.get(row.booking_id) ?? []), row.user_id]);
    }

    const nextReservations = bookingRows.map<Reservation>((booking) => {
      const team = booking.team_id ? teamById.get(booking.team_id) : undefined;
      const leader = team?.members.find((member) => member.id === team.leaderId);
      const bookingType = booking.booking_type === "room_block" ? "room_block" : "rehearsal";

      return {
        id: booking.id,
        teamId: booking.team_id ?? "",
        teamName: bookingType === "room_block" ? "동아리방 사용 제한" : team?.name ?? "삭제된 팀",
        teamSong: team?.song ?? "",
        leaderName: bookingType === "room_block" ? "최고 관리자" : leader?.name ?? "-",
        leaderRole: leader?.role,
        memberCount: team?.members.length ?? 0,
        bookingDate: booking.booking_date,
        day: booking.day_of_week,
        start: booking.start_time,
        duration: booking.duration,
        purpose: booking.purpose,
        status: booking.status,
        location: booking.booking_location === "external" ? "external" : "club_room",
        bookingType,
        attendanceUserIds: bookingAttendanceError ? undefined : attendanceByBooking.get(booking.id) ?? [],
      };
    });
    const nextPushSubscriptionStatuses = pushSubscriptionStatusError
      ? []
      : ((pushSubscriptionStatusResult.data ?? []) as Array<{
          user_id: string;
          name: string;
          cohort: string;
          has_push: boolean;
          registered_at: string | null;
        }>).map((row) => ({
          userId: row.user_id,
          name: row.name,
          cohort: row.cohort,
          hasPush: row.has_push,
          registeredAt: row.registered_at,
        }));
    const rehearsalMap: Record<string, string[]> = {};
    for (const booking of nextReservations) {
      if (booking.status !== "confirmed") {
        continue;
      }

      const memberIds = booking.attendanceUserIds ?? teamMembersByTeam.get(booking.teamId) ?? [];
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
    setClubRoomStatus(
      rawClubRoomStatus
        ? {
            isOpen: rawClubRoomStatus.is_open,
            updatedAt: rawClubRoomStatus.updated_at,
            updatedByName: clubRoomEditor?.name ?? "-",
            updatedByCohort: clubRoomEditor?.cohort ?? "-",
          }
        : null,
    );
    setIsClubRoomStatusReady(!clubRoomStatusError);
    setGoalCategories(nextGoalCategories);
    setBusyByUser(scheduleMap);
    setDateBusyByUser(dateScheduleMap);
    setDateOverrideByUser(dateOverrideMap);
    setRehearsalByUser(rehearsalMap);
    setPushSubscriptionStatuses(nextPushSubscriptionStatuses);
    setAllTeams(allTeams);
    setTeams(nextTeams);
    setReservations(nextReservations);
    setIsLoadingData(false);
  }, [profile]);

  const refreshRehearsalStats = useCallback(
    async (force = false) => {
      if (!profile || profile.status !== "approved") {
        return;
      }

      const cache = rehearsalStatsCacheRef.current;
      const hasFreshCache = cache.profileId === profile.id && Date.now() - cache.loadedAt < 5 * 60 * 1000;
      if (!force && hasFreshCache) {
        return;
      }

      const [leaderboardResult, teamTotalsResult] = await Promise.all([
        supabase.rpc("get_rehearsal_leaderboard"),
        supabase.rpc("get_team_rehearsal_totals"),
      ]);
      const leaderboardError = leaderboardResult.error ? getErrorMessage(leaderboardResult.error) : "";
      const teamTotalsError = teamTotalsResult.error ? getErrorMessage(teamTotalsResult.error) : "";

      if (leaderboardError && !isMissingSchemaError(leaderboardError)) {
        setDbError(leaderboardError);
        return;
      }
      if (teamTotalsError && !isMissingSchemaError(teamTotalsError)) {
        setDbError(teamTotalsError);
        return;
      }

      const nextLeaderboardRows = leaderboardError
        ? []
        : rankRehearsalLeaderboard(
            ((leaderboardResult.data ?? []) as Array<{
              user_id: string;
              name: string;
              cohort: string;
              total_duration: number;
            }>).map((row) => ({
              userId: row.user_id,
              name: row.name,
              cohort: row.cohort,
              totalDuration: Number(row.total_duration) || 0,
              rank: 0,
            })),
          );
      const nextTeamTotals = Object.fromEntries(
        (teamTotalsError
          ? []
          : ((teamTotalsResult.data ?? []) as Array<{
              team_id: string;
              total_duration: number;
              total_session_duration: number;
            }>))
          .map((row) => [
            row.team_id,
            {
              totalDuration: Number(row.total_duration) || 0,
              totalSessionDuration: Number(row.total_session_duration) || 0,
            },
          ]),
      );

      setRehearsalLeaderboardRows(nextLeaderboardRows);
      setTeamRehearsalTotals(nextTeamTotals);
      rehearsalStatsCacheRef.current = { profileId: profile.id, loadedAt: Date.now() };
    },
    [profile],
  );

  useEffect(() => {
    let mounted = true;
    let recoveryPromise: Promise<void> | null = null;
    let currentUserId: string | null = null;

    const applySession = (nextSession: SupabaseSession | null) => {
      if (!mounted) return;
      const nextUserId = nextSession?.user.id ?? null;
      if (isAccountChange(currentUserId, nextUserId)) {
        setIsBooting(true);
        let nextTab: Tab = "booking";
        try { nextTab = restoredTab(localStorage.getItem(`andante:tab:${nextUserId}`)); } catch { /* Storage may be unavailable in private mode. */ }
        setActiveTab(nextTab);
      }
      currentUserId = nextUserId;
      setSession((current) => current?.access_token === nextSession?.access_token && current?.user.id === nextUserId ? current : nextSession);
    };

    const recoverSession = () => {
      if (recoveryPromise) {
        return recoveryPromise;
      }

      recoveryPromise = (async () => {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) return;
        let nextSession = data.session;

        if (nextSession?.expires_at && nextSession.expires_at * 1000 <= Date.now() + 5 * 60 * 1000) {
          const { data: refreshedData, error } = await supabase.auth.refreshSession();
          if (!error && refreshedData.session) {
            nextSession = refreshedData.session;
          }
        }

        if (!mounted) {
          return;
        }

        applySession(nextSession);
        if (!nextSession) {
          setIsBooting(false);
        }
      })().catch(() => {
        // Network failure while resuming is not a sign-out.
        if (mounted) setIsBooting(false);
      }).finally(() => {
        recoveryPromise = null;
      });

      return recoveryPromise;
    };

    const recoverVisibleSession = () => {
      if (document.visibilityState === "visible") {
        void recoverSession();
      }
    };

    void recoverSession();
    window.addEventListener("online", recoverVisibleSession);
    window.addEventListener("pageshow", recoverVisibleSession);
    document.addEventListener("visibilitychange", recoverVisibleSession);

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
      if (!nextSession) {
        loadedProfileUserRef.current = "";
        setProfile(null);
        setTeams([]);
        setAllTeams([]);
        setProfiles([]);
        setClubRoomStatus(null);
        setIsClubRoomStatusReady(true);
        setGoalCategories([]);
        setBusyByUser({});
        setDateBusyByUser({});
        setDateOverrideByUser({});
        setRehearsalByUser({});
        setRehearsalLeaderboardRows([]);
        setTeamRehearsalTotals({});
        rehearsalStatsCacheRef.current = { profileId: "", loadedAt: 0 };
        setPushSubscriptionStatuses([]);
        setReservations([]);
        setPushHealth("");
        setIsBooting(false);
      }
    });

    return () => {
      mounted = false;
      window.removeEventListener("online", recoverVisibleSession);
      window.removeEventListener("pageshow", recoverVisibleSession);
      document.removeEventListener("visibilitychange", recoverVisibleSession);
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session && loadedProfileUserRef.current !== session.user.id) {
      const timeout = window.setTimeout(() => {
        void loadProfile(session);
      }, 0);

      return () => window.clearTimeout(timeout);
    }
  }, [session, loadProfile]);

  useEffect(() => {
    if (!session || isBooting) return;
    try { localStorage.setItem(`andante:tab:${session.user.id}`, activeTab); } catch { /* Keep navigation usable without storage. */ }
  }, [session, activeTab, isBooting]);

  useEffect(() => {
    if (!profile || profile.status !== "approved" || profile.password_reset_required) return;
    let active = true;
    let pending = false;
    let checkedAt = 0;
    const checkPush = async () => {
      if (document.visibilityState !== "visible" || pending || Date.now() - checkedAt < 5 * 60_000) return;
      pending = true;
      try {
        const { data } = await supabase.auth.getSession();
        if (!active || data.session?.user.id !== profile.id) return;
        const result = await syncPushSubscription(profile.id, data.session.access_token);
        if (active) setPushHealth(result.message);
        checkedAt = Date.now();
      } catch {
        // A temporary offline resume must not erase a working subscription.
        if (active) setPushHealth("알림 등록 상태를 확인하지 못했습니다. 인터넷 연결 후 다시 확인해 주세요.");
      } finally { pending = false; }
    };
    void checkPush();
    document.addEventListener("visibilitychange", checkPush);
    window.addEventListener("online", checkPush);
    return () => { active = false; document.removeEventListener("visibilitychange", checkPush); window.removeEventListener("online", checkPush); };
  }, [profile?.id, profile?.status, profile?.password_reset_required]);

  useEffect(() => {
    if (profile?.status === "approved") {
      const timeout = window.setTimeout(() => {
        void refreshData();
      }, 0);

      return () => window.clearTimeout(timeout);
    }
  }, [profile?.status, refreshData]);

  useEffect(() => {
    if (profile?.status === "approved" && (activeTab === "my" || activeTab === "team")) {
      void refreshRehearsalStats();
    }
  }, [activeTab, profile?.status, refreshRehearsalStats]);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null;
  const visibleTabs = [...baseTabs, ...(canUseAdminTab(profile) ? [adminTab] : []), { id: "recap" as const, label: "리캡", short: "♪" }];
  useEffect(() => {
    if (profile && activeTab === "admin" && !canUseAdminTab(profile)) {
      const timeout = window.setTimeout(() => setActiveTab("booking"), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [activeTab, profile]);
  const approvedProfiles = profiles.filter((item) => item.status === "approved");
  const pendingProfiles = profiles.filter((item) => item.status === "pending");
  const leaderTeams = useMemo(() => teams.filter((team) => team.leaderId === profile?.id), [teams, profile?.id]);
  const selectedBookingTeam =
    leaderTeams.find((team) => team.id === selectedTeamId && team.song === selectedBookingGoal) ?? null;
  const bookingBusy = useMemo(() => selectedBookingTeam?.busy ?? emptyBusy, [selectedBookingTeam]);
  const selectedBookingTeamRehearsals = useMemo(
    () => Object.fromEntries((selectedBookingTeam?.members ?? []).map((member) => [member.id, rehearsalByUser[member.id] ?? []])),
    [selectedBookingTeam, rehearsalByUser],
  );
  const bookingSlots = useMemo(
    () =>
      selectedBookingTeam
        ? buildBookingSlots(
            selectedBookingTeam,
            bookingBusy,
            dateBusyByUser,
            dateOverrideByUser,
            selectedBookingTeamRehearsals,
            reservations,
            selectedBookingDate,
            selectedBookingLocation || "club_room",
          )
        : [],
    [
      selectedBookingTeam,
      bookingBusy,
      dateBusyByUser,
      dateOverrideByUser,
      selectedBookingTeamRehearsals,
      reservations,
      selectedBookingDate,
      selectedBookingLocation,
    ],
  );
  const selectableBookingTimes = useMemo(
    () => bookingSlots.filter((slot) => slot.status !== "reserved").map((slot) => slot.time),
    [bookingSlots],
  );
  const selectedBookingTimes = useMemo(() => {
    const rawSelectedBookingTimes =
      bookingSelection.teamId === (selectedBookingTeam?.id ?? "") &&
      bookingSelection.date === selectedBookingDate &&
      bookingSelection.location === selectedBookingLocation
        ? bookingSelection.times
        : [];
    const selectableTimes = new Set(selectableBookingTimes);
    return rawSelectedBookingTimes.filter((time) => selectableTimes.has(time));
  }, [bookingSelection, selectedBookingTeam?.id, selectedBookingDate, selectedBookingLocation, selectableBookingTimes]);
  const upcomingReservations = reservations
    .filter((reservation) => isFutureReservation(reservation))
    .slice()
    .sort(compareReservationsByDateTime);
  const ownTeamIds = new Set(teams.filter((team) => team.members.some((member) => member.id === profile?.id)).map((team) => team.id));
  const ownTeamReservations = upcomingReservations.filter((reservation) => ownTeamIds.has(reservation.teamId));
  const leaderTeamIds = new Set(leaderTeams.map((team) => team.id));
  const leaderCancelableReservations = reservations
    .filter((reservation) => leaderTeamIds.has(reservation.teamId) && isCancelableReservation(reservation))
    .slice()
    .sort(compareReservationsByDateTime);

  async function signIn(email: string, password: string) {
    setAuthNotice("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setAuthNotice(getErrorMessage(error));
      return;
    }

    setAuthNotice("로그인했습니다.");
    setActiveTab("booking");
  }

  async function signUp(payload: {
    email: string;
    password: string;
    name: string;
    cohort: string;
    studentNo: string;
    privacyConsent: boolean;
  }) {
    setAuthNotice("");
    if (!payload.privacyConsent) {
      setAuthNotice("개인정보 수집·이용에 동의해야 가입할 수 있습니다.");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        data: {
          name: payload.name,
          cohort: payload.cohort,
          student_no: payload.studentNo,
          privacy_consent: true,
          privacy_consent_version: privacyConsentVersion,
        },
      },
    });

    if (error) {
      const message = getErrorMessage(error);
      setAuthNotice(
        message.toLowerCase().includes("database error")
          ? "이미 등록된 이름 또는 학번인지 확인해 주세요."
          : message,
      );
      return;
    }

    setAuthNotice("가입 신청이 접수됐어요. 관리자 승인을 기다려 주세요.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setStatus("로그인 후 팀 예약을 시작할 수 있어요.");
  }

  async function completePasswordReset(nextPassword: string) {
    setStatus("");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setStatus("다시 로그인해 주세요.");
      return;
    }
    const response = await fetch("/api/auth/complete-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ password: nextPassword }),
    }).catch(() => null);
    const result = await response?.json().catch(() => null);
    if (!response?.ok || result?.ok !== true) {
      setStatus(result?.error ?? "비밀번호 변경에 실패했습니다. 다시 시도해 주세요.");
      return;
    }

    setProfile((current) => (current ? { ...current, password_reset_required: false } : current));
    setStatus("비밀번호를 다시 설정했어요.");
  }

  async function acceptPrivacyConsent() {
    if (!session) {
      return;
    }

    setStatus("");
    const { error } = await supabase.rpc("accept_privacy_consent");

    if (error) {
      const message = getErrorMessage(error);
      setStatus(
        isMissingSchemaError(message)
          ? "개인정보 동의 DB 함수가 필요합니다. Supabase SQL Editor에서 patch-033-existing-member-privacy-consent.sql을 실행해 주세요."
          : message,
      );
      return;
    }

    setStatus("개인정보 수집·이용 동의가 완료됐어요.");
    await loadProfile(session);
  }

  function changeBookingGoal(goal: string) {
    setSelectedBookingGoal(goal);
    setSelectedTeamId("");
    setSelectedBookingLocation("");
    setBookingSelection({
      teamId: "",
      date: selectedBookingDate,
      location: "",
      times: [],
    });
  }

  function changeTeam(teamId: string) {
    const nextTeam = leaderTeams.find((team) => team.id === teamId && team.song === selectedBookingGoal);
    if (!nextTeam) {
      return;
    }

    setSelectedTeamId(nextTeam.id);
    setSelectedBookingLocation("");
    setBookingSelection({
      teamId: nextTeam.id,
      date: selectedBookingDate,
      location: "",
      times: [],
    });
    setStatus(`${nextTeam.name} 팀을 선택했어요.`);
  }

  function changeBookingLocation(location: BookingLocation) {
    setSelectedBookingLocation(location);
    setBookingSelection({
      teamId: selectedBookingTeam?.id ?? "",
      date: selectedBookingDate,
      location,
      times: [],
    });
  }

  async function setScheduleSlots(userId: string, slots: ScheduleSlotSelection[], isBusy: boolean) {
    if (!profile) {
      return;
    }

    const uniqueSlots = Array.from(new Map(slots.map((slot) => [slotKey(slot.day, slot.time), slot])).values());
    if (uniqueSlots.length === 0) {
      return;
    }

    if (isBusy) {
      const { error } = await supabase.from("member_schedules").upsert(
        uniqueSlots.map((slot) => ({
          user_id: userId,
          day_of_week: slot.day,
          start_time: slot.time,
          updated_by: profile.id,
        })),
        { onConflict: "user_id,day_of_week,start_time", ignoreDuplicates: true },
      );

      if (error) {
        setStatus(getScheduleErrorMessage(error));
        return;
      }
    } else {
      const slotsByDay = uniqueSlots.reduce<Record<Day, string[]>>(
        (acc, slot) => {
          acc[slot.day].push(slot.time);
          return acc;
        },
        { 월: [], 화: [], 수: [], 목: [], 금: [], 토: [], 일: [] },
      );

      for (const day of days) {
        const times = slotsByDay[day];
        if (times.length === 0) {
          continue;
        }

        const { error } = await supabase
          .from("member_schedules")
          .delete()
          .eq("user_id", userId)
          .eq("day_of_week", day)
          .in("start_time", times);

        if (error) {
          setStatus(getScheduleErrorMessage(error));
          return;
        }
      }
    }

    setStatus(`${uniqueSlots.length}개 시간대를 ${isBusy ? "불가" : "가능"}로 바꿨어요.`);
    await refreshData();
  }

  async function saveWeeklyScheduleDraft(userId: string, nextBusyKeys: string[]) {
    if (!profile) {
      return;
    }

    const nextSlots = nextBusyKeys
      .map((key) => {
        const day = days.find((item) => key.startsWith(`${item}-`));
        if (!day) {
          return null;
        }

        return { day, time: key.slice(day.length + 1) };
      })
      .filter((slot): slot is ScheduleSlotSelection => Boolean(slot));

    const rpcResult = await supabase.rpc("save_member_weekly_schedule", {
      p_user_id: userId,
      p_slots: nextSlots,
    });

    if (!rpcResult.error) {
      setBusyByUser((current) => ({ ...current, [userId]: nextBusyKeys }));
      setStatus("고정 시간표를 저장했어요.");
      await refreshData();
      return;
    }

    const rpcErrorMessage = getErrorMessage(rpcResult.error);
    if (!isMissingSchemaError(rpcErrorMessage) && !rpcErrorMessage.includes("save_member_weekly_schedule")) {
      setStatus(getScheduleErrorMessage(rpcResult.error));
      return;
    }

    const currentBusy = new Set(busyByUser[userId] ?? []);
    const nextBusy = new Set(nextBusyKeys);
    const toBusy: ScheduleSlotSelection[] = [];
    const toFree: ScheduleSlotSelection[] = [];

    for (const day of days) {
      for (const time of timeSlots) {
        const key = slotKey(day, time);
        const wasBusy = currentBusy.has(key);
        const willBeBusy = nextBusy.has(key);

        if (!wasBusy && willBeBusy) {
          toBusy.push({ day, time });
        }
        if (wasBusy && !willBeBusy) {
          toFree.push({ day, time });
        }
      }
    }

    if (toBusy.length === 0 && toFree.length === 0) {
      setStatus("저장할 시간표 변경이 없습니다.");
      return;
    }

    if (toBusy.length > 0) {
      const { error } = await supabase.from("member_schedules").upsert(
        toBusy.map((slot) => ({
          user_id: userId,
          day_of_week: slot.day,
          start_time: slot.time,
          updated_by: profile.id,
        })),
        { onConflict: "user_id,day_of_week,start_time", ignoreDuplicates: true },
      );

      if (error) {
        setStatus(getScheduleErrorMessage(error));
        return;
      }
    }

    const slotsByDay = toFree.reduce<Record<Day, string[]>>(
      (acc, slot) => {
        acc[slot.day].push(slot.time);
        return acc;
      },
      { 월: [], 화: [], 수: [], 목: [], 금: [], 토: [], 일: [] },
    );

    for (const day of days) {
      const times = slotsByDay[day];
      if (times.length === 0) {
        continue;
      }

      const { error } = await supabase
        .from("member_schedules")
        .delete()
        .eq("user_id", userId)
        .eq("day_of_week", day)
        .in("start_time", times);

      if (error) {
        setStatus(getScheduleErrorMessage(error));
        return;
      }
    }

    setStatus("고정 시간표를 저장했어요.");
    await refreshData();
  }

  async function saveDateScheduleDraft(userId: string, drafts: DateScheduleDrafts) {
    if (!profile) {
      throw new Error("로그인이 필요합니다.");
    }

    const dates = Object.keys(drafts);
    if (dates.length === 0) return;
    const { error } = await supabase.from("member_schedule_date_slots").upsert(
      buildDateScheduleRows(drafts, userId, profile.id, timeSlots, new Date().toISOString()),
      { onConflict: "user_id,schedule_date,start_time" },
    );

    if (error) {
      setStatus(getScheduleErrorMessage(error));
      throw new Error(getScheduleErrorMessage(error));
    }

    setStatus(`${dates.length}개 날짜의 시간표를 저장했어요.`);
    await refreshData();
  }

  async function resetDateSchedule(userId: string, date: string) {
    const { error } = await supabase.from("member_schedule_date_slots").delete().eq("user_id", userId).eq("schedule_date", date);

    if (error) {
      setStatus(getScheduleErrorMessage(error));
      throw new Error(getScheduleErrorMessage(error));
    }

    setStatus(`${formatDateLabel(date)} 시간표를 고정 시간표 기준으로 되돌렸어요.`);
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

  async function updateTeam(payload: UpdateTeamPayload) {
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

    const { error } = await supabase.rpc("update_team", {
      p_team_id: payload.teamId,
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
    setSelectedTeamId(payload.teamId);
    setStatus(`${payload.teamName} 팀 정보를 저장했어요.`);
  }

  function getBookingErrorMessage(error: unknown) {
    const message = getErrorMessage(error);

    if (
      message.includes("booking_location") ||
      message.includes("합주 장소") ||
      message.includes("create_bookings_with_location")
    ) {
      return "Supabase SQL Editor에서 patch-029-booking-location.sql을 먼저 실행해 주세요.";
    }

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
        currentSelection.teamId === teamId &&
        currentSelection.date === selectedBookingDate &&
        currentSelection.location === selectedBookingLocation
          ? currentSelection.times
          : [];
      const nextTimes = currentTimes.includes(time)
        ? currentTimes.filter((item) => item !== time)
        : [...currentTimes, time].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

      return {
        teamId,
        date: selectedBookingDate,
        location: selectedBookingLocation,
        times: nextTimes,
      };
    });
  }

  function clearBookingSelection() {
    setBookingSelection({
      teamId: selectedBookingTeam?.id ?? "",
      date: selectedBookingDate,
      location: selectedBookingLocation,
      times: [],
    });
  }

  function normalizeBookingIds(value: unknown) {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.length > 0);
    }

    if (typeof value === "string") {
      return value
        .replace(/[{}"]/g, "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  async function reserveSelectedBookingTimes() {
    if (!selectedBookingTeam) {
      setStatus("합주 목표와 예약할 팀을 먼저 선택해 주세요.");
      return;
    }

    if (!selectedBookingLocation) {
      setStatus("합주 장소를 먼저 선택해 주세요.");
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

    const { data, error } = await supabase.rpc("create_bookings_with_location", {
      p_team_id: selectedBookingTeam.id,
      p_day: bookingDay,
      p_booking_date: selectedBookingDate,
      p_purpose: selectedBookingTeam.song,
      p_groups: bookingGroups.map((group) => ({
        start_time: group.start,
        duration: group.duration,
        location: selectedBookingLocation,
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
    const pushResult = await sendBookingPushEvent(normalizeBookingIds(data), "booking_created");
    if (pushResult?.error) {
      setStatus(`${formatDateLabel(selectedBookingDate)} ${groupText} 예약이 확정됐어요. 알림 오류: ${pushResult.error}`);
    } else if (pushResult && pushResult.sent === 0) {
      setStatus(`${formatDateLabel(selectedBookingDate)} ${groupText} 예약이 확정됐어요. 알림 받을 기기가 아직 없어요.`);
    }
    setActiveTab("booking");
    await refreshData();
  }

  async function createRoomBlocks(date: string, reason: string, times: string[]) {
    if (!isSuperAdmin(profile)) {
      throw new Error("최고 관리자만 동아리방 사용 제한을 등록할 수 있습니다.");
    }

    const bookingGroups = groupBookingTimes(times);
    const { error } = await supabase.rpc("create_room_blocks", {
      p_day: dateToDay(date),
      p_booking_date: date,
      p_reason: reason,
      p_groups: bookingGroups.map((group) => ({
        start_time: group.start,
        duration: group.duration,
      })),
    });

    if (error) {
      const message = getErrorMessage(error);
      if (message.includes("create_room_blocks") || message.includes("booking_type")) {
        throw new Error("Supabase SQL Editor에서 patch-030-admin-room-blocks.sql을 먼저 실행해 주세요.");
      }
      throw new Error(message);
    }

    const groupText = bookingGroups.map((group) => `${group.start}-${group.end}`).join(", ");
    setStatus(`${formatDateLabel(date)} ${groupText} 동아리방 사용 제한을 등록했어요.`);
    await refreshData();
  }

  async function approveProfile(profileId: string, nextStatus: "approved" | "rejected") {
    if (!profile) {
      return;
    }

    const { error } = await supabase.rpc("review_profile_signup", {
      p_profile_id: profileId,
      p_status: nextStatus,
    });

    if (error) {
      setStatus(getErrorMessage(error));
      return;
    }

    setStatus(nextStatus === "approved" ? "가입을 승인했어요." : "가입을 거절했어요.");
    await refreshData();
  }

  async function updateProfileRole(profileId: string, nextRole: "member" | "manager") {
    if (!isSuperAdmin(profile)) {
      setStatus("최고 관리자만 집기 권한을 변경할 수 있습니다.");
      return;
    }

    const target = profiles.find((item) => item.id === profileId);
    if (!target || target.role === "admin") {
      setStatus("권한을 변경할 수 없는 계정입니다.");
      return;
    }

    const confirmed = window.confirm(`${target.name} 계정을 ${nextRole === "manager" ? "집기" : "부원"} 등급으로 변경할까요?`);
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("profiles").update({ role: nextRole }).eq("id", profileId);

    if (error) {
      setStatus(getErrorMessage(error));
      return;
    }

    setStatus(`${target.name} 계정을 ${nextRole === "manager" ? "집기" : "부원"} 등급으로 변경했어요.`);
    await refreshData();
  }

  async function resetMemberPassword(userId: string) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      throw new Error("관리자 로그인이 필요합니다.");
    }

    const response = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId }),
    });
    const result = (await response.json().catch(() => null)) as { temporaryPassword?: string; error?: string } | null;

    if (!response.ok || !result?.temporaryPassword) {
      throw new Error(result?.error ?? "비밀번호 리셋에 실패했습니다.");
    }

    await refreshData();
    return result.temporaryPassword;
  }

  async function resetRehearsalTracking() {
    if (!isSuperAdmin(profile)) {
      throw new Error("최고 관리자만 합주시간을 초기화할 수 있습니다.");
    }

    const { data, error } = await supabase.rpc("reset_rehearsal_tracking");

    if (error) {
      throw new Error(getErrorMessage(error));
    }

    setStatus("합주시간을 초기화했어요. 내일 이후 합주부터 다시 누적됩니다.");
    await refreshData();
    await refreshRehearsalStats(true);
    return data as string;
  }

  async function sendBookingPushEvent(bookingIds: string[], kind: "booking_created" | "booking_cancelled") {
    if (bookingIds.length === 0) {
      return null;
    }

    const token = session?.access_token;
    if (!token) {
      return null;
    }

    const response = await fetch("/api/push/booking-event", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ bookingIds, kind }),
    }).catch(() => null);

    const result = (await response?.json().catch(() => null)) as
      | { sent?: number; failed?: number; recipientCount?: number; subscriptionCount?: number; error?: string }
      | null;

    if (!response?.ok) {
      return result ?? null;
    }

    return result;
  }

  function getGoalCategoryErrorMessage(error: unknown) {
    const message = getErrorMessage(error);

    if (isMissingSchemaError(message)) {
      return "Supabase SQL Editor에서 patch-008-goal-categories.sql을 먼저 실행해 주세요.";
    }

    if (message.includes("duplicate") || message.includes("unique")) {
      return "이미 같은 이름의 합주 목표가 있습니다.";
    }

    return message;
  }

  async function addGoalCategory(name: string) {
    if (!profile || !canUseAdminTab(profile)) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus("추가할 합주 목표를 입력해 주세요.");
      return;
    }

    const { error } = await supabase.from("rehearsal_goal_categories").insert({
      name: trimmedName,
      created_by: profile.id,
    });

    if (error) {
      setStatus(getGoalCategoryErrorMessage(error));
      return;
    }

    setStatus(`${trimmedName} 합주 목표를 추가했어요.`);
    await refreshData();
  }

  async function deleteGoalCategory(categoryId: string) {
    if (!canUseAdminTab(profile)) {
      return;
    }

    const category = goalCategories.find((item) => item.id === categoryId);
    if (!category) {
      return;
    }

    const confirmed = window.confirm(`${category.name} 합주 목표를 삭제할까요?`);
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("rehearsal_goal_categories").delete().eq("id", categoryId);

    if (error) {
      setStatus(getGoalCategoryErrorMessage(error));
      return;
    }

    setStatus(`${category.name} 합주 목표를 삭제했어요.`);
    await refreshData();
  }

  function getClubRoomStatusErrorMessage(error: unknown) {
    const message = getErrorMessage(error);

    if (isMissingSchemaError(message)) {
      return "Supabase SQL Editor에서 patch-009-club-room-status.sql을 먼저 실행해 주세요.";
    }

    return message;
  }

  async function updateClubRoomStatus(isOpen: boolean) {
    if (!profile) {
      return;
    }

    const confirmed = window.confirm(`동아리방 상태를 ${isOpen ? "열림" : "닫힘"}으로 바꿀까요?`);
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("club_room_status").upsert({
      id: 1,
      is_open: isOpen,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setStatus(getClubRoomStatusErrorMessage(error));
      return;
    }

    setStatus(`동아리방 상태를 ${isOpen ? "열림" : "닫힘"}으로 바꿨어요.`);
    await refreshData();
  }

  async function cancelBooking(bookingId: string, reason: string) {
    if (!profile) {
      return false;
    }

    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
      p_reason: reason || "예약 취소",
    });

    if (error) {
      const message = getErrorMessage(error);
      setStatus(message);
      return false;
    }

    setStatus("예약을 취소했어요.");
    await sendBookingPushEvent([bookingId], "booking_cancelled");
    await refreshData();
    return true;
  }

  if (isBooting) {
    return <LoadingScreen label="계정 상태를 확인하고 있어요." />;
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
    return <LoadingScreen label="프로필을 불러오고 있어요." />;
  }

  if (profile.privacy_consent_at === null) {
    return (
      <PhoneShell>
        <PrivacyConsentScreen status={status} onAccept={acceptPrivacyConsent} onSignOut={signOut} />
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

  if (profile.password_reset_required) {
    return (
      <PhoneShell>
        <ForcedPasswordResetScreen status={status} onSubmit={completePasswordReset} onSignOut={signOut} />
      </PhoneShell>
    );
  }

  return (
    <WorkspaceShell
      activeTab={activeTab}
      tabs={visibleTabs}
      hideNavigation={isTextInputFocused}
      onChangeTab={(tab) => {
        if (tab === "suggestions" && activeTab !== "suggestions") {
          setSelectedTeamId("");
          setSelectedBookingGoal("");
          setSelectedBookingLocation("");
        }
        setActiveTab(tab);
      }}
      header={<AppHeader selectedTeam={selectedTeam} status={status} profile={profile} onSignOut={signOut} desktopTitle={workspaceTitles[activeTab]} />}
    >
                {isLoadingData && (
                  <LoadingStatus className="workspace-refresh-status" label="데이터를 불러오고 있어요." />
                )}

                {activeTab === "booking" && (
                  <BookingTab
                    selectedTeam={selectedTeam}
                    clubRoomStatus={clubRoomStatus}
                    isClubRoomStatusReady={isClubRoomStatusReady}
                    reservations={upcomingReservations}
                    ownTeamReservations={ownTeamReservations}
                    ownTeamIds={ownTeamIds}
                    leaderReservations={leaderCancelableReservations}
                    hasLeaderTeam={leaderTeams.length > 0}
                    onUpdateClubRoomStatus={updateClubRoomStatus}
                    onCancelBooking={cancelBooking}
                  />
                )}

                {activeTab === "suggestions" && (
                  <SuggestionsTab
                    leaderTeams={leaderTeams}
                    goalCategories={goalCategories}
                    selectedGoal={selectedBookingGoal}
                    changeGoal={changeBookingGoal}
                    selectedTeam={selectedBookingTeam}
                    changeTeam={changeTeam}
                    selectedLocation={selectedBookingLocation}
                    changeLocation={changeBookingLocation}
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
                    pushHealth={pushHealth}
                    teams={teams}
                    allTeams={allTeams}
                    goalCategories={goalCategories}
                    approvedProfiles={approvedProfiles}
                    reservations={reservations}
                    rehearsalLeaderboardRows={rehearsalLeaderboardRows}
                    ownBusy={busyByUser[profile.id] ?? []}
                    busyByUser={busyByUser}
                    dateBusyByUser={dateBusyByUser}
                    dateOverrideByUser={dateOverrideByUser}
                    dateBusyByDate={dateBusyByUser[profile.id] ?? {}}
                    dateOverrideDates={dateOverrideByUser[profile.id] ?? []}
                    saveWeeklySchedule={(nextBusyKeys) => saveWeeklyScheduleDraft(profile.id, nextBusyKeys)}
                    saveDateSchedule={(drafts) => saveDateScheduleDraft(profile.id, drafts)}
                    resetDateSchedule={(date) => resetDateSchedule(profile.id, date)}
                  />
                )}

                {activeTab === "recap" && (
                  <Suspense fallback={<LoadingStatus className="workspace-refresh-status" label="리캡을 불러오고 있어요." />}>
                    <RecapTab key={profile.id} userId={profile.id} name={profile.name} />
                  </Suspense>
                )}

                {activeTab === "calendar" && (
                  <CalendarTab key={profile.id} reservations={upcomingReservations} ownTeamIds={ownTeamIds} allTeams={allTeams} />
                )}

                {activeTab === "team" && (
                  <TeamTab
                    allTeams={allTeams}
                    approvedProfiles={approvedProfiles}
                    goalCategories={goalCategories}
                    teamRehearsalTotals={teamRehearsalTotals}
                    onAddTeam={addTeam}
                    onUpdateTeam={updateTeam}
                    currentUserId={profile.id}
                  />
                )}

                {activeTab === "admin" && canUseAdminTab(profile) && (
                  <AdminTab
                    currentProfile={profile}
                    pendingProfiles={pendingProfiles}
                    approvedProfiles={approvedProfiles}
                    allTeams={allTeams}
                    goalCategories={goalCategories}
                    reservations={upcomingReservations.filter((reservation) => !isReservationPast(reservation))}
                    pushSubscriptionStatuses={pushSubscriptionStatuses}
                    busyByUser={busyByUser}
                    dateBusyByUser={dateBusyByUser}
                    dateOverrideByUser={dateOverrideByUser}
                    rehearsalByUser={rehearsalByUser}
                    approveProfile={approveProfile}
                    updateProfileRole={updateProfileRole}
                    resetMemberPassword={resetMemberPassword}
                    resetRehearsalTracking={resetRehearsalTracking}
                    createRoomBlocks={createRoomBlocks}
                    addGoalCategory={addGoalCategory}
                    deleteGoalCategory={deleteGoalCategory}
                    addTeam={addTeam}
                    updateTeam={updateTeam}
                    cancelBooking={cancelBooking}
                    saveWeeklySchedule={(userId, nextBusyKeys) => saveWeeklyScheduleDraft(userId, nextBusyKeys)}
                    saveDateSchedule={(userId, drafts) => saveDateScheduleDraft(userId, drafts)}
                    resetDateSchedule={(userId, date) => resetDateSchedule(userId, date)}
                  />
                )}

                {activeTab === "team" && (
                  <p className="easter-egg-credit pb-8 pt-1 text-center text-[9px] font-medium text-[#f7e6df]" aria-hidden="true">
                    @41기 구강민 만듦
                  </p>
                )}
    </WorkspaceShell>
  );
}

function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <main className="app-viewport bg-[#fff8f4] text-slate-950 sm:bg-[#f9ebe6] sm:px-6 sm:py-5">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-center">
        <section className="typography-balanced relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-[#fff8f4] shadow-sm">
          <div className="app-shell-scroll flex-1 overflow-y-auto px-4 pt-4">{children}</div>
        </section>
      </div>
    </main>
  );
}

function PrivacyConsentAgreement({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-[#f0ded7] bg-[#fffaf8] p-3">
      <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold leading-5 text-slate-800">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff665a]"
        />
        <span>[필수] 개인정보 수집·이용에 동의합니다.</span>
      </label>
      <details className="mt-2 border-t border-[#f0ded7] pt-2 text-[11px] leading-5 text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">수집·이용 내용 보기</summary>
        <dl className="mt-2 space-y-1.5">
          <div>
            <dt className="font-semibold text-slate-800">수집 목적</dt>
            <dd>회원 식별과 승인, 팀 구성, 시간표 관리, 합주 예약 및 이용 기록 관리</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">수집 항목</dt>
            <dd>이름, 기수, 학번, 이메일, 개인 시간표, 소속 팀·세션, 예약 및 합주 참여 기록</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">보유 기간</dt>
            <dd>가입일부터 해당 학년도 겨울공연 종료 후 30일까지</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">동의 거부 안내</dt>
            <dd>동의를 거부할 수 있으나, 거부 시 회원가입과 서비스 이용이 불가능합니다.</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-800">파기 방법</dt>
            <dd>보유기간 종료 또는 동의 철회 시 관련 정보를 복구할 수 없는 방식으로 삭제합니다.</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

function AuthScreen({
  onSignIn,
  onSignUp,
  notice,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (payload: {
    email: string;
    password: string;
    name: string;
    cohort: string;
    studentNo: string;
    privacyConsent: boolean;
  }) => Promise<void>;
  notice: string;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [cohort, setCohort] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
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

    if (mode === "signup" && password.length < 8) {
      setMessage("비밀번호는 8자 이상으로 입력해 주세요.");
      return;
    }

    if (mode === "signup" && password !== passwordConfirm) {
      setMessage("비밀번호가 일치하지 않습니다.");
      return;
    }

    if (mode === "signup" && !privacyConsent) {
      setMessage("개인정보 수집·이용에 동의해 주세요.");
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
      cohort: normalizeCohort(cohort),
      studentNo: studentNo.trim(),
      privacyConsent,
    });
  }

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">Andante</p>
        <h1 className="mt-2 text-2xl font-semibold">로그인</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          회원가입 후 관리자의 승인이 있어야 사용 가능합니다.
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
              <LabeledInput label="비밀번호 재확인" value={passwordConfirm} onChange={setPasswordConfirm} placeholder="비밀번호 다시 입력" type="password" />
              <LabeledInput label="이름" value={name} onChange={setName} placeholder="홍길동" />
              <LabeledInput label="기수" value={cohort} onChange={setCohort} placeholder="예: 12기" />
              <LabeledInput label="학번" value={studentNo} onChange={setStudentNo} placeholder="예: 20261234" />
              <PrivacyConsentAgreement checked={privacyConsent} onChange={setPrivacyConsent} />
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

function PrivacyConsentScreen({
  status,
  onAccept,
  onSignOut,
}: {
  status: string;
  onAccept: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [hasConsent, setHasConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    if (!hasConsent) {
      setMessage("개인정보 수집·이용에 동의해 주세요.");
      return;
    }

    setMessage("");
    setIsSaving(true);
    await onAccept();
    setIsSaving(false);
  }

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">개인정보 이용 동의</p>
        <h1 className="mt-2 text-2xl font-semibold">서비스 이용을 위해 동의가 필요합니다</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          기존 회원의 개인정보 처리 내용을 안내하고 동의 이력을 기록하기 위한 절차입니다.
        </p>
      </MobilePanel>
      <MobilePanel title="개인정보 수집·이용">
        <div className="space-y-3">
          <PrivacyConsentAgreement checked={hasConsent} onChange={setHasConsent} />
          {(message || status) && (
            <p className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-[#be3d33]">{message || status}</p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={isSaving}
            className="h-12 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white disabled:bg-slate-100 disabled:text-slate-400"
          >
            {isSaving ? "처리 중" : "동의하고 계속하기"}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="h-10 w-full rounded-lg border border-[#f0ded7] bg-white text-xs font-semibold text-slate-600"
          >
            로그아웃
          </button>
        </div>
      </MobilePanel>
    </div>
  );
}

function ForcedPasswordResetScreen({
  status,
  onSubmit,
  onSignOut,
}: {
  status: string;
  onSubmit: (nextPassword: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    if (password.length < 8) {
      setMessage("새 비밀번호는 8자 이상으로 입력해 주세요.");
      return;
    }
    if (password !== passwordConfirm) {
      setMessage("비밀번호가 일치하지 않습니다.");
      return;
    }

    setIsSaving(true);
    setMessage("");
    await onSubmit(password);
    setIsSaving(false);
  }

  return (
    <div className="space-y-3">
      <MobilePanel>
        <p className="text-xs font-semibold text-[#ef6351]">비밀번호 재설정</p>
        <h1 className="mt-2 text-2xl font-semibold">새 비밀번호를 설정해 주세요</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          관리자가 임시 비밀번호를 발급했습니다. 계속 사용하려면 새 비밀번호로 변경해야 합니다.
        </p>
      </MobilePanel>
      <MobilePanel title="새 비밀번호">
        <div className="space-y-3">
          <LabeledInput label="새 비밀번호" value={password} onChange={setPassword} placeholder="8자 이상" type="password" />
          <LabeledInput label="새 비밀번호 재확인" value={passwordConfirm} onChange={setPasswordConfirm} placeholder="비밀번호 다시 입력" type="password" />
          {(message || status) && <p className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-[#be3d33]">{message || status}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={isSaving}
            className="h-12 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white disabled:bg-slate-100 disabled:text-slate-400"
          >
            {isSaving ? "저장 중" : "비밀번호 변경하기"}
          </button>
          <button type="button" onClick={onSignOut} className="h-10 w-full rounded-lg border border-[#f0ded7] bg-white text-xs font-semibold text-slate-600">
            로그아웃
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
  desktopTitle,
}: {
  selectedTeam: Team | null;
  status: string;
  profile: Profile;
  onSignOut: () => void;
  desktopTitle?: string;
}) {
  return (
    <header className="workspace-header shrink-0 px-4 pb-2 pt-1">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-[#ef6351]">Andante</p>
          <h2 className="mt-1 text-2xl font-semibold">
            <span className="workspace-mobile-label">{desktopTitle ?? "홈"}</span>
            <span className="workspace-desktop-label">{desktopTitle ?? "합주 예약"}</span>
          </h2>
        </div>
        <div className="workspace-header-actions">
        <AppearanceSelector />
        <button
          type="button"
          onClick={onSignOut}
          className={`workspace-signout flex h-[52px] max-w-[120px] flex-col items-center justify-center rounded-lg px-3 ${selectedTeam?.color ?? "bg-slate-800"} text-white`}
          aria-label="로그아웃"
          title={`${profile.name} 로그아웃`}
        >
          <span className="max-w-full truncate text-xs font-bold leading-4">{profile.name}</span>
          <LogOut size={16} aria-hidden="true" />
        </button>
        </div>
      </div>
      <p className="mt-3 rounded-lg border border-[#f0ded7] bg-white px-3 py-2 text-xs leading-5 text-slate-600">
        {status}
      </p>
    </header>
  );
}

function ClubRoomStatusPanel({
  status,
  isReady,
  onUpdateStatus,
}: {
  status: ClubRoomStatus | null;
  isReady: boolean;
  onUpdateStatus: (isOpen: boolean) => Promise<void>;
}) {
  const statusText = status ? (status.isOpen ? "열림" : "닫힘") : "미설정";
  const editorText = status?.updatedByName
    ? `${status.updatedByName} · ${status.updatedByCohort ?? "-"}`
    : "-";
  const updatedAtText = formatUpdatedAt(status?.updatedAt);

  return (
    <section className="rounded-lg border border-[#f0ded7] bg-white/88 p-3 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">동아리방 상태</h3>
      {!isReady ? (
        <EmptyText text="동아리방 상태 기능을 쓰려면 Supabase SQL Editor에서 patch-009-club-room-status.sql을 먼저 실행해 주세요." />
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-slate-500">현재</p>
              <p className={`rounded-md px-2 py-1 text-sm font-semibold ${status?.isOpen ? "bg-emerald-50 text-emerald-700" : "bg-[#fff0eb] text-[#be3d33]"}`}>
                {statusText}
              </p>
            </div>
            <p className="mt-2 truncate text-[11px] leading-4 text-slate-500">
              마지막 수정 {editorText} · {updatedAtText}
            </p>
          </div>

          <div className="grid w-[104px] shrink-0 grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => onUpdateStatus(true)}
              className={`h-8 rounded-md border text-xs font-semibold ${
                status?.isOpen ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-[#f0ded7] bg-white text-slate-700"
              }`}
            >
              열림
            </button>
            <button
              type="button"
              onClick={() => onUpdateStatus(false)}
              className={`h-8 rounded-md border text-xs font-semibold ${
                status && !status.isOpen ? "border-[#ff665a] bg-[#fff0eb] text-[#be3d33]" : "border-[#f0ded7] bg-white text-slate-700"
              }`}
            >
              닫힘
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ThreeWeekCalendar({
  selectedDate,
  onSelectDate,
  hasMarker,
  markerTone,
  compact = false,
  anchorDate,
  dateLabel,
  disabled = false,
}: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  hasMarker?: (date: string) => boolean;
  markerTone?: (date: string) => "own" | "other";
  compact?: boolean;
  anchorDate?: string;
  dateLabel?: (date: string) => string;
  disabled?: boolean;
}) {
  const cells = threeWeekCalendarCells(anchorDate);

  return (
    <div className={`three-week-calendar ${compact ? "mt-0" : "mt-3"}`}>
      <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold text-slate-500">
        {dateDayNames.map((day, index) => (
          <span
            key={day}
            className={`flex ${compact ? "h-5" : "h-6"} items-center justify-center ${index === 0 ? "" : "border-l border-slate-200/60"}`}
          >
            {day}
          </span>
        ))}
      </div>
      <div className={`grid grid-cols-7 ${compact ? "gap-y-0.5" : "gap-y-1"}`}>
        {cells.map((date, index) => {
          const cellClassName = `three-week-calendar-cell flex min-w-0 ${compact ? "h-[38px]" : "h-10"} items-center justify-center ${index % 7 === 0 ? "" : "border-l border-slate-200/60"}`;

          if (!date) {
            return <div key={`empty-${index}`} className={cellClassName} aria-hidden="true" />;
          }

          const isSelected = selectedDate === date;
          const isMarked = hasMarker?.(date) ?? false;

          return (
            <div key={date} className={cellClassName}>
              <button
                type="button"
                onClick={() => onSelectDate(date)}
                disabled={disabled}
                className={`three-week-calendar-day ${compact ? "h-[38px]" : "h-10"} w-full max-w-10 min-w-0 rounded-md border border-transparent py-1 text-center transition ${
                  isSelected ? "bg-[#e1ece8] text-slate-950" : "bg-transparent text-slate-700"
                }`}
                aria-pressed={isSelected}
                aria-label={dateLabel?.(date) ?? formatDateLabel(date)}
              >
                <span className="block whitespace-nowrap text-xs font-semibold leading-4">{formatDateShort(date)}</span>
                {isMarked && (
                  <span className={`mx-auto mt-0.5 block h-1.5 w-1.5 rounded-full ${markerTone ? markerTone(date) === "own" ? "calendar-own-dot" : "calendar-other-dot" : "bg-[#ff665a]"}`} />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BookingTab({
  selectedTeam,
  clubRoomStatus,
  isClubRoomStatusReady,
  reservations,
  ownTeamReservations,
  ownTeamIds,
  leaderReservations,
  hasLeaderTeam,
  onUpdateClubRoomStatus,
  onCancelBooking,
}: {
  selectedTeam: Team | null;
  clubRoomStatus: ClubRoomStatus | null;
  isClubRoomStatusReady: boolean;
  reservations: Reservation[];
  ownTeamReservations: Reservation[];
  ownTeamIds: ReadonlySet<string>;
  leaderReservations: Reservation[];
  hasLeaderTeam: boolean;
  onUpdateClubRoomStatus: (isOpen: boolean) => Promise<void>;
  onCancelBooking: (bookingId: string, reason: string) => Promise<boolean>;
}) {
  const [pendingCancelBookingId, setPendingCancelBookingId] = useState<string | null>(null);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);

  async function confirmLeaderCancellation(bookingId: string) {
    setCancellingBookingId(bookingId);

    try {
      const cancelled = await onCancelBooking(bookingId, "팀장 취소");
      if (cancelled) setPendingCancelBookingId(null);
    } finally {
      setCancellingBookingId(null);
    }
  }

  return (
    <div className="home-layout space-y-3">
      <div className="home-room">
      <ClubRoomStatusPanel
        status={clubRoomStatus}
        isReady={isClubRoomStatusReady}
        onUpdateStatus={onUpdateClubRoomStatus}
      />
      </div>

      {selectedTeam && (
        <MobilePanel title="합주 일정" className="home-agenda readable-compact">
          <div className={`function-group space-y-1 ${ownTeamReservations.length >= 4 ? "function-group-scroll max-h-64 pr-1" : ""}`}>
            {ownTeamReservations.map((reservation) => {
              const date = reservationDisplayDate(reservation);

              return (
                <div key={reservation.id} className="rounded-md border border-[#f0ded7] bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="text-[13px] font-semibold leading-4">{formatDateLabel(date)}</p>
                        {reservation.location === "external" && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">외부</span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[10px] leading-4 text-slate-500">
                        {reservation.teamName} - {reservation.purpose || reservation.teamSong || "합주"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center rounded bg-slate-950 px-2 py-1.5 text-right text-white">
                      <p className="text-[11px] font-semibold leading-4">
                        {reservation.start}-{addHours(reservation.start, reservation.duration)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {ownTeamReservations.length === 0 && <EmptyText text="내 팀의 예정된 합주가 없습니다." />}
          </div>
        </MobilePanel>
      )}

      <ReservationDetailPanel className="home-today" title={`금일 예약 · ${formatDateLabel(todayISO())}`} date={todayISO()} reservations={reservations} ownTeamIds={ownTeamIds} />

      {hasLeaderTeam && (
        <MobilePanel title="팀장 예약 관리" className="home-management">
          <div className="function-group space-y-2">
            {leaderReservations.map((reservation) => (
              <div key={reservation.id} className="rounded-lg border border-[#f0ded7] bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {reservation.bookingDate ? formatDateLabel(reservation.bookingDate) : `${reservation.day}요일`} {reservation.start}-
                      {addHours(reservation.start, reservation.duration)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {reservation.teamName} · {reservation.purpose || reservation.teamSong || "합주"}
                      {reservation.location === "external" ? " · 외부" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingCancelBookingId(reservation.id)}
                    disabled={cancellingBookingId !== null}
                    className="rounded-md bg-[#fff0eb] px-2 py-1 text-xs font-semibold text-[#be3d33] disabled:text-slate-400"
                  >
                    취소
                  </button>
                </div>

                {pendingCancelBookingId === reservation.id && (
                  <div className="mt-3 border-t border-[#f7e8e2] pt-3">
                    <p className="text-xs font-semibold text-slate-700">이 예약을 정말 취소할까요?</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPendingCancelBookingId(null)}
                        disabled={cancellingBookingId === reservation.id}
                        className="h-9 rounded-lg border border-[#f0ded7] bg-white text-xs font-semibold text-slate-600 disabled:text-slate-400"
                      >
                        돌아가기
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmLeaderCancellation(reservation.id)}
                        disabled={cancellingBookingId === reservation.id}
                        className="h-9 rounded-lg bg-[#ff665a] text-xs font-semibold text-white disabled:bg-slate-200"
                      >
                        {cancellingBookingId === reservation.id ? "취소 중" : "취소"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {leaderReservations.length === 0 && <EmptyText text="취소할 예약이 없습니다." />}
          </div>
        </MobilePanel>
      )}

    </div>
  );
}

function CalendarTab({ reservations, ownTeamIds, allTeams }: {
  reservations: Reservation[];
  ownTeamIds: ReadonlySet<string>;
  allTeams: Team[];
}) {
  const today = todayISO();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState(today);
  const [periodRows, setPeriodRows] = useState<Reservation[]>(reservations);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setPeriodRows([]);
    async function loadPeriod() {
      const end = addDays(anchorDate, 20);
      const response = await supabase.rpc("get_rehearsal_calendar", { p_start: anchorDate, p_end: end });
      let rows: Array<Record<string, unknown>>;
      if (response.error && ["PGRST202", "42883"].includes(response.error.code)) {
        // Ordinary past bookings remain available before the history migration is applied.
        const fallback = await supabase.from("bookings")
          .select("id,team_id,booking_date,day_of_week,start_time,duration,purpose,status,booking_location,booking_type")
          .eq("status", "confirmed").gte("booking_date", anchorDate).lte("booking_date", end)
          .order("booking_date").order("start_time");
        if (fallback.error) throw fallback.error;
        rows = (fallback.data ?? []) as Array<Record<string, unknown>>;
      } else {
        if (response.error) throw response.error;
        rows = (response.data ?? []) as Array<Record<string, unknown>>;
      }
      const mapped: Reservation[] = rows.map((row) => {
        const teamId = String(row.team_id ?? "");
        const team = allTeams.find((entry) => entry.id === teamId);
        const existing = reservations.find((entry) => entry.id === String(row.booking_id ?? row.id));
        const leader = team?.members.find((entry) => entry.id === team.leaderId);
        const bookingType = row.booking_type === "room_block" ? "room_block" : "rehearsal";
        return {
          id: String(row.booking_id ?? row.id), teamId,
          teamName: bookingType === "room_block" ? "사용 제한" : String(row.team_name ?? team?.name ?? "삭제된 팀"),
          teamSong: String(row.goal ?? team?.song ?? ""), leaderName: existing?.leaderName ?? leader?.name ?? "-", leaderRole: existing?.leaderRole ?? leader?.role, memberCount: team?.members.length ?? 0,
          bookingDate: String(row.booking_date), day: dateToDay(String(row.booking_date)),
          start: String(row.start_time), duration: Number(row.duration), purpose: String(row.purpose ?? row.goal ?? ""),
          status: "confirmed", location: row.booking_location === "external" ? "external" : "club_room", bookingType,
          sourceType: row.source_type === "notion_history" ? "notion_history" : "booking",
          creditedMinutes: row.credited_minutes == null ? undefined : Number(row.credited_minutes),
          isOwnTeam: row.is_own_team === true,
        };
      });
      if (active) setPeriodRows(mapped);
    }
    void loadPeriod().catch((err) => { if (active) setError(getErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [anchorDate, allTeams, reservations]);
  const byDate = useMemo(() => {
    const grouped = new Map<string, Reservation[]>();
    for (const entry of periodRows) {
      const date = reservationDisplayDate(entry);
      grouped.set(date, [...(grouped.get(date) ?? []), entry]);
    }
    for (const rows of grouped.values()) rows.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start) || a.teamName.localeCompare(b.teamName, "ko"));
    return grouped;
  }, [periodRows]);
  const own = (row: Reservation) => row.isOwnTeam || ownTeamIds.has(row.teamId);
  const reservationsByDate = byDate;
  const cells = useMemo(() => threeWeekCalendarCells(anchorDate), [anchorDate]);
  const isCompact = selectedDate !== null;
  function changePeriod(date: string) { setAnchorDate(date); setSelectedDate(null); }
  return (
    <div className="space-y-3">
      <MobilePanel title="캘린더" className="readable-compact">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold" aria-live="polite">
            {anchorDate.slice(0, 4)}.{formatDateShort(anchorDate)} – {formatDateShort(addDays(anchorDate, 20))}
          </p>
          <div className="flex items-center gap-1" role="group" aria-label="캘린더 기간 이동">
            <button type="button" aria-label="이전 3주 보기" title="이전 기간"
              onClick={() => changePeriod(addDays(anchorDate, -21))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white">
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={() => changePeriod(today)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold">오늘</button>
            <button type="button" aria-label="다음 3주 보기" title="다음 기간"
              onClick={() => changePeriod(addDays(anchorDate, 21))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <details className="mb-2">
          <summary className="cursor-pointer text-xs text-slate-500">날짜로 이동</summary>
          <label className="calendar-history-jump mt-2">
            <span>조회 시작 날짜</span>
            <input type="date" aria-label="캘린더 조회 시작 날짜" min="2000-01-01" max={addDays(today, 365)} value={anchorDate}
              onChange={(event) => { if (event.target.value) changePeriod(event.target.value); }} />
          </label>
        </details>
        {loading && <LoadingStatus label="합주 예약을 불러오고 있어요." />}
        {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
        {isCompact && (
          <button
            type="button"
            onClick={() => setSelectedDate(null)}
            className="w-full rounded-md border border-[#efc9c1] bg-[#fff8f4] px-3 py-1.5 text-xs font-semibold text-[#b8493f]"
          >
            전체 보기
          </button>
        )}

        <div className="mt-2 grid grid-cols-7 border-b border-[#f2e6e1] pb-1 text-center text-[11px] font-semibold text-slate-500">
          {dateDayNames.map((day, index) => (
            <span key={day} className={index === 0 ? "text-[#d45145]" : ""}>{day}</span>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((date, index) => {
            const dayReservations = date ? reservationsByDate.get(date) ?? [] : [];
            const isSelected = date === selectedDate;
            const isToday = date === today;
            const isPast = Boolean(date && date < today && anchorDate === today);

            if (!date) {
              return (
                <div
                  key={`empty-month-${index}`}
                  className={isCompact ? "h-11" : "h-[124px]"}
                  aria-hidden="true"
                />
              );
            }

            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={`flex min-w-0 flex-col items-stretch justify-start px-0.5 pt-1 text-left transition ${
                  isCompact ? "h-11" : "h-[124px]"
                } ${isSelected ? "bg-[#fff4ef]" : "bg-white"}`}
                aria-pressed={isSelected}
                aria-label={`${formatDateLabel(date)} ${dayReservations.length}건 예약`}
              >
                <span
                  className={`mx-auto flex h-6 min-w-8 max-w-[42px] items-center justify-center rounded-md px-1 text-[10px] font-semibold ${
                    isSelected
                      ? "text-slate-950"
                      : isToday
                        ? "bg-slate-950 text-white"
                        : isPast
                          ? "text-slate-300"
                          : index % 7 === 0
                            ? "text-[#d45145]"
                            : "text-slate-700"
                  }`}
                >
                  {formatDateShort(date)}
                </span>

                {isCompact ? (
                  dayReservations.length > 0 && (
                    <span className="mt-1 flex items-center justify-center gap-0.5" aria-hidden="true">
                      {dayReservations.slice(0, 5).map((reservation) => (
                        <span key={reservation.id} className="h-1 w-1 rounded-full bg-[#ef8e7f]" />
                      ))}
                      {dayReservations.length > 5 && <span className="text-[8px] leading-none text-[#d45145]">+</span>}
                    </span>
                  )
                ) : (
                  <span className="mt-1 block space-y-0.5 overflow-hidden">
                    {dayReservations.slice(0, 4).map((reservation) => (
                      <span
                        key={reservation.id}
                        className={`calendar-event-label block truncate rounded-sm border px-0.5 py-0.5 text-[9px] font-semibold leading-3 ${own(reservation) ? "is-own-team" : "is-other-team"}`}
                        title={`${reservation.start} ${reservation.teamName}${own(reservation) ? " · 내 팀" : ""}`}
                      >
                        {reservation.bookingType === "room_block"
                          ? "사용 제한"
                          : reservation.location === "external"
                            ? `${reservation.teamName} · 외부`
                            : reservation.teamName}
                      </span>
                    ))}
                    {dayReservations.length > 4 && (
                      <span className="block text-center text-[9px] font-semibold text-slate-400">+{dayReservations.length - 4}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </MobilePanel>

      {selectedDate && !loading && !error && <ReservationDetailPanel date={selectedDate} reservations={periodRows} ownTeamIds={ownTeamIds} />}
    </div>
  );
}

function SuggestionsTab({
  leaderTeams,
  goalCategories,
  selectedGoal,
  changeGoal,
  selectedTeam,
  changeTeam,
  selectedLocation,
  changeLocation,
  selectedDate,
  setSelectedDate,
  slots,
  selectedTimes,
  onToggleSlot,
  onReserveSelected,
}: {
  leaderTeams: Team[];
  goalCategories: GoalCategory[];
  selectedGoal: string;
  changeGoal: (goal: string) => void;
  selectedTeam: Team | null;
  changeTeam: (teamId: string) => void;
  selectedLocation: BookingLocation | "";
  changeLocation: (location: BookingLocation) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  slots: BookingSlot[];
  selectedTimes: string[];
  onToggleSlot: (time: string) => void;
  onReserveSelected: () => Promise<void>;
}) {
  const [slotFilter, setSlotFilter] = useState<BookingSlotFilter>("all");
  const goalTeams = selectedGoal ? leaderTeams.filter((team) => team.song === selectedGoal) : [];
  const availableCount = slots.filter((slot) => slot.status === "available").length;
  const limitedCount = slots.filter((slot) => slot.status === "limited").length;
  const reservedCount = slots.filter((slot) => slot.status === "reserved").length;
  const selectedGroups = groupBookingTimes(selectedTimes);
  const selectedDuration = selectedTimes.length * 0.5;
  const slotFilterOptions: Array<{ id: BookingSlotFilter; label: string; count: number }> = [
    { id: "all", label: "전체", count: slots.length },
    { id: "available", label: "전원 가능", count: availableCount },
    { id: "limited", label: "일부 가능", count: limitedCount },
    { id: "reserved", label: "예약 완료", count: reservedCount },
  ];

  return (
    <div className="reservation-layout space-y-3">
      <div className="reservation-controls space-y-3">
      <MobilePanel title="합주 목표 선택">
        {leaderTeams.length > 0 ? (
          <label className="block">
            <select
              aria-label="합주 목표"
              value={selectedGoal}
              onChange={(event) => changeGoal(event.target.value)}
              className="reservation-team-select h-9 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-[13px] font-semibold outline-none transition focus:border-[#ff665a]"
            >
              <option value="">합주 목표를 선택해 주세요</option>
              {goalCategories.map((category) => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <EmptyText text="팀장만 예약 가능합니다." />
        )}
      </MobilePanel>

      {selectedGoal && (
        <MobilePanel title="예약 팀 선택">
          {goalTeams.length > 0 ? (
            <label className="block">
              <select
                aria-label="예약할 팀"
                value={selectedTeam?.id ?? ""}
                onChange={(event) => changeTeam(event.target.value)}
                className="reservation-team-select h-9 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-[13px] font-semibold outline-none transition focus:border-[#ff665a]"
              >
                <option value="">팀을 선택해 주세요</option>
                {goalTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <EmptyText text="선택한 합주 목표에 예약 가능한 팀이 없습니다." />
          )}
        </MobilePanel>
      )}

      {selectedTeam && (
        <MobilePanel title="합주 장소 선택">
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: "club_room", label: "동아리방" },
              { id: "external", label: "외부 합주실" },
            ] as Array<{ id: BookingLocation; label: string }>).map((location) => (
              <button
                key={location.id}
                type="button"
                onClick={() => changeLocation(location.id)}
                className={`h-10 rounded-lg border text-xs font-semibold ${
                  selectedLocation === location.id
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-[#f0ded7] bg-white text-slate-600"
                }`}
              >
                {location.label}
              </button>
            ))}
          </div>
          {selectedLocation === "external" && (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              외부 합주실은 다른 예약과 시간이 겹쳐도 예약할 수 있습니다.
            </p>
          )}
        </MobilePanel>
      )}

      {selectedTeam && selectedLocation && (
        <>
      <MobilePanel title="날짜 선택">
        <ThreeWeekCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} compact />
      </MobilePanel>

      <MobilePanel title={`예약 가능 시간 · ${formatDateLabel(selectedDate)}`}>
        <div className="grid grid-cols-4 gap-1">
          {slotFilterOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSlotFilter(option.id)}
              className={`h-10 rounded-lg border px-1 text-[11px] font-semibold ${
                slotFilter === option.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white text-slate-600"
              }`}
            >
              <span className="block">{option.label}</span>
              <span className="block text-[10px] opacity-75">{option.count}개</span>
            </button>
          ))}
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

        </>
      )}
      </div>
      {selectedTeam && selectedLocation ? (
      <div className="reservation-slots space-y-3">
        {timeBands.map((band) => {
          const bandSlots = slots.filter((slot) => {
            const minutes = timeToMinutes(slot.time);
            return minutes >= band.start && minutes < band.end && (slotFilter === "all" || slot.status === slotFilter);
          });

          if (bandSlots.length === 0) {
            return null;
          }

          return (
            <MobilePanel key={band.id} title={`${band.label} ${band.range}`} className="!p-3 [&>h3]:mb-2">
              <div className="space-y-1.5">
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
        {slots.filter((slot) => slotFilter === "all" || slot.status === slotFilter).length === 0 && (
          <MobilePanel>
            <EmptyText text="선택한 조건에 맞는 시간대가 없습니다." />
          </MobilePanel>
        )}
      </div>
      ) : (
        <div className="reservation-placeholder workspace-desktop-only">
          <EmptyText text="예약할 팀과 장소를 선택해 주세요." />
        </div>
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
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<{ top: number; scroller: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    scrollAnchorRef.current = null;
    if (anchor && rowRef.current) {
      // The selection summary above the slots can grow or shrink after each click.
      anchor.scroller.scrollTop += rowRef.current.getBoundingClientRect().top - anchor.top;
    }
  }, [isSelected]);
  const disabled = slot.status === "reserved";
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
    <div ref={rowRef} className={`booking-slot-row rounded-lg border px-3 py-2 ${isSelected ? "border-[#ff665a] bg-[#fff8f4]" : "border-[#f0ded7] bg-white"}`}>
      <div className="booking-slot-summary flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {slot.time}-{slot.end}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {slot.reservation
              ? `${slot.reservation.teamName} ${slot.reservation.leaderName} 예약`
              : `${slot.available.length}/${teamSize}명 가능`}
          </p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${badgeClass}`}>{statusLabel}</span>
      </div>

      {slot.absent.length > 0 && slot.status !== "reserved" && (
        <div className="booking-slot-absent mt-1.5 flex flex-wrap gap-1.5">
          {slot.absent.map((member) => (
            <span key={member.id} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
              {member.name} {slot.absentReasons[member.id] ?? "불가"}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const row = rowRef.current;
          const scroller = row?.closest<HTMLElement>(".workspace-content");
          if (row && scroller) scrollAnchorRef.current = { top: row.getBoundingClientRect().top, scroller };
          onToggle(slot.time);
        }}
        aria-label={`${slot.time}-${slot.end} ${disabled ? "이미 예약됨" : isSelected ? "선택 해제" : "선택"}`}
        aria-pressed={isSelected}
        title={disabled ? "이미 예약됨" : isSelected ? "선택 해제" : "선택"}
        className={`booking-slot-toggle mt-2 h-9 w-full rounded-lg text-sm font-semibold ${
          disabled
            ? "bg-slate-100 text-slate-400"
            : isSelected
              ? "border border-[#ff665a] bg-white text-[#be3d33]"
              : "bg-[#ff665a] text-white"
        }`}
      >
        <span className="workspace-mobile-label">{slot.status === "reserved" ? "이미 예약됨" : isSelected ? "선택 해제" : "선택"}</span>
        {disabled ? <LockKeyhole className="workspace-nav-icon" size={18} aria-hidden="true" />
          : isSelected ? <Check className="workspace-nav-icon" size={18} aria-hidden="true" />
          : <Plus className="workspace-nav-icon" size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}

function MyPageTab({
  profile,
  pushHealth,
  teams,
  allTeams,
  goalCategories,
  approvedProfiles,
  reservations,
  rehearsalLeaderboardRows,
  ownBusy,
  busyByUser,
  dateBusyByUser,
  dateOverrideByUser,
  dateBusyByDate,
  dateOverrideDates,
  saveWeeklySchedule,
  saveDateSchedule,
  resetDateSchedule,
}: {
  profile: Profile;
  pushHealth: string;
  teams: Team[];
  allTeams: Team[];
  goalCategories: GoalCategory[];
  approvedProfiles: Profile[];
  reservations: Reservation[];
  rehearsalLeaderboardRows: RehearsalRankRow[];
  ownBusy: string[];
  busyByUser: Record<string, string[]>;
  dateBusyByUser: Record<string, Record<string, string[]>>;
  dateOverrideByUser: Record<string, string[]>;
  dateBusyByDate: Record<string, string[]>;
  dateOverrideDates: string[];
  saveWeeklySchedule: (nextBusyKeys: string[]) => Promise<void>;
  saveDateSchedule: (drafts: DateScheduleDrafts) => Promise<void>;
  resetDateSchedule: (date: string) => Promise<void>;
}) {
  const [scheduleScope, setScheduleScope] = useState<ScheduleScope>("weekly");
  const [scheduleDate, setScheduleDate] = useState(todayISO);
  const [showsLeaderboard, setShowsLeaderboard] = useState(false);
  const [selectedMembershipGoal, setSelectedMembershipGoal] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const [isSavingPush, setIsSavingPush] = useState(false);
  const [isSendingTestPush, setIsSendingTestPush] = useState(false);
  const memberships = teams
    .map((team) => {
      const member = team.members.find((item) => item.id === profile.id);
      return member ? { team, role: member.role } : null;
    })
    .filter((item): item is { team: Team; role: SessionRole } => Boolean(item));
  const filteredMemberships = selectedMembershipGoal
    ? memberships.filter(({ team }) => team.song === selectedMembershipGoal)
    : [];
  const rehearsalStats = useMemo(() => {
    const currentRow = rehearsalLeaderboardRows.find((row) => row.userId === profile.id);

    return {
      totalDuration: currentRow?.totalDuration ?? 0,
      rank: currentRow?.rank ?? null,
      rankedCount: rehearsalLeaderboardRows.length,
    };
  }, [profile.id, rehearsalLeaderboardRows]);
  const rehearsalLeaderboard = useMemo(() => rehearsalLeaderboardRows.slice(0, 10), [rehearsalLeaderboardRows]);
  const rehearsalRank = rehearsalStats.rank ? `${rehearsalStats.rank}위 / ${rehearsalStats.rankedCount}명` : "-";
  const dateHasOverride = dateOverrideDates.includes(scheduleDate);
  const scheduleDateDay = dateToDay(scheduleDate);
  const weeklyBusyForDate = ownBusy
    .filter((key) => key.startsWith(`${scheduleDateDay}-`))
    .map((key) => dateSlotKey(scheduleDate, weeklyKeyToTime(key)));
  const selectedDateBusy = dateHasOverride
    ? (dateBusyByDate[scheduleDate] ?? []).map((time) => dateSlotKey(scheduleDate, time))
    : weeklyBusyForDate;
  const scheduleColumns: ScheduleColumn[] =
    scheduleScope === "date"
      ? [{ label: formatDateShort(scheduleDate), day: scheduleDateDay, date: scheduleDate }]
      : dateDayNames.map((day) => ({ label: day, day }));
  const teamListClassName = filteredMemberships.length > 4 ? "max-h-56 overflow-y-auto pr-1" : "";

  async function enablePushNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushMessage("이 브라우저는 웹푸시 알림을 지원하지 않습니다.");
      return;
    }

    setIsSavingPush(true);
    setPushMessage("");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushMessage("알림 권한이 허용되지 않았습니다.");
        setIsSavingPush(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== profile.id) throw new Error("로그인 상태를 다시 확인해 주세요.");
      const result = await syncPushSubscription(profile.id, data.session.access_token, true, true);
      setPushMessage(result.message);
    } catch (error) {
      setPushMessage(getErrorMessage(error));
    } finally {
      setIsSavingPush(false);
    }
  }

  async function sendTestPushNotification(kind: "daily_digest" | "booking_reminder") {
    setIsSendingTestPush(true);
    setPushMessage("");

    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== profile.id) throw new Error("로그인 상태를 다시 확인해 주세요.");
      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ kind }),
      });
      const result = (await response.json().catch(() => null)) as { sent?: number; error?: string } | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "테스트 알림 발송에 실패했습니다.");
      }

      setPushMessage(`${kind === "daily_digest" ? "아침 브리핑" : "30분 전"} 테스트 알림을 보냈어요. (${result?.sent ?? 1}개 기기)`);
    } catch (error) {
      setPushMessage(getErrorMessage(error));
    } finally {
      setIsSendingTestPush(false);
    }
  }

  return (
    <div className="mypage-layout space-y-3">
      <MobilePanel className="mypage-profile">
        <p className="text-xs font-semibold text-[#ef6351]">마이페이지</p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold">{profile.name}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {profile.cohort} · {profile.student_no}
            </p>
          </div>
          <span className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs font-semibold text-[#be3d33]">
            {profileRoleLabel(profile.role)}
          </span>
        </div>
        <div className="mypage-stats mt-4 grid grid-cols-2 gap-2">
          <div className="mypage-time min-w-0 rounded-lg border border-[#f0ded7] bg-white p-3">
            <p className="text-xs font-semibold text-slate-500">누적 합주시간</p>
            <p className="mt-1 break-words text-sm font-semibold leading-5 text-slate-950">{formatDuration(rehearsalStats.totalDuration)}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowsLeaderboard((current) => !current)}
            className="mypage-rank min-w-0 rounded-lg border border-[#f0ded7] bg-white p-3 text-left"
            aria-expanded={showsLeaderboard}
          >
            <p className="text-xs font-semibold text-slate-500">합주 시간 순위</p>
            <p className="mt-1 break-words text-sm font-semibold leading-5 text-slate-950">{rehearsalRank}</p>
            <p className="mt-1 text-[10px] font-semibold text-[#be3d33]">{showsLeaderboard ? "접기" : "상위 10명 보기"}</p>
          </button>
        </div>
        {showsLeaderboard && (
          <div className="mypage-leaderboard mt-3 rounded-lg border border-[#f0ded7] bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">합주 시간 리더보드</p>
              <p className="text-[11px] font-semibold text-slate-500">상위 10명</p>
            </div>
            <div className="space-y-1.5">
              {rehearsalLeaderboard.map((row) => (
                <div
                  key={row.userId}
                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-2 text-xs ${
                    row.userId === profile.id ? "bg-[#fff0eb]" : "bg-slate-50"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">
                      {row.rank}위 · {row.cohort} {row.name}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold text-slate-700">{formatDuration(row.totalDuration)}</p>
                </div>
              ))}
              {rehearsalLeaderboard.length === 0 && <EmptyText text="아직 순위 데이터가 없습니다." />}
            </div>
          </div>
        )}
      </MobilePanel>

      <MobilePanel title="소속 팀" className="mypage-teams">
        <label className="mb-3 block">
          <span className="text-xs font-semibold text-slate-500">합주 목표</span>
          <select
            value={selectedMembershipGoal}
            onChange={(event) => setSelectedMembershipGoal(event.target.value)}
            disabled={goalCategories.length === 0}
            className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none transition focus:border-[#ff665a] disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">
              {goalCategories.length === 0 ? "등록된 합주 목표가 없습니다." : "합주 목표를 선택해 주세요"}
            </option>
            {goalCategories.map((category) => (
              <option key={category.id} value={category.name}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <div className={`mypage-membership-list space-y-2 ${teamListClassName}`}>
          {filteredMemberships.map(({ team, role }) => (
            <div key={team.id} className="rounded-lg border border-[#f0ded7] bg-white px-3 py-3">
              <p className="text-sm font-semibold">
                {team.name} - {role}
              </p>
            </div>
          ))}
          {!selectedMembershipGoal && goalCategories.length > 0 && <EmptyText text="합주 목표를 선택하면 소속 팀이 표시됩니다." />}
          {selectedMembershipGoal && filteredMemberships.length === 0 && (
            <EmptyText text="선택한 합주 목표에 소속된 팀이 없습니다." />
          )}
        </div>
      </MobilePanel>

      <MobilePanel title="내 시간표 편집" className="mypage-schedule">
        <p className="mb-3 text-xs leading-5 text-slate-500">
          고정 요일 시간표는 기본으로 적용되고, 날짜별 수정은 선택한 날짜에만 적용됩니다. 수정 후 저장해야 반영됩니다.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {([
            { id: "weekly", label: "고정 요일" },
            { id: "date", label: "날짜별 수정" },
          ] as Array<{ id: ScheduleScope; label: string }>).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setScheduleScope(item.id)}
              className={`h-10 rounded-lg border text-xs font-semibold ${
                scheduleScope === item.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white text-slate-600"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {scheduleScope === "date" && (
          <div className="mb-3 space-y-2">
            <ThreeWeekCalendar selectedDate={scheduleDate} onSelectDate={setScheduleDate} />
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              {dateHasOverride ? "이 날짜는 날짜별 시간표가 적용 중입니다." : "아직 날짜별 수정이 없어 고정 시간표를 사용합니다."}
            </p>
          </div>
        )}
        <ScheduleGrid
          key={profile.id}
          busy={scheduleScope === "date" ? selectedDateBusy : ownBusy}
          columns={scheduleColumns}
          onSaveDraft={saveWeeklySchedule}
          onSaveDateDrafts={saveDateSchedule}
          onResetDateOverride={scheduleScope === "date" && dateHasOverride ? () => resetDateSchedule(scheduleDate) : undefined}
        />
      </MobilePanel>

      <MobilePanel title="푸시 알림" className="mypage-push">
        <p className="text-xs leading-5 text-slate-500">
          합주 당일 오전 9시, 시작 30분 전, 일정 추가/취소 알림을 받을 수 있습니다. 새 기기를 등록하면 이전 기기의 알림은 해제됩니다. iPhone은 홈 화면에 추가한 Andante에서 허용해야 안정적으로 동작합니다.
        </p>
        {(pushMessage || pushHealth) && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{pushMessage || pushHealth}</p>}
        <button
          type="button"
          onClick={enablePushNotifications}
          disabled={isSavingPush}
          className="mt-3 h-11 w-full rounded-lg bg-slate-950 text-sm font-semibold text-white disabled:bg-slate-100 disabled:text-slate-400"
        >
          {isSavingPush ? "알림 설정 중" : "이 기기에서 알림 받기"}
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => sendTestPushNotification("daily_digest")}
            disabled={isSendingTestPush}
            className="h-10 rounded-lg border border-[#f0ded7] bg-white text-xs font-semibold text-slate-700 disabled:bg-slate-50 disabled:text-slate-400"
          >
            아침 브리핑 테스트
          </button>
          <button
            type="button"
            onClick={() => sendTestPushNotification("booking_reminder")}
            disabled={isSendingTestPush}
            className="h-10 rounded-lg border border-[#f0ded7] bg-white text-xs font-semibold text-slate-700 disabled:bg-slate-50 disabled:text-slate-400"
          >
            30분 전 알림 테스트
          </button>
        </div>
      </MobilePanel>
    </div>
  );
}

function TeamTab({
  allTeams,
  approvedProfiles,
  goalCategories,
  teamRehearsalTotals,
  onAddTeam,
  onUpdateTeam,
  currentUserId,
}: {
  allTeams: Team[];
  approvedProfiles: Profile[];
  goalCategories: GoalCategory[];
  teamRehearsalTotals: Record<string, TeamRehearsalTotal>;
  onAddTeam: (payload: NewTeamPayload) => Promise<void>;
  onUpdateTeam: (payload: UpdateTeamPayload) => Promise<void>;
  currentUserId: string;
}) {
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [registeredTeamGoal, setRegisteredTeamGoal] = useState("");
  const [selectedEditTeamId, setSelectedEditTeamId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [selectedGoal, setSelectedGoal] = useState("");
  const [leaderRole, setLeaderRole] = useState<SessionRole>("보컬");
  const [memberId, setMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberRole, setMemberRole] = useState<SessionRole>("리드기타");
  const [members, setMembers] = useState<TeamMemberDraft[]>([]);
  const [message, setMessage] = useState("승인된 부원을 선택해 새 팀을 만들 수 있어요.");

  const currentProfile = approvedProfiles.find((item) => item.id === currentUserId);
  const teamEligibleProfiles = approvedProfiles.filter((item) => item.role !== "admin");
  const leader = teamEligibleProfiles.find((item) => item.id === currentUserId);
  const leaderTeams = allTeams.filter((team) => team.leaderId === currentUserId);
  const selectedEditTeam = leaderTeams.find((team) => team.id === selectedEditTeamId) ?? leaderTeams[0] ?? null;
  const addedMemberIds = new Set(members.map((member) => member.userId));
  const availableMemberProfiles = teamEligibleProfiles.filter((item) => item.id !== currentUserId && !addedMemberIds.has(item.id));
  const selectedMember = availableMemberProfiles.find((item) => item.id === memberId) ?? null;

  useEffect(() => {
    if (goalCategories.length === 0) {
      if (selectedGoal) {
        setSelectedGoal("");
      }
      if (registeredTeamGoal) {
        setRegisteredTeamGoal("");
      }
      return;
    }

    if (!goalCategories.some((category) => category.name === selectedGoal)) {
      setSelectedGoal(goalCategories[0].name);
    }
    if (
      registeredTeamGoal &&
      registeredTeamGoal !== allGoalFilterValue &&
      !goalCategories.some((category) => category.name === registeredTeamGoal)
    ) {
      setRegisteredTeamGoal("");
    }
  }, [goalCategories, registeredTeamGoal, selectedGoal]);

  const isAllRegisteredTeamGoal = registeredTeamGoal === allGoalFilterValue;
  const registeredGoalTeams = !registeredTeamGoal
    ? []
    : isAllRegisteredTeamGoal
      ? allTeams
      : allTeams.filter((team) => team.song === registeredTeamGoal);

  useEffect(() => {
    setMemberId("");
    setMemberSearch("");

    if (mode === "create") {
      setSelectedEditTeamId("");
      setTeamName("");
      setSelectedGoal(goalCategories[0]?.name ?? "");
      setLeaderRole("보컬");
      setMembers([]);
      setMessage("승인된 부원을 선택해 새 팀을 만들 수 있어요.");
      return;
    }

    if (!selectedEditTeam) {
      setSelectedEditTeamId("");
      setTeamName("");
      setSelectedGoal(goalCategories[0]?.name ?? "");
      setLeaderRole("보컬");
      setMembers([]);
      setMessage("팀장인 팀이 없습니다.");
      return;
    }

    const teamLeader = selectedEditTeam.members.find((member) => member.id === currentUserId);
    setSelectedEditTeamId(selectedEditTeam.id);
    setTeamName(selectedEditTeam.name);
    setSelectedGoal(selectedEditTeam.song);
    setLeaderRole(teamLeader?.role ?? "보컬");
    setMembers(
      selectedEditTeam.members
        .filter((member) => member.id !== currentUserId)
        .map((member) => ({ userId: member.id, name: member.name, role: member.role })),
    );
    setMessage(`${selectedEditTeam.name} 팀을 수정할 수 있어요.`);
  }, [mode, selectedEditTeam?.id, currentUserId, goalCategories]);

  function addMemberDraft() {
    const target = selectedMember;
    if (!target) {
      setMessage("추가할 부원을 선택해 주세요.");
      return;
    }
    if (members.some((member) => member.userId === target.id)) {
      setMessage("이미 추가한 멤버입니다.");
      return;
    }

    setMembers((current) => [...current, { userId: target.id, name: target.name, role: memberRole }]);
    setMemberId("");
    setMemberSearch("");
    setMessage(`${target.name} 멤버를 추가했어요.`);
  }

  function removeDraft(userId: string) {
    setMembers((current) => current.filter((member) => member.userId !== userId));
  }

  async function submitTeamForm() {
    const trimmedTeamName = teamName.trim();
    if (!trimmedTeamName) {
      setMessage("팀 이름을 먼저 입력해 주세요.");
      return;
    }
    if (!leader) {
      setMessage(
        currentProfile?.role === "admin"
          ? "관리자 계정은 팀장이나 멤버로 추가할 수 없습니다."
          : "내 계정 정보를 불러온 뒤 다시 시도해 주세요.",
      );
      return;
    }
    if (
      allTeams.some(
        (team) => team.name.toLowerCase() === trimmedTeamName.toLowerCase() && (mode === "create" || team.id !== selectedEditTeam?.id),
      )
    ) {
      setMessage("이미 같은 이름의 팀이 있어요.");
      return;
    }
    if (!selectedGoal) {
      setMessage("관리자 탭에서 합주 목표를 먼저 추가해 주세요.");
      return;
    }

    if (mode === "edit") {
      if (!selectedEditTeam) {
        setMessage("수정할 팀을 선택해 주세요.");
        return;
      }

      await onUpdateTeam({
        teamId: selectedEditTeam.id,
        teamName: trimmedTeamName,
        song: selectedGoal,
        leaderId: currentUserId,
        leaderRole,
        members,
      });
      setMessage("팀 정보를 저장했어요.");
      return;
    }

    await onAddTeam({
      teamName: trimmedTeamName,
      song: selectedGoal,
      leaderId: currentUserId,
      leaderRole,
      members,
    });
    setTeamName("");
    setSelectedGoal(goalCategories[0]?.name ?? "");
    setMembers([]);
    setMessage("팀 등록 요청을 보냈어요.");
  }

  return (
    <div className="team-layout space-y-3">
      <MobilePanel className="team-editor" title={mode === "create" ? "팀 생성" : "팀 편집"}>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {([
            { id: "create", label: "생성" },
            { id: "edit", label: "편집" },
          ] as Array<{ id: "create" | "edit"; label: string }>).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={`h-10 rounded-lg border text-sm font-semibold ${
                mode === item.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white text-slate-600"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mb-3 rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-slate-700">{message}</p>

        {mode === "edit" && (
          <label className="mb-3 block">
            <span className="text-xs font-semibold text-slate-500">수정할 팀</span>
            <select
              value={selectedEditTeam?.id ?? ""}
              onChange={(event) => setSelectedEditTeamId(event.target.value)}
              disabled={leaderTeams.length === 0}
              className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none transition focus:border-[#ff665a] disabled:bg-slate-50 disabled:text-slate-400"
            >
              {leaderTeams.length === 0 && (
                <option value="" disabled>
                  팀장인 팀이 없습니다
                </option>
              )}
              {leaderTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} · {team.song}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="space-y-3">
          <LabeledInput label="팀 이름" value={teamName} onChange={setTeamName} placeholder="곡 이름" />
          <GoalCategorySelect label="합주 목표" value={selectedGoal} onChange={setSelectedGoal} categories={goalCategories} />

          <div>
            <p className="text-xs font-semibold text-slate-500">팀장</p>
            <div className="mt-2 rounded-lg border border-[#f0ded7] bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-950">
              {leader
                ? `${leader.name} · ${leader.cohort}`
                : currentProfile?.role === "admin"
                  ? "관리자 계정은 팀에 추가할 수 없습니다"
                  : "내 계정"}
            </div>
          </div>
          <SessionSelect label="팀장 세션" value={leaderRole} onChange={setLeaderRole} />

          <ProfileSearchPicker
            label="멤버"
            value={memberId}
            query={memberSearch}
            onQueryChange={setMemberSearch}
            onChange={setMemberId}
            profiles={availableMemberProfiles}
          />
          <SessionSelect label="멤버 세션" value={memberRole} onChange={setMemberRole} />
          <button
            type="button"
            onClick={addMemberDraft}
            disabled={!selectedMember}
            className="h-10 w-full rounded-lg border border-slate-950 bg-slate-950 text-sm font-semibold text-white disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
          >
            멤버 추가
          </button>

          <div className="space-y-2">
          {members.length === 0 ? (
            <EmptyText text="보컬&악기로 같이 하는 세션의 경우 보컬로 선택해주세요." />
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
        </div>

        <button
          type="button"
          onClick={submitTeamForm}
          disabled={mode === "edit" && !selectedEditTeam}
          className="mt-4 h-12 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(239,99,81,0.24)] disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
        >
          {mode === "create" ? "팀 등록하기" : "팀 정보 저장"}
        </button>
      </MobilePanel>

      <MobilePanel title="등록된 팀" className="team-directory">
        <div className="space-y-3">
          <GoalCategorySelect
            label="조회할 합주 목표"
            value={registeredTeamGoal}
            onChange={setRegisteredTeamGoal}
            categories={goalCategories}
            includeAllOption
          />
          <div className="space-y-2">
            {registeredGoalTeams.map((team) => {
              const leaderProfile = team.members.find((member) => member.id === team.leaderId);
              const rehearsalTotals = teamRehearsalTotals[team.id] ?? { totalDuration: 0, totalSessionDuration: 0 };

              return (
                <div key={team.id} className="rounded-lg border border-[#f0ded7] bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{team.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{team.song}</p>
                    </div>
                    <div className="relative min-w-[138px] shrink-0 pt-4 text-right">
                      <span className={`absolute right-0 top-0 block h-3 w-3 rounded-sm ${team.color}`} />
                      <p className="flex items-center justify-between gap-2 whitespace-nowrap text-[10px] font-semibold leading-4 text-slate-500">
                        <span>전체 합주시간</span>
                        <strong className="text-xs text-slate-950">{formatDuration(rehearsalTotals.totalDuration)}</strong>
                      </p>
                      <p className="flex items-center justify-between gap-2 whitespace-nowrap text-[10px] font-semibold leading-4 text-slate-500">
                        <span>전체 세션 합주시간</span>
                        <strong className="text-xs text-slate-950">{formatDuration(rehearsalTotals.totalSessionDuration)}</strong>
                      </p>
                    </div>
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
            {!registeredTeamGoal ? (
              <EmptyText text="목표를 선택해 주세요." />
            ) : (
              registeredGoalTeams.length === 0 && (
                <EmptyText text={isAllRegisteredTeamGoal ? "등록된 팀이 없습니다." : "선택한 합주 목표에 등록된 팀이 없습니다."} />
              )
            )}
          </div>
        </div>
      </MobilePanel>
    </div>
  );
}

function TeamEditPanel({
  title,
  emptyText,
  teams,
  approvedProfiles,
  goalCategories,
  fixedLeaderId,
  onSubmit,
}: {
  title: string;
  emptyText: string;
  teams: Team[];
  approvedProfiles: Profile[];
  goalCategories: GoalCategory[];
  fixedLeaderId?: string;
  onSubmit: (payload: UpdateTeamPayload) => Promise<void>;
}) {
  const eligibleProfiles = approvedProfiles.filter((profile) => profile.role !== "admin");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null;
  const [teamSearch, setTeamSearch] = useState("");
  const [teamName, setTeamName] = useState("");
  const [selectedGoal, setSelectedGoal] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [leaderRole, setLeaderRole] = useState<SessionRole>("보컬");
  const [memberId, setMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberRole, setMemberRole] = useState<SessionRole>("리드기타");
  const [members, setMembers] = useState<TeamMemberDraft[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!selectedTeam) {
      setSelectedTeamId("");
      setTeamName("");
      setSelectedGoal(goalCategories[0]?.name ?? "");
      setLeaderId(fixedLeaderId ?? "");
      setLeaderRole("보컬");
      setMembers([]);
      return;
    }

    const leader = selectedTeam.members.find((member) => member.id === selectedTeam.leaderId);
    setSelectedTeamId(selectedTeam.id);
    setTeamName(selectedTeam.name);
    setSelectedGoal(selectedTeam.song);
    setLeaderId(fixedLeaderId ?? selectedTeam.leaderId);
    setLeaderRole(leader?.role ?? "보컬");
    setMembers(
      selectedTeam.members
        .filter((member) => member.id !== (fixedLeaderId ?? selectedTeam.leaderId))
        .map((member) => ({ userId: member.id, name: member.name, role: member.role })),
    );
    setMemberId("");
    setMemberSearch("");
    setTeamSearch(selectedTeam.name);
    setMessage("");
  }, [selectedTeam?.id, fixedLeaderId, goalCategories]);

  const effectiveLeaderId = fixedLeaderId ?? leaderId;
  const leader = eligibleProfiles.find((profile) => profile.id === effectiveLeaderId) ?? null;
  const addedMemberIds = new Set(members.map((member) => member.userId));
  const availableMemberProfiles = eligibleProfiles.filter((profile) => profile.id !== effectiveLeaderId && !addedMemberIds.has(profile.id));
  const selectedMember = availableMemberProfiles.find((profile) => profile.id === memberId) ?? null;

  function addMemberDraft() {
    if (!selectedMember) {
      setMessage("추가할 부원을 선택해 주세요.");
      return;
    }

    setMembers((current) => [...current, { userId: selectedMember.id, name: selectedMember.name, role: memberRole }]);
    setMemberId("");
    setMemberSearch("");
    setMessage(`${selectedMember.name} 멤버를 추가했어요.`);
  }

  async function submitTeamEdit() {
    if (!selectedTeam) {
      return;
    }

    const trimmedName = teamName.trim();
    if (!trimmedName) {
      setMessage("팀 이름을 입력해 주세요.");
      return;
    }
    if (!selectedGoal) {
      setMessage("합주 목표를 선택해 주세요.");
      return;
    }
    if (!leader) {
      setMessage("팀장을 선택해 주세요.");
      return;
    }

    await onSubmit({
      teamId: selectedTeam.id,
      teamName: trimmedName,
      song: selectedGoal,
      leaderId: leader.id,
      leaderRole,
      members,
    });
    setMessage("팀 정보를 저장했어요.");
  }

  return (
    <MobilePanel title={title}>
      {teams.length === 0 ? (
        <EmptyText text={emptyText} />
      ) : (
        <div className="space-y-3">
          <TeamSearchPicker
            label="수정할 팀 검색"
            value={selectedTeam?.id ?? ""}
            query={teamSearch}
            onQueryChange={setTeamSearch}
            onChange={setSelectedTeamId}
            teams={teams}
          />
          <LabeledInput label="팀 이름" value={teamName} onChange={setTeamName} placeholder="곡 이름" />
          <GoalCategorySelect label="합주 목표" value={selectedGoal} onChange={setSelectedGoal} categories={goalCategories} />

          {fixedLeaderId ? (
            <div>
              <p className="text-xs font-semibold text-slate-500">팀장</p>
              <div className="mt-2 rounded-lg border border-[#f0ded7] bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-950">
                {leader ? `${leader.name} · ${leader.cohort}` : "내 계정"}
              </div>
            </div>
          ) : (
            <ProfileSelect label="팀장" value={effectiveLeaderId} onChange={setLeaderId} profiles={eligibleProfiles} />
          )}
          <SessionSelect label="팀장 세션" value={leaderRole} onChange={setLeaderRole} />

          <ProfileSearchPicker
            label="멤버 검색"
            value={memberId}
            query={memberSearch}
            onQueryChange={setMemberSearch}
            onChange={setMemberId}
            profiles={availableMemberProfiles}
          />
          <SessionSelect label="멤버 세션" value={memberRole} onChange={setMemberRole} />
          <button
            type="button"
            onClick={addMemberDraft}
            disabled={!selectedMember}
            className="h-10 w-full rounded-lg border border-slate-950 bg-slate-950 text-sm font-semibold text-white disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
          >
            멤버 추가
          </button>

          <div className="space-y-2">
            {members.map((member) => (
              <div key={member.userId} className="flex items-center justify-between rounded-lg border border-[#f0ded7] bg-white p-3">
                <div>
                  <p className="text-sm font-semibold">{member.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{member.role}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMembers((current) => current.filter((item) => item.userId !== member.userId))}
                  className="rounded-md bg-[#fff0eb] px-2 py-1 text-xs font-semibold text-[#be3d33]"
                >
                  제거
                </button>
              </div>
            ))}
            {members.length === 0 && <EmptyText text="팀장만 있는 팀으로도 저장할 수 있어요." />}
          </div>

          {message && <p className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-slate-600">{message}</p>}
          <button type="button" onClick={submitTeamEdit} className="h-11 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white">
            팀 정보 저장
          </button>
        </div>
      )}
    </MobilePanel>
  );
}

function AdminTeamManager({
  allTeams,
  approvedProfiles,
  goalCategories,
  onAddTeam,
  onUpdateTeam,
}: {
  allTeams: Team[];
  approvedProfiles: Profile[];
  goalCategories: GoalCategory[];
  onAddTeam: (payload: NewTeamPayload) => Promise<void>;
  onUpdateTeam: (payload: UpdateTeamPayload) => Promise<void>;
}) {
  const eligibleProfiles = approvedProfiles.filter((profile) => profile.role !== "admin");
  const [teamName, setTeamName] = useState("");
  const [selectedGoal, setSelectedGoal] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [leaderRole, setLeaderRole] = useState<SessionRole>("보컬");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!selectedGoal && goalCategories[0]) {
      setSelectedGoal(goalCategories[0].name);
    }
    if (!leaderId && eligibleProfiles[0]) {
      setLeaderId(eligibleProfiles[0].id);
    }
  }, [goalCategories, selectedGoal, eligibleProfiles, leaderId]);

  async function createAdminTeam() {
    const trimmedName = teamName.trim();
    if (!trimmedName) {
      setMessage("팀 이름을 입력해 주세요.");
      return;
    }
    if (!selectedGoal) {
      setMessage("합주 목표를 선택해 주세요.");
      return;
    }
    if (!leaderId) {
      setMessage("팀장을 선택해 주세요.");
      return;
    }

    await onAddTeam({
      teamName: trimmedName,
      song: selectedGoal,
      leaderId,
      leaderRole,
      members: [],
    });
    setTeamName("");
    setMessage("팀을 생성했어요.");
  }

  return (
    <>
      <MobilePanel title="관리자 팀 생성">
        <div className="space-y-3">
          <LabeledInput label="팀 이름" value={teamName} onChange={setTeamName} placeholder="곡 이름" />
          <GoalCategorySelect label="합주 목표" value={selectedGoal} onChange={setSelectedGoal} categories={goalCategories} />
          <ProfileSelect label="팀장" value={leaderId} onChange={setLeaderId} profiles={eligibleProfiles} />
          <SessionSelect label="팀장 세션" value={leaderRole} onChange={setLeaderRole} />
          {message && <p className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-slate-600">{message}</p>}
          <button type="button" onClick={createAdminTeam} className="h-11 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white">
            팀 생성
          </button>
        </div>
      </MobilePanel>

      <TeamEditPanel
        title="기존 팀 수정"
        emptyText="등록된 팀이 없습니다."
        teams={allTeams}
        approvedProfiles={approvedProfiles}
        goalCategories={goalCategories}
        onSubmit={onUpdateTeam}
      />
    </>
  );
}

function AdminTab({
  currentProfile,
  pendingProfiles,
  approvedProfiles,
  allTeams,
  goalCategories,
  reservations,
  pushSubscriptionStatuses,
  busyByUser,
  dateBusyByUser,
  dateOverrideByUser,
  rehearsalByUser,
  approveProfile,
  updateProfileRole,
  resetMemberPassword,
  resetRehearsalTracking,
  createRoomBlocks,
  addGoalCategory,
  deleteGoalCategory,
  addTeam,
  updateTeam,
  cancelBooking,
  saveWeeklySchedule,
  saveDateSchedule,
  resetDateSchedule,
}: {
  currentProfile: Profile;
  pendingProfiles: Profile[];
  approvedProfiles: Profile[];
  allTeams: Team[];
  goalCategories: GoalCategory[];
  reservations: Reservation[];
  pushSubscriptionStatuses: PushSubscriptionStatus[];
  busyByUser: Record<string, string[]>;
  dateBusyByUser: Record<string, Record<string, string[]>>;
  dateOverrideByUser: Record<string, string[]>;
  rehearsalByUser: Record<string, string[]>;
  approveProfile: (profileId: string, nextStatus: "approved" | "rejected") => Promise<void>;
  updateProfileRole: (profileId: string, nextRole: "member" | "manager") => Promise<void>;
  resetMemberPassword: (profileId: string) => Promise<string>;
  resetRehearsalTracking: () => Promise<string>;
  createRoomBlocks: (date: string, reason: string, times: string[]) => Promise<void>;
  addGoalCategory: (name: string) => Promise<void>;
  deleteGoalCategory: (categoryId: string) => Promise<void>;
  addTeam: (payload: NewTeamPayload) => Promise<void>;
  updateTeam: (payload: UpdateTeamPayload) => Promise<void>;
  cancelBooking: (bookingId: string, reason: string) => Promise<boolean>;
  saveWeeklySchedule: (userId: string, nextBusyKeys: string[]) => Promise<void>;
  saveDateSchedule: (userId: string, drafts: DateScheduleDrafts) => Promise<void>;
  resetDateSchedule: (userId: string, date: string) => Promise<void>;
}) {
  const [newGoalName, setNewGoalName] = useState("");
  const [managerTargetId, setManagerTargetId] = useState("");
  const [managerQuery, setManagerQuery] = useState("");
  const [showsRehearsalResetConfirmation, setShowsRehearsalResetConfirmation] = useState(false);
  const [isResettingRehearsalTracking, setIsResettingRehearsalTracking] = useState(false);
  const [rehearsalResetMessage, setRehearsalResetMessage] = useState("");
  const roleEditableProfiles = approvedProfiles.filter((profile) => profile.role !== "admin");
  const selectedRoleProfile = roleEditableProfiles.find((profile) => profile.id === managerTargetId) ?? null;

  async function submitGoalCategory() {
    const trimmedGoalName = newGoalName.trim();
    if (!trimmedGoalName) {
      return;
    }

    await addGoalCategory(trimmedGoalName);
    setNewGoalName("");
  }

  async function confirmRehearsalTrackingReset() {
    setIsResettingRehearsalTracking(true);
    setRehearsalResetMessage("");

    try {
      await resetRehearsalTracking();
      setShowsRehearsalResetConfirmation(false);
      setRehearsalResetMessage("초기화가 완료되었습니다. 내일 이후 합주부터 다시 누적됩니다.");
    } catch (error) {
      setRehearsalResetMessage(getErrorMessage(error));
    } finally {
      setIsResettingRehearsalTracking(false);
    }
  }

  return (
    <div className="admin-layout space-y-3">
      <MobilePanel className="admin-summary">
        <p className="text-xs font-semibold text-[#ef6351]">관리자</p>
        <h3 className="mt-1 text-xl font-semibold">승인과 운영 관리</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          가입 승인, 예약 취소, 부원 시간표 수정을 처리합니다.
        </p>
      </MobilePanel>

      {isSuperAdmin(currentProfile) && (
        <>
          <AdminRoomBlockPanel reservations={reservations} onCreate={createRoomBlocks} />
          <PushSubscriptionStatusPanel statuses={pushSubscriptionStatuses} />

          <MobilePanel title="집기 권한 관리">
            <div className="space-y-3">
            <ProfileSearchPicker
              label="부원 검색"
              value={managerTargetId}
              query={managerQuery}
              onQueryChange={setManagerQuery}
              onChange={setManagerTargetId}
              profiles={roleEditableProfiles}
            />
            {selectedRoleProfile ? (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                선택된 계정: {selectedRoleProfile.name} · {selectedRoleProfile.cohort} · 현재 등급 {profileRoleLabel(selectedRoleProfile.role)}
              </div>
            ) : (
              <EmptyText text="집기로 등록하거나 해제할 부원을 선택해 주세요." />
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => selectedRoleProfile && updateProfileRole(selectedRoleProfile.id, "manager")}
                disabled={!selectedRoleProfile || selectedRoleProfile.role === "manager"}
                className="h-10 rounded-lg bg-slate-950 text-sm font-semibold text-white disabled:bg-slate-100 disabled:text-slate-400"
              >
                집기 등록
              </button>
              <button
                type="button"
                onClick={() => selectedRoleProfile && updateProfileRole(selectedRoleProfile.id, "member")}
                disabled={!selectedRoleProfile || selectedRoleProfile.role === "member"}
                className="h-10 rounded-lg border border-[#f0ded7] bg-white text-sm font-semibold text-[#be3d33] disabled:bg-slate-50 disabled:text-slate-300"
              >
                집기 해제
              </button>
            </div>
            </div>
          </MobilePanel>

          <MobilePanel title="합주시간 초기화">
            <p className="text-xs leading-5 text-slate-600">
              예약과 시간표는 유지하고, 오늘까지의 개인·팀 합주시간과 순위만 집계에서 제외합니다.
            </p>
            {rehearsalResetMessage && (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{rehearsalResetMessage}</p>
            )}
            {!showsRehearsalResetConfirmation ? (
              <button
                type="button"
                onClick={() => {
                  setRehearsalResetMessage("");
                  setShowsRehearsalResetConfirmation(true);
                }}
                className="mt-3 h-10 w-full rounded-lg border border-[#ff665a] bg-white text-sm font-semibold text-[#be3d33]"
              >
                합주시간 초기화
              </button>
            ) : (
              <div className="mt-3 rounded-lg bg-[#fff0eb] p-3">
                <p className="text-xs font-semibold leading-5 text-[#9f3029]">정말 초기화할까요? 실행 후 이전 누적시간은 화면에 다시 표시되지 않습니다.</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShowsRehearsalResetConfirmation(false)}
                    disabled={isResettingRehearsalTracking}
                    className="h-9 rounded-lg border border-[#f0ded7] bg-white text-xs font-semibold text-slate-600 disabled:text-slate-300"
                  >
                    돌아가기
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmRehearsalTrackingReset()}
                    disabled={isResettingRehearsalTracking}
                    className="h-9 rounded-lg bg-[#ff665a] text-xs font-semibold text-white disabled:bg-slate-200"
                  >
                    {isResettingRehearsalTracking ? "초기화 중" : "초기화 확정"}
                  </button>
                </div>
              </div>
            )}
          </MobilePanel>
        </>
      )}

      <MobilePanel title="가입 승인">
        <div className="admin-record-list space-y-2">
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

      <MobilePanel title="합주 목표 관리">
        <div className="space-y-3">
          <div>
            <LabeledInput label="합주 목표" value={newGoalName} onChange={setNewGoalName} placeholder="공연 이름 (예: 대동제)" />
            <button
              type="button"
              onClick={submitGoalCategory}
              disabled={!newGoalName.trim()}
              className="mt-3 h-10 w-full rounded-lg bg-slate-950 text-sm font-semibold text-white disabled:bg-slate-100 disabled:text-slate-400"
            >
              합주 목표 추가
            </button>
          </div>

          <div className="admin-record-list space-y-2">
            {goalCategories.map((category) => (
              <div key={category.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#f0ded7] bg-white p-3">
                <p className="text-sm font-semibold">{category.name}</p>
                <button
                  type="button"
                  onClick={() => deleteGoalCategory(category.id)}
                  className="rounded-md bg-[#fff0eb] px-2 py-1 text-xs font-semibold text-[#be3d33]"
                >
                  삭제
                </button>
              </div>
            ))}
            {goalCategories.length === 0 && (
              <EmptyText text="등록된 합주 목표가 없습니다. patch-008-goal-categories.sql 실행 후 목표를 추가해 주세요." />
            )}
          </div>
        </div>
      </MobilePanel>

      <AdminBookingCancellationPanel reservations={reservations} onCancel={cancelBooking} />

      <MobilePanel title="부원 시간표 수정" className="admin-schedule">
        <AdminScheduleEditor
          profiles={approvedProfiles}
          busyByUser={busyByUser}
          dateBusyByUser={dateBusyByUser}
          dateOverrideByUser={dateOverrideByUser}
          rehearsalByUser={rehearsalByUser}
          saveWeeklySchedule={saveWeeklySchedule}
          saveDateSchedule={saveDateSchedule}
          resetDateSchedule={resetDateSchedule}
        />
      </MobilePanel>

      <MobilePanel title="계정 비밀번호 리셋">
        <AdminPasswordResetPanel profiles={approvedProfiles} onResetPassword={resetMemberPassword} />
      </MobilePanel>

      <AdminTeamManager allTeams={allTeams} approvedProfiles={approvedProfiles} goalCategories={goalCategories} onAddTeam={addTeam} onUpdateTeam={updateTeam} />

    </div>
  );
}

function AdminBookingCancellationPanel({ reservations, onCancel }: {
  reservations: Reservation[];
  onCancel: (bookingId: string, reason: string) => Promise<boolean>;
}) {
  const today = todayISO();
  const [selectedDate, setSelectedDate] = useState(today);
  const [anchorDate, setAnchorDate] = useState(today);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [message, setMessage] = useState("");
  const byDate = useMemo(() => {
    const grouped = new Map<string, Reservation[]>();
    for (const reservation of reservations) {
      if (reservation.status !== "confirmed") continue;
      const date = reservationDisplayDate(reservation);
      grouped.set(date, [...(grouped.get(date) ?? []), reservation]);
    }
    for (const entries of grouped.values()) entries.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    return grouped;
  }, [reservations]);
  const selectedReservations = byDate.get(selectedDate) ?? [];

  function selectDate(date: string) {
    if (isCancelling) return;
    setSelectedDate(date); setPendingId(null); setMessage("");
  }
  function changePeriod(date: string) {
    setAnchorDate(date); selectDate(date);
  }
  async function confirmCancellation(bookingId: string) {
    if (isCancelling || pendingId !== bookingId) return;
    setIsCancelling(true); setMessage("");
    try {
      const cancelled = await onCancel(bookingId, "관리자 취소");
      if (cancelled) { setPendingId(null); setMessage("예약을 취소했습니다."); }
      else setMessage("예약을 취소하지 못했습니다. 다시 시도해 주세요.");
    } catch (error) { setMessage(getErrorMessage(error)); }
    finally { setIsCancelling(false); }
  }

  return <MobilePanel title="예약 취소" className="admin-cancellations">
    <div className="admin-cancellation-layout">
      <div className="admin-cancellation-calendar">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{formatDateShort(anchorDate)} – {formatDateShort(addDays(anchorDate, 20))}</p>
          <div className="flex items-center gap-1">
            <button type="button" title="이전 기간" aria-label="이전 기간" disabled={isCancelling || anchorDate <= today}
              onClick={() => changePeriod(addDays(anchorDate, -21) < today ? today : addDays(anchorDate, -21))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-30"><ChevronLeft size={18} /></button>
            <button type="button" disabled={isCancelling} onClick={() => changePeriod(today)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold">오늘</button>
            <button type="button" title="다음 기간" aria-label="다음 기간" disabled={isCancelling} onClick={() => changePeriod(addDays(anchorDate, 21))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-30"><ChevronRight size={18} /></button>
          </div>
        </div>
        <ThreeWeekCalendar selectedDate={selectedDate} onSelectDate={selectDate} anchorDate={anchorDate} compact disabled={isCancelling}
          hasMarker={(date) => (byDate.get(date)?.length ?? 0) > 0}
          dateLabel={(date) => `${formatDateLabel(date)} ${byDate.get(date)?.length ?? 0}건 예약`} />
      </div>
      <div className="admin-cancellation-list" aria-live="polite" aria-busy={isCancelling}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{formatDateLabel(selectedDate)}</h4>
          <span className="text-xs text-slate-500">{selectedReservations.length}건</span>
        </div>
        {message && <p role="status" className="mb-3 text-xs leading-5 text-slate-600">{message}</p>}
        {selectedReservations.length === 0 ? <EmptyText text="선택한 날짜에 취소할 예약이 없습니다." /> :
          <div className="function-group">
            {selectedReservations.map((reservation) => <article key={reservation.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{reservation.start}–{addHours(reservation.start, reservation.duration)}</p>
                  <p className="mt-1 break-words text-sm">{reservation.teamName}</p>
                  <p className="mt-1 text-xs text-slate-500">{reservation.bookingType === "room_block" ? "사용 제한" : reservation.location === "external" ? "외부 합주실" : "동아리방"} · {reservation.purpose || reservation.teamSong}</p>
                </div>
                <button type="button" disabled={isCancelling} aria-label={`${reservation.teamName} ${reservation.start} 예약 취소`}
                  onClick={() => { setPendingId(reservation.id); setMessage(""); }}
                  className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-[#fff0eb] px-3 text-xs font-semibold text-[#be3d33] disabled:opacity-40"><Trash2 size={14} />취소</button>
              </div>
              {pendingId === reservation.id && <div role="group" aria-label="예약 취소 확인" className="mt-3 border-t border-slate-200 pt-3">
                <p className="text-xs font-semibold leading-5">이 예약을 취소할까요?</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" disabled={isCancelling} onClick={() => setPendingId(null)} className="h-9 rounded-lg border border-slate-200 bg-white text-xs font-semibold">돌아가기</button>
                  <button type="button" disabled={isCancelling} onClick={() => void confirmCancellation(reservation.id)} className="h-9 rounded-lg bg-[#ff665a] text-xs font-semibold text-white disabled:opacity-40">{isCancelling ? "취소 중…" : "예약 취소 확정"}</button>
                </div>
              </div>}
            </article>)}
          </div>}
      </div>
    </div>
  </MobilePanel>;
}

function PushSubscriptionStatusPanel({ statuses }: { statuses: PushSubscriptionStatus[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredStatuses = normalizedQuery
    ? statuses.filter((item) => `${item.name} ${item.cohort}`.toLowerCase().includes(normalizedQuery))
    : statuses;
  const activeCount = statuses.filter((item) => item.hasPush).length;

  return (
    <MobilePanel title="푸시 알림 등록 현황">
      <div className="grid grid-cols-2 gap-2">
        <ProfileStat label="알림 등록" value={`${activeCount}명`} />
        <ProfileStat label="미등록" value={`${Math.max(0, statuses.length - activeCount)}명`} />
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="이름 또는 기수 검색"
        className="mt-3 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none focus:border-[#ff665a]"
      />

      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-[#f0ded7] bg-white">
        {filteredStatuses.map((item) => (
          <div key={item.userId} className="flex items-center justify-between gap-3 border-b border-[#f7e8e2] px-3 py-2 last:border-b-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{item.name} · {item.cohort}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                {item.hasPush ? `마지막 등록 ${formatUpdatedAt(item.registeredAt)}` : "등록된 기기 없음"}
              </p>
            </div>
            <span
              className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold ${
                item.hasPush ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {item.hasPush ? "등록" : "미등록"}
            </span>
          </div>
        ))}
        {filteredStatuses.length === 0 && <p className="px-3 py-4 text-center text-xs text-slate-500">표시할 부원이 없습니다.</p>}
      </div>
    </MobilePanel>
  );
}

function AdminRoomBlockPanel({
  reservations,
  onCreate,
}: {
  reservations: Reservation[];
  onCreate: (date: string, reason: string, times: string[]) => Promise<void>;
}) {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedBand, setSelectedBand] = useState(timeBands[0].id);
  const [reasonPreset, setReasonPreset] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const activeBand = timeBands.find((band) => band.id === selectedBand) ?? timeBands[0];
  const visibleTimes = timeSlots.filter((time) => {
    const minutes = timeToMinutes(time);
    return minutes >= activeBand.start && minutes < activeBand.end;
  });
  const occupiedTimes = new Set(
    timeSlots.filter((time) =>
      reservations.some(
        (reservation) =>
          reservation.status === "confirmed" &&
          reservation.location === "club_room" &&
          isReserved(reservation, selectedDate, time),
      ),
    ),
  );
  const reason = reasonPreset === "기타" ? customReason.trim() : reasonPreset;
  const selectedGroups = groupBookingTimes(selectedTimes);

  function changeDate(date: string) {
    setSelectedDate(date);
    setSelectedTimes([]);
    setIsConfirming(false);
    setMessage("");
  }

  function toggleTime(time: string) {
    if (occupiedTimes.has(time)) {
      return;
    }

    setSelectedTimes((current) =>
      current.includes(time)
        ? current.filter((item) => item !== time)
        : [...current, time].sort((left, right) => timeToMinutes(left) - timeToMinutes(right)),
    );
    setIsConfirming(false);
    setMessage("");
  }

  async function submitRoomBlock() {
    if (!reason || selectedTimes.length === 0) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      await onCreate(selectedDate, reason, selectedTimes);
      setSelectedTimes([]);
      setIsConfirming(false);
      setReasonPreset("");
      setCustomReason("");
      setMessage("동아리방 사용 제한을 등록했습니다.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <MobilePanel title="동아리방 사용 제한">
      <p className="text-xs leading-5 text-slate-600">
        유지 보수나 장비 문제로 사용할 수 없는 시간을 막습니다. 이 일정은 합주시간에 포함되지 않습니다.
      </p>

      <div className="mt-3">
        <ThreeWeekCalendar
          selectedDate={selectedDate}
          onSelectDate={changeDate}
          hasMarker={(date) =>
            reservations.some(
              (reservation) =>
                reservation.status === "confirmed" &&
                reservation.location === "club_room" &&
                reservationMatchesDate(reservation, date),
            )
          }
          compact
        />
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-semibold text-slate-500">사용 제한 사유</span>
        <select
          value={reasonPreset}
          onChange={(event) => {
            setReasonPreset(event.target.value);
            setIsConfirming(false);
            setMessage("");
          }}
          className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none focus:border-[#ff665a]"
        >
          <option value="">사유를 선택해 주세요</option>
          <option value="동아리방 유지 보수">동아리방 유지 보수</option>
          <option value="장비 점검 및 문제">장비 점검 및 문제</option>
          <option value="동아리 운영">동아리 운영</option>
          <option value="기타">기타</option>
        </select>
      </label>

      {reasonPreset === "기타" && (
        <input
          type="text"
          value={customReason}
          onChange={(event) => {
            setCustomReason(event.target.value);
            setIsConfirming(false);
            setMessage("");
          }}
          maxLength={120}
          placeholder="사용할 수 없는 이유"
          className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none focus:border-[#ff665a]"
        />
      )}

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {timeBands.map((band) => (
          <button
            key={band.id}
            type="button"
            onClick={() => setSelectedBand(band.id)}
            className={`h-10 rounded-lg border text-xs font-semibold ${
              selectedBand === band.id
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-[#f0ded7] bg-white text-slate-600"
            }`}
          >
            <span className="block">{band.label}</span>
            <span className={`block text-[10px] ${selectedBand === band.id ? "text-white/70" : "text-slate-400"}`}>{band.range}</span>
          </button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {visibleTimes.map((time) => {
          const isOccupied = occupiedTimes.has(time);
          const isSelected = selectedTimes.includes(time);

          return (
            <button
              key={time}
              type="button"
              onClick={() => toggleTime(time)}
              disabled={isOccupied}
              className={`h-10 rounded-md border text-[11px] font-semibold ${
                isOccupied
                  ? "border-slate-100 bg-slate-100 text-slate-400"
                  : isSelected
                    ? "border-[#ff8c81] bg-[#fff0eb] text-[#be3d33]"
                    : "border-[#f0ded7] bg-white text-slate-700"
              }`}
            >
              <span className="block">{time}</span>
              {isOccupied && <span className="block text-[9px]">예약</span>}
            </button>
          );
        })}
      </div>

      {selectedGroups.length > 0 && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          선택: {selectedGroups.map((group) => `${group.start}-${group.end}`).join(", ")}
        </p>
      )}

      {message && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{message}</p>}

      {!isConfirming ? (
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          disabled={!reason || selectedTimes.length === 0}
          className="mt-3 h-10 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white disabled:bg-slate-100 disabled:text-slate-400"
        >
          사용 제한 등록
        </button>
      ) : (
        <div className="mt-3 rounded-lg bg-[#fff0eb] p-3">
          <p className="text-xs font-semibold leading-5 text-[#9f3029]">
            {formatDateLabel(selectedDate)} 선택 시간에 동아리방 예약을 막을까요?
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setIsConfirming(false)}
              disabled={isSaving}
              className="h-9 rounded-lg border border-[#f0ded7] bg-white text-xs font-semibold text-slate-600"
            >
              돌아가기
            </button>
            <button
              type="button"
              onClick={() => void submitRoomBlock()}
              disabled={isSaving}
              className="h-9 rounded-lg bg-[#ff665a] text-xs font-semibold text-white disabled:bg-slate-200"
            >
              {isSaving ? "등록 중" : "등록 확정"}
            </button>
          </div>
        </div>
      )}
    </MobilePanel>
  );
}

function AdminScheduleEditor({
  profiles,
  busyByUser,
  dateBusyByUser,
  dateOverrideByUser,
  rehearsalByUser,
  saveWeeklySchedule,
  saveDateSchedule,
  resetDateSchedule,
}: {
  profiles: Profile[];
  busyByUser: Record<string, string[]>;
  dateBusyByUser: Record<string, Record<string, string[]>>;
  dateOverrideByUser: Record<string, string[]>;
  rehearsalByUser: Record<string, string[]>;
  saveWeeklySchedule: (userId: string, nextBusyKeys: string[]) => Promise<void>;
  saveDateSchedule: (userId: string, drafts: DateScheduleDrafts) => Promise<void>;
  resetDateSchedule: (userId: string, date: string) => Promise<void>;
}) {
  const memberProfiles = profiles.filter((profile) => profile.role !== "admin");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [scheduleScope, setScheduleScope] = useState<ScheduleScope>("weekly");
  const [scheduleDate, setScheduleDate] = useState(todayISO);

  const effectiveSelectedUserId = memberProfiles.some((profile) => profile.id === selectedUserId)
    ? selectedUserId
    : memberProfiles[0]?.id ?? "";
  const selectedProfile = memberProfiles.find((profile) => profile.id === effectiveSelectedUserId) ?? null;
  const ownBusy = selectedProfile ? busyByUser[selectedProfile.id] ?? [] : [];
  const dateBusyByDate = selectedProfile ? dateBusyByUser[selectedProfile.id] ?? {} : {};
  const dateOverrideDates = selectedProfile ? dateOverrideByUser[selectedProfile.id] ?? [] : [];
  const dateHasOverride = dateOverrideDates.includes(scheduleDate);
  const scheduleDateDay = dateToDay(scheduleDate);
  const weeklyBusyForDate = ownBusy
    .filter((key) => key.startsWith(`${scheduleDateDay}-`))
    .map((key) => dateSlotKey(scheduleDate, weeklyKeyToTime(key)));
  const selectedDateBusy = dateHasOverride
    ? (dateBusyByDate[scheduleDate] ?? []).map((time) => dateSlotKey(scheduleDate, time))
    : weeklyBusyForDate;
  const scheduleColumns: ScheduleColumn[] =
    scheduleScope === "date"
      ? [{ label: formatDateShort(scheduleDate), day: scheduleDateDay, date: scheduleDate }]
      : dateDayNames.map((day) => ({ label: day, day }));

  return (
    <div className="admin-schedule-editor space-y-3">
      <div className="admin-member-search">
      <ProfileSearchPicker
        label="부원 검색"
        value={effectiveSelectedUserId}
        query={memberQuery}
        onQueryChange={setMemberQuery}
        onChange={setSelectedUserId}
        profiles={memberProfiles}
      />
      </div>

      {selectedProfile ? (
        <>
          <div className="admin-schedule-controls space-y-3">
          <p className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-slate-700">
            {selectedProfile.name} 부원의 고정 요일 시간표와 날짜별 시간표를 관리자 권한으로 수정합니다.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: "weekly", label: "고정 요일" },
              { id: "date", label: "날짜별 수정" },
            ] as Array<{ id: ScheduleScope; label: string }>).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setScheduleScope(item.id)}
                className={`h-10 rounded-lg border text-xs font-semibold ${
                  scheduleScope === item.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white text-slate-600"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {scheduleScope === "date" && (
            <div className="space-y-2">
              <ThreeWeekCalendar selectedDate={scheduleDate} onSelectDate={setScheduleDate} />
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                {dateHasOverride ? "이 날짜는 날짜별 시간표가 적용 중입니다." : "아직 날짜별 수정이 없어 고정 시간표를 사용합니다."}
              </p>
            </div>
          )}
          </div>
          <ScheduleGrid
            key={selectedProfile.id}
            busy={scheduleScope === "date" ? selectedDateBusy : ownBusy}
            columns={scheduleColumns}
            rehearsals={scheduleScope === "date" ? rehearsalByUser[selectedProfile.id] ?? [] : []}
            onSaveDraft={(nextBusyKeys) => saveWeeklySchedule(selectedProfile.id, nextBusyKeys)}
            onSaveDateDrafts={(drafts) => saveDateSchedule(selectedProfile.id, drafts)}
            onResetDateOverride={
              scheduleScope === "date" && dateHasOverride
                ? () => resetDateSchedule(selectedProfile.id, scheduleDate)
                : undefined
            }
          />
        </>
      ) : (
        <EmptyText text="승인된 부원이 없습니다." />
      )}
    </div>
  );
}

function AdminPasswordResetPanel({
  profiles,
  onResetPassword,
}: {
  profiles: Profile[];
  onResetPassword: (profileId: string) => Promise<string>;
}) {
  const memberProfiles = profiles.filter((profile) => profile.role !== "admin");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const selectedProfile = memberProfiles.find((profile) => profile.id === selectedUserId) ?? null;

  async function resetPassword() {
    if (!selectedProfile) {
      setMessage("비밀번호를 리셋할 부원을 선택해 주세요.");
      return;
    }

    const firstConfirm = window.confirm(`${selectedProfile.name} 부원의 비밀번호를 임시 비밀번호로 리셋할까요?`);
    if (!firstConfirm) {
      return;
    }
    const secondConfirm = window.confirm("기존 비밀번호로는 더 이상 로그인할 수 없습니다. 계속 진행할까요?");
    if (!secondConfirm) {
      return;
    }

    setIsResetting(true);
    setMessage("");
    setTemporaryPassword("");

    try {
      const nextPassword = await onResetPassword(selectedProfile.id);
      setTemporaryPassword(nextPassword);
      setMessage(`${selectedProfile.name} 부원의 임시 비밀번호를 발급했어요.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="space-y-3">
      <ProfileSearchPicker
        label="부원 검색"
        value={selectedUserId}
        query={memberQuery}
        onQueryChange={(value) => {
          setMemberQuery(value);
          setTemporaryPassword("");
        }}
        onChange={(value) => {
          setSelectedUserId(value);
          setTemporaryPassword("");
        }}
        profiles={memberProfiles}
      />
      <p className="rounded-lg bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-slate-700">
        리셋하면 임시 비밀번호가 발급되고, 부원은 다음 로그인 때 새 비밀번호를 반드시 설정해야 합니다.
      </p>
      {temporaryPassword && (
        <div className="rounded-lg border border-[#ffb3aa] bg-white p-3">
          <p className="text-xs font-semibold text-[#be3d33]">임시 비밀번호</p>
          <p className="mt-2 select-all rounded-lg bg-slate-950 px-3 py-2 font-mono text-sm font-semibold text-white">
            {temporaryPassword}
          </p>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">이 값은 다시 볼 수 없으니 필요한 부원에게 바로 전달해 주세요.</p>
        </div>
      )}
      {message && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{message}</p>}
      <button
        type="button"
        onClick={resetPassword}
        disabled={!selectedProfile || isResetting}
        className="h-11 w-full rounded-lg bg-[#ff665a] text-sm font-semibold text-white disabled:bg-slate-100 disabled:text-slate-400"
      >
        {isResetting ? "리셋 중" : "임시 비밀번호 발급"}
      </button>
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

function GoalCategorySelect({
  label = "합주 목표",
  value,
  onChange,
  categories,
  includeAllOption = false,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  categories: GoalCategory[];
  includeAllOption?: boolean;
}) {
  const isDisabled = categories.length === 0 && !includeAllOption;

  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={isDisabled}
        className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none transition focus:border-[#ff665a] disabled:bg-slate-50 disabled:text-slate-400"
      >
        {includeAllOption && (
          <option value="" disabled>
            목표를 선택해 주세요
          </option>
        )}
        {includeAllOption && <option value={allGoalFilterValue}>전체 표시</option>}
        {categories.length === 0 && !includeAllOption && (
          <option value="" disabled>
            관리자 탭에서 합주 목표를 먼저 추가해 주세요
          </option>
        )}
        {categories.map((category) => (
          <option key={category.id} value={category.name}>
            {category.name}
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
        {profiles.length === 0 && (
          <option value="" disabled>
            선택 가능한 부원이 없습니다
          </option>
        )}
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · {profile.cohort}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProfileSearchPicker({
  label,
  value,
  query,
  onQueryChange,
  onChange,
  profiles,
}: {
  label: string;
  value: string;
  query: string;
  onQueryChange: (value: string) => void;
  onChange: (value: string) => void;
  profiles: Profile[];
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const selectedProfile = profiles.find((profile) => profile.id === value) ?? null;
  const filteredProfiles = profiles
    .filter((profile) => {
      if (!normalizedQuery) {
        return true;
      }

      return `${profile.name} ${profile.cohort} ${profile.student_no}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery);
    })
    .slice(0, 8);

  return (
    <div>
      <label className="block">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            onChange("");
          }}
          placeholder="이름 또는 기수 검색"
          className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none transition focus:border-[#ff665a]"
        />
      </label>

      {selectedProfile && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
          선택됨: {selectedProfile.name} · {selectedProfile.cohort}
        </p>
      )}

      <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[#f0ded7] bg-white">
        {profiles.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">선택 가능한 부원이 없습니다.</p>}
        {profiles.length > 0 && filteredProfiles.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">검색 결과가 없습니다.</p>}
        {filteredProfiles.map((profile) => {
          const isSelected = profile.id === value;

          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => {
                onChange(profile.id);
                onQueryChange(profile.name);
              }}
              className={`flex w-full items-center justify-between border-b border-[#f7e8e2] px-3 py-2 text-left text-sm last:border-b-0 ${
                isSelected ? "bg-slate-950 text-white" : "bg-white text-slate-950"
              }`}
            >
              <span className="font-semibold">{profile.name}</span>
              <span className={isSelected ? "text-white/75" : "text-slate-500"}>{profile.cohort}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamSearchPicker({
  label,
  value,
  query,
  onQueryChange,
  onChange,
  teams,
}: {
  label: string;
  value: string;
  query: string;
  onQueryChange: (value: string) => void;
  onChange: (value: string) => void;
  teams: Team[];
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const selectedTeam = teams.find((team) => team.id === value) ?? null;
  const filteredTeams = teams
    .filter((team) => {
      if (!normalizedQuery) {
        return true;
      }

      const leader = team.members.find((member) => member.id === team.leaderId);
      return `${team.name} ${team.song} ${leader?.name ?? ""}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery);
    })
    .slice(0, 8);

  return (
    <div>
      <label className="block">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            onChange("");
          }}
          placeholder="팀 이름 또는 합주 목표 검색"
          className="mt-2 h-10 w-full rounded-lg border border-[#f0ded7] bg-white px-3 text-sm outline-none transition focus:border-[#ff665a]"
        />
      </label>

      {selectedTeam && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
          선택됨: {selectedTeam.name} · {selectedTeam.song}
        </p>
      )}

      <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[#f0ded7] bg-white">
        {teams.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">수정할 팀이 없습니다.</p>}
        {teams.length > 0 && filteredTeams.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">검색 결과가 없습니다.</p>}
        {filteredTeams.map((team) => {
          const isSelected = team.id === value;
          const leader = team.members.find((member) => member.id === team.leaderId);

          return (
            <button
              key={team.id}
              type="button"
              onClick={() => {
                onChange(team.id);
                onQueryChange(team.name);
              }}
              className={`flex w-full items-center justify-between gap-3 border-b border-[#f7e8e2] px-3 py-2 text-left text-sm last:border-b-0 ${
                isSelected ? "bg-slate-950 text-white" : "bg-white text-slate-950"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{team.name}</span>
                <span className={`mt-0.5 block truncate text-xs ${isSelected ? "text-white/75" : "text-slate-500"}`}>
                  {team.song} · 팀장 {leader?.name ?? "-"}
                </span>
              </span>
              <span className={`h-3 w-3 shrink-0 rounded-sm ${team.color}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MobilePanel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`workspace-panel min-w-0 rounded-lg border border-[#f0ded7] bg-white/88 p-4 shadow-sm ${className}`}>
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

function ReservationDetailPanel({
  title,
  className = "",
  date,
  reservations,
  ownTeamIds,
}: {
  title?: string;
  className?: string;
  date: string;
  reservations: Reservation[];
  ownTeamIds: ReadonlySet<string>;
}) {
  const dayReservations = reservations
    .filter((reservation) => reservation.status === "confirmed" && reservationMatchesDate(reservation, date))
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  return (
    <MobilePanel title={title ?? `${formatDateLabel(date)} 예약 상세`} className={`readable-compact ${className}`}>
      <div className="function-group space-y-1">
        {dayReservations.map((reservation) => {
          const isMine = reservation.isOwnTeam || ownTeamIds.has(reservation.teamId);
          const isRoomBlock = reservation.bookingType === "room_block";

          return (
            <article
              key={reservation.id}
              className={`reservation-detail-card rounded-md border p-2 ${
                isRoomBlock
                  ? "border-amber-200 bg-amber-50/70"
                  : isMine
                    ? "border-[#ffb3aa] bg-[#fff8f4]"
                    : "border-[#f0ded7] bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1">
                    <h4 className="truncate text-[13px] font-semibold leading-4">{reservation.teamName}</h4>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                        isRoomBlock
                          ? "bg-amber-100 text-amber-800"
                          : isMine
                            ? "bg-[#ff665a] text-white"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isRoomBlock ? "사용 제한" : isMine ? "내 팀" : "다른 팀"}
                    </span>
                    {!isRoomBlock && reservation.location === "external" && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">외부</span>
                    )}
                  </div>
                  <p className="text-[10px] leading-4 text-slate-500">
                    {isRoomBlock
                      ? "최고 관리자 등록"
                      : `대표자 ${reservation.leaderName}${reservation.leaderRole ? ` · ${reservation.leaderRole}` : ""}`}
                  </p>
                </div>
                <div className="flex w-[92px] shrink-0 items-center justify-center rounded bg-slate-950 px-2 py-1.5 text-center text-white">
                  <p className="text-[11px] font-semibold leading-4">
                    {reservation.start}-{addHours(reservation.start, reservation.duration)}
                  </p>
                </div>
              </div>

              <div className="mt-px flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4">
                  <span><strong className="text-slate-500">길이</strong> {formatDuration(reservation.duration)}</span>
                  {!isRoomBlock && (
                    <span><strong className="text-slate-500">멤버</strong> {reservation.memberCount > 0 ? `${reservation.memberCount}명` : "-"}</span>
                  )}
                </div>
                <p className="w-[92px] shrink-0 truncate text-center text-[10px] leading-4 text-slate-500">
                  {reservation.purpose || reservation.teamSong || (isRoomBlock ? "사용 제한" : "합주 예약")}
                </p>
              </div>

            </article>
          );
        })}
        {dayReservations.length === 0 && <EmptyText text={`${formatDateLabel(date)}에는 아직 예약이 없습니다.`} />}
      </div>
    </MobilePanel>
  );
}

function ScheduleGrid({
  busy,
  columns,
  rehearsals = [],
  onSaveDraft,
  onSaveDateDrafts,
  onResetDateOverride,
}: {
  busy: string[];
  columns?: ScheduleColumn[];
  rehearsals?: string[];
  onSaveDraft: (nextBusyKeys: string[]) => Promise<void>;
  onSaveDateDrafts?: (drafts: DateScheduleDrafts) => Promise<void>;
  onResetDateOverride?: () => Promise<void>;
}) {
  const [selectedBandId, setSelectedBandId] = useState(timeBands[0].id);
  const [editMode, setEditMode] = useState<"busy" | "free" | null>(null);
  const [weeklyDraftBusy, setWeeklyDraftBusy] = useState<string[]>(busy);
  const [dateDrafts, setDateDrafts] = useState<DateScheduleDrafts>({});
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isPaintingRef = useRef(false);
  const paintBusyRef = useRef(true);
  const gridRef = useRef<HTMLDivElement>(null);
  const selectedBand = timeBands.find((band) => band.id === selectedBandId) ?? timeBands[0];
  const gridColumns: ScheduleColumn[] = useMemo(() => columns ?? days.map((day) => ({ label: day, day })), [columns]);
  const selectedScheduleDate = gridColumns.length === 1 ? gridColumns[0].date : undefined;
  const draftBusy = selectedScheduleDate ? dateDrafts[selectedScheduleDate] ?? busy : weeklyDraftBusy;
  const pendingDateCount = Object.keys(dateDrafts).length;
  const timeLabelColumnWidth = gridColumns.length >= 7 ? 34 : 42;
  const gridTemplateColumns = `${timeLabelColumnWidth}px repeat(${gridColumns.length}, minmax(0, 1fr))`;
  const showsRehearsals = rehearsals.length > 0;
  const hasChanges = selectedScheduleDate ? pendingDateCount > 0 : !scheduleSetsEqual(draftBusy, busy);
  const wholeDateSlotKeys = selectedScheduleDate ? timeSlots.map((time) => dateSlotKey(selectedScheduleDate, time)) : [];
  const isWholeDateBusy = wholeDateSlotKeys.length > 0 && wholeDateSlotKeys.every((key) => draftBusy.includes(key));
  const visibleTimeSlots = timeSlots.filter((time) => {
    const minutes = timeToMinutes(time);
    return minutes >= selectedBand.start && minutes < selectedBand.end;
  });

  useEffect(() => {
    if (!selectedScheduleDate) setWeeklyDraftBusy(busy);
  }, [busy, selectedScheduleDate]);

  const setDraftBusy = useCallback((update: (current: string[]) => string[]) => {
    if (selectedScheduleDate) {
      setDateDrafts((current) => updateDateScheduleDraft(current, selectedScheduleDate, busy, update));
    } else {
      setWeeklyDraftBusy(update);
    }
  }, [selectedScheduleDate, busy]);

  function getColumnKey(column: ScheduleColumn, time: string) {
    return column.date ? dateSlotKey(column.date, time) : slotKey(column.day, time);
  }

  const paintSlot = useCallback(
    (column: ScheduleColumn, time: string, nextBusyState: boolean) => {
      if (isSaving || !editMode) {
        return;
      }

      const key = getColumnKey(column, time);
      if (rehearsals.includes(key)) {
        return;
      }

      setDraftBusy((current) => {
        const isAlreadyBusy = current.includes(key);
        if (isAlreadyBusy === nextBusyState) {
          return current;
        }

        return nextBusyState ? [...current, key] : current.filter((item) => item !== key);
      });
    },
    [editMode, rehearsals, isSaving, setDraftBusy],
  );

  const finishPainting = useCallback(() => {
    isPaintingRef.current = false;
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", finishPainting);
    window.addEventListener("pointercancel", finishPainting);
    window.addEventListener("blur", finishPainting);

    return () => {
      window.removeEventListener("pointerup", finishPainting);
      window.removeEventListener("pointercancel", finishPainting);
      window.removeEventListener("blur", finishPainting);
    };
  }, [finishPainting]);

  function startPainting(column: ScheduleColumn, time: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || isSaving || !editMode) return;
    const key = getColumnKey(column, time);
    if (rehearsals.includes(key)) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    isPaintingRef.current = true;
    paintBusyRef.current = editMode === "busy";
    paintSlot(column, time, paintBusyRef.current);
  }

  function continuePainting(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isPaintingRef.current) {
      return;
    }
    if (event.pointerType !== "touch" && event.buttons === 0) { finishPainting(); return; }

    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-schedule-cell]") as HTMLElement | null;
    if (!target || !gridRef.current?.contains(target)) return;
    const columnIndex = Number(target?.dataset.scheduleColumnIndex);
    const time = target?.dataset.scheduleTime;
    const column = gridColumns[columnIndex];

    if (!column || !time) {
      return;
    }

    paintSlot(column, time, paintBusyRef.current);
  }

  async function saveDraft() {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError("");
    try {
      if (selectedScheduleDate && onSaveDateDrafts) {
        await onSaveDateDrafts(dateDrafts);
        setDateDrafts({});
      } else {
        await onSaveDraft(draftBusy);
      }
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function resetSelectedDate() {
    if (!onResetDateOverride || !selectedScheduleDate || isSaving) return;
    const date = selectedScheduleDate;
    setIsSaving(true);
    setSaveError("");
    try {
      await onResetDateOverride();
      setDateDrafts((current) => {
        const remaining = { ...current };
        delete remaining[date];
        return remaining;
      });
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  function toggleWholeDateAvailability() {
    if (!selectedScheduleDate || isSaving) {
      return;
    }

    const wholeDateSlotSet = new Set(wholeDateSlotKeys);
    setDraftBusy((current) =>
      isWholeDateBusy
        ? current.filter((key) => !wholeDateSlotSet.has(key))
        : [...new Set([...current, ...wholeDateSlotKeys])],
    );
    setEditMode(null);
  }

  return (
    <div className="schedule-editor space-y-3">
      <p className="text-xs leading-5 text-slate-500">칠하기 또는 지우기를 선택한 뒤 시간표를 터치하거나 드래그해 수정해 주세요. 수정 후 저장해 주세요.</p>
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
        {selectedScheduleDate && (
          <button
            type="button"
            onClick={toggleWholeDateAvailability}
            disabled={isSaving}
            className={`col-span-4 h-10 rounded-lg border text-xs font-semibold disabled:text-slate-300 ${
              isWholeDateBusy
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-[#ffb3aa] bg-[#fff0eb] text-[#be3d33]"
            }`}
          >
            {isWholeDateBusy ? "하루 전체 가능" : "하루 전체 불가"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="시간표 편집 방식">
        {([{ id: "busy", label: "불가로 칠하기" }, { id: "free", label: "가능으로 지우기" }] as const).map((mode) => (
          <button key={mode.id} type="button" disabled={isSaving} aria-pressed={editMode === mode.id}
            onClick={() => setEditMode((current) => current === mode.id ? null : mode.id)}
            className={`h-10 rounded-lg border text-xs font-semibold ${editMode === mode.id ? "border-slate-950 bg-slate-950 text-white" : "border-[#f0ded7] bg-white text-slate-600"}`}>
            {mode.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{selectedBand.label} 시간대</span>
        <span>{editMode ? (editMode === "busy" ? "불가로 칠하기" : "가능으로 지우기") : "먼저 모드 선택"}</span>
      </div>
      <div
        ref={gridRef}
        className="schedule-cell-grid grid select-none gap-1"
        style={{ gridTemplateColumns, touchAction: editMode ? "none" : "pan-y" }}
        onPointerMove={continuePainting}
        onContextMenu={(event) => { if ((event.target as Element).closest("[data-schedule-cell]")) event.preventDefault(); }}
      >
        <div />
        {gridColumns.map((column) => (
          <div key={`${column.date ?? column.day}-${column.label}`} className="flex h-8 items-center justify-center text-xs font-semibold text-slate-500">
            {column.label}
          </div>
        ))}
        {visibleTimeSlots.map((time) => (
          <MemberScheduleRow
            key={time}
            time={time}
            columns={gridColumns}
            busy={draftBusy}
            rehearsals={rehearsals}
            getColumnKey={getColumnKey}
            onStartPaint={startPainting}
            onToggle={(column, time) => paintSlot(column, time, editMode === "busy")}
            isSaving={isSaving}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
        <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">가능</span>
        <span className="rounded-md bg-[#fff0eb] px-2 py-1 text-[#be3d33]">불가</span>
        {showsRehearsals && <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">합주</span>}
      </div>
      {selectedScheduleDate && pendingDateCount > 0 && (
        <p className="text-xs text-slate-500" aria-live="polite">저장 대기 {pendingDateCount}개 날짜</p>
      )}
      {saveError && <p role="alert" className="text-xs text-red-600">{saveError}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            if (selectedScheduleDate) setDateDrafts({});
            else setWeeklyDraftBusy(busy);
            setSaveError("");
          }}
          disabled={!hasChanges || isSaving}
          className="h-10 rounded-lg border border-[#f0ded7] bg-white text-xs font-semibold text-slate-600 disabled:bg-slate-50 disabled:text-slate-300"
        >
          {selectedScheduleDate ? "전체 변경 취소" : "변경 취소"}
        </button>
        <button
          type="button"
          onClick={saveDraft}
          disabled={!hasChanges || isSaving}
          className="h-10 rounded-lg bg-[#ff665a] text-xs font-semibold text-white disabled:bg-slate-100 disabled:text-slate-400"
        >
          {isSaving ? "저장 중" : selectedScheduleDate && pendingDateCount > 0 ? `${pendingDateCount}개 날짜 저장` : "시간표 저장"}
        </button>
      </div>
      {onResetDateOverride && (
        <button
          type="button"
          onClick={resetSelectedDate}
          disabled={isSaving}
          className="h-10 w-full rounded-lg border border-[#f0ded7] bg-white text-xs font-semibold text-slate-600 disabled:text-slate-300"
        >
          고정 시간표로 되돌리기
        </button>
      )}
    </div>
  );
}

function MemberScheduleRow({
  time,
  columns,
  busy,
  rehearsals,
  getColumnKey,
  onStartPaint,
  onToggle,
  isSaving,
}: {
  time: string;
  columns: ScheduleColumn[];
  busy: string[];
  rehearsals: string[];
  getColumnKey: (column: ScheduleColumn, time: string) => string;
  onStartPaint: (column: ScheduleColumn, time: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggle: (column: ScheduleColumn, time: string) => void;
  isSaving: boolean;
}) {
  return (
    <>
      <div className="flex h-9 items-center text-[11px] font-semibold text-slate-500">{time}</div>
      {columns.map((column, index) => {
        const key = getColumnKey(column, time);
        const hasRehearsal = rehearsals.includes(key);
        const isBusy = busy.includes(key);

        return (
          <button
            key={key}
            type="button"
            disabled={hasRehearsal || isSaving}
            data-schedule-cell="true"
            data-schedule-column-index={index}
            data-schedule-time={time}
            onPointerDown={(event) => onStartPaint(column, time, event)}
            onClick={(event) => { if (event.detail === 0) onToggle(column, time); }}
            aria-pressed={isBusy}
            className={`h-9 rounded-md border text-[10px] font-semibold transition ${
              hasRehearsal
                ? "border-amber-100 bg-amber-50 text-amber-800"
                : isBusy
                ? "border-[#ffb3aa] bg-[#fff0eb] text-[#be3d33]"
                : "border-emerald-100 bg-emerald-50 text-emerald-700"
            }`}
            aria-label={`${column.label} ${time} ${hasRehearsal ? "합주 있음" : isBusy ? "불가" : "가능"}`}
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

function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <MobilePanel>
      <h3 className="text-xl font-semibold">{title}</h3>
      {body && <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>}
    </MobilePanel>
  );
}
