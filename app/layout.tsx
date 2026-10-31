import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./liquid-workspace.css";
import "./system-theme.css";
import { AppearanceSync } from "./appearance";

const appearanceBootstrap = `(function(){try{var p=localStorage.getItem('andante-appearance');document.documentElement.dataset.theme=(p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))?'dark':'light'}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}})();`;

export const metadata: Metadata = {
  title: "Andante",
  description: "밴드부 팀 합주 예약과 AI 시간 추천 웹앱",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f5" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} /></head>
      <body><AppearanceSync />{children}</body>
    </html>
  );
}
