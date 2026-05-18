const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.resolve(__dirname, '../../data/fixtures');
const CONFIDENCE_RANK = {
  exact_live: 0,
  exact_observed: 1,
  source_backed_range: 2,
  manual_range: 3,
  derived_estimate: 4,
  fixture_estimate: 5,
  unknown: 6,
};

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

function loadFixtureCatalog() {
  return {
    airports: readFixture('airports'),
    countries: readFixture('countries'),
    regions: readFixture('regions'),
    resorts: readFixture('resorts'),
    lodging_zones: readFixture('lodging_zones'),
    transfer_options: readFixture('transfer_options'),
    flights: fs.existsSync(path.join(FIXTURE_DIR, 'flights.json')) ? readFixture('flights') : [],
    lift_tickets: readFixture('lift_tickets'),
    gear_rentals: readFixture('gear_rentals'),
    trip_profiles: readFixture('trip_profiles'),
  };
}

function indexById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function usd(amount) {
  return { amount: Math.round(amount), currency: 'USD' };
}

function convertMoney(money, fx) {
  if (!money) return undefined;
  if (money.currency === 'USD') return { amount: money.amount, currency: 'USD' };
  if (!fx || money.currency !== fx.from || fx.to !== 'USD') {
    throw new Error(`Cannot convert ${money.currency} to USD without a matching fixture FX rate`);
  }
  return { amount: money.amount / fx.rate, currency: 'USD' };
}

function scaleRange(range, multiplier, fx) {
  const low = convertMoney(range.low, fx);
  const expected = convertMoney(range.expected, fx);
  const high = convertMoney(range.high, fx);
  return {
    low: usd(low.amount * multiplier),
    expected: usd(expected.amount * multiplier),
    high: usd(high.amount * multiplier),
    unit: 'trip',
    assumptions: range.assumptions || [],
    provenance: range.provenance,
  };
}

function resolveFixtureRange(ref, catalog) {
  const fixtureName = ref.file.replace(/\.json$/, '');
  const collection = catalog[fixtureName];
  if (!collection) throw new Error(`Unknown fixture collection ${ref.file}`);
  const record = collection.find((item) => item.id === ref.id);
  if (!record) throw new Error(`Unknown fixture ${ref.id} in ${ref.file}`);
  const range = record[ref.range_field];
  if (!range) throw new Error(`Fixture ${ref.id} lacks range field ${ref.range_field}`);
  return { record, range };
}

function makeLineItem(profile, sourceItem, catalog) {
  let range;
  let fixtureRecord;
  if (sourceItem.fixture_ref) {
    const resolved = resolveFixtureRange(sourceItem.fixture_ref, catalog);
    range = resolved.range;
    fixtureRecord = resolved.record;
  } else {
    range = sourceItem.cost;
  }
  if (!range?.provenance) throw new Error(`Line item "${sourceItem.label}" lacks cost provenance`);

  let multiplier = 1;
  const ref = sourceItem.fixture_ref;
  if (ref?.multiplier_field) multiplier *= profile[ref.multiplier_field];
  if (ref?.per_person_multiplier) multiplier *= profile.party_size;
  if (!ref && sourceItem.cost?.unit === 'person') multiplier *= profile.party_size;
  if (!ref && sourceItem.cost?.unit === 'day') {
    multiplier *= sourceItem.category === 'food' ? profile.nights : profile.ski_days;
    if (sourceItem.per_person) multiplier *= profile.party_size;
  }

  const fx = profile.currency_conversion || profile.fx;
  const cost = scaleRange(range, multiplier, fx);
  const item = {
    category: sourceItem.category,
    label: sourceItem.label,
    cost,
    per_person: Boolean(sourceItem.per_person),
    required: sourceItem.required !== false,
    provenance: sourceItem.provenance || cost.provenance,
  };
  const sourceCurrency = range.expected?.currency || range.low?.currency || range.high?.currency;
  if (sourceCurrency && sourceCurrency !== cost.expected.currency) {
    item.original_currency = sourceCurrency;
    item.fx_assumption = `${fx.rate} ${fx.from} = 1 ${fx.to}`;
  }
  if (fixtureRecord?.id) item.fixture_source_id = fixtureRecord.id;
  return item;
}

function collectSource(sourceLinks, provenance) {
  if (!provenance) return;
  const sources = Array.isArray(provenance) ? provenance : [provenance];
  for (const source of sources) {
    const key = `${source.source_name}|${source.source_url || ''}`;
    if (!sourceLinks.has(key)) sourceLinks.set(key, source);
  }
}

function confidenceSummary(lineItems) {
  let lowest = 'exact_live';
  const staleFields = [];
  const unknownFields = [];
  const caveats = [];
  const sourceLinks = new Map();

  for (const item of lineItems) {
    const source = item.cost.provenance;
    if (CONFIDENCE_RANK[source.confidence] > CONFIDENCE_RANK[lowest]) lowest = source.confidence;
    if (source.freshness === 'stale') staleFields.push(item.label);
    if (source.confidence === 'unknown') unknownFields.push(item.label);
    if (source.display_caveat) caveats.push(`${item.label}: ${source.display_caveat}`);
    collectSource(sourceLinks, source);
    collectSource(sourceLinks, item.provenance);
  }

  return {
    confidence_summary: {
      lowest_confidence: lowest,
      stale_fields: staleFields,
      unknown_fields: unknownFields,
      caveats,
    },
    source_links: [...sourceLinks.values()],
  };
}

function calculateTripEstimate(input) {
  if (!Number.isInteger(input.party_size) || input.party_size < 1) {
    throw new Error('party_size must be a positive integer');
  }
  const lineItems = input.line_items || [];
  for (const item of lineItems) {
    if (!item.cost?.provenance) throw new Error(`Line item "${item.label}" lacks cost provenance`);
    for (const key of ['low', 'expected', 'high']) {
      if (item.cost[key]?.currency !== 'USD') throw new Error(`Line item "${item.label}" must be normalized to USD before calculation`);
    }
  }
  const totals = lineItems.reduce((sum, item) => ({
    low: sum.low + item.cost.low.amount,
    expected: sum.expected + item.cost.expected.amount,
    high: sum.high + item.cost.high.amount,
  }), { low: 0, expected: 0, high: 0 });
  const confidence = confidenceSummary(lineItems);
  return {
    id: input.id,
    selected_origin_airport_codes: input.selected_origin_airport_codes,
    selected_country_or_region_id: input.selected_country_or_region_id,
    selected_resort_ids: input.selected_resort_ids,
    party_size: input.party_size,
    nights: input.nights,
    ski_days: input.ski_days,
    dates_or_window: input.dates_or_window,
    flight_options: input.flight_options || [],
    lodging_zone_id: input.lodging_zone_id,
    transfer_option_id: input.transfer_option_id,
    lift_ticket_choice: input.lift_ticket_choice,
    rental_choice: input.rental_choice,
    line_items: lineItems,
    total_low: usd(totals.low),
    total_expected: usd(totals.expected),
    total_high: usd(totals.high),
    per_person_low: usd(totals.low / input.party_size),
    per_person_expected: usd(totals.expected / input.party_size),
    per_person_high: usd(totals.high / input.party_size),
    confidence_summary: confidence.confidence_summary,
    assumptions: input.assumptions || [],
    source_links: confidence.source_links,
    created_at: input.created_at,
    updated_at: input.updated_at,
  };
}

function buildFixtureTripEstimate({ profileId, createdAt = new Date().toISOString() }) {
  const catalog = loadFixtureCatalog();
  const profile = indexById(catalog.trip_profiles).get(profileId);
  if (!profile) throw new Error(`Unknown trip profile fixture: ${profileId}`);
  const lineItems = profile.line_items.map((item) => makeLineItem(profile, item, catalog));
  return calculateTripEstimate({
    id: `estimate-${profile.id}`,
    selected_origin_airport_codes: profile.selected_origin_airport_codes,
    selected_country_or_region_id: profile.selected_country_or_region_id,
    selected_resort_ids: profile.selected_resort_ids,
    party_size: profile.party_size,
    nights: profile.nights,
    ski_days: profile.ski_days,
    dates_or_window: profile.dates_or_window,
    lodging_zone_id: profile.lodging_zone_id,
    transfer_option_id: profile.transfer_option_id,
    line_items: lineItems,
    assumptions: profile.assumptions || [],
    created_at: createdAt,
    updated_at: createdAt,
  });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function defineCollaborationPermissions({ shareId, tripEstimateId, createdAt = new Date().toISOString() }) {
  return deepFreeze({
    share_id: shareId,
    trip_estimate_id: tripEstimateId,
    created_at: createdAt,
    modes: [
      { mode: 'read_only', permissions: { can_view: true, can_comment: false, can_edit: false, can_invite: false } },
      { mode: 'comment', permissions: { can_view: true, can_comment: true, can_edit: false, can_invite: false } },
      { mode: 'edit', permissions: { can_view: true, can_comment: true, can_edit: true, can_invite: false } },
    ],
    rollout_order: [
      'ship read-only snapshot links first',
      'enable friend comments after identity/auth exists',
      'enable editing only after owner approval and audit history exist',
    ],
  });
}

function createShareableTripSnapshot({ estimate, shareId, createdAt = new Date().toISOString(), baseUrl = '' }) {
  const catalog = loadFixtureCatalog();
  const region = catalog.regions.find((candidate) => candidate.id === estimate.selected_country_or_region_id);
  const origins = estimate.selected_origin_airport_codes.map((code) => catalog.airports.find((airport) => airport.code === code) || { code, name: code });
  const cleanBase = String(baseUrl).replace(/\/$/, '');
  const shareUrl = cleanBase ? `${cleanBase}/snapshots/${shareId}.html` : `snapshots/${shareId}.html`;
  return deepFreeze({
    share_id: shareId,
    trip_estimate_id: estimate.id,
    share_url: shareUrl,
    snapshot_version: 1,
    created_at: createdAt,
    access: { mode: 'read_only', collaboration_enabled: false, permissions: { can_view: true, can_comment: false, can_edit: false, can_invite: false } },
    selected_origin_airport_codes: deepClone(estimate.selected_origin_airport_codes),
    origins: origins.map(deepClone),
    destination: region ? { id: region.id, name: region.name, description: region.description, gateway_airport_codes: deepClone(region.gateway_airport_codes) } : { id: estimate.selected_country_or_region_id, name: estimate.selected_country_or_region_id, gateway_airport_codes: [] },
    selected_resort_ids: deepClone(estimate.selected_resort_ids),
    dates_or_window: estimate.dates_or_window,
    party_size: estimate.party_size,
    nights: estimate.nights,
    ski_days: estimate.ski_days,
    total_low: deepClone(estimate.total_low),
    total_expected: deepClone(estimate.total_expected),
    total_high: deepClone(estimate.total_high),
    per_person_expected: deepClone(estimate.per_person_expected),
    line_items: deepClone(estimate.line_items),
    assumptions: deepClone(estimate.assumptions),
    confidence_summary: deepClone(estimate.confidence_summary),
    source_links: deepClone(estimate.source_links),
  });
}

function displayConfidence(confidence) {
  return {
    exact_live: 'Live price',
    exact_observed: 'Observed exact price',
    source_backed_range: 'Source-backed range',
    manual_range: 'Manual range',
    derived_estimate: 'Estimated from route/source data',
    fixture_estimate: 'Prototype fixture estimate',
    unknown: 'Unknown / needs source',
  }[confidence] || confidence;
}

function formatMoneyText(money) {
  return `${money.currency} ${Math.abs(money.amount).toLocaleString('en-US')}`;
}

function findFlightLineItem(estimate) {
  return estimate.line_items.find((item) => item.category === 'flight' || /flight/i.test(item.label));
}

function confidenceLabel({ fareConfidence, tripConfidenceSummary }) {
  if (tripConfidenceSummary.unknown_fields?.length) {
    return fareConfidence === 'exact_live'
      ? 'Mixed confidence: live fare, trip total has unknown fields'
      : 'Mixed confidence: fare observed, trip total has unknown fields';
  }
  if (tripConfidenceSummary.stale_fields?.length) {
    return `Mixed confidence: ${displayConfidence(fareConfidence).toLowerCase()}, stale trip fields need recheck`;
  }
  return `${displayConfidence(fareConfidence)} fare with ${displayConfidence(tripConfidenceSummary.lowest_confidence).toLowerCase()} trip estimate`;
}

function evaluateFlightDeal({ profileId, dealFarePerPerson, fareConfidence, observedAt = new Date().toISOString(), minimumSavingsPercent = 10, minimumSavingsPerPerson = 250 }) {
  if (!fareConfidence) throw new Error('fareConfidence is required for flight deal decisions');
  if (!dealFarePerPerson || dealFarePerPerson.currency !== 'USD' || typeof dealFarePerPerson.amount !== 'number') {
    throw new Error('dealFarePerPerson must be a USD money amount');
  }
  const baseline = buildFixtureTripEstimate({ profileId, createdAt: observedAt });
  const flightItem = findFlightLineItem(baseline);
  if (!flightItem) throw new Error(`Trip profile ${profileId} has no flight line item to replace`);

  const dealEstimateInput = deepClone(baseline);
  const dealFlightItem = findFlightLineItem(dealEstimateInput);
  const dealTripAmount = dealFarePerPerson.amount * baseline.party_size;
  dealFlightItem.cost = {
    low: usd(dealTripAmount),
    expected: usd(dealTripAmount),
    high: usd(dealTripAmount),
    unit: 'trip',
    assumptions: [`Observed sale fare ${formatMoneyText(dealFarePerPerson)} per person replaces fixture flight estimate.`],
    provenance: {
      source_type: fareConfidence === 'exact_live' ? 'live_fare' : 'manual_observation',
      source_name: 'Flight sale fare observation',
      confidence: fareConfidence,
      freshness: fareConfidence === 'exact_live' ? 'live' : 'recent',
      retrieved_at: observedAt,
      display_caveat: 'Observed flight-sale fare only; verify baggage, date fit, and checkout total before booking.',
    },
  };
  dealFlightItem.provenance = dealFlightItem.cost.provenance;

  const dealEstimate = calculateTripEstimate(dealEstimateInput);
  const totalDelta = dealEstimate.total_expected.amount - baseline.total_expected.amount;
  const perPersonDelta = Math.round(totalDelta / baseline.party_size);
  const flightDelta = dealFlightItem.cost.expected.amount - flightItem.cost.expected.amount;
  const savingsAmount = Math.max(0, -totalDelta);
  const savingsPercent = baseline.total_expected.amount > 0 ? Math.round((savingsAmount / baseline.total_expected.amount) * 100) : 0;
  const hasActualSavings = savingsAmount > 0;
  const meetsSavingsThreshold = savingsPercent >= minimumSavingsPercent || -perPersonDelta >= minimumSavingsPerPerson;
  const decision = hasActualSavings && meetsSavingsThreshold
    ? 'book_if_dates_work'
    : 'skip_not_enough_trip_delta';
  const summary = decision === 'book_if_dates_work'
    ? `Sale fare saves ${formatMoneyText(usd(savingsAmount))} vs fixture trip (${savingsPercent}% below fixture trip).`
    : `Only saves ${formatMoneyText(usd(savingsAmount))}; total-trip delta is too small to book on fare alone.`;

  return deepFreeze({
    profile_id: profileId,
    observed_at: observedAt,
    decision,
    confidence_label: confidenceLabel({ fareConfidence, tripConfidenceSummary: dealEstimate.confidence_summary }),
    baseline_total_expected: deepClone(baseline.total_expected),
    deal_total_expected: deepClone(dealEstimate.total_expected),
    total_expected_delta: usd(totalDelta),
    per_person_expected_delta: usd(perPersonDelta),
    flight_expected_delta: usd(flightDelta),
    deal_fare_per_person: deepClone(dealFarePerPerson),
    savings_percent: savingsPercent,
    summary,
    unknown_fields: deepClone(dealEstimate.confidence_summary.unknown_fields),
    stale_fields: deepClone(dealEstimate.confidence_summary.stale_fields),
    caveats: deepClone(dealEstimate.confidence_summary.caveats),
    baseline_estimate_id: baseline.id,
    deal_estimate_id: dealEstimate.id,
  });
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function renderMoney(money) {
  return `${money.currency} ${money.amount.toLocaleString('en-US')}`;
}

function renderTripSnapshotHtml(snapshot) {
  const lineItems = snapshot.line_items.map((item) => {
    const confidence = displayConfidence(item.cost.provenance.confidence);
    const caveat = item.cost.provenance.display_caveat || '';
    return `<tr><td>${escapeHtml(item.label)}</td><td>${renderMoney(item.cost.low)} – ${renderMoney(item.cost.expected)} – ${renderMoney(item.cost.high)}</td><td>${escapeHtml(confidence)}</td><td>${escapeHtml(caveat)}</td></tr>`;
  }).join('\n');
  const sources = snapshot.source_links.map((source) => `<li>${source.source_url ? `<a href="${escapeHtml(source.source_url)}">${escapeHtml(source.source_name)}</a>` : escapeHtml(source.source_name)} — ${escapeHtml(displayConfidence(source.confidence))}</li>`).join('\n');
  const assumptions = snapshot.assumptions.map((assumption) => `<li>${escapeHtml(assumption)}</li>`).join('\n');
  const origins = (snapshot.origins || snapshot.origin_airports || []).map((airport) => `${airport.name} (${airport.code})`).join(', ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Read-only trip snapshot</title></head><body><main><p>Read-only trip snapshot</p><h1>${escapeHtml(snapshot.destination.name)}</h1><p>Origins: ${escapeHtml(origins)}</p><p>Party: ${snapshot.party_size}; Nights: ${snapshot.nights}; Ski days: ${snapshot.ski_days}</p><p>Total expected: ${renderMoney(snapshot.total_expected || snapshot.totals.expected)} (${renderMoney(snapshot.per_person_expected || snapshot.totals.per_person_expected)} per person)</p><table><thead><tr><th>Line item</th><th>Low / expected / high</th><th>Confidence</th><th>Caveat</th></tr></thead><tbody>${lineItems}</tbody></table><h2>Assumptions</h2><ul>${assumptions}</ul><h2>Source links</h2><ul>${sources}</ul></main></body></html>`;
}

module.exports = {
  buildFixtureTripEstimate,
  calculateTripEstimate,
  createShareableTripSnapshot,
  defineCollaborationPermissions,
  evaluateFlightDeal,
  loadFixtureCatalog,
  renderTripSnapshotHtml,
};
