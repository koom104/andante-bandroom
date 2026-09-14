import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutation } from "../../request-security";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://inlddwyoesmvmxkcuhwd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_dKyziP5Nq6fTyZWkUd5OQQ_D5oyYD2P";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function generateTemporaryPassword() {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%",
  ];
  const alphabet = groups.join("");
  const randomIndex = (length: number) => {
    const limit = 256 - (256 % length);
    const byte = new Uint8Array(1);

    do {
      crypto.getRandomValues(byte);
    } while (byte[0] >= limit);

    return byte[0] % length;
  };
  const characters = groups.map((group) => group[randomIndex(group.length)]);

  while (characters.length < 16) {
    characters.push(alphabet[randomIndex(alphabet.length)]);
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }

  return characters.join("");
}

function isMissingPasswordResetColumn(message: string) {
  return message.includes("password_reset_required") && (message.includes("schema cache") || message.includes("column"));
}

export async function POST(request: NextRequest) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) {
    return crossOriginResponse;
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "관리자 서버 설정을 확인해 주세요." }, { status: 500 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }

  const body = (await request.json().catch(() => null)) as { userId?: string } | null;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return NextResponse.json({ error: "관리자 세션을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요." }, { status: 401 });
  }

  const targetUserId = body?.userId;

  if (!targetUserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
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

  const { data: requesterProfile, error: requesterProfileError } = await adminClient
    .from("profiles")
    .select("role,status")
    .eq("id", requesterData.user.id)
    .maybeSingle();

  if (requesterProfileError) {
    console.error("Admin profile lookup failed", requesterProfileError);
    return NextResponse.json({ error: "관리자 프로필 확인에 실패했습니다." }, { status: 500 });
  }

  if (!requesterProfile) {
    return NextResponse.json({ error: "로그인 계정의 프로필을 찾을 수 없습니다." }, { status: 404 });
  }

  if (!["admin", "manager"].includes(requesterProfile.role) || requesterProfile.status !== "approved") {
    return NextResponse.json({ error: "관리 권한 계정만 비밀번호를 리셋할 수 있습니다." }, { status: 403 });
  }

  const { data: targetProfile, error: targetProfileError } = await adminClient
    .from("profiles")
    .select("id,role,status,password_reset_required")
    .eq("id", targetUserId)
    .maybeSingle();

  if (targetProfileError) {
    if (isMissingPasswordResetColumn(targetProfileError.message)) {
      return NextResponse.json(
        {
          error:
            "Supabase DB에 password_reset_required 컬럼이 아직 없습니다. supabase/patch-016-password-reset.sql을 SQL Editor에서 실행한 뒤 다시 시도해 주세요.",
        },
        { status: 500 },
      );
    }

    console.error("Password reset target lookup failed", targetProfileError);
    return NextResponse.json({ error: "부원 계정 확인에 실패했습니다." }, { status: 500 });
  }

  if (!targetProfile) {
    return NextResponse.json({ error: "부원 계정을 찾을 수 없습니다." }, { status: 404 });
  }

  if (targetProfile.role === "admin") {
    return NextResponse.json({ error: "관리자 계정은 이 기능으로 리셋할 수 없습니다." }, { status: 400 });
  }

  if (requesterProfile.role === "manager" && targetProfile.role !== "member") {
    return NextResponse.json({ error: "집기 계정은 일반 부원의 비밀번호만 리셋할 수 있습니다." }, { status: 403 });
  }

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { data: recentReset } = await adminClient
    .from("audit_logs")
    .select("id")
    .eq("action", "reset_password")
    .eq("target_id", targetUserId)
    .gte("created_at", oneMinuteAgo)
    .limit(1)
    .maybeSingle();

  if (recentReset) {
    return NextResponse.json({ error: "방금 임시 비밀번호를 발급했습니다. 1분 뒤 다시 시도해 주세요." }, { status: 429 });
  }

  const temporaryPassword = generateTemporaryPassword();
  const { error: prepareProfileError } = await adminClient
    .from("profiles")
    .update({ password_reset_required: true })
    .eq("id", targetUserId);

  if (prepareProfileError) {
    if (isMissingPasswordResetColumn(prepareProfileError.message)) {
      return NextResponse.json(
        {
          error:
            "Supabase DB에 password_reset_required 컬럼이 아직 없습니다. supabase/patch-016-password-reset.sql을 SQL Editor에서 실행한 뒤 다시 시도해 주세요.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ error: "비밀번호 변경 상태를 준비하지 못했습니다." }, { status: 500 });
  }

  const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    password: temporaryPassword,
  });

  if (updateAuthError) {
    await adminClient.from("profiles").update({ password_reset_required: false }).eq("id", targetUserId);

    if (updateAuthError.message.toLowerCase().includes("invalid api key")) {
      return NextResponse.json(
        {
          error:
            "Cloudflare의 SUPABASE_SERVICE_ROLE_KEY가 올바른 Supabase service_role 키가 아닙니다. Supabase Dashboard에서 service_role 키를 복사해 Cloudflare secret에 다시 저장해 주세요.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ error: "임시 비밀번호 발급에 실패했습니다." }, { status: 500 });
  }

  await adminClient.from("audit_logs").insert({
    actor_id: requesterData.user.id,
    action: "reset_password",
    target_type: "profile",
    target_id: targetUserId,
    reason: "임시 비밀번호 발급",
  });

  return NextResponse.json(
    { temporaryPassword },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
