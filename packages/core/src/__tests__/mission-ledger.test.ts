import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MissionLedger } from '../mission-ledger.js';

describe('MissionLedger', () => {
  it('dedupes artifacts and allows bounded passes', () => {
    const ledger = new MissionLedger();
    ledger.createMission({ id: 'mis_demo', objective: 'demo mission', budget: 0.05, sticker: 'DEMO' });

    const first = ledger.addArtifact({ missionId: 'mis_demo', type: 'note', text: 'same content', sticker: 'DEMO' });
    const duplicate = ledger.addArtifact({ missionId: 'mis_demo', type: 'note', text: 'same content', sticker: 'DEMO' });
    expect(duplicate.id).toBe(first.id);

    const pass = ledger.planPass({
      missionId: 'mis_demo',
      role: 'planner',
      model: 'local/free',
      artifactIds: 'all',
      prompt: 'plan next pass',
      estimatedTokensOut: 100,
      maxSpend: 0.05,
      sticker: 'DEMO',
    });

    expect(pass.decision).toBe('allowed');
    expect(ledger.reviewCard(pass.id).nextAction).toMatch(/Ready/);
  });

  it('persists and reloads missions, artifacts, and passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contextclaw-ledger-'));
    const path = join(dir, 'ledger.json');
    try {
      const ledger = new MissionLedger();
      ledger.createMission({ id: 'mis_persist', objective: 'persist mission', budget: 0.05, sticker: 'PERSIST' });
      ledger.addArtifact({ missionId: 'mis_persist', type: 'note', text: 'durable context', sticker: 'PERSIST' });
      const pass = ledger.planPass({
        missionId: 'mis_persist',
        role: 'planner',
        model: 'local/free',
        artifactIds: 'all',
        prompt: 'persist this pass',
        estimatedTokensOut: 100,
        maxSpend: 0.05,
        sticker: 'PERSIST',
      });
      ledger.save(path);

      const loaded = MissionLedger.load(path);
      expect(loaded.reviewCard(pass.id).title).toBe('persist mission');
      expect(loaded.renderReviewCard(pass.id)).toContain('Next action');
      expect(loaded.explain(pass.id)).toContain('within budget');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks over-budget passes and explains why', () => {
    const ledger = new MissionLedger();
    ledger.createMission({ id: 'mis_demo', objective: 'demo mission', budget: 0.01, sticker: 'DEMO' });
    ledger.addArtifact({ missionId: 'mis_demo', type: 'note', text: 'short context', sticker: 'DEMO' });

    const pass = ledger.planPass({
      missionId: 'mis_demo',
      role: 'planner',
      model: 'premium/frontier',
      artifactIds: 'all',
      prompt: 'expensive pass',
      estimatedTokensOut: 100_000,
      maxSpend: 0.001,
      sticker: 'DEMO-BLOCK',
    });

    expect(pass.decision).toBe('blocked');
    expect(pass.reason).toBe('mission budget exceeded');
    expect(ledger.explain(pass.id)).toContain('blocked');
    expect(ledger.reviewCard(pass.id).nextAction).toMatch(/Approve once/);
  });
});
