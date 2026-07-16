/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { buildBookingPushPayload, sendWebPush, type PushBooking, type PushSubscriptionRecord, type PushTeam } from "../app/push-utils";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  WEB_PUSH_PUBLIC_KEY?: string;
  WEB_PUSH_PRIVATE_KEY?: string;
  WEB_PUSH_SUBJECT?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

interface PushNotificationLog {
  user_id: string;
  booking_id: string | null;
}

const defaultSupabaseUrl = "https://inlddwyoesmvmxkcuhwd.supabase.co";

function getSupabaseUrl(env: Env) {
  return env.NEXT_PUBLIC_SUPABASE_URL || defaultSupabaseUrl;
}

function getServiceHeaders(env: Env) {
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
}

function getWebPushConfig(env: Env) {
  return {
    publicKey: env.WEB_PUSH_PUBLIC_KEY ?? "",
    privateKey: env.WEB_PUSH_PRIVATE_KEY ?? "",
    subject: env.WEB_PUSH_SUBJECT ?? "mailto:admin@example.com",
  };
}

function kstDateParts(timestamp = Date.now()) {
  const shifted = new Date(timestamp + 9 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();

  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function startTimeToMinutes(startTime: string) {
  const [hour, minute] = startTime.split(":").map(Number);
  return hour * 60 + minute;
}

async function supabaseGet<T>(env: Env, path: string) {
  const response = await fetch(`${getSupabaseUrl(env)}/rest/v1/${path}`, {
    headers: getServiceHeaders(env),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T[];
}

async function supabaseInsertLog(env: Env, row: Record<string, string | null>) {
  const response = await fetch(`${getSupabaseUrl(env)}/rest/v1/push_notification_logs`, {
    method: "POST",
    headers: {
      ...getServiceHeaders(env),
      prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });

  if (!response.ok) {
    console.error("Push notification log insert failed", {
      kind: row.kind,
      bookingId: row.booking_id,
      status: response.status,
      error: await response.text(),
    });
  }

  return response.ok;
}

async function disableSubscription(env: Env, subscriptionId?: string) {
  if (!subscriptionId) {
    return;
  }

  await fetch(`${getSupabaseUrl(env)}/rest/v1/push_subscriptions?id=eq.${subscriptionId}`, {
    method: "PATCH",
    headers: getServiceHeaders(env),
    body: JSON.stringify({ disabled_at: new Date().toISOString() }),
  }).catch(() => undefined);
}

function inFilter(values: string[]) {
  return `in.(${values.join(",")})`;
}

async function loadPushContext(env: Env, bookings: PushBooking[]) {
  const teamIds = Array.from(new Set(bookings.map((booking) => booking.team_id)));
  if (teamIds.length === 0) {
    return {
      teamById: new Map<string, PushTeam>(),
      membersByTeam: new Map<string, string[]>(),
      subscriptionsByUser: new Map<string, PushSubscriptionRecord[]>(),
    };
  }

  const [teams, members] = await Promise.all([
    supabaseGet<PushTeam>(env, `teams?select=id,name,song&id=${inFilter(teamIds)}`),
    supabaseGet<{ team_id: string; user_id: string }>(env, `team_members?select=team_id,user_id&team_id=${inFilter(teamIds)}`),
  ]);
  const membersByTeam = new Map<string, string[]>();

  for (const member of members) {
    membersByTeam.set(member.team_id, [...(membersByTeam.get(member.team_id) ?? []), member.user_id]);
  }

  const userIds = Array.from(new Set(Array.from(membersByTeam.values()).flat()));
  const subscriptions =
    userIds.length > 0
      ? await supabaseGet<PushSubscriptionRecord>(
          env,
          `push_subscriptions?select=id,user_id,endpoint,p256dh,auth_key&disabled_at=is.null&user_id=${inFilter(userIds)}`,
        )
      : [];
  const subscriptionsByUser = new Map<string, PushSubscriptionRecord[]>();

  for (const subscription of subscriptions) {
    if (!subscription.user_id) {
      continue;
    }
    subscriptionsByUser.set(subscription.user_id, [...(subscriptionsByUser.get(subscription.user_id) ?? []), subscription]);
  }

  return {
    teamById: new Map(teams.map((team) => [team.id, team])),
    membersByTeam,
    subscriptionsByUser,
  };
}

async function sendToSubscription(env: Env, subscription: PushSubscriptionRecord, payload: { title: string; body: string; url?: string; tag?: string }) {
  const response = await sendWebPush(subscription, payload, getWebPushConfig(env)).catch((error) => {
    console.error("Web Push request failed", {
      subscriptionId: subscription.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (response?.status === 404 || response?.status === 410) {
    await disableSubscription(env, subscription.id);
  }

  if (response && !response.ok && response.status !== 404 && response.status !== 410) {
    console.error("Web Push provider rejected request", {
      subscriptionId: subscription.id,
      status: response.status,
      response: await response.text().catch(() => ""),
    });
  }

  return response?.ok === true;
}

async function sendDailyDigest(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.WEB_PUSH_PUBLIC_KEY || !env.WEB_PUSH_PRIVATE_KEY) {
    return;
  }

  const today = kstDateParts().date;
  const bookings = await supabaseGet<PushBooking>(
    env,
    `bookings?select=id,team_id,booking_date,day_of_week,start_time,duration,purpose,status&status=eq.confirmed&booking_date=eq.${today}&order=start_time.asc`,
  );
  const { teamById, membersByTeam, subscriptionsByUser } = await loadPushContext(env, bookings);
  const bookingsByUser = new Map<string, PushBooking[]>();

  for (const booking of bookings) {
    for (const userId of membersByTeam.get(booking.team_id) ?? []) {
      bookingsByUser.set(userId, [...(bookingsByUser.get(userId) ?? []), booking]);
    }
  }

  for (const [userId, userBookings] of bookingsByUser) {
    const userSubscriptions = subscriptionsByUser.get(userId) ?? [];
    if (userSubscriptions.length === 0) {
      continue;
    }

    const summary = userBookings
      .slice(0, 4)
      .map((booking) => {
        const team = teamById.get(booking.team_id);
        return `${booking.start_time} ${team?.name ?? "합주"}`;
      })
      .join(", ");
    const moreText = userBookings.length > 4 ? ` 외 ${userBookings.length - 4}건` : "";

    let userSent = false;
    for (const subscription of userSubscriptions) {
      const sent = await sendToSubscription(env, subscription, {
        title: "오늘 합주 일정",
        body: `${userBookings.length}건: ${summary}${moreText}`,
        url: "/",
        tag: `daily-digest-${today}`,
      });
      userSent ||= sent;
    }

    if (userSent) {
      await supabaseInsertLog(env, {
        user_id: userId,
        booking_id: null,
        kind: "daily_digest",
        notification_date: today,
      });
    }
  }
}

async function sendThirtyMinuteReminders(env: Env, scheduledTime: number) {
  const actualRunTime = Date.now();
  console.log("Thirty-minute reminder job started", {
    scheduledTime: new Date(scheduledTime).toISOString(),
    actualRunTime: new Date(actualRunTime).toISOString(),
  });

  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.WEB_PUSH_PUBLIC_KEY || !env.WEB_PUSH_PRIVATE_KEY) {
    console.error("Thirty-minute reminders skipped because required secrets are missing.");
    return;
  }

  // A Worker deployment can briefly delay a Cron trigger. Keep retrying an
  // unlogged reminder until the rehearsal starts so one missed tick does not
  // permanently discard the notification.
  const now = kstDateParts(actualRunTime);
  const bookings = (
    await supabaseGet<PushBooking>(
      env,
      `bookings?select=id,team_id,booking_date,day_of_week,start_time,duration,purpose,status&status=eq.confirmed&booking_date=eq.${now.date}`,
    )
  ).filter((booking) => {
    const startMinutes = startTimeToMinutes(booking.start_time);
    const reminderMinutes = startMinutes - 30;
    return reminderMinutes <= now.minutes && startMinutes > now.minutes;
  });
  const { teamById, membersByTeam, subscriptionsByUser } = await loadPushContext(env, bookings);
  const bookingIds = bookings.map((booking) => booking.id);
  const existingLogs =
    bookingIds.length > 0
      ? await supabaseGet<PushNotificationLog>(
          env,
          `push_notification_logs?select=user_id,booking_id&kind=eq.booking_reminder&booking_id=${inFilter(bookingIds)}`,
        )
      : [];
  const sentKeys = new Set(existingLogs.map((log) => `${log.user_id}:${log.booking_id}`));

  console.log("Thirty-minute reminder candidates", {
    scheduledTime: new Date(scheduledTime).toISOString(),
    actualRunTime: new Date(actualRunTime).toISOString(),
    targetDate: now.date,
    targetMinutes: now.minutes,
    bookingCount: bookings.length,
  });

  for (const booking of bookings) {
    const payload = buildBookingPushPayload("booking_reminder", booking, teamById.get(booking.team_id));

    for (const userId of membersByTeam.get(booking.team_id) ?? []) {
      const sentKey = `${userId}:${booking.id}`;
      if (sentKeys.has(sentKey)) {
        continue;
      }

      const userSubscriptions = subscriptionsByUser.get(userId) ?? [];
      if (userSubscriptions.length === 0) {
        continue;
      }

      let userSent = false;
      for (const subscription of userSubscriptions) {
        const sent = await sendToSubscription(env, subscription, payload);
        userSent ||= sent;
      }

      if (userSent) {
        const logged = await supabaseInsertLog(env, {
          user_id: userId,
          booking_id: booking.id,
          kind: "booking_reminder",
          notification_date: booking.booking_date,
        });

        if (logged) {
          sentKeys.add(sentKey);
        }
      }
    }
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "0 0 * * *") {
      ctx.waitUntil(sendDailyDigest(env));
      return;
    }

    ctx.waitUntil(
      sendThirtyMinuteReminders(env, event.scheduledTime).catch((error) => {
        console.error("Thirty-minute reminder job failed", error);
        throw error;
      }),
    );
  },
};

export default worker;
