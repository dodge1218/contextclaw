import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatEcoReport,
  summarizeDataPoints,
  tokensToFootprint,
} from '../eco-report.js';

test('tokensToFootprint converts saved tokens into carbon equivalents', () => {
  const footprint = tokensToFootprint(8_347_815, {
    whPerToken: 0.001,
    gridGCo2PerKwh: 385,
  });

  assert.equal(footprint.kWh, 8.348);
  assert.equal(footprint.gCO2e, 3214);
  assert.equal(footprint.equivalents.milesDriven, 8);
  assert.equal(footprint.equivalents.phoneCharges, 402);
});

test('summarizeDataPoints totals existing ContextClaw tracker points', () => {
  const summary = summarizeDataPoints([
    { tokensSaved: 1000, charsSaved: 4000, truncatedCount: 2 },
    { tokensSaved: 2500, charsSaved: 10000, truncatedCount: 1 },
    { tokensSaved: -99, charsSaved: undefined, truncatedCount: 0 },
  ]);

  assert.equal(summary.items, 3);
  assert.equal(summary.tokensSaved, 3500);
  assert.equal(summary.charsSaved, 14000);
  assert.equal(summary.truncatedCount, 3);
});

test('formatEcoReport includes the key human-readable fields', () => {
  const report = formatEcoReport(summarizeDataPoints([
    { tokensSaved: 1000000, charsSaved: 4000000, truncatedCount: 8 },
  ]), 'Short Gemini narration.');

  assert.match(report, /ContextClaw Eco-Report/);
  assert.match(report, /Tokens saved\s+: 1,000,000/);
  assert.match(report, /Gemini says:/);
  assert.match(report, /Short Gemini narration/);
});
