import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

/**
 * Translates a quota's `period` ('month' | 'year' — see `ZLimitsSchema`)
 * into the word to interpolate into "...this {word}" copy, so a client
 * component doesn't need its own conditional at every call site.
 */
export const PERIOD_LABEL_MAP: Record<'month' | 'year', MessageDescriptor> = {
  month: msg`month`,
  year: msg`year`,
};
