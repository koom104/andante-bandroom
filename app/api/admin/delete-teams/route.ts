import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://inlddwyoesmvmxkcuhwd.supabase.co";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function getServerErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? fallback);
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}

async function assertNoError<T>(operation: PromiseLike<{ data: T; error: { message?: string } | null }>, message: string) {
  const result = await operation;
  if (result.error) {
    throw new Error(`${message}: ${getServerErrorMessage(result.error, "unknown error")}`);
  }

  return result.data;
}

export async function POST(request: Request) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return jsonError("SUPABASE_SERVICE_ROLE_KEY가 서버 환경변수에 설정되지 않았습니다.", 500);
  }
  if (serviceRoleKey.startsWith("sb_publishable_")) {
    return jsonError("SUPABASE_SERVICE_ROLE_KEY에 publishable key가 들어가 있습니다. Supabase service_role 또는 secret key로 다시 설정해 주세요.", 500);
  }

  const body = (await request.json().catch(() => null)) as { teamIds?: unknown; accessToken?: unknown; actorProfileId?: unknown } | null;
  const authorization = request.headers.get("authorization") ?? "";
  const headerAccessToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const bodyAccessToken = typeof body?.accessToken === "string" ? body.accessToken : "";
  const accessToken = headerAccessToken || bodyAccessToken;
  const actorProfileId = typeof body?.actorProfileId === "string" ? body.actorProfileId : "";

  const teamIds = Array.isArray(body?.teamIds)
    ? Array.from(new Set(body.teamIds.filter((teamId): teamId is string => typeof teamId === "string" && teamId.length > 0)))
    : [];

  if (teamIds.length === 0) {
    return jsonError("삭제할 팀을 선택해 주세요.", 400);
  }

  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let actorId = "";
  if (accessToken) {
    const {
      data: { user },
    } = await supabase.auth.getUser(accessToken);
    actorId = user?.id ?? "";
  }

  if (!actorId) {
    actorId = actorProfileId;
  }

  if (!actorId) {
    return jsonError("관리자 계정을 확인할 수 없습니다. 로그아웃 후 다시 로그인해 주세요.", 401);
  }

  const adminProfile = await assertNoError(
    supabase.from("profiles").select("id, role, status").eq("id", actorId).maybeSingle(),
    "관리자 권한 확인에 실패했습니다",
  );

  if (!adminProfile || adminProfile.role !== "admin" || adminProfile.status !== "approved") {
    return jsonError("관리자만 팀을 삭제할 수 있습니다.", 403);
  }

  try {
    const targetTeams = await assertNoError(
      supabase.from("teams").select("id, name").in("id", teamIds),
      "삭제 대상 팀 확인에 실패했습니다",
    );

    if (!targetTeams || targetTeams.length === 0) {
      return jsonError("삭제할 팀을 찾을 수 없습니다.", 404);
    }

    const targetIds = targetTeams.map((team) => team.id);
    await assertNoError(supabase.from("bookings").delete().in("team_id", targetIds), "팀 예약 삭제에 실패했습니다");
    await assertNoError(supabase.from("team_members").delete().in("team_id", targetIds), "팀 멤버 삭제에 실패했습니다");
    await assertNoError(supabase.from("teams").delete().in("id", targetIds), "팀 삭제에 실패했습니다");

    await assertNoError(
      supabase.from("audit_logs").insert(
        targetTeams.map((team) => ({
          actor_id: adminProfile.id,
          action: "delete_team",
          target_type: "team",
          target_id: team.id,
          reason: team.name,
        })),
      ),
      "감사 로그 기록에 실패했습니다",
    );

    return Response.json({ ok: true, deletedCount: targetTeams.length });
  } catch (error) {
    return jsonError(getServerErrorMessage(error, "팀 삭제에 실패했습니다."), 500);
  }
}
