import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BandRoom AI",
  description: "밴드부 팀 합주실 예약과 AI 시간 추천 웹앱",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
