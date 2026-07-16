import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  buildBookingPushPayload,
  sendWebPush,
  type PushBooking,
  type PushSubscriptionRecord,
  type PushTeam,
} from "../../../push-utils";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://inlddwyoesmvmxkcuhwd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_dKyziP5Nq6fTyZWkUd5OQQ_D5oyYD2P";

type BookingEventBody = {
  bookingIds?: string[];
  kind?: "booking_created" | "booking_cancelled";
};

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

function isMissingPushTargetRpc(error: { code?: string }) {
  return error.code === "42883" || error.code === "PGRST202";
}

export async function POST(request: NextRequest) {
  const config = webPushConfig();
  if (!config.publicKey || !config.privateKey) {
    return NextResponse.json({ error: "WEB_PUSH_PUBLIC_KEY 또는 WEB_PUSH_PRIVATE_KEY가 서버 환경변수에 없습니다." }, { status: 500 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as BookingEventBody | null;
  const bookingIds = Array.from(new Set(body?.bookingIds ?? [])).filter(Boolean);
  const kind = body?.kind;

  if (!kind || bookingIds.length === 0) {
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
  const { data: userData, error: userError } = await requesterClient.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "로그인 세션을 확인할 수 없습니다." }, { status: 401 });
  }

  const { data: requesterProfile, error: requesterError } = await requesterClient
    .from("profiles")
    .select("id,status")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (requesterError) {
    return NextResponse.json({ error: requesterError.message }, { status: 500 });
  }
  if (!requesterProfile || requesterProfile.status !== "approved") {
    return NextResponse.json({ error: "승인된 부원만 알림을 보낼 수 있습니다." }, { status: 403 });
  }

  const { data: targets, error: targetError } = await requesterClient.rpc("get_booking_push_targets", {
    p_booking_ids: bookingIds,
  });
  if (targetError) {
    return NextResponse.json(
      {
        error: isMissingPushTargetRpc(targetError)
          ? "Supabase SQL Editor에서 supabase/patch-020-booking-push-targets.sql을 실행해 주세요."
          : targetError.message,
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
        await requesterClient.rpc("disable_my_push_subscription", { p_subscription_id: row.subscription_id }).catch(() => undefined);
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
