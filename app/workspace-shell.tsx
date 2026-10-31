"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { CalendarDays, CalendarPlus, Disc3, House, Settings, UserRound, Users } from "lucide-react";
import { AppInfoTrigger } from "./app-info";

export type WorkspaceTab = "booking" | "calendar" | "suggestions" | "my" | "team" | "admin" | "recap";

export const workspaceTitles: Record<WorkspaceTab, string> = {
  booking: "홈", calendar: "캘린더", suggestions: "합주 예약",
  my: "마이페이지", team: "팀", admin: "관리자", recap: "리캡",
};
const icons = { booking: House, calendar: CalendarDays, suggestions: CalendarPlus, my: UserRound, team: Users, admin: Settings, recap: Disc3 };

export function WorkspaceShell({ header, children, tabs, activeTab, onChangeTab, hideNavigation = false }: {
  header: ReactNode;
  children: ReactNode;
  tabs: Array<{ id: WorkspaceTab; label: string; short: string }>;
  activeTab: WorkspaceTab;
  onChangeTab: (tab: WorkspaceTab) => void;
  hideNavigation?: boolean;
}) {
  const shellRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const headerElement = headerRef.current;
    if (!headerElement) return;
    const measure = () => shellRef.current?.style.setProperty("--workspace-header-height", `${headerElement.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(headerElement);
    return () => observer.disconnect();
  }, []);
  return (
    <main className="app-viewport workspace-viewport liquid-workspace bg-[#fff8f4] text-slate-950 sm:bg-[#f9ebe6] sm:px-6 sm:py-5">
      <div className="workspace-frame mx-auto flex h-full max-w-6xl items-center justify-center">
        <section ref={shellRef} className="workspace-shell typography-balanced relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-[#fff8f4] shadow-sm">
          <div ref={headerRef} className="workspace-header-layer">{header}</div>
          <div className={`workspace-content app-scroll flex-1 overflow-y-auto px-4 pt-3 ${activeTab === "recap" ? "recap-content" : ""} ${hideNavigation ? "app-scroll-keyboard" : ""}`} id="workspace-content">
            {children}
          </div>
          <div className={`workspace-navigation app-tabbar absolute inset-x-0 bottom-0 border-t border-[#f0ded7] bg-[#fff8f4]/95 px-4 pt-3 backdrop-blur ${hideNavigation ? "mobile-nav-hidden" : ""}`}>
            <div className="workspace-brand">
              <img src="/icon-192.png" alt="" width={36} height={36} />
              <div><AppInfoTrigger className="workspace-brand-trigger" /><span>합주 일정 관리</span></div>
            </div>
            <nav className="workspace-nav-grid grid gap-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, "--tab-count": tabs.length, "--active-index": Math.max(0, tabs.findIndex((tab) => tab.id === activeTab)) } as CSSProperties} aria-label="앱 탭">
              <span className="workspace-nav-lens" aria-hidden="true" />
              {tabs.map((tab) => {
                const Icon = icons[tab.id];
                return (
                  <button key={tab.id} type="button" onClick={() => onChangeTab(tab.id)} aria-current={activeTab === tab.id ? "page" : undefined}
                    className={`workspace-nav-item flex h-12 flex-col items-center justify-center rounded-lg text-xs font-semibold transition ${activeTab === tab.id ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-[#f7e8e1]"}`}>
                    <Icon className="workspace-nav-icon" size={19} aria-hidden="true" />
                    <span className="workspace-mobile-label">{tab.label}</span>
                    <span className="workspace-desktop-label">{workspaceTitles[tab.id]}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </section>
      </div>
    </main>
  );
}
