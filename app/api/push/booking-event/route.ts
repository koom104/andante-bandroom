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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type BookingEventBody = {
  bookingIds?: string[];
  kind?: "booking_created" | "booking_cancelled";
};

function webPushConfig() {
  return {
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? "",
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? "",
    subject: process.env.WEB_PUSH_SUBJECT ?? "mailto:admin@example.com",
  };
}

export async function POST(request: NextRequest) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY가 서버 환경변수에 설정되지 않았습니다." }, { status: 500 });
  }

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
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

  const { data: bookings, error: bookingError } = await serviceClient
    .from("bookings")
    .select("id,team_id,booking_date,day_of_week,start_time,duration,purpose,status")
    .in("id", bookingIds);
  if (bookingError) {
    return NextResponse.json({ error: bookingError.message }, { status: 500 });
  }

  const bookingRows = (bookings ?? []) as PushBooking[];
  if (bookingRows.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const teamIds = Array.from(new Set(bookingRows.map((booking) => booking.team_id)));
  const { data: teams } = await serviceClient.from("teams").select("id,name,song").in("id", teamIds);
  const { data: memberRows } = await serviceClient.from("team_members").select("team_id,user_id").in("team_id", teamIds);
  const membersByTeam = new Map<string, string[]>();

  for (const member of (memberRows ?? []) as Array<{ team_id: string; user_id: string }>) {
    membersByTeam.set(member.team_id, [...(membersByTeam.get(member.team_id) ?? []), member.user_id]);
  }

  const userIds = Array.from(new Set(Array.from(membersByTeam.values()).flat()));
  if (userIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const { data: subscriptions } = await serviceClient
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth_key")
    .is("disabled_at", null)
    .in("user_id", userIds);
  const subscriptionsByUser = new Map<string, PushSubscriptionRecord[]>();

  for (const subscription of (subscriptions ?? []) as PushSubscriptionRecord[]) {
    if (!subscription.user_id) {
      continue;
    }
    subscriptionsByUser.set(subscription.user_id, [...(subscriptionsByUser.get(subscription.user_id) ?? []), subscription]);
  }

  const teamById = new Map((teams ?? []).map((team) => [(team as PushTeam).id, team as PushTeam]));
  let sent = 0;

  for (const booking of bookingRows) {
    const recipients = membersByTeam.get(booking.team_id) ?? [];
    const payload = buildBookingPushPayload(kind, booking, teamById.get(booking.team_id));

    for (const userId of recipients) {
      const { data: insertedLog } = await serviceClient
        .from("push_notification_logs")
        .insert({
          user_id: userId,
          booking_id: booking.id,
          kind,
          notification_date: booking.booking_date,
        })
        .select("id")
        .maybeSingle();

      if (!insertedLog) {
        continue;
      }

      for (const subscription of subscriptionsByUser.get(userId) ?? []) {
        const response = await sendWebPush(subscription, payload, config).catch(() => null);
        if (response?.status === 404 || response?.status === 410) {
          await serviceClient.from("push_subscriptions").update({ disabled_at: new Date().toISOString() }).eq("id", subscription.id);
        }
        if (response?.ok) {
          sent += 1;
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sent });
}
