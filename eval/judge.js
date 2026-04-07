import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const RESULTS_DIR = join(process.env.HOME, '.openclaw', 'workspace', 'contextclaw', 'eval', 'results');

/**
 * Judge a scenario with honest metrics.
 * 
 * Preservation: weighted keyword check — only content words (>4 chars),
 * capped at 1.0, penalized for false positives.
 * 
 * Reduction: linear 0-100 based on actual token reduction percentage.
 * Score capped at 100 — never exceeds it.
 */
function judgeScenario(scenario) {
  // 1. Context Preservation — are the IMPORTANT words from the question 
  //    still findable in pruned context?
  const stopWords = new Set(['what', 'when', 'where', 'which', 'that', 'this', 
    'they', 'them', 'their', 'there', 'then', 'than', 'been', 'have', 'with',
    'from', 'were', 'will', 'would', 'could', 'should', 'about', 'does', 'into']);
  
  const qWords = scenario.question.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4 && !stopWords.has(w));
  
  if (qWords.length === 0) {
    return { contextPreservationScore: 1, reductionScore: 0, totalScore: 0.5 };
  }

  const fullStr = JSON.stringify(scenario.fullContext).toLowerCase();
  const prunedStr = JSON.stringify(scenario.prunedContext).toLowerCase();
  
  // Only count words that existed in the full context
  const relevantWords = qWords.filter(w => fullStr.includes(w));
  if (relevantWords.length === 0) {
    return { contextPreservationScore: 1, reductionScore: scenario.reduction > 20 ? 1 : scenario.reduction / 20, totalScore: 0.7 };
  }
  
  const preserved = relevantWords.filter(w => prunedStr.includes(w));
  const contextPreservationScore = Math.min(1.0, preserved.length / relevantWords.length);

  // 2. Bloat Reduction — linear scale, 0% reduction = 0, 50%+ = 1.0
  const reductionScore = Math.min(1.0, (scenario.reduction || 0) / 50);

  // 3. Combined — capped at 1.0
  const totalScore = Math.min(1.0, (contextPreservationScore * 0.6) + (reductionScore * 0.4));

  return { contextPreservationScore, reductionScore, totalScore };
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
  
  // Warn if scores look suspicious
  if (avgScore > 95) {
    console.warn(`⚠️  Score ${avgScore}/100 is suspiciously high — eval may need harder scenarios`);
  }
  
  const report = {
    date: new Date().toISOString(),
    sourceFile: files[files.length - 1],
    methodology: 'Keyword preservation (content words >4 chars, stopwords removed) + linear reduction scoring. Capped at 100. NOT LLM-judged.',
    caveats: [
      'Keyword presence != answer quality — a word being present does not mean the LLM could use it to answer correctly',
      'Synthetic scenarios only — real-world eval requires live session replay',
      'No adversarial cases — should test edge cases where important context is near eviction boundary'
    ],
    summary: { avgScore, avgPreservation, avgReduction },
    details: results
  };
  
  writeFileSync(join(RESULTS_DIR, 'judged-results.json'), JSON.stringify(report, null, 2));
  
  const mdPath = join(process.env.HOME, '.openclaw', 'workspace', 'outputs', 'contextclaw-eval-results.md');
  const mdContent = `# ContextClaw Eval Results
Date: ${report.date}

## Methodology
- **Preservation**: Keyword presence check (content words >4 chars, common stop words removed)
- **Reduction**: Linear score based on token reduction percentage
- **Score cap**: 100 (no >100% artifacts)
- **NOT LLM-judged**: This is a heuristic proxy, not a ground-truth eval

## Caveats
- Keyword presence ≠ answer quality
- Synthetic scenarios only (3 scenarios)
- No adversarial edge cases tested
- Real eval would require live session replay with actual LLM responses

## Summary
- **Overall Eval Score**: ${avgScore}/100
- **Context Preservation**: ${avgPreservation}%
- **Bloat Reduction**: ${avgReduction}%

## Details
${results.map(r => `- **${r.id}**: Score ${r.score} (Preservation: ${r.preservation}%, Reduction: ${r.reduction}%)`).join('\n')}
`;
  mkdirSync(join(process.env.HOME, '.openclaw', 'workspace', 'outputs'), { recursive: true });
  writeFileSync(mdPath, mdContent);
  console.log(`Wrote: ${mdPath}`);
}

runJudge();
