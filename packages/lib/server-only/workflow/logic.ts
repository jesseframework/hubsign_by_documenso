/**
 * Dependency-free JSONLogic-compatible evaluator.
 *
 * Implements the operators from https://jsonlogic.com so workflow rules authored
 * in the standard JSONLogic format Just Work. We ship our own implementation
 * (rather than the `json-logic-js` package) because these rules are authored by
 * org admins and evaluated server-side — keeping the evaluator small, auditable,
 * and free of `eval`/prototype access matters more than the convenience of a
 * dependency. To swap in the official package later, replace `evaluateLogic`
 * with `jsonLogic.apply` — the rule format is identical.
 *
 * Safety properties:
 *   • No `eval` / `Function` — purely structural interpretation.
 *   • `var` path traversal refuses `__proto__` / `prototype` / `constructor`.
 *   • Operators are looked up on a frozen, own-property-only table.
 */

import type { TJsonLogic } from '../../types/workflow';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Resolve a dotted path (e.g. "document.recipients.0.email") against `data`.
 * Returns `undefined` when any segment is missing. Numeric segments index arrays.
 */
export const getByPath = (data: unknown, path: string): unknown => {
  if (path === '' || path === null || path === undefined) {
    return data;
  }

  const segments = String(path).split('.');
  let current: unknown = data;

  for (const segment of segments) {
    if (FORBIDDEN_KEYS.has(segment)) {
      return undefined;
    }

    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

/** JSONLogic truthiness: empty arrays are falsy, non-empty arrays are truthy. */
export const isTruthy = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return Boolean(value);
};

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Operator = (args: any[], data: unknown) => unknown;

/**
 * Operator table. Operators receive their already-... no — control-flow operators
 * (`if`, `and`, `or`, array iterators) need raw args so they can short-circuit or
 * bind a per-element scope, so each operator decides when to recurse via `ev`.
 */
const buildOperators = (): Record<string, Operator> => {
  const ev = (rule: TJsonLogic, data: unknown): unknown => evaluateLogic(rule, data);
  const evAll = (args: unknown[], data: unknown) => args.map((a) => ev(a, data));

  const operators: Record<string, Operator> = {
    var: (args, data) => {
      const path = ev(args[0] ?? '', data);
      const fallback = args.length > 1 ? ev(args[1], data) : undefined;
      const value = getByPath(data, path === undefined || path === null ? '' : String(path));
      return value === undefined ? (fallback === undefined ? null : fallback) : value;
    },

    missing: (args, data) => {
      const keys = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
      return keys
        .map((k) => String(ev(k, data)))
        .filter((k) => {
          const v = getByPath(data, k);
          return v === undefined || v === null;
        });
    },

    missing_some: (args, data) => {
      const min = toNumber(ev(args[0], data));
      const keys = (asArray(ev(args[1], data)) as unknown[]).map(String);
      const present = keys.filter((k) => {
        const v = getByPath(data, k);
        return v !== undefined && v !== null;
      });
      return present.length >= min ? [] : keys.filter((k) => !present.includes(k));
    },

    if: (args, data) => {
      // [c1, v1, c2, v2, ..., else]
      for (let i = 0; i < args.length - 1; i += 2) {
        if (isTruthy(ev(args[i], data))) {
          return ev(args[i + 1], data);
        }
      }
      return args.length % 2 === 1 ? ev(args[args.length - 1], data) : null;
    },

    '==': (args, data) => {
      const [a, b] = evAll(args, data);
      // eslint-disable-next-line eqeqeq
      return a == b;
    },
    '===': (args, data) => {
      const [a, b] = evAll(args, data);
      return a === b;
    },
    '!=': (args, data) => {
      const [a, b] = evAll(args, data);
      // eslint-disable-next-line eqeqeq
      return a != b;
    },
    '!==': (args, data) => {
      const [a, b] = evAll(args, data);
      return a !== b;
    },

    '!': (args, data) => !isTruthy(ev(Array.isArray(args) ? args[0] : args, data)),
    '!!': (args, data) => isTruthy(ev(Array.isArray(args) ? args[0] : args, data)),

    and: (args, data) => {
      let result: unknown = true;
      for (const a of args) {
        result = ev(a, data);
        if (!isTruthy(result)) return result;
      }
      return result;
    },
    or: (args, data) => {
      let result: unknown = false;
      for (const a of args) {
        result = ev(a, data);
        if (isTruthy(result)) return result;
      }
      return result;
    },

    '>': (args, data) => {
      const v = evAll(args, data);
      return toNumber(v[0]) > toNumber(v[1]);
    },
    '>=': (args, data) => {
      const v = evAll(args, data);
      return toNumber(v[0]) >= toNumber(v[1]);
    },
    '<': (args, data) => {
      const v = evAll(args, data).map(toNumber);
      // Between form: a < b < c
      return v.length === 3 ? v[0] < v[1] && v[1] < v[2] : v[0] < v[1];
    },
    '<=': (args, data) => {
      const v = evAll(args, data).map(toNumber);
      return v.length === 3 ? v[0] <= v[1] && v[1] <= v[2] : v[0] <= v[1];
    },

    '+': (args, data) => evAll(args, data).reduce<number>((acc, v) => acc + toNumber(v), 0),
    '*': (args, data) => evAll(args, data).reduce<number>((acc, v) => acc * toNumber(v), 1),
    '-': (args, data) => {
      const v = evAll(args, data).map(toNumber);
      if (v.length === 1) return -v[0];
      return v[0] - v[1];
    },
    '/': (args, data) => {
      const v = evAll(args, data).map(toNumber);
      return v[0] / v[1];
    },
    '%': (args, data) => {
      const v = evAll(args, data).map(toNumber);
      return v[0] % v[1];
    },
    max: (args, data) => Math.max(...evAll(args, data).map(toNumber)),
    min: (args, data) => Math.min(...evAll(args, data).map(toNumber)),

    in: (args, data) => {
      const [needle, haystack] = evAll(args, data);
      if (typeof haystack === 'string') return haystack.includes(String(needle));
      if (Array.isArray(haystack)) return haystack.includes(needle);
      return false;
    },
    cat: (args, data) => evAll(args, data).map((v) => (v === null || v === undefined ? '' : String(v))).join(''),
    substr: (args, data) => {
      const v = evAll(args, data);
      const str = String(v[0] ?? '');
      const start = toNumber(v[1]);
      const begin = start < 0 ? Math.max(str.length + start, 0) : start;
      if (v.length >= 3) {
        const len = toNumber(v[2]);
        return len < 0 ? str.slice(begin, str.length + len) : str.substr(begin, len);
      }
      return str.slice(begin);
    },

    merge: (args, data) =>
      evAll(args, data).reduce<unknown[]>((acc, v) => acc.concat(asArray(v)), []),

    // Array iterators bind each element as the scope for the inner logic.
    map: (args, data) => {
      const arr = asArray(ev(args[0], data)) as unknown[];
      return arr.map((item) => ev(args[1], item));
    },
    filter: (args, data) => {
      const arr = asArray(ev(args[0], data)) as unknown[];
      return arr.filter((item) => isTruthy(ev(args[1], item)));
    },
    reduce: (args, data) => {
      const arr = asArray(ev(args[0], data)) as unknown[];
      const initial = args.length > 2 ? ev(args[2], data) : null;
      return arr.reduce(
        (accumulator, current) => ev(args[1], { current, accumulator }),
        initial,
      );
    },
    all: (args, data) => {
      const arr = asArray(ev(args[0], data)) as unknown[];
      return arr.length > 0 && arr.every((item) => isTruthy(ev(args[1], item)));
    },
    none: (args, data) => {
      const arr = asArray(ev(args[0], data)) as unknown[];
      return arr.every((item) => !isTruthy(ev(args[1], item)));
    },
    some: (args, data) => {
      const arr = asArray(ev(args[0], data)) as unknown[];
      return arr.some((item) => isTruthy(ev(args[1], item)));
    },

    log: (args, data) => ev(Array.isArray(args) ? args[0] : args, data),
  };

  return Object.freeze(operators);
};

const OPERATORS = buildOperators();

/**
 * Evaluate a JSONLogic rule against `data`. Primitives and arrays of primitives
 * are returned as-is; a single-key object whose key is a known operator is
 * applied. Unknown operators throw so authoring mistakes surface loudly.
 */
export const evaluateLogic = (rule: TJsonLogic, data: unknown): unknown => {
  // Primitives (and null) are literals.
  if (rule === null || typeof rule !== 'object') {
    return rule;
  }

  // Arrays are treated as literal arrays (their items may themselves be rules
  // only when an operator chooses to evaluate them).
  if (Array.isArray(rule)) {
    return rule;
  }

  const keys = Object.keys(rule as Record<string, unknown>).filter(
    (k) => !FORBIDDEN_KEYS.has(k),
  );

  if (keys.length === 0) {
    return rule;
  }

  if (keys.length > 1) {
    // Not an operator object — return as a plain value.
    return rule;
  }

  const op = keys[0];
  const operator = Object.prototype.hasOwnProperty.call(OPERATORS, op)
    ? OPERATORS[op]
    : undefined;

  if (!operator) {
    throw new Error(`Unknown JSONLogic operator: "${op}"`);
  }

  const rawArgs = (rule as Record<string, unknown>)[op];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];

  return operator(args, data);
};

/**
 * Evaluate a rule and coerce to a boolean using JSONLogic truthiness. A missing
 * rule (undefined) means "always true" — used for optional trigger gates.
 */
export const evaluateCondition = (rule: TJsonLogic | undefined, data: unknown): boolean => {
  if (rule === undefined) {
    return true;
  }
  return isTruthy(evaluateLogic(rule, data));
};
