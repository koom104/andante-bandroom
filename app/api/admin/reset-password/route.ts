import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://inlddwyoesmvmxkcuhwd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_dKyziP5Nq6fTyZWkUd5OQQ_D5oyYD2P";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function generateTemporaryPassword() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function POST(request: NextRequest) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY가 서버 환경변수에 설정되지 않았습니다." }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as { userId?: string; accessToken?: string } | null;
  const authorization = request.headers.get("authorization") ?? "";
  const headerToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const token = headerToken || body?.accessToken || "";

  if (!token) {
    return NextResponse.json({ error: "관리자 세션을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요." }, { status: 401 });
  }

  const targetUserId = body?.userId;

  if (!targetUserId) {
    return NextResponse.json({ error: "리셋할 부원을 선택해 주세요." }, { status: 400 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
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

  const { data: requesterData, error: requesterError } = await requesterClient.auth.getUser(token);
  if (requesterError || !requesterData.user) {
    return NextResponse.json({ error: "관리자 세션을 확인할 수 없습니다. 로그아웃 후 다시 로그인해 주세요." }, { status: 401 });
  }

  const { data: requesterProfile, error: requesterProfileError } = await requesterClient
    .from("profiles")
    .select("role,status")
    .eq("id", requesterData.user.id)
    .maybeSingle();

  if (requesterProfileError) {
    return NextResponse.json({ error: `관리자 프로필 확인에 실패했습니다: ${requesterProfileError.message}` }, { status: 500 });
  }

  if (!requesterProfile) {
    return NextResponse.json({ error: "로그인 계정의 프로필을 찾을 수 없습니다." }, { status: 404 });
  }

  if (requesterProfile.role !== "admin" || requesterProfile.status !== "approved") {
    return NextResponse.json(
      { error: `관리자만 비밀번호를 리셋할 수 있습니다. 현재 권한: ${requesterProfile.role} / ${requesterProfile.status}` },
      { status: 403 },
    );
  }

  const { data: targetProfile, error: targetProfileError } = await requesterClient
    .from("profiles")
    .select("id,role,status")
    .eq("id", targetUserId)
    .maybeSingle();

  if (targetProfileError) {
    return NextResponse.json({ error: `부원 계정 확인에 실패했습니다: ${targetProfileError.message}` }, { status: 500 });
  }

  if (!targetProfile) {
    return NextResponse.json({ error: "부원 계정을 찾을 수 없습니다." }, { status: 404 });
  }

  if (targetProfile.role === "admin") {
    return NextResponse.json({ error: "관리자 계정은 이 기능으로 리셋할 수 없습니다." }, { status: 400 });
  }

  const temporaryPassword = generateTemporaryPassword();
  const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    password: temporaryPassword,
  });

  if (updateAuthError) {
    return NextResponse.json({ error: updateAuthError.message }, { status: 500 });
  }

  const { error: updateProfileError } = await requesterClient
    .from("profiles")
    .update({ password_reset_required: true })
    .eq("id", targetUserId);

  if (updateProfileError) {
    return NextResponse.json({ error: updateProfileError.message }, { status: 500 });
  }

  return NextResponse.json({ temporaryPassword });
}
