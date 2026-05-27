/**
 * Dependency-free cron parser for SCHEDULE-triggered workflows.
 *
 * Supports the standard 5-field format: `minute hour day-of-month month
 * day-of-week`, with `*`, ranges (`a-b`), steps (`*\/n`, `a-b/n`, `a/n`) and
 * lists (`a,b,c`). Day-of-week accepts 0 or 7 for Sunday. Following crontab
 * semantics, when BOTH day-of-month and day-of-week are restricted a day matches
 * if EITHER matches.
 *
 * Timezone handling is delegated to luxon (already a dependency) so schedules
 * fire correctly across DST. Named months/weekdays and special tokens (`L`, `#`,
 * `@hourly`, ...) are intentionally not supported.
 */

import { DateTime } from 'luxon';

type Field = { set: Set<number>; star: boolean };

const parseField = (raw: string, min: number, max: number): Field => {
  const field = raw.trim();
  const star = field === '*' || field.startsWith('*/');
  const set = new Set<number>();

  const addRange = (lo: number, hi: number, step: number) => {
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) set.add(v);
    }
  };

  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;

    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step in "${raw}"`);
    }

    if (rangePart === '*') {
      addRange(min, max, step);
    } else if (rangePart.includes('-')) {
      const [lo, hi] = rangePart.split('-').map(Number);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        throw new Error(`Invalid cron range in "${raw}"`);
      }
      addRange(lo, hi, step);
    } else {
      const value = Number(rangePart);
      if (!Number.isInteger(value)) {
        throw new Error(`Invalid cron value in "${raw}"`);
      }
      if (stepPart) {
        addRange(value, max, step);
      } else {
        set.add(value);
      }
    }
  }

  if (set.size === 0) {
    throw new Error(`Cron field "${raw}" matches nothing`);
  }

  return { set, star };
};

type ParsedCron = {
  minute: Field;
  hour: Field;
  dayOfMonth: Field;
  month: Field;
  dayOfWeek: Field;
};

export const parseCron = (expression: string): ParsedCron => {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${parts.length}: "${expression}"`);
  }

  const dayOfWeek = parseField(parts[4], 0, 7);
  // Normalise Sunday (7 -> 0) so it matches luxon's weekday conversion below.
  if (dayOfWeek.set.has(7)) {
    dayOfWeek.set.add(0);
    dayOfWeek.set.delete(7);
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek,
  };
};

/** Validate a cron expression, returning true if parseable. */
export const isValidCron = (expression: string): boolean => {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
};

const MAX_ITERATIONS = 100_000;

/**
 * Compute the next fire time strictly after `from` for a cron expression in the
 * given IANA timezone. Returns null if no match is found within ~4 years.
 */
export const getNextCronRun = (
  expression: string,
  from: Date = new Date(),
  zone = 'UTC',
): Date | null => {
  const cron = parseCron(expression);

  let dt = DateTime.fromJSDate(from, { zone })
    .plus({ minutes: 1 })
    .set({ second: 0, millisecond: 0 });

  if (!dt.isValid) {
    return null;
  }

  const domRestricted = !cron.dayOfMonth.star;
  const dowRestricted = !cron.dayOfWeek.star;

  const dayMatches = (candidate: DateTime): boolean => {
    const domOk = cron.dayOfMonth.set.has(candidate.day);
    const dowOk = cron.dayOfWeek.set.has(candidate.weekday % 7); // luxon: 1=Mon..7=Sun

    if (domRestricted && dowRestricted) return domOk || dowOk;
    if (domRestricted) return domOk;
    if (dowRestricted) return dowOk;
    return true;
  };

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    if (!cron.month.set.has(dt.month)) {
      dt = dt.plus({ months: 1 }).set({ day: 1, hour: 0, minute: 0 });
      continue;
    }
    if (!dayMatches(dt)) {
      dt = dt.plus({ days: 1 }).set({ hour: 0, minute: 0 });
      continue;
    }
    if (!cron.hour.set.has(dt.hour)) {
      dt = dt.plus({ hours: 1 }).set({ minute: 0 });
      continue;
    }
    if (!cron.minute.set.has(dt.minute)) {
      dt = dt.plus({ minutes: 1 });
      continue;
    }
    return dt.toJSDate();
  }

  return null;
};
