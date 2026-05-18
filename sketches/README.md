# Snowboard Trip Search Initial Render Variants

Public preview entry point: `../index.html`

## Variants

1. `001-dashboard-command-center/`
   - Dense Linear-style command center.
   - Best for fast flight-sale decisions and total-cost breakdowns.
   - QA notes: strongest concept fit; add final total row in estimate panel, label scoring bars, and add map legend/labels.

2. `002-map-first-explorer/`
   - Map-first route/destination explorer.
   - Best for unfamiliar regions and airport/resort geography.
   - QA notes: selected route should be more prominent; map needs subtle geography/markers; top country/region active state could be clearer.

3. `003-country-guide-atlas/`
   - Country-level travel atlas.
   - Best for “I want to go to Japan; what are my regions/gateways?” navigation.
   - QA notes: country navigation is clear for Japan; align Europe/Austria taxonomy; rename comparison table to region comparison; improve secondary text contrast.

## Recommendation

Use variant 1 as the default product shell because it directly answers the urgent airfare-sale question. Merge in variant 2’s map emphasis as a central/secondary tab, and variant 3’s country atlas as the destination discovery/country page pattern.

Do not start production implementation until the user approves or revises a design direction.
