export type DateScheduleDrafts = Record<string, string[]>;

export function updateDateScheduleDraft(
  drafts: DateScheduleDrafts,
  date: string,
  saved: string[],
  update: (current: string[]) => string[],
): DateScheduleDrafts {
  const next = update(drafts[date] ?? saved);
  const savedSet = new Set(saved);
  if (next.length === savedSet.size && next.every((key) => savedSet.has(key))) {
    const remaining = { ...drafts };
    delete remaining[date];
    return remaining;
  }
  return { ...drafts, [date]: next };
}

export function buildDateScheduleRows(
  drafts: DateScheduleDrafts,
  userId: string,
  updatedBy: string,
  times: string[],
  updatedAt: string,
) {
  return Object.entries(drafts).flatMap(([date, keys]) => {
    const busy = new Set(keys);
    return times.map((time) => ({
      user_id: userId,
      schedule_date: date,
      start_time: time,
      is_busy: busy.has(`${date}-${time}`),
      updated_by: updatedBy,
      updated_at: updatedAt,
    }));
  });
}
