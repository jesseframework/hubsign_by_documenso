/**
 * `{{ path }}` templating for workflow action configs.
 *
 * Action string fields (email subject/body, HTTP url/headers/body, notification
 * text, ...) may embed `{{ path.to.value }}` placeholders that are resolved
 * against the run context using the same dotted-path traversal as the JSONLogic
 * `var` operator. For richer logic, compute a value in a SET_VARIABLE step first
 * and reference it as `{{ vars.myValue }}`.
 */

import { getByPath } from './logic';

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * Replace every `{{ path }}` in `template` with the stringified value at that
 * path in `data`. Unknown paths render as an empty string.
 */
export const renderTemplate = (template: string, data: unknown): string => {
  if (!template.includes('{{')) {
    return template;
  }

  return template.replace(PLACEHOLDER, (_match, rawPath: string) => {
    const value = getByPath(data, rawPath.trim());
    return stringify(value);
  });
};

/**
 * Resolve a single placeholder string to its raw (non-stringified) value when
 * the entire string is exactly one `{{ path }}`. Useful where a non-string value
 * is expected (e.g. a numeric user id, a JSON body). Otherwise falls back to
 * string interpolation.
 */
export const resolveValue = (template: string, data: unknown): unknown => {
  const whole = template.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (whole) {
    return getByPath(data, whole[1].trim());
  }
  return renderTemplate(template, data);
};

/**
 * Deeply resolve templates in any value: strings are interpolated, arrays and
 * plain objects are walked. Non-string leaves are returned unchanged.
 */
export const resolveTemplatesDeep = <T>(value: T, data: unknown): T => {
  if (typeof value === 'string') {
    return renderTemplate(value, data) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplatesDeep(item, data)) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveTemplatesDeep(val, data);
    }
    return out as unknown as T;
  }

  return value;
};
