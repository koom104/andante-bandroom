import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { readBoundedJson } from "../../bounded-json";
import { rejectCrossOriginMutation } from "../../request-security";
import { changeRequiredPassword } from "../password-change";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://inlddwyoesmvmxkcuhwd.supabase.co";
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_dKyziP5Nq6fTyZWkUd5OQQ_D5oyYD2P";

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const parsed = await readBoundedJson(request, 4_096);
  if (!parsed.ok) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: parsed.status });
  const password = parsed.value.password;
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return NextResponse.json({ error: "비밀번호는 8~128자로 입력해 주세요." }, { status: 400 });
  }
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return NextResponse.json({ error: "서버 설정을 확인해 주세요." }, { status: 503 });
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const client = createClient(url, publicKey, options);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "다시 로그인해 주세요." }, { status: 401 });
  const userId = data.user.id;
  const admin = createClient(url, secret, options);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,password_reset_required").eq("id", userId).maybeSingle();
  if (profileError) return NextResponse.json({ error: "계정 상태를 확인하지 못했습니다." }, { status: 503 });
  if (!profile?.password_reset_required) {
    return NextResponse.json({ error: "비밀번호 재설정 대상 계정이 아닙니다." }, { status: 409 });
  }
  try {
    const outcome = await changeRequiredPassword(
      async () => {
        const response = await fetch(`${url}/auth/v1/user`, {
          method: "PUT",
          headers: { apikey: publicKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ password }),
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
        const result = await response.json().catch(() => null);
        return response.ok && result?.id === userId;
      },
      async () => {
        const { data: updated, error: updateError } = await admin.from("profiles")
          .update({ password_reset_required: false }).eq("id", userId).select("id").single();
        return !updateError && updated?.id === userId;
      },
    );
    if (outcome !== "ok") {
      return NextResponse.json({ error: outcome === "password_failed"
        ? "비밀번호를 변경하지 못했습니다. 이전과 다른 비밀번호를 사용해 주세요."
        : "비밀번호는 변경됐으나 상태 갱신에 실패했습니다. 다시 로그인해 주세요." }, { status: 503 });
    }
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "비밀번호 변경을 완료하지 못했습니다. 다시 시도해 주세요." }, { status: 503 });
  }
}
