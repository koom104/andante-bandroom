export const sessionDisplayOrder = ["보컬", "리드기타", "리듬기타", "어쿠스틱", "베이스", "드럼", "피아노", "신디"] as const;

const roleRanks = new Map<string, number>(sessionDisplayOrder.map((role, index) => [role, index]));
for (const [alias, role] of [["일렉 리드", "리드기타"], ["일렉 리듬", "리듬기타"], ["세컨기타", "리듬기타"], ["통기타", "어쿠스틱"], ["건반", "피아노"]]) {
  roleRanks.set(alias, roleRanks.get(role)!);
}

export function sortTeamMembersBySession<T extends { role: string }>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => (roleRanks.get(a.role) ?? 99) - (roleRanks.get(b.role) ?? 99));
}
