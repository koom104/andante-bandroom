import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sendWebPush, type PushSubscriptionRecord } from "../../../push-utils";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://inlddwyoesmvmxkcuhwd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_dKyziP5Nq6fTyZWkUd5OQQ_D5oyYD2P";

function webPushConfig() {
  return {
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? "",
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? "",
    subject: process.env.WEB_PUSH_SUBJECT ?? "mailto:admin@example.com",
  };
}

function isMissingPushSchema(error: { code?: string; message?: string }) {
  return error.code === "42P01" || error.code === "PGRST202" || error.code === "PGRST204" || error.code === "PGRST205";
}

type TestPushKind = "daily_digest" | "booking_reminder";

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

  const requestBody = (await request.json().catch(() => null)) as { kind?: TestPushKind } | null;
  const kind: TestPushKind = requestBody?.kind === "daily_digest" ? "daily_digest" : "booking_reminder";

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

  const { data: profile, error: profileError } = await requesterClient
    .from("profiles")
    .select("id,name,status")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile || profile.status !== "approved") {
    return NextResponse.json({ error: "승인된 부원만 테스트 알림을 받을 수 있습니다." }, { status: 403 });
  }

  const { data: subscriptions, error: subscriptionError } = await requesterClient.rpc("get_my_push_subscriptions");
  if (subscriptionError) {
    return NextResponse.json(
      {
        error: isMissingPushSchema(subscriptionError)
          ? "Supabase SQL Editor에서 supabase/patch-018-web-push.sql과 supabase/patch-019-web-push-rpc.sql을 실행해 주세요."
          : subscriptionError.message,
      },
      { status: 500 },
    );
  }

  const activeSubscriptions = (subscriptions ?? []) as PushSubscriptionRecord[];
  if (activeSubscriptions.length === 0) {
    return NextResponse.json({ error: "저장된 알림 구독이 없습니다. 먼저 이 기기에서 알림 받기를 눌러 주세요." }, { status: 404 });
  }

  let sent = 0;
  const payload =
    kind === "daily_digest"
      ? {
          title: "오늘 합주 일정",
          body: "[테스트] 2건: 14:00 가상 합주 A, 18:00 가상 합주 B",
          url: "/",
          tag: `push-test-digest-${userData.user.id}-${Date.now()}`,
        }
      : {
          title: "합주 시작 30분 전입니다",
          body: "[테스트] 18:00-20:00 · 가상 합주 팀 - 알림 확인",
          url: "/",
          tag: `push-test-reminder-${userData.user.id}-${Date.now()}`,
        };

  for (const subscription of activeSubscriptions) {
    const response = await sendWebPush(subscription, payload, config).catch(() => null);

    if (response?.status === 404 || response?.status === 410) {
      await requesterClient.rpc("disable_my_push_subscription", { p_subscription_id: subscription.id });
    }

    if (response?.ok) {
      sent += 1;
    }
  }

  if (sent === 0) {
    return NextResponse.json({ error: "알림 발송에 실패했습니다. 브라우저 알림 권한을 다시 확인해 주세요." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sent, kind, recipient: profile.name });
}
