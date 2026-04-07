import { ContextClawEngine } from '../plugin/index.js';
import { classifyAll } from '../plugin/classifier.js';

const engine = new ContextClawEngine();
import { writeFileSync } from 'node:fs';

function makeMsg(role, content, toolId) {
  const m = { role, content };
  if (toolId) m.tool_call_id = toolId;
  return m;
}

function randomText(chars) {
  const words = 'const function return import export class async await if else for while break continue switch case default try catch throw new delete typeof instanceof void this super extends implements interface enum abstract static readonly public private protected get set yield from of in as is let var do with debugger'.split(' ');
  let t = '';
  while (t.length < chars) t += words[Math.floor(Math.random() * words.length)] + ' ';
  return t.slice(0, chars);
}

function buildSession(name, fileReads, cmdOutputs, errorTraces, configDumps) {
  const msgs = [];
  msgs.push(makeMsg('system', 'You are a helpful coding assistant. Follow instructions carefully. Use tools when needed. ' + randomText(500)));
  
  let turnIdx = 0;
  for (let i = 0; i < 50; i++) {
    if (i < fileReads) {
      msgs.push(makeMsg('user', `Read the file src/module${i}.ts`));
      const size = 1000 + Math.floor(Math.random() * 34000);
      msgs.push(makeMsg('tool', randomText(size), `call_${i}`));
      msgs.push(makeMsg('assistant', `I've read the file. It contains ${size} characters of code.`));
    } else if (i < fileReads + cmdOutputs) {
      msgs.push(makeMsg('user', `Run npm test`));
      const size = 500 + Math.floor(Math.random() * 4500);
      msgs.push(makeMsg('tool', '$ npm test\n' + randomText(size), `call_${i}`));
      msgs.push(makeMsg('assistant', 'Tests completed. Let me analyze the results.'));
    } else if (i < fileReads + cmdOutputs + errorTraces) {
      msgs.push(makeMsg('user', 'What went wrong?'));
      msgs.push(makeMsg('tool', 'Error: ECONNREFUSED\n    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)\n' + randomText(2000), `call_${i}`));
      msgs.push(makeMsg('assistant', 'The connection was refused. Let me check the server.'));
    } else if (i < fileReads + cmdOutputs + errorTraces + configDumps) {
      msgs.push(makeMsg('user', 'Show me the config'));
      msgs.push(makeMsg('tool', '{\n  "compilerOptions": {\n' + randomText(3000) + '\n  }\n}', `call_${i}`));
      msgs.push(makeMsg('assistant', 'Here is the configuration.'));
    } else {
      msgs.push(makeMsg('user', `Question ${i}: How do I implement ${randomText(50)}?`));
      msgs.push(makeMsg('assistant', `Here's how: ${randomText(200)}`));
    }
  }
  return { name, msgs };
}

const sessions = [
  buildSession('Heavy file reader', 15, 5, 3, 2),
  buildSession('Build & test loop', 5, 15, 5, 3),
  buildSession('Debugging session', 8, 5, 10, 2),
  buildSession('Config exploration', 5, 3, 2, 10),
  buildSession('Balanced session', 8, 8, 4, 5),
];

async function run() {
const results = [];
for (const { name, msgs } of sessions) {
  const classified = classifyAll(msgs);
  const sessionId = `bench-${name.toLowerCase().replace(/\s+/g, '-')}`;
  await engine.bootstrap({ sessionId });
  
  const start = performance.now();
  const { messages: assembled } = await engine.assemble({ sessionId, messages: classified, tokenBudget: 128000 });
  const elapsed = performance.now() - start;
  
  const inputChars = msgs.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
  const outputChars = assembled.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);
  const reduction = ((1 - outputChars / inputChars) * 100).toFixed(1);
  
  const truncated = assembled.filter(m => m._truncated).length;
  
  results.push({ name, msgs: msgs.length, inputTokens, outputTokens, reduction, elapsed: elapsed.toFixed(1), truncated });
}

let md = '# ContextClaw Benchmark Results\n\n';
md += `Date: ${new Date().toISOString()}\n\n`;
md += '| Session | Messages | Input Tokens | Output Tokens | Reduction | Time (ms) | Truncated |\n';
md += '|---------|----------|-------------|--------------|-----------|-----------|----------|\n';
for (const r of results) {
  md += `| ${r.name} | ${r.msgs} | ${r.inputTokens.toLocaleString()} | ${r.outputTokens.toLocaleString()} | ${r.reduction}% | ${r.elapsed} | ${r.truncated} |\n`;
}

const avgReduction = (results.reduce((s, r) => s + parseFloat(r.reduction), 0) / results.length).toFixed(1);
const totalInput = results.reduce((s, r) => s + r.inputTokens, 0);
const totalOutput = results.reduce((s, r) => s + r.outputTokens, 0);
md += `\n**Average reduction: ${avgReduction}%** | Total: ${totalInput.toLocaleString()} → ${totalOutput.toLocaleString()} tokens\n`;

console.log(md);
writeFileSync(new URL('./results/benchmark-results.md', import.meta.url), md);
console.log('\nWritten to eval/results/benchmark-results.md');
}
run();
