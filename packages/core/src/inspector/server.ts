import express from 'express';
import type { ContextClaw } from '../orchestrator.js';

const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ContextClaw Inspector</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; margin: 2rem; }
    h1 { color: #00d4ff; }
    .stats { margin-bottom: 1.5rem; font-size: 1.1rem; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
    .card { background: #16213e; border: 1px solid #0f3460; border-radius: 8px; padding: 1rem; }
    .card .type { color: #00d4ff; font-weight: bold; text-transform: uppercase; font-size: 0.8rem; }
    .card .source { color: #888; font-size: 0.85rem; }
    .card .meta { display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.85rem; color: #aaa; }
    .card .content { margin-top: 0.5rem; font-size: 0.9rem; white-space: pre-wrap; max-height: 120px; overflow: auto; }
  </style>
</head>
<body>
  <h1>ContextClaw Inspector</h1>
  <div class="stats" id="stats"></div>
  <div class="cards" id="cards"></div>
  <script>
    async function refresh() {
      const res = await fetch('/api/state');
      const state = await res.json();
      document.getElementById('stats').innerHTML =
        'Tokens: ' + state.totalTokens + ' / ' + (state.totalTokens + state.budgetTokens) +
        ' &nbsp;|&nbsp; Utilization: ' + state.utilizationPercent + '%' +
        ' &nbsp;|&nbsp; Blocks: ' + state.blocks.length;
      const cards = state.blocks.map(function(b) {
        var age = Math.round((Date.now() - b.createdAt) / 1000);
        return '<div class="card">' +
          '<div class="type">' + b.type + '</div>' +
          '<div class="source">' + (b.source || '-') + '</div>' +
          '<div class="meta"><span>Tokens: ' + b.tokens + '</span><span>Score: ' + b.score.toFixed(2) + '</span><span>Age: ' + age + 's</span></div>' +
          '<div class="content">' + (b.content || '').substring(0, 300) + '</div>' +
          '</div>';
      }).join('');
      document.getElementById('cards').innerHTML = cards;
    }
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;

export async function startInspector(claw: ContextClaw, port: number): Promise<void> {
  const app = express();

  app.get('/', (_req, res) => {
    res.type('html').send(HTML_TEMPLATE);
  });

  app.get('/api/state', (_req, res) => {
    res.json(claw.inspect());
  });

  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`Inspector running at http://localhost:${port}`);
      resolve();
    });
  });
}
