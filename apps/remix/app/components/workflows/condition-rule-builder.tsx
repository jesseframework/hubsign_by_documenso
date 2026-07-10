import type { ReactNode } from 'react';

import { Trans } from '@lingui/react/macro';
import { PlusIcon, XIcon } from 'lucide-react';

import { Button } from '@documenso/ui/primitives/button';

/**
 * A small "field is/contains value" rule builder for JSONLogic conditions.
 *
 * Covers the common case — a flat list of comparisons ANDed/ORed together —
 * used by both the trigger's optional condition and CONDITION steps. Anything
 * more complex than that (nested logic, non-`var` operands, ...) can't be
 * represented here; callers should fall back to the raw JSON editor for those.
 */

export type TConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

export type TConditionRow = {
  id: string;
  field: string;
  operator: TConditionOperator;
  value: string;
};

export type TSimpleCondition = {
  combinator: 'and' | 'or';
  rows: TConditionRow[];
};

export const CONDITION_OPERATORS: Array<{
  value: TConditionOperator;
  label: string;
  jsonLogicOp: string;
}> = [
  { value: 'eq', label: 'is', jsonLogicOp: '==' },
  { value: 'neq', label: 'is not', jsonLogicOp: '!=' },
  { value: 'gt', label: '>', jsonLogicOp: '>' },
  { value: 'gte', label: '>=', jsonLogicOp: '>=' },
  { value: 'lt', label: '<', jsonLogicOp: '<' },
  { value: 'lte', label: '<=', jsonLogicOp: '<=' },
  { value: 'contains', label: 'contains', jsonLogicOp: 'in' },
];

const OPERATOR_BY_JSONLOGIC_OP: Partial<Record<string, TConditionOperator>> = Object.fromEntries(
  CONDITION_OPERATORS.filter((op) => op.jsonLogicOp !== 'in').map((op) => [op.jsonLogicOp, op.value]),
);

export const CONDITION_FIELD_SUGGESTIONS = [
  'event',
  'document.status',
  'document.title',
  'document.id',
  'document.recipient.email',
  'organization.id',
  'payload.extractedData',
];

let rowSeq = 0;
const nextRowId = () => `row_${Date.now().toString(36)}_${(rowSeq++).toString(36)}`;

/** "true"/"false" and numeric strings become their JS type; everything else stays a string. */
export const coerceValue = (raw: string): unknown => {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw.trim())) return Number(raw);
  return raw;
};

export const valueToText = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asVarName = (value: unknown): string | null =>
  isRecord(value) && typeof value.var === 'string' ? value.var : null;

/** Parse one clause like `{ "==": [{ "var": "a" }, "b"] }` into a row, or null if it doesn't fit. */
const parseRule = (rule: unknown): Omit<TConditionRow, 'id'> | null => {
  if (!isRecord(rule)) return null;

  const entries = Object.entries(rule);
  if (entries.length !== 1) return null;

  const [op, args] = entries[0];
  if (!Array.isArray(args) || args.length !== 2) return null;

  if (op === 'in') {
    const field = asVarName(args[1]);
    if (field === null) return null;
    return { field, operator: 'contains', value: valueToText(args[0]) };
  }

  const operator = OPERATOR_BY_JSONLOGIC_OP[op];
  if (!operator) return null;

  const field = asVarName(args[0]);
  if (field === null) return null;

  return { field, operator, value: valueToText(args[1]) };
};

/** Try to represent a JSONLogic condition as a flat AND/OR list of rules. Returns null if too complex. */
export const jsonLogicToSimpleCondition = (condition: unknown): TSimpleCondition | null => {
  if (condition === undefined || condition === null) {
    return { combinator: 'and', rows: [] };
  }

  if (!isRecord(condition)) return null;

  const entries = Object.entries(condition);
  if (entries.length === 1) {
    const [op, args] = entries[0];
    if ((op === 'and' || op === 'or') && Array.isArray(args)) {
      const rows: TConditionRow[] = [];
      for (const clause of args) {
        const parsed = parseRule(clause);
        if (!parsed) return null;
        rows.push({ id: nextRowId(), ...parsed });
      }
      return { combinator: op, rows };
    }
  }

  const single = parseRule(condition);
  if (!single) return null;
  return { combinator: 'and', rows: [{ id: nextRowId(), ...single }] };
};

/**
 * Build a JSONLogic condition from the simple rows, or undefined for "always run".
 *
 * Deliberately does *not* drop rows with an empty field: this function's output is
 * round-tripped straight back through `jsonLogicToSimpleCondition` to redraw the rows
 * (see the builder page), so filtering incomplete rows here would make them vanish
 * the instant they're added, before the user gets a chance to fill them in.
 */
export const simpleConditionToJsonLogic = (condition: TSimpleCondition): unknown | undefined => {
  const clauses = condition.rows.map((row) => {
    const opDef = CONDITION_OPERATORS.find((op) => op.value === row.operator) ?? CONDITION_OPERATORS[0];
    const value = coerceValue(row.value);

    if (opDef.value === 'contains') {
      return { in: [value, { var: row.field }] };
    }

    return { [opDef.jsonLogicOp]: [{ var: row.field }, value] };
  });

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { [condition.combinator]: clauses };
};

export const emptySimpleCondition = (): TSimpleCondition => ({ combinator: 'and', rows: [] });

export const newConditionRow = (): TConditionRow => ({
  id: nextRowId(),
  field: '',
  operator: 'eq',
  value: '',
});

const fieldCls =
  'block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary';

export const ConditionRuleBuilder = ({
  value,
  onChange,
  emptyHint,
  datalistId = 'workflow-condition-fields',
}: {
  value: TSimpleCondition;
  onChange: (next: TSimpleCondition) => void;
  emptyHint?: ReactNode;
  datalistId?: string;
}) => {
  const addRow = () => onChange({ ...value, rows: [...value.rows, newConditionRow()] });

  const updateRow = (id: string, patch: Partial<TConditionRow>) =>
    onChange({ ...value, rows: value.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)) });

  const removeRow = (id: string) =>
    onChange({ ...value, rows: value.rows.filter((row) => row.id !== id) });

  return (
    <div className="space-y-2">
      {value.rows.length === 0 && (
        <p className="text-[12px] text-muted-foreground">
          {emptyHint ?? <Trans>No conditions — this always runs.</Trans>}
        </p>
      )}

      {value.rows.length > 1 && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Trans>Match</Trans>
          <select
            className="rounded-md border border-border bg-background px-1.5 py-1 text-[12px]"
            value={value.combinator}
            onChange={(e) => onChange({ ...value, combinator: e.target.value as 'and' | 'or' })}
          >
            <option value="and">all</option>
            <option value="or">any</option>
          </select>
          <Trans>of the following:</Trans>
        </div>
      )}

      {value.rows.length > 0 && (
        <div className="space-y-2">
          {value.rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
              <input
                className={`${fieldCls} sm:w-[38%]`}
                list={datalistId}
                value={row.field}
                onChange={(e) => updateRow(row.id, { field: e.target.value })}
                placeholder="e.g. document.status"
              />
              <select
                className={`${fieldCls} sm:w-auto`}
                value={row.operator}
                onChange={(e) => updateRow(row.id, { operator: e.target.value as TConditionOperator })}
              >
                {CONDITION_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                className={`${fieldCls} sm:flex-1`}
                value={row.value}
                onChange={(e) => updateRow(row.id, { value: e.target.value })}
                placeholder="value"
              />
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                aria-label="Remove condition"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <datalist id={datalistId}>
        {CONDITION_FIELD_SUGGESTIONS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={addRow}>
        <PlusIcon className="mr-1 h-3 w-3" />
        <Trans>Add condition</Trans>
      </Button>
    </div>
  );
};
