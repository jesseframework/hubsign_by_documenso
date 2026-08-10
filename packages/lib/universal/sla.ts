/**
 * Business-hours SLA clock.
 *
 * Turnaround targets are stated in *working* hours, not elapsed hours: an
 * invoice arriving 4pm Friday against an 8-hour target is not late by Monday
 * morning. So every calculation here walks the working calendar — the
 * organization's working days, daily window, timezone, and holidays — rather
 * than doing arithmetic on wall-clock time.
 *
 * Pure and timezone-explicit so it can be reasoned about and tested directly.
 */

import { DateTime } from 'luxon';

export type SlaCalendar = {
  /** IANA zone the working day is expressed in. */
  timezone: string;
  /** ISO weekdays that count as working days: 1 = Monday … 7 = Sunday. */
  workingDays: number[];
  /** Local start of the working day, "HH:mm". */
  workdayStart: string;
  /** Local end of the working day, "HH:mm". */
  workdayEnd: string;
  /** "yyyy-MM-dd" dates treated as non-working regardless of weekday. */
  holidays: string[];
};

export const DEFAULT_SLA_CALENDAR: SlaCalendar = {
  timezone: 'UTC',
  workingDays: [1, 2, 3, 4, 5],
  workdayStart: '09:00',
  workdayEnd: '17:00',
  holidays: [],
};

const parseHhMm = (value: string, fallback: { hour: number; minute: number }) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());

  if (!match) {
    return fallback;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }

  return { hour, minute };
};

/**
 * Normalise possibly-bad stored config into something safe to compute with.
 *
 * A misconfigured calendar must not make the engine loop forever or divide by
 * zero, so an empty working week falls back to Mon–Fri and a non-positive day
 * length falls back to 09:00–17:00.
 */
export const normalizeCalendar = (calendar: Partial<SlaCalendar> | null | undefined): SlaCalendar => {
  const source = { ...DEFAULT_SLA_CALENDAR, ...(calendar ?? {}) };

  const workingDays = [...new Set(source.workingDays.filter((d) => d >= 1 && d <= 7))].sort();
  const start = parseHhMm(source.workdayStart, { hour: 9, minute: 0 });
  const end = parseHhMm(source.workdayEnd, { hour: 17, minute: 0 });

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;

  return {
    timezone: DateTime.local().setZone(source.timezone).isValid ? source.timezone : 'UTC',
    workingDays: workingDays.length ? workingDays : [...DEFAULT_SLA_CALENDAR.workingDays],
    workdayStart: endMinutes > startMinutes ? source.workdayStart : DEFAULT_SLA_CALENDAR.workdayStart,
    workdayEnd: endMinutes > startMinutes ? source.workdayEnd : DEFAULT_SLA_CALENDAR.workdayEnd,
    holidays: source.holidays.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
  };
};

type Bounds = { open: DateTime; close: DateTime };

const isWorkingDay = (day: DateTime, calendar: SlaCalendar): boolean =>
  calendar.workingDays.includes(day.weekday) && !calendar.holidays.includes(day.toFormat('yyyy-MM-dd'));

/** The open/close instants of the working window on `day`'s date. */
const boundsFor = (day: DateTime, calendar: SlaCalendar): Bounds => {
  const start = parseHhMm(calendar.workdayStart, { hour: 9, minute: 0 });
  const end = parseHhMm(calendar.workdayEnd, { hour: 17, minute: 0 });

  return {
    open: day.set({ ...start, second: 0, millisecond: 0 }),
    close: day.set({ ...end, second: 0, millisecond: 0 }),
  };
};

/**
 * The first working instant at or after `from`. If `from` lands mid-window it
 * is returned unchanged; before opening it jumps to today's open; after close
 * (or on a non-working day) it jumps to the next working day's open.
 */
const nextWorkingInstant = (from: DateTime, calendar: SlaCalendar): DateTime => {
  let cursor = from;

  // Bounded rather than `while (true)`: a calendar where every day is a holiday
  // would otherwise spin forever. A year of lookahead is far past useful.
  for (let i = 0; i < 366; i += 1) {
    if (isWorkingDay(cursor, calendar)) {
      const { open, close } = boundsFor(cursor, calendar);

      if (cursor < open) return open;
      if (cursor < close) return cursor;
    }

    cursor = cursor.plus({ days: 1 }).startOf('day');
  }

  return from;
};

/**
 * Business minutes elapsed between two instants. Never negative; time outside
 * the working window contributes nothing.
 */
export const businessMinutesBetween = (
  startAt: Date,
  endAt: Date,
  calendar: SlaCalendar,
): number => {
  const config = normalizeCalendar(calendar);
  const zone = config.timezone;

  let cursor = DateTime.fromJSDate(startAt, { zone });
  const end = DateTime.fromJSDate(endAt, { zone });

  if (!cursor.isValid || !end.isValid || end <= cursor) {
    return 0;
  }

  let minutes = 0;

  for (let i = 0; i < 3660 && cursor < end; i += 1) {
    if (!isWorkingDay(cursor, config)) {
      cursor = cursor.plus({ days: 1 }).startOf('day');
      continue;
    }

    const { open, close } = boundsFor(cursor, config);
    const from = cursor < open ? open : cursor;
    const to = end < close ? end : close;

    if (to > from) {
      minutes += to.diff(from, 'minutes').minutes;
    }

    cursor = cursor.plus({ days: 1 }).startOf('day');
  }

  return Math.round(minutes);
};

/**
 * The instant `hours` business hours after `startAt` — the SLA due date.
 *
 * A target set from outside working time starts counting at the next open,
 * so an invoice arriving Saturday is due relative to Monday morning.
 */
export const addBusinessHours = (startAt: Date, hours: number, calendar: SlaCalendar): Date => {
  const config = normalizeCalendar(calendar);
  const zone = config.timezone;

  let cursor = nextWorkingInstant(DateTime.fromJSDate(startAt, { zone }), config);
  let remaining = Math.max(0, hours) * 60;

  if (remaining === 0) {
    return cursor.toJSDate();
  }

  for (let i = 0; i < 3660 && remaining > 0; i += 1) {
    const { close } = boundsFor(cursor, config);
    const availableToday = close.diff(cursor, 'minutes').minutes;

    if (remaining <= availableToday) {
      return cursor.plus({ minutes: remaining }).toJSDate();
    }

    remaining -= availableToday;
    cursor = nextWorkingInstant(cursor.plus({ days: 1 }).startOf('day'), config);
  }

  return cursor.toJSDate();
};

export type SlaState = 'on-track' | 'at-risk' | 'met' | 'breached' | 'untracked';

/**
 * Fraction of the target already consumed past which an unfinished item is
 * called "at risk" — early enough to act on, late enough not to cry wolf.
 */
export const AT_RISK_THRESHOLD = 0.8;

export type SlaEvaluation = {
  state: SlaState;
  /** Business minutes consumed: to completion if finished, else to `now`. */
  elapsedMinutes: number;
  /** The target in business minutes. */
  targetMinutes: number;
  /** When the clock runs out. */
  dueAt: Date | null;
  /** Portion of the target used; can exceed 1 when breached. */
  ratio: number;
};

/**
 * Evaluate one leg of an SLA.
 *
 * `completedAt` null means still running, so the clock is measured to `now` and
 * the item can only be on-track, at-risk, or already breached — never "met".
 */
export const evaluateSla = ({
  startedAt,
  completedAt,
  targetHours,
  calendar,
  now,
}: {
  startedAt: Date;
  completedAt: Date | null;
  targetHours: number | null;
  calendar: SlaCalendar;
  now: Date;
}): SlaEvaluation => {
  if (!targetHours || targetHours <= 0) {
    return { state: 'untracked', elapsedMinutes: 0, targetMinutes: 0, dueAt: null, ratio: 0 };
  }

  const config = normalizeCalendar(calendar);
  const targetMinutes = targetHours * 60;
  const dueAt = addBusinessHours(startedAt, targetHours, config);
  const elapsedMinutes = businessMinutesBetween(startedAt, completedAt ?? now, config);
  const ratio = elapsedMinutes / targetMinutes;

  if (completedAt) {
    return {
      state: elapsedMinutes <= targetMinutes ? 'met' : 'breached',
      elapsedMinutes,
      targetMinutes,
      dueAt,
      ratio,
    };
  }

  return {
    state: ratio >= 1 ? 'breached' : ratio >= AT_RISK_THRESHOLD ? 'at-risk' : 'on-track',
    elapsedMinutes,
    targetMinutes,
    dueAt,
    ratio,
  };
};

/** "2h 15m" / "3d 4h" (working days of the configured length). */
export const formatBusinessMinutes = (minutes: number, calendar: SlaCalendar): string => {
  const config = normalizeCalendar(calendar);
  const start = parseHhMm(config.workdayStart, { hour: 9, minute: 0 });
  const end = parseHhMm(config.workdayEnd, { hour: 17, minute: 0 });
  const dayMinutes = end.hour * 60 + end.minute - (start.hour * 60 + start.minute);

  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }

  if (minutes < dayMinutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  const days = Math.floor(minutes / dayMinutes);
  const h = Math.round((minutes % dayMinutes) / 60);
  return h ? `${days}d ${h}h` : `${days}d`;
};
