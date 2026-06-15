export const APPOINTMENT_COLORS = ['red', 'blue', 'green', 'yellow'] as const;
export type AppointmentColor = (typeof APPOINTMENT_COLORS)[number];

export const DEFAULT_BUSINESS_START = '09:00';
export const DEFAULT_BUSINESS_END = '18:00';
export const DEFAULT_SLOT_MINUTES = 30;

export function isValidAppointmentColor(color: string): color is AppointmentColor {
  return (APPOINTMENT_COLORS as readonly string[]).includes(color);
}

export function parseLocalDateTime(date: string, time?: string): Date | null {
  if (!date) return null;
  const normalizedTime = time || '00:00';
  const d = new Date(`${date}T${normalizedTime}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getAppointmentEnd(start: Date, durationMinutes: number): Date {
  return new Date(start.getTime() + durationMinutes * 60_000);
}

export function appointmentsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatTimeLocal(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function generateDaySlots(
  date: string,
  durationMinutes: number,
  businessStart = DEFAULT_BUSINESS_START,
  businessEnd = DEFAULT_BUSINESS_END,
  stepMinutes = DEFAULT_SLOT_MINUTES
): Array<{ start: string; end: string; startDate: Date; endDate: Date }> {
  const slots: Array<{ start: string; end: string; startDate: Date; endDate: Date }> = [];
  const dayStart = parseLocalDateTime(date, businessStart);
  const dayEnd = parseLocalDateTime(date, businessEnd);
  if (!dayStart || !dayEnd) return slots;

  let cursor = new Date(dayStart);
  while (cursor < dayEnd) {
    const slotEnd = getAppointmentEnd(cursor, durationMinutes);
    if (slotEnd > dayEnd) break;
    slots.push({
      start: formatTimeLocal(cursor),
      end: formatTimeLocal(slotEnd),
      startDate: new Date(cursor),
      endDate: slotEnd,
    });
    cursor = new Date(cursor.getTime() + stepMinutes * 60_000);
  }
  return slots;
}

export function findConflicts(
  appointments: Array<{ appointment_date: string; duration_minutes: number; id?: string }>,
  start: Date,
  end: Date,
  excludeId?: string
) {
  return appointments.filter((appt) => {
    if (excludeId && appt.id === excludeId) return false;
    const apptStart = new Date(appt.appointment_date);
    const apptEnd = getAppointmentEnd(apptStart, appt.duration_minutes || 30);
    return appointmentsOverlap(start, end, apptStart, apptEnd);
  });
}
