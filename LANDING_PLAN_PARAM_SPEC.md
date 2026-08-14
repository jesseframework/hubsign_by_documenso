# Landing site → signup: `?plan=` contract

**For:** the marketing/landing site team (separate repo, not this one).
**Status:** app.hubsign.io (this repo) now reads and acts on this param — ready to receive it.

---

## Background

`SIGNIN_AND_PLAN_LINKS.md` (2026-08-11) shipped the landing site's side of this: pricing
CTAs link straight to signup instead of the old dead sign-in modal, and pass a `?plan=`
query param. That doc listed it as inert — the app didn't read it yet. It does now.

The pricing ladder itself was also restructured since that doc was written (see
`HUBSIGN-Pricing-Plan.md`) — tiers are now **Free, Individual, Team, Business, Enterprise**,
not the old Personal/Individual/Business three-card layout. The slugs below reflect the new
ladder; update the pricing page's CTAs to match if they still send the old values.

## The contract

Append `?plan=<slug>` to the signup link only:

```
https://app.hubsign.io/signup?plan=team
```

Combinable with the existing `utm_source` param — order doesn't matter.

**No other link needs this.** HubSign generates and sends its own email-verification link;
the landing site never touches it, so there's nothing else to change downstream.

### Accepted slugs (exact, lowercase, case-sensitive)

| Slug | Tier | What happens |
|---|---|---|
| `free` | Free | No-op — user lands on the normal dashboard after verifying. Free requires no purchase step. |
| `individual` | Individual ($15/mo) | After verifying, lands on personal billing with checkout **already open**, one click from paying. |
| `team` | Team ($59/mo) | After verifying, walks through creating an organization (new signups have none yet), then lands on org billing with Team preselected and the purchase form open. |
| `business` | Business ($199/mo) | Same as `team`, preselecting Business. |
| `enterprise` | Enterprise | Same as `team`, preselecting Enterprise. Always resolves to the **shared** Enterprise tier on app.hubsign.io — there is no self-serve Dedicated option; that tier is sales-assisted and provisioned on a separate instance. |

**Anything else — missing, misspelled, or an unrecognized value — is silently ignored.** The
user still reaches signup and lands on the normal post-verification dashboard with no
preselection. Nothing errors, nothing blocks signup.

**`enterprise_dedicated` is deliberately not a slug.** Don't send it — there's nowhere for
the app to route it.

### Known, by-design limitation

The selection is carried in a short-lived browser cookie set at signup and read back after
the user clicks the verification link — it doesn't survive a **different browser or device**.
Sign up on a phone, verify from a link opened on a desktop, and the user lands on the normal
dashboard instead of a pre-filled purchase screen. This is expected and requires no handling
on the landing site's side; it was a deliberate tradeoff over threading the plan through the
verification email itself (which would have meant touching core auth-token generation for a
cosmetic "which screen opens first" feature).

## What to update on the landing site

If the pricing page still sends the old `personal`/`individual`/`business` values from the
Personal/Individual/Business three-card layout, update it to the five slugs above, matching
whatever cards the (now five-tier) pricing page actually shows. If in doubt about which slug
maps to which visible card, match the table above by tier name, not by column position.
