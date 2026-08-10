import { describe, expect, it } from 'vitest';

import {
  type SlaCalendar,
  addBusinessHours,
  businessMinutesBetween,
  evaluateSla,
  formatBusinessMinutes,
  normalizeCalendar,
} from './sla';

/**
 * The business-hours clock underneath every number on the SLA dashboard.
 *
 * Two classes of case are load-bearing here and should not be quietly relaxed:
 *
 *   - The `settled` flag. "Breached" alone does not distinguish an invoice still
 *     sitting unsent past its target from one that was sent, just sent late. The
 *     dashboard counted both as work outstanding and told the user that finished,
 *     fully-signed invoices "will miss without action".
 *   - The calendar fallbacks. These are fed straight from nullable columns, and a
 *     calendar that throws does not surface as an error — the SLA page catches the
 *     failed query and renders "SLA tracking is off" to an organization that has it
 *     switched on.
 */

/** Mon–Fri, 09:00–17:00 UTC. 480 working minutes per day. */
const CAL: SlaCalendar = {
  timezone: 'UTC',
  workingDays: [1, 2, 3, 4, 5],
  workdayStart: '09:00',
  workdayEnd: '17:00',
  holidays: [],
};

// 2026-01-05 is a Monday.
const at = (iso: string) => new Date(`${iso}Z`);
const MON = '2026-01-05T';
const TUE = '2026-01-06T';
const WED = '2026-01-07T';
const FRI = '2026-01-09T';
const SAT = '2026-01-10T';
const NEXT_MON = '2026-01-12T';

describe('businessMinutesBetween', () => {
  it('counts only time inside the working window', () => {
    expect(businessMinutesBetween(at(`${MON}10:00:00`), at(`${MON}12:00:00`), CAL)).toBe(120);
    // Starts before opening: the hour before 09:00 does not count.
    expect(businessMinutesBetween(at(`${MON}08:00:00`), at(`${MON}10:00:00`), CAL)).toBe(60);
    // Spans a closing: 16:00–17:00 plus 09:00–10:00.
    expect(businessMinutesBetween(at(`${MON}16:00:00`), at(`${TUE}10:00:00`), CAL)).toBe(120);
  });

  it('skips weekends', () => {
    expect(businessMinutesBetween(at(`${FRI}16:00:00`), at(`${NEXT_MON}10:00:00`), CAL)).toBe(120);
    expect(businessMinutesBetween(at(`${SAT}10:00:00`), at(`${SAT}12:00:00`), CAL)).toBe(0);
  });

  it('skips configured holidays', () => {
    const withHoliday = { ...CAL, holidays: ['2026-01-06'] };
    // Mon 16:00 → Wed 10:00 would be 120 minutes, but Tuesday is a holiday.
    expect(businessMinutesBetween(at(`${MON}16:00:00`), at(`${WED}10:00:00`), withHoliday)).toBe(120);
    expect(businessMinutesBetween(at(`${TUE}09:00:00`), at(`${TUE}17:00:00`), withHoliday)).toBe(0);
  });

  it('is never negative', () => {
    expect(businessMinutesBetween(at(`${TUE}10:00:00`), at(`${MON}10:00:00`), CAL)).toBe(0);
    expect(businessMinutesBetween(at(`${MON}10:00:00`), at(`${MON}10:00:00`), CAL)).toBe(0);
  });

  it('measures a working day as its wall-clock length across a DST transition', () => {
    // US clocks jump forward on 2026-03-08. A 09:00–17:00 day is still 8 hours
    // on each side of it, which is what a turnaround target means.
    const ny: SlaCalendar = { ...CAL, timezone: 'America/New_York' };
    const friBeforeDst = new Date('2026-03-06T21:00:00Z'); // Fri 16:00 EST
    const monAfterDst = new Date('2026-03-09T14:00:00Z'); // Mon 10:00 EDT
    expect(businessMinutesBetween(friBeforeDst, monAfterDst, ny)).toBe(120);
  });

  it('terminates on a calendar with no working time at all', () => {
    const noDays = normalizeCalendar({ ...CAL, workingDays: [6] , holidays: ['2026-01-10'] });
    expect(businessMinutesBetween(at(`${MON}09:00:00`), at('2026-06-01T09:00:00'), noDays)).toBeGreaterThanOrEqual(0);
  });
});

describe('addBusinessHours', () => {
  it('adds within a single day', () => {
    expect(addBusinessHours(at(`${MON}10:00:00`), 2, CAL).toISOString()).toBe(`${MON}12:00:00.000Z`);
  });

  it('rolls over the end of the day', () => {
    // One hour left on Monday, one hour into Tuesday.
    expect(addBusinessHours(at(`${MON}16:00:00`), 2, CAL).toISOString()).toBe(`${TUE}10:00:00.000Z`);
  });

  it('starts counting at the next opening when the clock starts outside hours', () => {
    expect(addBusinessHours(at(`${MON}07:00:00`), 1, CAL).toISOString()).toBe(`${MON}10:00:00.000Z`);
    expect(addBusinessHours(at(`${SAT}10:00:00`), 1, CAL).toISOString()).toBe(`${NEXT_MON}10:00:00.000Z`);
  });

  it('carries a target across a weekend', () => {
    // Friday 16:00 + 8 working hours: 1h on Friday, then 7h from Monday 09:00.
    expect(addBusinessHours(at(`${FRI}16:00:00`), 8, CAL).toISOString()).toBe(`${NEXT_MON}16:00:00.000Z`);
  });

  it('steps over a holiday', () => {
    const withHoliday = { ...CAL, holidays: ['2026-01-06'] };
    expect(addBusinessHours(at(`${MON}16:00:00`), 2, withHoliday).toISOString()).toBe(
      `${WED}10:00:00.000Z`,
    );
  });
});

describe('evaluateSla', () => {
  const target = 8; // 480 business minutes

  it('marks finished-on-time work met, and settled', () => {
    const result = evaluateSla({
      startedAt: at(`${MON}09:00:00`),
      completedAt: at(`${MON}15:00:00`),
      targetHours: target,
      calendar: CAL,
      now: at(`${TUE}09:00:00`),
    });
    expect(result.state).toBe('met');
    expect(result.elapsedMinutes).toBe(360);
    expect(result.settled).toBe(true);
  });

  it('marks finished-late work breached, but SETTLED — it is history, not a to-do', () => {
    const result = evaluateSla({
      startedAt: at(`${MON}09:00:00`),
      completedAt: at(`${TUE}10:00:00`),
      targetHours: target,
      calendar: CAL,
      now: at(`${WED}09:00:00`),
    });
    expect(result.state).toBe('breached');
    expect(result.elapsedMinutes).toBe(540);
    // The distinction the "will miss without action" tile depends on.
    expect(result.settled).toBe(true);
  });

  it('marks still-running late work breached and NOT settled', () => {
    const result = evaluateSla({
      startedAt: at(`${MON}09:00:00`),
      completedAt: null,
      targetHours: target,
      calendar: CAL,
      now: at(`${TUE}10:00:00`),
    });
    expect(result.state).toBe('breached');
    expect(result.settled).toBe(false);
  });

  it('walks on-track → at-risk as the clock runs down', () => {
    const running = (now: string) =>
      evaluateSla({
        startedAt: at(`${MON}09:00:00`),
        completedAt: null,
        targetHours: target,
        calendar: CAL,
        now: at(now),
      });

    expect(running(`${MON}15:00:00`).state).toBe('on-track'); // 360/480 = 0.75
    expect(running(`${MON}16:00:00`).state).toBe('at-risk'); // 420/480 = 0.875
  });

  it('never calls unfinished work met, however little time has passed', () => {
    const result = evaluateSla({
      startedAt: at(`${SAT}10:00:00`),
      completedAt: null,
      targetHours: target,
      calendar: CAL,
      now: at(`${SAT}12:00:00`),
    });
    expect(result.elapsedMinutes).toBe(0);
    expect(result.state).toBe('on-track');
  });

  it('is untracked without a usable target', () => {
    for (const targetHours of [null, 0, -5]) {
      const result = evaluateSla({
        startedAt: at(`${MON}09:00:00`),
        completedAt: null,
        targetHours,
        calendar: CAL,
        now: at(`${FRI}09:00:00`),
      });
      expect(result.state).toBe('untracked');
      expect(result.dueAt).toBeNull();
    }
  });
});

describe('normalizeCalendar', () => {
  /**
   * These are regressions, not hypotheticals. `calendarFromOrg` maps nullable
   * columns onto this shape, and an object spread let an explicit `undefined`
   * overwrite the default — so de-selecting every working day in Settings threw
   * inside `.filter`, the slaStats query 500'd, and the page told the user SLA
   * tracking was off while it was on.
   */
  it('survives an empty or missing working week', () => {
    expect(normalizeCalendar({ workingDays: [] }).workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(normalizeCalendar({ workingDays: undefined }).workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(normalizeCalendar({}).workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(normalizeCalendar(null).workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('survives missing day bounds', () => {
    expect(normalizeCalendar({ workdayStart: undefined }).workdayStart).toBe('09:00');
    expect(normalizeCalendar({ workdayEnd: undefined }).workdayEnd).toBe('17:00');
    expect(normalizeCalendar({ holidays: undefined }).holidays).toEqual([]);
  });

  it('falls back to UTC for an unrecognised time zone', () => {
    expect(normalizeCalendar({ timezone: 'America/Kingstn' }).timezone).toBe('UTC');
    expect(normalizeCalendar({ timezone: 'America/Jamaica' }).timezone).toBe('America/Jamaica');
  });

  it('rejects a working day that ends before it starts', () => {
    const inverted = normalizeCalendar({ workdayStart: '22:00', workdayEnd: '06:00' });
    expect(inverted.workdayStart).toBe('09:00');
    expect(inverted.workdayEnd).toBe('17:00');
  });

  it('drops malformed holiday entries rather than matching them', () => {
    expect(normalizeCalendar({ holidays: ['2026-01-06', 'christmas', ''] }).holidays).toEqual([
      '2026-01-06',
    ]);
  });

  it('de-duplicates and sorts the working week', () => {
    expect(normalizeCalendar({ workingDays: [5, 1, 5, 9, 0, 3] }).workingDays).toEqual([1, 3, 5]);
  });
});

describe('formatBusinessMinutes', () => {
  it('reads in working days, not calendar days', () => {
    expect(formatBusinessMinutes(45, CAL)).toBe('45m');
    expect(formatBusinessMinutes(120, CAL)).toBe('2h');
    expect(formatBusinessMinutes(150, CAL)).toBe('2h 30m');
    // 480 minutes is one 09:00–17:00 day.
    expect(formatBusinessMinutes(480, CAL)).toBe('1d');
    expect(formatBusinessMinutes(540, CAL)).toBe('1d 1h');
  });
});
