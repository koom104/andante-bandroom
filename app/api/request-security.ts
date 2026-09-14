import { NextRequest, NextResponse } from "next/server";

export function rejectCrossOriginMutation(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (!origin || origin === request.nextUrl.origin) {
    return null;
  }

  return NextResponse.json(
    { error: "허용되지 않은 요청 출처입니다." },
    {
      status: 403,
      headers: { "cache-control": "no-store" },
    },
  );
}
