# BMS ML → HubSign field-name contract

**Audience:** whoever authors extraction templates in BMS ML
(`/api/v1/invoice-field-templates/`).

**Why this exists.** HubSign workflows key off extracted field values — matching
a vendor in the metadata directory, filling the invoice number into a
confirmation email, routing a document for signature. When a template names a
field something HubSign doesn't recognise, the placeholder resolves to an empty
string. Nothing errors. The lookup just returns "not found", the workflow takes
its else-branch, and the run is recorded as **COMPLETED** having done nothing.

That exact failure ran unnoticed for 21 workflow runs: templates emitted
`merchant_name`, the workflow read `vendor_name`, and every invoice silently
skipped both its confirmation email and its signature request.

**The ask:** emit the **Preferred name** below. HubSign also accepts the listed
aliases, but the preferred name is the one guaranteed not to drift.

---

## Field names

`snake_case`, lowercase. HubSign exposes each as a camelCase template
placeholder — emit `invoice_number`, reference `{{payload.invoiceNumber}}`.

| Preferred name | Type | HubSign placeholder | Also accepted |
| --- | --- | --- | --- |
| `vendor_name` | string | `{{payload.vendorName}}` | `vendor`, `merchant_name`, `merchant`, `supplier_name`, `supplier`, `seller_name`, `seller`, `biller_name`, `biller`, `company_name`, `business_name`, `payee`, `payee_name`, `from_name`, `issued_by`, `remit_to` |
| `vendor_address` | string | `{{payload.vendorAddress}}` | `merchant_address`, `supplier_address`, `remit_to_address` |
| `vendor_email` | string | `{{payload.vendorContact}}` | `vendor_contact`, `merchant_email`, `merchant_contact`, `supplier_email`, `supplier_contact`, `contact_email` |
| `invoice_number` | string | `{{payload.invoiceNumber}}` | `invoice_no`, `invoice_num`, `invoice`, `bill_number`, `bill_no`, `document_number`, `reference`, `reference_number` |
| `invoice_date` | date | `{{payload.invoiceDate}}` | `date`, `issue_date`, `issued_date`, `bill_date`, `document_date` |
| `due_date` | date | `{{payload.dueDate}}` | `invoice_due_date`, `payment_due_date`, `payment_due`, `pay_by` |
| `po_number` | string | `{{payload.poNumber}}` | `po_no`, `purchase_order`, `purchase_order_number`, `order_number` |
| `subtotal` | number | `{{payload.subtotal}}` | `sub_total`, `net_amount`, `amount_before_tax` |
| `tax_amount` | number | `{{payload.taxAmount}}` | `tax`, `vat`, `vat_amount`, `gct`, `sales_tax` |
| `total_amount` | number | `{{payload.totalAmount}}` | `total`, `total_amount_due`, `amount_due`, `total_charges`, `grand_total`, `balance_due` |
| `currency` | string | `{{payload.currency}}` | `currency_code` |
| `account_number` | string | `{{payload.accountNumber}}` | `account_no`, `account`, `customer_account_number` |
| `bill_to` | string | `{{payload.billTo}}` | `billed_to`, `customer_name`, `sold_to`, `client_name` |
| `payment_terms` | string | `{{payload.paymentTerms}}` | `terms`, `payment_term` |

Matching ignores case, underscores, and spaces — `Invoice Number`,
`invoice_number`, and `invoiceNumber` are the same field. Templates may emit any
additional fields; unrecognised ones are stored and displayed on the document,
they just have no canonical placeholder.

## Rules that matter

**1. `vendor_name` is who *sent* the invoice — never who received it.**

This is the single most important field: it is the key HubSign matches against
the vendor directory to decide who gets the confirmation email and who the
document goes to for signature. Getting it backwards routes the invoice to the
wrong company.

- ✅ the supplier, merchant, biller, payee — the party being paid
- ❌ `bill_to`, `sold_to`, `customer_name` — the party paying

Those belong in `bill_to`, which is a separate field.

**2. Prefer `*_amount` over bare names when a template emits both.**

Templates that emit both `total` and `total_amount` (or `tax` and `tax_amount`)
are ambiguous — a bare `total` is often a line-item figure. HubSign resolves
`total_amount` first, but emitting only the `*_amount` form is unambiguous.

**3. Money as numbers, not strings.**

`1234.56`, not `"$1,234.56"`. No currency symbols, no thousands separators.
Keep the sign — a credit balance is negative. Put the ISO code in `currency`.

**4. Dates as ISO-8601.**

`2026-08-10`. Not `10/08/2026`, which is ambiguous across locales.

**5. Omit, or use `null`, for fields you cannot find.**

HubSign treats `""`, `null`, `"N/A"`, `"none"`, and `"-"` as absent and falls
through to the next alias. Do not emit a placeholder string like `"not found"` —
that reads as a real value and will be matched against the vendor directory.

**6. Identifiers verbatim.**

Account, invoice, PO, and reference numbers keep their original formatting —
leading zeros, dashes, and prefixes intact. They are matched and quoted back to
vendors exactly as extracted.

## Line items

Line-item data (`item_description`, `item_quantity`, `item_rate`,
`item_amount`) currently arrives as parallel arrays. An array of objects under
`line_items` is preferred, each with `description`, `quantity`,
`unit_price`, `amount`. Parallel arrays cannot express which values belong
together once any one of them has a gap.

## Checking a template

After a template runs, `payload.extractedData` on the processed item shows the
raw field names it emitted. Anything in that bag not in the table above (and not
an alias of it) is invisible to workflows.

As of the last audit, across 22 processed invoices:
`vendor_name`, `invoice_number`, `invoice_date`, `total_amount` resolved
**22/22**; `due_date` and `currency` **21/22**; `subtotal` **20/22**;
`tax_amount` **18/22**. `account_number` resolved **0/22** — no template emits
it yet, which matters for utility-style bills keyed on an account rather than an
invoice number.

## Adding a field

Aliases live in [`packages/lib/universal/ocr-fields.ts`](../packages/lib/universal/ocr-fields.ts)
(`OCR_FIELD_ALIASES`). Adding an entry there makes it available to every
workflow as `{{payload.<camelCase>}}`; no workflow needs editing.
