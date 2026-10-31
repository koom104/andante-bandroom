type PushSyncResult = { ok: boolean; message: string };

function keyBytes(value: string) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function storedEndpoint(userId: string) {
  try { return localStorage.getItem(`andante:push:${userId}`); } catch { return null; }
}

export async function syncPushSubscription(userId: string, accessToken: string, explicit = false, renew = false): Promise<PushSyncResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { ok: false, message: "이 브라우저는 웹푸시 알림을 지원하지 않습니다. 아이폰은 홈 화면에 추가한 앱에서 알림을 등록해 주세요." };
  }
  if (Notification.permission !== "granted") {
    return { ok: false, message: "알림을 받으려면 이 기기에서 알림 받기를 눌러 주세요." };
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  // A newly installed worker is not necessarily active when register() resolves.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("알림 준비 시간이 초과됐습니다. 다시 시도해 주세요.")), 15_000);
    navigator.serviceWorker.ready.then(() => { clearTimeout(timeout); resolve(); }, (error) => { clearTimeout(timeout); reject(error); });
  });
  let subscription = await registration.pushManager.getSubscription();
  const previousEndpoint = storedEndpoint(userId) ?? subscription?.endpoint ?? null;
  if (!explicit && !subscription && !previousEndpoint) {
    return { ok: false, message: "이 기기의 알림 구독이 없습니다. 이 기기에서 알림 받기를 다시 눌러 주세요." };
  }
  const keyResponse = await fetch("/api/push/public-key/", { cache: "no-store" });
  const keyResult = await keyResponse.json() as { publicKey?: string; error?: string };
  if (!keyResponse.ok || !keyResult.publicKey) throw new Error(keyResult.error ?? "푸시 공개키를 불러오지 못했습니다.");
  const publicKey = keyBytes(keyResult.publicKey);
  const existingKey = subscription?.options.applicationServerKey;
  const keyChanged = existingKey && (existingKey.byteLength !== publicKey.length || !new Uint8Array(existingKey).every((byte, i) => byte === publicKey[i]));
  if (subscription && (keyChanged || (explicit && renew))) {
    if (!explicit) return { ok: false, message: "알림 설정이 변경됐습니다. 이 기기에서 알림 받기를 다시 눌러 주세요." };
    await subscription.unsubscribe();
    if (await registration.pushManager.getSubscription()) throw new Error("기존 알림 구독을 갱신하지 못했습니다. 다시 시도해 주세요.");
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mode: explicit ? "register" : "refresh", previousEndpoint, subscription: subscription.toJSON() }),
  });
  const result = await response.json() as { error?: string };
  if (response.status === 409) return { ok: false, message: result.error ?? "다른 기기가 알림 수신 기기로 등록되어 있습니다." };
  if (!response.ok) throw new Error(result.error ?? "알림 구독 저장에 실패했습니다.");
  try { localStorage.setItem(`andante:push:${userId}`, subscription.endpoint); } catch { /* Server registration remains valid. */ }
  return { ok: true, message: "이 기기에서 합주 알림을 받을 수 있어요." };
}
