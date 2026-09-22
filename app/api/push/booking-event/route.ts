import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  buildBookingPushPayload,
  sendWebPush,
  type PushBooking,
  type PushSubscriptionRecord,
  type PushTeam,
} from "../../../push-utils";
import { rejectCrossOriginMutation } from "../../request-security";
import { readBoundedJson } from "../../bounded-json";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://inlddwyoesmvmxkcuhwd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_dKyziP5Nq6fTyZWkUd5OQQ_D5oyYD2P";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type BookingPushTarget = {
  booking_id: string;
  team_id: string;
  booking_date: string | null;
  day_of_week: string;
  start_time: string;
  duration: number;
  purpose: string;
  status: string;
  team_name: string;
  team_song: string;
  user_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};

function webPushConfig() {
  return {
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? "",
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? "",
    subject: process.env.WEB_PUSH_SUBJECT ?? "mailto:admin@example.com",
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) {
    return crossOriginResponse;
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "알림 서버 설정을 확인해주세요." }, { status: 500 });
  }

  const config = webPushConfig();
  if (!config.publicKey || !config.privateKey) {
    return NextResponse.json({ error: "WEB_PUSH_PUBLIC_KEY 또는 WEB_PUSH_PRIVATE_KEY가 서버 환경변수에 없습니다." }, { status: 500 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const parsed = await readBoundedJson(request, 8_192);
  if (!parsed.ok) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: parsed.status });
  const body = parsed.value;
  if (!Array.isArray(body.bookingIds) || body.bookingIds.length > 20 ||
      !body.bookingIds.every((id): id is string => typeof id === "string" && uuidPattern.test(id))) {
    return NextResponse.json({ error: "예약 ID 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const bookingIds = Array.from(new Set(body.bookingIds));
  const kind = body.kind;

  if (
    (kind !== "booking_created" && kind !== "booking_cancelled") ||
    bookingIds.length === 0 ||
    bookingIds.length > 20 ||
    bookingIds.some((bookingId) => !uuidPattern.test(bookingId))
  ) {
    return NextResponse.json({ error: "알림 종류와 예약 ID가 필요합니다." }, { status: 400 });
  }

  const requesterClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: userData, error: userError } = await requesterClient.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "로그인 세션을 확인할 수 없습니다." }, { status: 401 });
  }

  const { data: requesterProfile, error: requesterError } = await requesterClient
    .from("profiles")
    .select("id,status,role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (requesterError) {
    return NextResponse.json({ error: "부원 권한을 확인하지 못했습니다." }, { status: 500 });
  }
  if (!requesterProfile || requesterProfile.status !== "approved") {
    return NextResponse.json({ error: "승인된 부원만 알림을 보낼 수 있습니다." }, { status: 403 });
  }

  const { data: requestedBookings, error: bookingError } = await requesterClient
    .from("bookings")
    .select("id,team_id,status")
    .in("id", bookingIds);
  if (bookingError) {
    return NextResponse.json({ error: "예약 정보를 확인하지 못했습니다." }, { status: 500 });
  }

  const expectedStatus = kind === "booking_created" ? "confirmed" : "cancelled";
  if (
    requestedBookings.length !== bookingIds.length ||
    requestedBookings.some((booking) => booking.status !== expectedStatus)
  ) {
    return NextResponse.json({ error: "현재 예약 상태와 알림 종류가 일치하지 않습니다." }, { status: 409 });
  }

  const isManager = requesterProfile.role === "admin" || requesterProfile.role === "manager";
  if (!isManager) {
    const teamIds = Array.from(new Set(requestedBookings.map((booking) => booking.team_id)));
    const { data: leaderships, error: leadershipError } = await requesterClient
      .from("team_members")
      .select("team_id")
      .eq("user_id", userData.user.id)
      .eq("is_leader", true)
      .in("team_id", teamIds);
    const ledTeamIds = new Set((leaderships ?? []).map((membership) => membership.team_id));

    if (leadershipError || teamIds.some((teamId) => !ledTeamIds.has(teamId))) {
      return NextResponse.json({ error: "해당 팀의 팀장만 예약 알림을 보낼 수 있습니다." }, { status: 403 });
    }
  }

  const { data: targets, error: targetError } = await adminClient.rpc("claim_booking_push_targets", {
    p_requester_id: userData.user.id,
    p_booking_ids: bookingIds,
    p_kind: kind,
  });

  if (targetError) {
    return NextResponse.json(
      {
        error: targetError.code === "42883" || targetError.code === "PGRST202"
          ? "Supabase SQL Editor에서 supabase/patch-034-security-audit.sql을 실행해 주세요."
          : "알림 대상을 확인하지 못했습니다.",
      },
      { status: 500 },
    );
  }

  const rows = (targets ?? []) as BookingPushTarget[];
  const rowsByBooking = new Map<string, BookingPushTarget[]>();

  for (const row of rows) {
    rowsByBooking.set(row.booking_id, [...(rowsByBooking.get(row.booking_id) ?? []), row]);
  }

  let sent = 0;
  let failed = 0;
  const recipientIds = new Set<string>();
  const subscriptionIds = new Set<string>();

  for (const [bookingId, bookingRows] of rowsByBooking) {
    const firstRow = bookingRows[0];
    const booking: PushBooking = {
      id: bookingId,
      team_id: firstRow.team_id,
      booking_date: firstRow.booking_date,
      day_of_week: firstRow.day_of_week,
      start_time: firstRow.start_time,
      duration: Number(firstRow.duration),
      purpose: firstRow.purpose,
      status: firstRow.status,
    };
    const team: PushTeam = {
      id: firstRow.team_id,
      name: firstRow.team_name,
      song: firstRow.team_song,
    };
    const payload = buildBookingPushPayload(kind, booking, team);

    for (const row of bookingRows) {
      recipientIds.add(row.user_id);
      subscriptionIds.add(row.subscription_id);
      const subscription: PushSubscriptionRecord = {
        id: row.subscription_id,
        user_id: row.user_id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth_key: row.auth_key,
      };
      const response = await sendWebPush(subscription, payload, config).catch(() => null);
      if (response?.status === 404 || response?.status === 410) {
        await adminClient
          .from("push_subscriptions")
          .update({ disabled_at: new Date().toISOString() })
          .eq("id", row.subscription_id);
      }
      if (response?.ok) {
        sent += 1;
      } else {
        failed += 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    recipientCount: recipientIds.size,
    subscriptionCount: subscriptionIds.size,
  });
}
