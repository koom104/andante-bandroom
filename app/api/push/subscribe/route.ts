import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://inlddwyoesmvmxkcuhwd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_dKyziP5Nq6fTyZWkUd5OQQ_D5oyYD2P";

type SubscribeBody = {
  subscription?: {
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
};

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SubscribeBody | null;
  const subscription = body?.subscription;
  const endpoint = subscription?.endpoint ?? "";
  const p256dh = subscription?.keys?.p256dh ?? "";
  const auth = subscription?.keys?.auth ?? "";

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "푸시 구독 정보가 올바르지 않습니다." }, { status: 400 });
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

  const { data: profile, error: profileError } = await requesterClient
    .from("profiles")
    .select("id,status")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile || profile.status !== "approved") {
    return NextResponse.json({ error: "승인된 부원만 알림을 받을 수 있습니다." }, { status: 403 });
  }

  const { error } = await requesterClient.from("push_subscriptions").upsert(
    {
      user_id: userData.user.id,
      endpoint,
      p256dh,
      auth_key: auth,
      user_agent: request.headers.get("user-agent") ?? "",
      updated_at: new Date().toISOString(),
      disabled_at: null,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json(
      {
        error: error.message.includes("push_subscriptions")
          ? "Supabase SQL Editor에서 supabase/patch-018-web-push.sql을 먼저 실행해 주세요."
          : error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
