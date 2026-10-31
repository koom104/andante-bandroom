"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Appearance = "system" | "light" | "dark";
const key = "andante-appearance";
let volatileAppearance: Appearance | null = null;
function readAppearance(): Appearance {
  if (volatileAppearance) return volatileAppearance;
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}

function applyAppearance() {
  const preference = readAppearance();
  const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = dark ? "#000000" : "#f3f5f5";
  });
}

export function AppearanceSync() {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    applyAppearance();
    media.addEventListener("change", applyAppearance);
    window.addEventListener("storage", applyAppearance);
    window.addEventListener("andante-appearance", applyAppearance);
    return () => {
      media.removeEventListener("change", applyAppearance);
      window.removeEventListener("storage", applyAppearance);
      window.removeEventListener("andante-appearance", applyAppearance);
    };
  }, []);
  return null;
}

export function AppearanceSelector() {
  const [preference, setPreference] = useState<Appearance>("system");
  useEffect(() => {
    const sync = () => setPreference(readAppearance());
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return <div className="appearance-toggle" role="group" aria-label="화면 모드">
    {([{ id: "light", label: "라이트", Icon: Sun }, { id: "dark", label: "다크", Icon: Moon }, { id: "system", label: "자동", Icon: null }] as const).map(({ id, label, Icon }) => (
      <button key={id} type="button" aria-pressed={preference === id} aria-label={label} title={label}
        className="appearance-option"
        onClick={() => {
          setPreference(id);
          try { localStorage.setItem(key, id); } catch { volatileAppearance = id; }
          document.documentElement.dataset.theme = id === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : id;
          window.dispatchEvent(new Event("andante-appearance"));
        }}>
        {Icon ? <Icon size={15} aria-hidden="true" /> : <span aria-hidden="true">A</span>}
      </button>
    ))}
  </div>;
}
