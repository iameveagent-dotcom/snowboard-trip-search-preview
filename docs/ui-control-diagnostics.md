# Snowboard Trip UI control diagnostics

Scope: customer-visible static prototype flow: Landing → Discover/Country Atlas → Map → Price → Share.

## Expected behavior contract

### Global navigation / architecture rail
- `Main screen`: opens the product landing page.
- `Discover`: opens the Country Atlas and keeps the user in country/resort discovery context.
- `Map`: opens the map-first explorer.
- `Price`: opens the estimate/flight-sale decision dashboard.
- `Share`: opens the read-only Hokkaido snapshot.
- Architecture steps 1–4 should mirror the same flow and never link to Mission Control or internal tooling.

### Landing page
- Primary flow controls should route to Discover, Map, Price, and Share pages.
- Public copy should describe a trip-planning product, not a prototype or fixture artifact.
- CTA links should resolve to pages in the static preview.

### Country Atlas / Discover
- Country pills (`Japan`, `Canada`, `Austria`, `Switzerland`, `France`, `Italy`, `Finland`, `USA`) should show only that country page and mark one active country.
- `Select <country> and continue to Map`: should preserve country intent by linking to the map with the corresponding `?region=` query.
- `Open country page`: should deep-link to the selected country URL.
- `View on map`: should navigate to the map explorer.
- `Price this region`: should navigate to the price/dashboard page.
- `Add to shortlist`: should give persistent visible feedback in the atlas (`Added to shortlist: <region/resort>...`) and update `window.lastShortlistedRegion` for regression QA.
- Estimate cards must stay hidden/gated until user trip inputs exist. Saved examples can exist as data, but public copy should say `saved example estimates` / `saved estimate from linked sources`, not `fixture`.

### Map-first explorer
- Region presets should be semantic filters, not aliases for global state:
  - `Japan`: Japan snow resorts only.
  - `US West`: Utah/Tahoe/Colorado US West context only.
  - `Canada`: Canada Rockies/BC/Eastern Canada context only.
  - `Europe`: European snow resorts only.
  - `BC Powder`: Interior BC/Powder Highway context only.
- `All layers` / `Show all layers`: the only control that should show everything at once.
- Destination cards, route cards, lodging/base cards, and decision rows should synchronize the selected route, selected map markers, route detail copy, and price-row selection.
- Pass inventory filters (`All`, `Epic`, `Ikon`, overlap/zero-state, search) should filter the real inventory and update the status text.
- Mobile must keep a real Leaflet/OpenStreetMap viewport visible with no horizontal overflow.

### Price / Dashboard
- Region baseline buttons should swap the visible decision card to that route profile.
- Fare input should update sale total, trip delta, per-person delta, and fare summary.
- Traveler count should scale party-level totals while keeping per-person delta normalized.
- Date fields should update peak/base adjustment labels without corrupting the selected route.
- `Share with friends`: should create `window.lastDealShareSnapshot`, update visible share status, and provide a durable read-only snapshot link.
- Optional board rental remains visible as an optional add-on, excluded from default totals.

### Share snapshot
- `Copy share link`: should copy or expose the current snapshot URL/status.
- `Print / save PDF`: should invoke the browser print flow.
- Snapshot values should match current default Hokkaido price state: baseline USD 8,107; sale USD 7,027; savings USD 1,080 total / USD 540 pp.
- Public snapshot must not expose internal fixture/prototype language.

## Discrepancies found and addressed

- Country Atlas exposed customer-visible `static fixture` / `fixture range` wording. Replaced with customer-facing `saved example estimates`, `saved estimate from linked sources`, and `planning range` language.
- `Add to shortlist` only mutated an invisible JS variable. Added a persistent visible aria-live status and a central `addToShortlist` handler.
- Price share button label was implementation-oriented (`Create share snapshot`). Changed to user-facing `Share with friends` and added an `Open read-only snapshot` link in the result status.
- Dashboard rental source had an empty URL in one profile. Replaced with a concrete Snowbird rental source link.
- Hokkaido traveler-count scaling undercounted 4-traveler totals because the resort shuttle transfer adjustment was not scaling with party size. Added explicit transfer scaling for that shuttle so 4 travelers returns Baseline `$16,214` and Sale `$14,054`.

## Verification commands

- `python -m pytest tests/test_ui_control_diagnostics_contract.py -q`
- `python -m pytest -q`
- `node --test tests/*.test.js`
- `python scripts/prototype_exit_gate.py`
- `node tests/ui_control_browser_diagnostics.js`
