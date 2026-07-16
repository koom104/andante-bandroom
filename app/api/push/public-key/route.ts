import { NextResponse } from "next/server";

export async function GET() {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY ?? "";

  if (!publicKey) {
    return NextResponse.json({ error: "WEB_PUSH_PUBLIC_KEY가 서버 환경변수에 없습니다." }, { status: 500 });
  }

  return NextResponse.json({ publicKey });
}
