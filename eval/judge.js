import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const RESULTS_DIR = join(process.env.HOME, '.openclaw', 'workspace', 'contextclaw', 'eval', 'results');

// Heuristic logic to judge pruning
function judgeScenario(scenario) {
  // 1. Was important context preserved?
  // We check if the keywords from the question exist in the pruned context
  const qWords = new Set(scenario.question.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  
  let qWordsInFull = 0;
  for (const w of qWords) {
    if (scenario.fullContext.some(m => JSON.stringify(m).toLowerCase().includes(w))) qWordsInFull++;
  }
  
  let qWordsInPruned = 0;
  for (const w of qWords) {
    if (scenario.prunedContext.some(m => JSON.stringify(m).toLowerCase().includes(w))) qWordsInPruned++;
  }

  const contextPreservationScore = qWordsInFull > 0 ? (qWordsInPruned / qWordsInFull) : 1;

  // 2. Was bloat removed?
  // We check the reduction percentage
  const reductionScore = scenario.reduction > 20 ? 1 : (scenario.reduction / 20);

  return {
    contextPreservationScore,
    reductionScore,
    totalScore: (contextPreservationScore * 0.7) + (reductionScore * 0.3)
  };
}

function runJudge() {
  const files = readdirSync(RESULTS_DIR).filter(f => f.startsWith('eval-') && f.endsWith('.json'));
  if (files.length === 0) {
    console.error('No eval results found to judge.');
    return;
  }
  
  files.sort();
  const latestFile = join(RESULTS_DIR, files[files.length - 1]);
  const data = JSON.parse(readFileSync(latestFile, 'utf-8'));
  
  console.log(`Judging ${latestFile}...`);
  
  const results = data.scenarios.map(s => {
    const j = judgeScenario(s);
    return {
      id: s.id,
      preservation: Math.round(j.contextPreservationScore * 100),
      reduction: Math.round(j.reductionScore * 100),
      score: Math.round(j.totalScore * 100)
    };
  });
  
  const avgPreservation = Math.round(results.reduce((acc, r) => acc + r.preservation, 0) / results.length);
  const avgReduction = Math.round(results.reduce((acc, r) => acc + r.reduction, 0) / results.length);
  const avgScore = Math.round(results.reduce((acc, r) => acc + r.score, 0) / results.length);
  
  console.log(`\nOverall Eval Score: ${avgScore}/100`);
  console.log(`Average Context Preservation: ${avgPreservation}%`);
  console.log(`Average Bloat Reduction: ${avgReduction}%`);
  
  const report = {
    date: new Date().toISOString(),
    sourceFile: files[files.length - 1],
    summary: { avgScore, avgPreservation, avgReduction },
    details: results
  };
  
  writeFileSync(join(RESULTS_DIR, 'judged-results.json'), JSON.stringify(report, null, 2));
  
  // Write to workspace outputs
  const mdPath = join(process.env.HOME, '.openclaw', 'workspace', 'outputs', 'contextclaw-eval-results.md');
  const mdContent = `# ContextClaw Eval Results
Date: ${report.date}

## Summary
- **Overall Eval Score**: ${avgScore}/100
- **Context Preservation**: ${avgPreservation}% (heuristic: question keywords present in retained context)
- **Bloat Reduction**: ${avgReduction}% (heuristic: token count reduced significantly)

## Details
${results.map(r => `- **${r.id}**: Score ${r.score} (Preservation: ${r.preservation}%, Reduction: ${r.reduction}%)`).join('\n')}
`;
  mkdirSync(join(process.env.HOME, '.openclaw', 'workspace', 'outputs'), { recursive: true });
  writeFileSync(mdPath, mdContent);
  console.log(`\nWrote Markdown summary to ${mdPath}`);
}

runJudge();
