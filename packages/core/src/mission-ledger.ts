import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type MissionState = 'planned' | 'running' | 'waiting_approval' | 'paused' | 'complete' | 'failed' | 'killed';
export type PassDecision = 'allowed' | 'blocked' | 'approved' | 'rejected';

export interface Mission {
  id: string;
  objective: string;
  budgetTotal: number;
  budgetRemaining: number;
  state: MissionState;
  acceptanceCriteria?: string;
  sticker?: string;
}

export interface Artifact {
  id: string;
  missionId: string;
  type: string;
  contentHash: string;
  text: string;
  summary: string;
  tokens: number;
  sticker?: string;
}

export interface PassPlan {
  id: string;
  missionId: string;
  role: string;
  model: string;
  artifactIds: string[];
  prompt: string;
  estimatedTokensIn: number;
  estimatedTokensOut: number;
  estimatedCost: number;
  maxSpend: number;
  decision: PassDecision;
  reason?: string;
  sticker?: string;
  manifest: PassManifest;
}

export interface PassManifest {
  promptHash: string;
  assembledContextHash: string;
  artifacts: Array<{ id: string; sticker?: string; tokens: number; summary: string; hash: string }>;
  budgetRemainingBefore: number;
}

export interface ReviewCard {
  title: string;
  mission: Pick<Mission, 'id' | 'state' | 'sticker' | 'budgetRemaining'>;
  pass: Pick<PassPlan, 'id' | 'role' | 'model' | 'decision' | 'estimatedCost' | 'maxSpend' | 'estimatedTokensIn' | 'estimatedTokensOut' | 'reason'>;
  nextAction: string;
  artifacts: PassManifest['artifacts'];
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateCost(tokensIn: number, tokensOut: number, ratePer1k = 0.002): number {
  return ((tokensIn + tokensOut) / 1000) * ratePer1k;
}

export interface MissionLedgerSnapshot {
  missions: Mission[];
  artifacts: Artifact[];
  passes: PassPlan[];
}

export class MissionLedger {
  missions = new Map<string, Mission>();
  artifacts = new Map<string, Artifact>();
  passes = new Map<string, PassPlan>();

  static fromSnapshot(snapshot: MissionLedgerSnapshot): MissionLedger {
    const ledger = new MissionLedger();
    for (const mission of snapshot.missions) ledger.missions.set(mission.id, mission);
    for (const artifact of snapshot.artifacts) ledger.artifacts.set(artifact.id, artifact);
    for (const pass of snapshot.passes) ledger.passes.set(pass.id, pass);
    return ledger;
  }

  static load(path: string): MissionLedger {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as MissionLedgerSnapshot;
    return MissionLedger.fromSnapshot(snapshot);
  }

  snapshot(): MissionLedgerSnapshot {
    return {
      missions: [...this.missions.values()],
      artifacts: [...this.artifacts.values()],
      passes: [...this.passes.values()],
    };
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(this.snapshot(), null, 2)}\n`);
  }

  createMission(input: { id: string; objective: string; budget: number; acceptanceCriteria?: string; sticker?: string }): Mission {
    const mission: Mission = {
      id: input.id,
      objective: input.objective,
      budgetTotal: input.budget,
      budgetRemaining: input.budget,
      state: 'planned',
      acceptanceCriteria: input.acceptanceCriteria,
      sticker: input.sticker,
    };
    this.missions.set(mission.id, mission);
    return mission;
  }

  addArtifact(input: { missionId: string; type: string; text: string; summary?: string; sticker?: string }): Artifact {
    this.mustMission(input.missionId);
    const contentHash = hashText(input.text);
    const existing = [...this.artifacts.values()].find((artifact) => artifact.missionId === input.missionId && artifact.contentHash === contentHash);
    if (existing) return existing;

    const artifact: Artifact = {
      id: `art_${contentHash.slice(0, 12)}`,
      missionId: input.missionId,
      type: input.type,
      contentHash,
      text: input.text,
      summary: input.summary ?? input.text.replace(/\s+/g, ' ').slice(0, 240),
      tokens: estimateTokens(input.text),
      sticker: input.sticker,
    };
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  planPass(input: { missionId: string; role: string; model: string; artifactIds: string[] | 'all'; prompt: string; estimatedTokensOut: number; maxSpend: number; sticker?: string; ratePer1k?: number }): PassPlan {
    const mission = this.mustMission(input.missionId);
    const artifacts = input.artifactIds === 'all'
      ? [...this.artifacts.values()].filter((artifact) => artifact.missionId === input.missionId)
      : input.artifactIds.map((id) => this.mustArtifact(id));

    const deduped = new Map<string, Artifact>();
    for (const artifact of artifacts) deduped.set(artifact.contentHash, artifact);
    const selected = [...deduped.values()];
    const assembled = selected.map((artifact) => `# Artifact ${artifact.id} (${artifact.type}, sticker=${artifact.sticker ?? 'none'})\nSummary: ${artifact.summary}\n\n${artifact.text}`).join('\n\n');
    const estimatedTokensIn = estimateTokens(assembled) + estimateTokens(input.prompt);
    const estimatedCost = estimateCost(estimatedTokensIn, input.estimatedTokensOut, input.ratePer1k);

    let decision: PassDecision = 'allowed';
    let reason: string | undefined;
    if (estimatedCost > input.maxSpend) {
      decision = 'blocked';
      reason = 'pass budget exceeded';
    }
    if (estimatedCost > mission.budgetRemaining) {
      decision = 'blocked';
      reason = 'mission budget exceeded';
    }

    const pass: PassPlan = {
      id: `pass_${hashText(`${input.missionId}:${input.prompt}:${this.passes.size}`).slice(0, 12)}`,
      missionId: input.missionId,
      role: input.role,
      model: input.model,
      artifactIds: selected.map((artifact) => artifact.id),
      prompt: input.prompt,
      estimatedTokensIn,
      estimatedTokensOut: input.estimatedTokensOut,
      estimatedCost,
      maxSpend: input.maxSpend,
      decision,
      reason,
      sticker: input.sticker,
      manifest: {
        promptHash: hashText(input.prompt),
        assembledContextHash: hashText(assembled),
        budgetRemainingBefore: mission.budgetRemaining,
        artifacts: selected.map((artifact) => ({ id: artifact.id, sticker: artifact.sticker, tokens: artifact.tokens, summary: artifact.summary, hash: artifact.contentHash })),
      },
    };

    this.passes.set(pass.id, pass);
    if (decision === 'allowed') {
      mission.budgetRemaining -= estimatedCost;
      mission.state = 'running';
    } else {
      mission.state = 'waiting_approval';
    }
    return pass;
  }

  explain(passId: string): string {
    const pass = this.mustPass(passId);
    const mission = this.mustMission(pass.missionId);
    if (pass.decision === 'blocked') {
      return `Pass ${pass.id} blocked: ${pass.reason}. Estimated spend $${pass.estimatedCost.toFixed(6)}; pass max $${pass.maxSpend.toFixed(6)}; mission remaining before pass $${pass.manifest.budgetRemainingBefore.toFixed(6)}.`;
    }
    return `Pass ${pass.id} ${pass.decision}. Estimated spend $${pass.estimatedCost.toFixed(6)} was within budget for mission ${mission.id}.`;
  }

  reviewCard(passId: string): ReviewCard {
    const pass = this.mustPass(passId);
    const mission = this.mustMission(pass.missionId);
    return {
      title: mission.objective,
      mission: { id: mission.id, state: mission.state, sticker: mission.sticker, budgetRemaining: mission.budgetRemaining },
      pass: {
        id: pass.id,
        role: pass.role,
        model: pass.model,
        decision: pass.decision,
        estimatedCost: pass.estimatedCost,
        maxSpend: pass.maxSpend,
        estimatedTokensIn: pass.estimatedTokensIn,
        estimatedTokensOut: pass.estimatedTokensOut,
        reason: pass.reason,
      },
      artifacts: pass.manifest.artifacts,
      nextAction: pass.decision === 'blocked'
        ? 'Approve once, reduce scope, or keep waiting'
        : pass.decision === 'rejected'
          ? 'Revise scope, create a smaller pass, or keep mission paused'
          : 'Ready for model/tool execution or next pass',
    };
  }

  approvePass(passId: string, options: { increaseBudget?: number } = {}): PassPlan {
    const pass = this.mustPass(passId);
    const mission = this.mustMission(pass.missionId);
    if (pass.decision !== 'blocked') throw new Error(`Pass is not blocked: ${pass.id}`);
    const increaseBudget = options.increaseBudget ?? 0;
    if (increaseBudget > 0) {
      mission.budgetTotal += increaseBudget;
      mission.budgetRemaining += increaseBudget;
    }
    if (pass.estimatedCost > mission.budgetRemaining) {
      throw new Error(`Approval needs more budget: estimated $${pass.estimatedCost.toFixed(6)}, remaining $${mission.budgetRemaining.toFixed(6)}`);
    }
    mission.budgetRemaining -= pass.estimatedCost;
    mission.state = 'running';
    pass.decision = 'approved';
    pass.reason = 'manual approve once';
    return pass;
  }

  rejectPass(passId: string, reason = 'manual reject'): PassPlan {
    const pass = this.mustPass(passId);
    const mission = this.mustMission(pass.missionId);
    if (pass.decision !== 'blocked' && pass.decision !== 'allowed') throw new Error(`Pass cannot be rejected from state ${pass.decision}: ${pass.id}`);
    pass.decision = 'rejected';
    pass.reason = reason;
    mission.state = 'paused';
    return pass;
  }

  revisePass(passId: string, input: { prompt: string; estimatedTokensOut: number; maxSpend: number; model?: string; role?: string; sticker?: string }): PassPlan {
    const source = this.mustPass(passId);
    const mission = this.mustMission(source.missionId);
    const revised = this.planPass({
      missionId: source.missionId,
      role: input.role ?? source.role,
      model: input.model ?? source.model,
      artifactIds: source.artifactIds,
      prompt: input.prompt,
      estimatedTokensOut: input.estimatedTokensOut,
      maxSpend: input.maxSpend,
      sticker: input.sticker ?? source.sticker,
    });
    if (source.decision === 'blocked' || source.decision === 'rejected') {
      mission.state = revised.decision === 'blocked' ? 'waiting_approval' : 'running';
    }
    return revised;
  }

  renderReviewCard(passId: string): string {
    const card = this.reviewCard(passId);
    return [
      `## ${card.title}`,
      `Mission: \`${card.mission.id}\` | Sticker: \`${card.mission.sticker ?? 'none'}\` | State: **${card.mission.state}**`,
      `Pass: \`${card.pass.id}\` | Role: \`${card.pass.role}\` | Model: \`${card.pass.model}\` | Decision: **${card.pass.decision}**`,
      `Spend: estimated \`$${card.pass.estimatedCost.toFixed(6)}\` | pass max \`$${card.pass.maxSpend.toFixed(6)}\` | mission remaining \`$${card.mission.budgetRemaining.toFixed(6)}\``,
      `Tokens: ${card.pass.estimatedTokensIn} in / ${card.pass.estimatedTokensOut} out`,
      `Reason: ${card.pass.reason ?? 'within budget'}`,
      '',
      'Artifacts:',
      ...card.artifacts.map((artifact) => `- \`${artifact.id}\` [${artifact.sticker ?? 'no-sticker'}], ~${artifact.tokens} tokens: ${artifact.summary.slice(0, 120)}`),
      '',
      `Next action: **${card.nextAction}**`,
    ].join('\n');
  }

  private mustMission(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error(`No mission: ${id}`);
    return mission;
  }

  private mustArtifact(id: string): Artifact {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new Error(`No artifact: ${id}`);
    return artifact;
  }

  private mustPass(id: string): PassPlan {
    const pass = this.passes.get(id);
    if (!pass) throw new Error(`No pass: ${id}`);
    return pass;
  }
}
