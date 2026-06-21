export const DEFAULT_TEAM_MEMBERS = ['YONA', 'LEDJANA', 'CAROLINA', 'MILAGROS', 'YUSTI'] as const;
export const TEAM_MEMBERS_SETTINGS_KEY = 'team_members';

export function normalizeMemberInput(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/** Returns normalized name or null if invalid. */
export function validateMemberName(raw: string): string | null {
  const name = normalizeMemberInput(raw);
  if (!name || name.length > 50) return null;
  if (!/^[A-Z0-9][A-Z0-9\s'.-]*$/.test(name)) return null;
  return name;
}

export function parseTeamMembersSetting(raw: string | null | undefined): string[] {
  if (!raw) return [...DEFAULT_TEAM_MEMBERS];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_TEAM_MEMBERS];
    const members = [
      ...new Set(
        parsed
          .map((entry) => validateMemberName(String(entry)))
          .filter((entry): entry is string => !!entry)
      ),
    ];
    return members.length > 0 ? members : [...DEFAULT_TEAM_MEMBERS];
  } catch {
    return [...DEFAULT_TEAM_MEMBERS];
  }
}

export function isAllowedTeamMember(name: string, allowed: readonly string[]): boolean {
  const normalized = normalizeMemberInput(name);
  return allowed.includes(normalized);
}

/** Returns normalized member name, null to clear, or undefined if input was undefined. */
export function normalizeAssignedTeamMember(
  value: unknown,
  allowed: readonly string[]
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const u = normalizeMemberInput(String(value));
  if (!allowed.includes(u)) {
    throw new Error(`Invalid team member. Must be one of: ${allowed.join(', ')}`);
  }
  return u;
}
