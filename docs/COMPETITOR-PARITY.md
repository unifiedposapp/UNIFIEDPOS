# Competitor Parity — Gap Analysis and Build-Out

> Benchmarked against Square, Shopify POS, Toast, Lightspeed Retail, Erply, Clover,
> Revel, Oracle MICROS, ZOHO POS and Aloha.
> Companion to `IMPLEMENTATION_STATUS.md`; the corrections to the earlier status
> claims live there, this file maps each gap to what was built.

## 1. Method

Each of the ten systems was walked feature-by-feature at the level a merchant
actually buys on: the register loop, back-office roster, stock truth, kitchen
flow and the reporting/export edge. Where a competitor had a capability the
codebase did not, it was recorded as a gap and then closed as a **pure service +
thin route + screen** triple, in that order — the service first so the money and
stock maths is unit-testable without a database.

Nothing in this document is a roadmap item. Every row below has code, a route and
a test behind it, and the last section records the two live defects that writing
the tests exposed.

## 2. Gap table

| Competitor | What they had that we lacked | Now implemented as | Where |
| --- | --- | --- | --- |
| Square | Weighed items, unit-of-measure selling, store scale (PLU) barcodes | `normalizeQuantity` / `convertQty` / `weighedPrice` / `decodeScaleBarcode` | `server/src/services/units.ts`, POS keypad, `/products` barcode lookup |
| Square | Offline card sales that survive a network drop | Pre-POST local queue with idempotent replay | `web/src/services/posOffline.ts`, `POSPage.tsx` |
| Square | Tip pooling and tip-out to support staff | Four weighting methods, cent-exact allocation, persisted distributions | `server/src/services/tipPooling.ts`, `/tips`, Tips page |
| Shopify POS | Real storefront connectors with signed webhooks | Shopify / WooCommerce / BigCommerce REST connectors + HMAC verification | `server/src/services/channels.ts`, `/channels`, Channels page |
| Shopify POS | Quote → order conversion; partial fulfilment with a visible balance | Quote lifecycle + backorder ledger with partial fulfilment | `/quotes`, `/orders/backorders`, Quotes & Backorders pages |
| Toast | Recipe/BOM costing with ingredient depletion on sale | BOM roll-up, waste uplift, cycle guard, per-sale draws as inventory movements | `server/src/services/recipes.ts`, `depletion.ts`, `/recipes` |
| Toast | Kitchen display: station routing, fire-by-course, ticket ageing | `routeItem` / `planCourseFire` / `slaStatus` | `server/src/services/kds.ts`, `/restaurant/stations`, `/restaurant/tickets` |
| Toast | Employee scheduling, availability, time off, shift swaps, payroll export | `shiftHours` / `splitOvertime` / `detectConflicts` / `availabilityViolations` / `coverageGaps` | `server/src/services/labor.ts`, `/labor`, Labor page |
| Lightspeed Retail | Serialised service work orders, rentals, appointments | Appointment clash detection + slot search, work-order line ledger, rental returns with late fees | `/service`, Service Orders page |
| Lightspeed Retail | Age-restricted item gate with an audit trail | `evaluateAgeGate` verdicts + verification records + policy endpoint | `server/src/services/ageGate.ts`, `/age-verifications`, POS prompt |
| Erply | Deep promotion mechanics (mix-and-match, bundles, quantity breaks, dayparts) | `planPromotions` with priority ordering and non-stackable short-circuit, proportional allocation | `server/src/services/promotions.ts`, `/marketing/promotions/*` |
| Clover | Customer-facing display paired to the register | Kiosk sessions + cart mirroring + public device token | `/kiosk`, `/device/:token`, Kiosk page |
| Clover | Self-service kiosk checkout | Server-side repricing, age-flag propagation, per-session token | `/kiosk/session/:token/order` |
| Revel | Loyalty tiers over a points ledger | Tier thresholds, earn rates, audited adjustments | `/loyalty/tiers`, Loyalty Tiers page |
| Oracle MICROS | Course-at-a-time firing to the kitchen | `planCourseFire` with sent-item suppression | `kds.ts`, `/restaurant/tickets/:id/fire` |
| Oracle MICROS | Tab / table merge and transfer | Tab open-close, table merge, table transfer | `/restaurant/tabs`, `/restaurant/tables/*` |
| ZOHO POS | User-built reports without SQL | Closed-vocabulary report builder with `FilterSet`, grouping, CSV, cron | `server/src/services/reportBuilder.ts`, `/reports/*`, Report Builder page |
| Aloha | Manager card-present flow with tip adjust | Stripe Terminal readers, card-present intents, capture, refund, tip adjust | `server/src/services/terminal.ts`, `/terminal`, Terminal page |

## 3. Capability detail

### 3.1 Weighted selling, units and scale barcodes

`units.ts` owns quantity truth. `normalizeQuantity(value, unit)` enforces three
decimals for `KG / G / L / ML / M` and whole numbers for `EACH / PACK`, returning
`NOT_POSITIVE | TOO_MANY_DECIMALS | INTEGER_ONLY | TOO_LARGE` rather than
silently rounding a cashier's keystroke. `convertQty` handles the metric
cross-units (`G↔KG`, `ML↔L`) so a recipe draw and an inventory balance can meet
in the middle, and `weighedPrice(ratePerKg, weightKg)` prices the scale-read line.

Barcodes: `gtinCheckDigitValid` does the mod-10 check for both symbologies, and
`decodeScaleBarcode(code, 'WEIGHT' | 'PRICE')` reads the GS1 retailer-assigned
EAN-13 form (leading `2`, PLU in digits 2–6, grams or minor currency units in
digits 7–11). The register scans straight into a weighed line; the server
re-validates on the order write.

### 3.2 Recipes, BOM costing and depletion

`rollupRecipeCost` costs a menu item from its components with a `MAX_DEPTH` of 6,
a cycle guard, waste uplift applied **before** costing and a yield division.
`explodeRecipe` turns a sale into ingredient draws; the merge key is
`productId::unit`, because the same ingredient may legitimately appear as `100 G`
on one line and `0.02 KG` on another — keying by product alone dropped one of the
two draws and under-depleted stock. `depletion.ts::applyDraw` converts each draw
into the balance's own unit before writing the movement.

### 3.3 Promotion engine

Seven mechanics (`PERCENTAGE`, `FIXED`, `BOGO`, `BUNDLE`, `MIX_AND_MATCH`,
`QTY_BREAK`, `DAYPART`). The daypart window is evaluated in the tenant's local
minutes alongside date, weekday and channel eligibility. `planPromotions` applies
eligible promotions in priority order then discount size, stops at the first
non-stackable match, and `allocateDiscount` splits the total across lines by
largest remainder so the per-line figures sum exactly to the order discount — no
drifting cent.

### 3.4 Loyalty tiers

Tiers sit above the existing flat points program as a fall-through on `/loyalty`.
Thresholds are evaluated on lifetime points, earn rates multiply the base accrual,
and `POST /loyalty/tiers/evaluate` re-runs the assignment for a batch so the ledger
stays consistent after an audited adjustment.

### 3.5 Labour, scheduling and payroll

`shiftHours` subtracts unpaid breaks; `splitOvertime` applies daily thresholds
first and then the weekly threshold over the residual, so a week of 10-hour days
splits as 40 regular + 10 overtime rather than taxing one of the two rules.
`detectConflicts` flags overlap, insufficient rest, over-long and inverted shifts;
`availabilityViolations` compares proposed shifts against each employee's declared
windows; `coverageGaps` reports staffing shortfall per interval. Time-off and swap
requests carry a manager decision, and a payroll run freezes hours/cost at the
multiplier with a CSV export.

### 3.6 Tips

`allocateTips(pool, participants, method)` supports `EQUAL`, `HOURS`, `SALES` and
`POINTS` weights over a largest-remainder cent split, and returns
`roundingDrift` so a caller can assert `distributed === pool`. Pool rules are
per-role, distributions are persisted, and tip-out covers support staff.

### 3.7 Quotes and backorders

Quotes are a first-class record with lines, a guarded status flow and a
`convert` endpoint that creates the order. Backorders mount on `/orders` (ahead of
the order router so `GET /:id` cannot swallow the path) and keep the outstanding
quantity visible across partial fulfilments, with notify and cancel paths.

### 3.8 Field service

`/service` carries three related objects. Appointments have clash detection and a
free-slot search. Work orders accumulate labour, part and fee lines behind a
guarded status flow. Rentals price at hourly/daily/weekly rates, return per line
with condition, and charge a merchant-set late fee.

### 3.9 Kitchen display

`routeItem` resolves a station by precedence — item-level modifier override, then
category, then fallback — so a "no onions" line can go to a different station than
the dish. `planCourseFire` releases one course at a time and never re-fires an
already-sent item. `slaStatus` grades tickets `ON_TIME / AT_RISK / LATE` against a
per-station target, and `averageTicketMinutes` reports the station's real pace.

### 3.10 Self-service devices

A manager pairs a device; the token is returned exactly once at pairing, and only
a six-character preview is ever listed afterwards — never the token itself. The public
`/device/:token` route and `/kiosk/session/:token/*` endpoints let a kiosk
bootstrap, heartbeat, mirror a cart to a customer display and submit an order that
the server reprices and age-gates. Device scoping is per session, not per token
guess.

### 3.11 Card-present

`terminal.ts` wraps Stripe Terminal: connection tokens, reader registration and
labelling, card-present PaymentIntents with manual capture, capture, cancel,
refund and `validateTipAdjust` — which refuses a total below the authorised amount
and enforces the 20% ceiling, because the authorisation was for the food.

Without Stripe keys the module runs a simulator provider, so the route surface and
the register flow are exercisable in development; `GET /terminal/provider` reports
which mode is live.

### 3.12 Report builder

`validateDefinition` enforces a closed vocabulary of sources and columns and walks
the `FilterSet` operator map (`eq / ne / gte / lte / in / contains`), rejecting
unknown operators and unknown column names one level down. `buildReport` executes
against Prisma's typed client (no string SQL anywhere) with grouping and sums;
`toCsv` writes RFC 4180. Definitions can be cron-scheduled.

### 3.13 Offline sale queue

`posOffline` writes the sale to local storage **before** the POST, replays oldest
first, and sends the client order id as `Idempotency-Key` so a retry cannot double
charge. A transport failure or a 401 keeps the sale queued; a 4xx parks it with
its reason for a human. Failure handling updates only the failing record in
current storage — writing back the array captured at the start of a flush
resurrected sales the server had already accepted.

### 3.14 Channel connectors

`channels.ts` implements three real REST connectors with provider-specific auth,
pagination, order and product mappers, and HMAC webhook verification; webhooks are
raw-mounted at `/api/channels/webhooks/:connectionId` because signature
verification needs the exact bytes. `POST /commerce/integrations/:id/sync` now
calls the provider instead of flipping a status flag.

## 4. Verification

| Suite | Tests | What it pins |
| --- | --- | --- |
| `packages/server/test/parityServices.test.ts` | 100 | units, scale barcodes, tip pooling, promotions, recipes/depletion, age gate, KDS, labour, report builder/CSV |
| `packages/web/test/posOffline.test.ts` | 10 | queue-before-send, idempotency header, transport/5xx/401/4xx handling, ordering, resurrection regression |
| `packages/web/test/i18n.test.ts` | 13 | every new navigation key present and translated in all 17 locales |

```bash
npx vitest run            # whole repo: 745 passed / 19 DB-gated skipped, 44 suites
npm run build             # shared → server → web, exits 0
```

Schema changes ship as migrations, not `db push`: `20261028120000_competitor_parity`
creates the 27 new tables and the weighed-item / PLU / age-gate columns. Verified by
applying the whole chain to an empty database —

```bash
prisma migrate deploy                                   # ten migrations, all applied
prisma migrate diff --from-url $DATABASE_URL \
  --to-schema-datamodel prisma/schema.prisma --script  # "This is an empty migration."
```

## 5. Defects found while proving this out

All five were live in `main`. The first two were found by writing the tests above,
not by reading the code; the rest by taking the code to a running system.

1. **Every filtered custom report was refused.** `validateDefinition` iterated
   `Object.keys(def.filters)` — the operator names — as if they were column names,
   so `runDefinition`, create and update all returned `400 Unknown filter column
   "eq"`. A filter set on declared columns now validates clean, and the operator
   walk rejects genuinely unknown operators.
2. **The offline flush resurrected accepted sales.** On a failure the flush wrote
   back the queue array it had captured at the start of the loop, undoing the
   `remove()` calls for sales already accepted in the same pass. Harmless while the
   server still held the idempotency record — a duplicate sale once it no longer
   did. The flush now updates only the failing record against current storage.
3. **Recipe depletion dropped a draw.** `explodeRecipe` merged on
   `componentProductId` alone, so an ingredient listed as `100 G` on one line and
   `0.02 KG` on another collapsed into a single draw and under-depleted stock
   (§3.2). The merge key is now `productId::unit`.
4. **`prisma migrate deploy` aborted on a UTF-16 migration file.**
   `20260922000000_global_hardening/migration.sql` had been saved as UTF-16LE, so
   the migration engine reported P3015 (*file not found*) and stopped — the Docker
   entrypoint's very first command, on a fresh volume. Re-saved as UTF-8.
5. **Two groups of tables had no migration at all.** The 27 competitor-parity
   models and the platform-billing tables (`platform_plans`,
   `platform_payments`, and the billing columns on `organizations`) existed only in
   the schema, so a `migrate deploy` database would have thrown on the first
   recipe, quote or Admin Console query. Added as
   `20261028120000_competitor_parity` and `20261028130000_platform_billing`; the
   chain now applies clean to an empty database and diffs empty against the schema.

## 6. Deliberate non-goals

- **§24 hardware drivers** — physical printer/drawer/scale transports stay out of
  scope; ESC/POS byte generation and the browser transports that need no driver are
  in.
- **Client SDKs** — spec-deferred. The REST API, developer catalogue and
  `.well-known` discovery documents are complete, so an SDK is generated surface,
  not missing capability.
- **Provider breadth as a proxy for integration depth** — the ~137-entry payment
  catalogue is documented as a directory of providers a merchant may request, not
  as live connectors. Live rails are the ones with a code path and a test.
