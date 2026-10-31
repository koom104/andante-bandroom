import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isValidWebPushSubscription } from "../../../push-utils";
import { rejectCrossOriginMutation } from "../../request-security";
import { readBoundedJson } from "../../bounded-json";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://inlddwyoesmvmxkcuhwd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_dKyziP5Nq6fTyZWkUd5OQQ_D5oyYD2P";

type SubscribeBody = {
  mode?: string;
  previousEndpoint?: string;
  subscription?: {
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
};

function isMissingPushSchema(error: { code?: string; message?: string }) {
  return error.code === "42P01" || error.code === "PGRST202" || error.code === "PGRST204" || error.code === "PGRST205";
}

export async function POST(request: NextRequest) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) {
    return crossOriginResponse;
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return NextResponse.json({ error: "푸시 구독 정보가 너무 큽니다." }, { status: 413 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const parsed = await readBoundedJson(request, 16_384);
  if (!parsed.ok) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: parsed.status });
  const body = parsed.value as SubscribeBody;
  const subscription = body?.subscription;
  const endpoint = subscription?.endpoint ?? "";
  const p256dh = subscription?.keys?.p256dh ?? "";
  const auth = subscription?.keys?.auth ?? "";

  if (
    !isValidWebPushSubscription({
      endpoint,
      p256dh,
      auth_key: auth,
    })
  ) {
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
    .select("id,status,password_reset_required")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: "부원 승인 상태를 확인하지 못했습니다." }, { status: 500 });
  }

  if (!profile || profile.status !== "approved" || profile.password_reset_required) {
    return NextResponse.json({ error: "승인된 부원만 알림을 받을 수 있습니다." }, { status: 403 });
  }

  // Passive renewal must never replace the device the member explicitly chose.
  if (body.mode === "refresh") {
    const { data: rows, error: readError } = await requesterClient.rpc("get_my_push_subscriptions");
    if (readError) return NextResponse.json({ error: "알림 등록 상태를 확인하지 못했습니다." }, { status: 500 });
    const active = (rows ?? []).find((row: { endpoint: string }) => row.endpoint === endpoint || row.endpoint === body.previousEndpoint);
    if (!active) {
      return NextResponse.json({ error: "현재 이 기기가 알림 수신 기기로 등록되어 있지 않습니다. 이 기기에서 알림 받기를 다시 눌러 주세요." }, { status: 409 });
    }
    if (active.endpoint === endpoint && active.p256dh === p256dh && active.auth_key === auth) {
      return NextResponse.json({ ok: true });
    }
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return NextResponse.json({ error: "알림 구독 자동 갱신을 사용할 수 없습니다. 이 기기에서 알림 받기를 다시 눌러 주세요." }, { status: 503 });
    const serviceClient = createClient(SUPABASE_URL, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: updated, error: updateError } = await serviceClient.from("push_subscriptions")
      .update({ endpoint, p256dh, auth_key: auth, updated_at: new Date().toISOString() })
      .eq("id", active.id).eq("user_id", userData.user.id).eq("endpoint", active.endpoint)
      .eq("p256dh", active.p256dh).eq("auth_key", active.auth_key).is("disabled_at", null).select("id");
    if (updateError || !updated?.length) return NextResponse.json({ error: "알림 등록이 변경되었습니다. 이 기기에서 알림 받기를 다시 눌러 주세요." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  const { error } = await requesterClient.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth_key: auth,
    p_user_agent: (request.headers.get("user-agent") ?? "").slice(0, 512),
  });

  if (error) {
    return NextResponse.json(
      {
        error: isMissingPushSchema(error)
          ? "Supabase SQL Editor에서 supabase/patch-018-web-push.sql과 supabase/patch-019-web-push-rpc.sql을 실행해 주세요."
          : "푸시 구독 정보를 저장하지 못했습니다.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
