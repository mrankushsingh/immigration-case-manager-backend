export const TEAM_MEMBERS = ['YONA', 'LEDJANA', 'CAROLINA', 'MILAGROS', 'YUSTI'] as const;
export type TeamMemberName = (typeof TEAM_MEMBERS)[number];

export function isTeamMemberName(value: string): value is TeamMemberName {
  return (TEAM_MEMBERS as readonly string[]).includes(value);
}

/** Returns normalized member name, null to clear, or undefined if input was undefined. */
export function normalizeAssignedTeamMember(
  value: unknown
): TeamMemberName | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const u = String(value).trim().toUpperCase();
  if (!isTeamMemberName(u)) {
    throw new Error(`Invalid team member. Must be one of: ${TEAM_MEMBERS.join(', ')}`);
  }
  return u;
}
