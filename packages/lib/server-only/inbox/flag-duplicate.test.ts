import { describe, expect, it } from 'vitest';

import { affectsDuplicateCheck } from './flag-duplicate';

/**
 * The cost of getting this wrong is silent: a correction to the vendor name that
 * does not re-run detection leaves a duplicate looking clean forever, and nobody
 * finds out until the invoice is paid twice.
 */
describe('affectsDuplicateCheck', () => {
  it('recognises the four values detection reads', () => {
    expect(affectsDuplicateCheck('vendor_name')).toBe(true);
    expect(affectsDuplicateCheck('invoice_number')).toBe(true);
    expect(affectsDuplicateCheck('invoice_date')).toBe(true);
    expect(affectsDuplicateCheck('total_amount')).toBe(true);
  });

  it('recognises them under any template’s spelling', () => {
    // Every one of these is what some extraction template calls the vendor or
    // the total; the alias table is shared with `readOcrField`, so a field the
    // detector can read is a field an edit must re-check.
    expect(affectsDuplicateCheck('Vendor Name')).toBe(true);
    expect(affectsDuplicateCheck('merchantName')).toBe(true);
    expect(affectsDuplicateCheck('supplier')).toBe(true);
    expect(affectsDuplicateCheck('grand_total')).toBe(true);
    expect(affectsDuplicateCheck('balance-due')).toBe(true);
    expect(affectsDuplicateCheck('ISSUE_DATE')).toBe(true);
  });

  it('ignores fields that cannot change the verdict', () => {
    expect(affectsDuplicateCheck('po_number')).toBe(false);
    expect(affectsDuplicateCheck('payment_terms')).toBe(false);
    expect(affectsDuplicateCheck('bill_to')).toBe(false);
    expect(affectsDuplicateCheck('currency')).toBe(false);
    // The tax is not the total, and two invoices agreeing on it prove nothing.
    expect(affectsDuplicateCheck('tax_amount')).toBe(false);
    expect(affectsDuplicateCheck('due_date')).toBe(false);
  });
});
