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

  const body = (await request.json().catch(() => null)) as { profileId?: unknown; accessToken?: unknown; actorProfileId?: unknown } | null;
  const authorization = request.headers.get("authorization") ?? "";
  const headerAccessToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const bodyAccessToken = typeof body?.accessToken === "string" ? body.accessToken : "";
  const accessToken = headerAccessToken || bodyAccessToken;
  const actorProfileId = typeof body?.actorProfileId === "string" ? body.actorProfileId : "";

  const profileId = typeof body?.profileId === "string" ? body.profileId : "";
  if (!profileId) {
    return jsonError("삭제할 부원을 선택해 주세요.", 400);
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

  if (actorId === profileId) {
    return jsonError("본인 계정은 삭제할 수 없습니다.", 400);
  }

  const adminProfile = await assertNoError(
    supabase.from("profiles").select("id, role, status").eq("id", actorId).maybeSingle(),
    "관리자 권한 확인에 실패했습니다",
  );

  if (!adminProfile || adminProfile.role !== "admin" || adminProfile.status !== "approved") {
    return jsonError("관리자만 계정을 삭제할 수 있습니다.", 403);
  }

  const targetProfile = await assertNoError(
    supabase.from("profiles").select("id, name, role").eq("id", profileId).maybeSingle(),
    "삭제 대상 확인에 실패했습니다",
  );

  if (!targetProfile) {
    return jsonError("삭제할 부원을 찾을 수 없습니다.", 404);
  }

  if (targetProfile.role === "admin") {
    return jsonError("관리자 계정은 삭제할 수 없습니다.", 400);
  }

  try {
    const ledTeams = await assertNoError(
      supabase.from("team_members").select("team_id").eq("user_id", profileId).eq("is_leader", true),
      "팀장 정보 확인에 실패했습니다",
    );

    for (const ledTeam of ledTeams ?? []) {
      const replacements = await assertNoError(
        supabase
          .from("team_members")
          .select("user_id")
          .eq("team_id", ledTeam.team_id)
          .neq("user_id", profileId)
          .order("created_at", { ascending: true })
          .limit(1),
        "팀장 승계 대상 확인에 실패했습니다",
      );

      const replacement = replacements?.[0];
      if (replacement) {
        await assertNoError(
          supabase.from("team_members").update({ is_leader: false }).eq("team_id", ledTeam.team_id),
          "팀장 초기화에 실패했습니다",
        );
        await assertNoError(
          supabase.from("team_members").update({ is_leader: true }).eq("team_id", ledTeam.team_id).eq("user_id", replacement.user_id),
          "팀장 승계에 실패했습니다",
        );
      } else {
        await assertNoError(supabase.from("teams").delete().eq("id", ledTeam.team_id), "빈 팀 삭제에 실패했습니다");
      }
    }

    await assertNoError(supabase.from("teams").update({ created_by: null }).eq("created_by", profileId), "팀 생성자 정리에 실패했습니다");
    await assertNoError(
      supabase.from("member_schedules").update({ updated_by: null }).eq("updated_by", profileId),
      "시간표 수정자 정리에 실패했습니다",
    );
    await assertNoError(supabase.from("bookings").update({ created_by: null }).eq("created_by", profileId), "예약 생성자 정리에 실패했습니다");
    await assertNoError(supabase.from("bookings").update({ cancelled_by: null }).eq("cancelled_by", profileId), "예약 취소자 정리에 실패했습니다");
    await assertNoError(supabase.from("profiles").update({ approved_by: null }).eq("approved_by", profileId), "승인자 정리에 실패했습니다");
    await assertNoError(supabase.from("audit_logs").update({ actor_id: null }).eq("actor_id", profileId), "감사 로그 정리에 실패했습니다");

    const { error: deleteError } = await supabase.auth.admin.deleteUser(profileId);
    if (deleteError) {
      throw new Error(deleteError.message);
    }

    await assertNoError(
      supabase.from("audit_logs").insert({
        actor_id: adminProfile.id,
        action: "delete_member_auth_user",
        target_type: "profile",
        target_id: profileId,
        reason: targetProfile.name,
      }),
      "감사 로그 기록에 실패했습니다",
    );

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(getServerErrorMessage(error, "계정 삭제에 실패했습니다."), 500);
  }
}
