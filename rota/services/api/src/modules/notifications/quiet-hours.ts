/**
 * =============================================================================
 * Rota API — Quiet Hours Evaluator
 * =============================================================================
 * AGENTS.md §3.4 (P-06):
 * Enforce quiet hours on the server, in the user's time zone, inside the
 * notification worker. Never rely on the device.
 * Only security events bypass quiet hours. Everything else waits.
 * =============================================================================
 */

export interface QuietHoursCheckResult {
  inQuietHours: boolean;
  nextQuietHoursEnd?: Date;
}

function parseTimeMinutes(timeStr: string): { hour: number; minute: number; totalMinutes: number } {
  const parts = timeStr.split(':');
  const hour = parseInt(parts[0] ?? '0', 10);
  const minute = parseInt(parts[1] ?? '0', 10);
  return {
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

/**
 * Converts a target local (year, month, day, hour, minute) in an IANA timezone
 * into the exact UTC Date object.
 */
function localToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const approx = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(approx);

  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  const tzYear = get('year');
  const tzMonth = get('month');
  const tzDay = get('day');
  const tzHour = get('hour');
  const tzMinute = get('minute');

  const tzAsUtc = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0);
  const diffMs = tzAsUtc - approx.getTime();
  return new Date(approx.getTime() - diffMs);
}

/**
 * Evaluates whether `now` is within the user's configured quiet hours
 * in the user's IANA timezone.
 */
export function evaluateQuietHours(params: {
  enabled: boolean;
  start: string | null;
  end: string | null;
  timezone: string;
  now?: Date;
}): QuietHoursCheckResult {
  if (!params.enabled || !params.start || !params.end) {
    return { inQuietHours: false };
  }

  const now = params.now ?? new Date();

  // Extract current local components in user's timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: params.timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  const localYear = get('year');
  const localMonth = get('month');
  const localDay = get('day');
  const localHour = get('hour');
  const localMinute = get('minute');
  const currentMinutes = localHour * 60 + localMinute;

  const startParsed = parseTimeMinutes(params.start);
  const endParsed = parseTimeMinutes(params.end);

  const isOvernight = startParsed.totalMinutes > endParsed.totalMinutes;

  let inQuietHours = false;
  let endDayOffset = 0;

  if (isOvernight) {
    // Overnight: e.g. 22:00 to 07:00
    if (currentMinutes >= startParsed.totalMinutes) {
      // It's after start (e.g. 23:00) -> in quiet hours, ends tomorrow morning
      inQuietHours = true;
      endDayOffset = 1;
    } else if (currentMinutes < endParsed.totalMinutes) {
      // It's before end in the early morning (e.g. 05:00) -> in quiet hours, ends today morning
      inQuietHours = true;
      endDayOffset = 0;
    }
  } else {
    // Same-day: e.g. 13:00 to 15:00
    if (currentMinutes >= startParsed.totalMinutes && currentMinutes < endParsed.totalMinutes) {
      inQuietHours = true;
      endDayOffset = 0;
    }
  }

  if (!inQuietHours) {
    return { inQuietHours: false };
  }

  // Calculate target calendar day for the end time
  const targetDate = new Date(Date.UTC(localYear, localMonth - 1, localDay + endDayOffset));
  const targetYear = targetDate.getUTCFullYear();
  const targetMonth = targetDate.getUTCMonth() + 1;
  const targetDay = targetDate.getUTCDate();

  const nextQuietHoursEnd = localToUtc(
    targetYear,
    targetMonth,
    targetDay,
    endParsed.hour,
    endParsed.minute,
    params.timezone
  );

  return {
    inQuietHours: true,
    nextQuietHoursEnd,
  };
}
