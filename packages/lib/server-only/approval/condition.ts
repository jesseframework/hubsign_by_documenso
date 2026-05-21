/**
 * Condition evaluation shared by approval rule selection and validation rules.
 *
 * Two supported config shapes:
 *   1. A condition GROUP: `{ "logic": "AND"|"OR", "conditions": [ ... ] }`, where
 *      each condition is `{ field, operator, value }` or a cross-field
 *      `{ field1, operator, field2 }`. Field paths are dotted (e.g.
 *      "document.status") and resolved against the context.
 *   2. Raw JSONLogic — anything else is handed to the JSONLogic evaluator.
 *
 * Both reuse the dependency-free helpers from the workflow engine.
 */

import { evaluateCondition, getByPath } from '../workflow/logic';

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isNaN(n) ? NaN : n;
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Compare two values using a (case-insensitive) operator name. */
export const compare = (operator: string, left: unknown, right: unknown): boolean => {
  switch ((operator ?? 'Equals').toLowerCase()) {
    case 'equals':
    case '==':
    case 'eq':
      // eslint-disable-next-line eqeqeq
      return left == right;
    case 'notequals':
    case '!=':
    case 'neq':
      // eslint-disable-next-line eqeqeq
      return left != right;
    case 'greaterthan':
    case '>':
    case 'gt':
      return num(left) > num(right);
    case 'greaterorequal':
    case '>=':
    case 'gte':
      return num(left) >= num(right);
    case 'lessthan':
    case '<':
    case 'lt':
      return num(left) < num(right);
    case 'lessorequal':
    case '<=':
    case 'lte':
      return num(left) <= num(right);
    case 'contains':
      return str(left).includes(str(right));
    case 'startswith':
      return str(left).startsWith(str(right));
    case 'endswith':
      return str(left).endsWith(str(right));
    case 'in':
      return Array.isArray(right) ? (right as unknown[]).includes(left) : str(right).includes(str(left));
    case 'notnull':
    case 'required':
      return left !== null && left !== undefined && str(left) !== '';
    default:
      // eslint-disable-next-line eqeqeq
      return left == right;
  }
};

type ConditionGroup = {
  logic?: string;
  conditions: Array<{
    field?: string;
    field1?: string;
    field2?: string;
    operator?: string;
    value?: unknown;
  }>;
};

const isConditionGroup = (config: unknown): config is ConditionGroup =>
  !!config &&
  typeof config === 'object' &&
  Array.isArray((config as { conditions?: unknown }).conditions);

export const evaluateConditionGroup = (
  group: ConditionGroup,
  context: unknown,
): boolean => {
  const logic = (group.logic ?? 'AND').toUpperCase();

  const results = group.conditions.map((c) => {
    if (c.field1 && c.field2) {
      return compare(c.operator ?? 'Equals', getByPath(context, c.field1), getByPath(context, c.field2));
    }
    return compare(c.operator ?? 'Equals', getByPath(context, c.field ?? ''), c.value);
  });

  return logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
};

/**
 * Evaluate either a condition group or raw JSONLogic against the context.
 * An empty/undefined config evaluates to true.
 */
export const evaluateConditionConfig = (config: unknown, context: unknown): boolean => {
  if (config === null || config === undefined) return true;
  if (isConditionGroup(config)) return evaluateConditionGroup(config, context);
  return evaluateCondition(config, context);
};
