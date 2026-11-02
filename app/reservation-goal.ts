export function reservationDisplayGoal(currentGoal: string | null | undefined, bookedGoal: string | null | undefined,
  sourceType = "booking", bookingType = "rehearsal"): string {
  const current = currentGoal?.trim() ?? "";
  const booked = bookedGoal?.trim() ?? "";
  if (bookingType === "room_block") return booked || "사용 제한";
  // Imported history keeps the original performance context for past records.
  if (sourceType === "notion_history") return booked || current;
  return current || booked;
}
