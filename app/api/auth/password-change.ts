export async function changeRequiredPassword(
  updatePassword: () => Promise<boolean>,
  clearRequirement: () => Promise<boolean>,
): Promise<"ok" | "password_failed" | "completion_failed"> {
  if (!(await updatePassword())) return "password_failed";
  if (!(await clearRequirement())) return "completion_failed";
  return "ok";
}
