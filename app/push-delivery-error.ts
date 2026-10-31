export function pushDeliveryError(status: number | null, reason?: string) {
  if (reason === "VapidPkHashMismatch") return {
    code: "PUSH_KEY_MISMATCH", status: 409,
    error: "등록된 기기의 알림 인증키가 현재 서버 설정과 다릅니다. ‘이 기기에서 알림 받기’를 눌러 새 구독으로 교체해 주세요.",
  };
  if (status === 404 || status === 410) return {
    code: "PUSH_SUBSCRIPTION_EXPIRED", status: 410,
    error: "이 기기의 알림 구독이 만료됐습니다. ‘이 기기에서 알림 받기’를 눌러 새로 등록한 뒤 다시 테스트해 주세요.",
  };
  if (status === 401 || status === 403) return {
    code: "PUSH_AUTH_REJECTED", status: 502,
    error: "푸시 서버가 발송 인증을 거절했습니다. 브라우저 알림 권한 문제가 아닌 서버 인증 설정 확인이 필요합니다.",
  };
  if (status === 429) return {
    code: "PUSH_RATE_LIMITED", status: 429,
    error: "푸시 서버의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
  };
  if (status === 400 || status === 413) return {
    code: "PUSH_PAYLOAD_REJECTED", status: 502,
    error: "푸시 서버가 알림 데이터를 거절했습니다. 서버의 구독·메시지 형식을 확인해야 합니다.",
  };
  return {
    code: status === null ? "PUSH_REQUEST_FAILED" : "PUSH_PROVIDER_UNAVAILABLE", status: 503,
    error: "푸시 발송 서버에 연결하지 못했거나 알림 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  };
}
