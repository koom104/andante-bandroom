export const appTabs = ["booking", "suggestions", "calendar", "my", "team", "admin", "recap"] as const;
export type AppTab = typeof appTabs[number];

export function restoredTab(value: string | null): AppTab {
  return appTabs.includes(value as AppTab) ? value as AppTab : "booking";
}

export function isAccountChange(previousId: string | null, nextId: string | null) {
  return nextId !== null && previousId !== nextId;
}
