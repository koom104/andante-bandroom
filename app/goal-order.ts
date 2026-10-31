// Newer performances appear first; the oldest goal stays at the bottom.
const performanceOrder = ["가을공연", "가을축제", "동연제", "여름공연", "봄공연", "대동제"];

export function sortGoalCategories<T extends { name: string }>(categories: readonly T[]): T[] {
  const rank = (name: string) => {
    const normalized = name.normalize("NFKC").replace(/\s+/gu, "");
    const index = performanceOrder.findIndex((goal) => normalized === goal || normalized.startsWith(`${goal}(`));
    return index < 0 ? -1 : index;
  };
  return [...categories].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, "ko"));
}
