export type PushSubscriptionRecord = {
  id?: string;
  user_id?: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};

export type PushBooking = {
  id: string;
  team_id: string;
  booking_date: string | null;
  day_of_week: string;
  start_time: string;
  duration: number;
  purpose: string;
  status: string;
};

export type PushTeam = {
  id: string;
  name: string;
  song: string;
};

export type WebPushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

const textEncoder = new TextEncoder();

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function uint8ArrayToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function concatUint8Arrays(...arrays: Uint8Array[]) {
  const totalLength = arrays.reduce((sum, array) => sum + array.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const array of arrays) {
    merged.set(array, offset);
    offset += array.byteLength;
  }

  return merged;
}

async function hkdfExtract(salt: Uint8Array, inputKeyMaterial: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, inputKeyMaterial));
}

async function hkdfExpand(pseudoRandomKey: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", pseudoRandomKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const result = new Uint8Array(await crypto.subtle.sign("HMAC", key, concatUint8Arrays(info, new Uint8Array([1]))));
  return result.slice(0, length);
}

async function createVapidToken(subscriptionEndpoint: string, config: WebPushConfig) {
  const publicKeyBytes = base64UrlToUint8Array(config.publicKey);
  const privateKeyBytes = base64UrlToUint8Array(config.privateKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: uint8ArrayToBase64Url(publicKeyBytes.slice(1, 33)),
      y: uint8ArrayToBase64Url(publicKeyBytes.slice(33, 65)),
      d: uint8ArrayToBase64Url(privateKeyBytes),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const audience = new URL(subscriptionEndpoint).origin;
  const header = uint8ArrayToBase64Url(textEncoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = uint8ArrayToBase64Url(
    textEncoder.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: config.subject,
      }),
    ),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, textEncoder.encode(`${header}.${payload}`)),
  );

  return `${header}.${payload}.${uint8ArrayToBase64Url(signature)}`;
}

async function encryptPushPayload(subscription: PushSubscriptionRecord, payload: PushPayload) {
  const userPublicKey = base64UrlToUint8Array(subscription.p256dh);
  const authSecret = base64UrlToUint8Array(subscription.auth_key);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const userKey = await crypto.subtle.importKey("raw", userPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: userKey }, serverKeys.privateKey, 256));
  const authInfo = concatUint8Arrays(textEncoder.encode("WebPush: info\0"), userPublicKey, serverPublicKey);
  const pseudoRandomKey = await hkdfExtract(authSecret, sharedSecret);
  const inputKeyMaterial = await hkdfExpand(pseudoRandomKey, authInfo, 32);
  const contentEncryptionKey = await hkdfExpand(await hkdfExtract(salt, inputKeyMaterial), textEncoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(await hkdfExtract(salt, inputKeyMaterial), textEncoder.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", contentEncryptionKey, "AES-GCM", false, ["encrypt"]);
  const plaintext = concatUint8Arrays(textEncoder.encode(JSON.stringify(payload)), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext));
  const recordSize = new Uint8Array([0, 0, 16, 0]);

  return concatUint8Arrays(salt, recordSize, new Uint8Array([serverPublicKey.byteLength]), serverPublicKey, ciphertext);
}

export async function sendWebPush(subscription: PushSubscriptionRecord, payload: PushPayload, config: WebPushConfig) {
  if (!config.publicKey || !config.privateKey || !config.subject) {
    throw new Error("VAPID 설정이 없습니다.");
  }

  const vapidToken = await createVapidToken(subscription.endpoint, config);
  const body = await encryptPushPayload(subscription, payload);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${vapidToken}, k=${config.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
    },
    body,
  });
}

export function bookingEndTime(startTime: string, duration: number) {
  const [hour, minute] = startTime.split(":").map(Number);
  const totalMinutes = hour * 60 + minute + Math.round(duration * 60);
  const nextHour = Math.floor(totalMinutes / 60);
  const nextMinute = totalMinutes % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

export function formatPushDate(date: string | null, day: string) {
  if (!date) {
    return `${day}요일`;
  }

  const [, month, dateNumber] = date.split("-");
  return `${Number(month)}.${Number(dateNumber)} ${day}요일`;
}

export function buildBookingPushPayload(kind: "booking_created" | "booking_cancelled" | "booking_reminder", booking: PushBooking, team?: PushTeam) {
  const teamName = team?.name ?? "합주";
  const date = formatPushDate(booking.booking_date, booking.day_of_week);
  const time = `${booking.start_time}-${bookingEndTime(booking.start_time, Number(booking.duration))}`;
  const purpose = booking.purpose || team?.song || "합주";

  if (kind === "booking_created") {
    return {
      title: "합주 일정이 추가됐어요",
      body: `${date} ${time} · ${teamName} - ${purpose}`,
      url: "/",
      tag: `booking-created-${booking.id}`,
    };
  }

  if (kind === "booking_cancelled") {
    return {
      title: "합주 일정이 취소됐어요",
      body: `${date} ${time} · ${teamName} - ${purpose}`,
      url: "/",
      tag: `booking-cancelled-${booking.id}`,
    };
  }

  return {
    title: "합주 시작 30분 전입니다",
    body: `${time} · ${teamName} - ${purpose}`,
    url: "/",
    tag: `booking-reminder-${booking.id}`,
  };
}
