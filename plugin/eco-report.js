#!/usr/bin/env node

/**
 * ContextClaw eco-report
 *
 * Converts token savings into a conservative energy/carbon estimate and,
 * when requested, asks Gemini to narrate the already-computed numbers.
 */

const DEFAULT_WH_PER_TOKEN = Number(process.env.CONTEXTCLAW_WH_PER_TOKEN || 0.001);
const DEFAULT_GRID_G_CO2_PER_KWH = Number(process.env.CONTEXTCLAW_GRID_G_CO2_PER_KWH || 385);
const G_CO2_PER_MILE = 404;
const G_CO2_PER_PHONE_CHARGE = 8;
const KWH_PER_FRIDGE_DAY = 1.5;

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function tokensToFootprint(tokensSaved, options = {}) {
  const whPerToken = Number(options.whPerToken ?? DEFAULT_WH_PER_TOKEN);
  const gridFactor = Number(options.gridGCo2PerKwh ?? DEFAULT_GRID_G_CO2_PER_KWH);
  const safeTokens = Math.max(0, Number(tokensSaved) || 0);
  const kWh = (safeTokens * whPerToken) / 1000;
  const gCO2e = kWh * gridFactor;

  return {
    tokensSaved: safeTokens,
    kWh: round(kWh, 3),
    gCO2e: Math.round(gCO2e),
    assumptions: {
      whPerToken,
      gridGCo2PerKwh: gridFactor,
      gCo2PerMile: G_CO2_PER_MILE,
      gCo2PerPhoneCharge: G_CO2_PER_PHONE_CHARGE,
    },
    equivalents: {
      milesDriven: round(gCO2e / G_CO2_PER_MILE, 1),
      phoneCharges: Math.round(gCO2e / G_CO2_PER_PHONE_CHARGE),
      fridgeDays: round(kWh / KWH_PER_FRIDGE_DAY, 1),
    },
  };
}

function summarizeDataPoints(dataPoints = [], options = {}) {
  const totals = dataPoints.reduce((acc, point) => {
    acc.items += 1;
    acc.tokensSaved += Math.max(0, Number(point.tokensSaved) || 0);
    acc.charsSaved += Math.max(0, Number(point.charsSaved) || 0);
    acc.truncatedCount += Math.max(0, Number(point.truncatedCount) || 0);
    return acc;
  }, { items: 0, tokensSaved: 0, charsSaved: 0, truncatedCount: 0 });

  return {
    ...totals,
    footprint: tokensToFootprint(totals.tokensSaved, options),
  };
}

function formatEcoReport(summary, narration = '') {
  const f = summary.footprint;
  const lines = [
    'ContextClaw Eco-Report',
    '----------------------',
    `Items processed        : ${summary.items.toLocaleString()}`,
    `Tokens saved           : ${summary.tokensSaved.toLocaleString()}`,
    `Characters saved       : ${summary.charsSaved.toLocaleString()}`,
    `Truncations recorded   : ${summary.truncatedCount.toLocaleString()}`,
    `Energy avoided         : ${f.kWh.toLocaleString()} kWh`,
    `CO2e avoided           : ${f.gCO2e.toLocaleString()} g`,
    `Roughly equivalent to  : ${f.equivalents.milesDriven.toLocaleString()} miles driven`,
    `                         OR ${f.equivalents.phoneCharges.toLocaleString()} phone charges`,
    `                         OR ${f.equivalents.fridgeDays.toLocaleString()} fridge-days`,
  ];

  if (narration) {
    lines.push('', 'Gemini says:', narration.trim());
  }

  return lines.join('\n');
}

async function narrateWithGemini(summary, apiKey = process.env.GEMINI_API_KEY) {
  if (!apiKey) {
    return '';
  }

  const prompt = `Write a terse, punchy, three-sentence plain-English environmental summary of this ContextClaw session. Use the provided numbers only; do not do new arithmetic.\n\n${JSON.stringify(summary, null, 2)}`;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return body.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function parseArgs(argv) {
  const args = { gemini: false };
  for (const arg of argv) {
    if (arg === '--gemini') args.gemini = true;
    else if (arg.startsWith('--grid-factor=')) args.gridGCo2PerKwh = Number(arg.split('=')[1]);
    else if (arg.startsWith('--wh-per-token=')) args.whPerToken = Number(arg.split('=')[1]);
    else if (!args.file) args.file = arg;
  }
  return args;
}

async function main() {
  const { readFileSync } = await import('node:fs');
  const args = parseArgs(process.argv.slice(2));
  const raw = args.file ? readFileSync(args.file, 'utf8') : await new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
  });

  const data = JSON.parse(raw || '{}');
  const dataPoints = Array.isArray(data) ? data : (data.dataPoints || data.sessions || []);
  const summary = summarizeDataPoints(dataPoints, args);
  const narration = args.gemini ? await narrateWithGemini(summary) : '';
  console.log(formatEcoReport(summary, narration));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

export {
  tokensToFootprint,
  summarizeDataPoints,
  formatEcoReport,
  narrateWithGemini,
};
