import type { SubagentConfig, SubagentDefaults } from './types.js';

export class SubagentLauncher {
  private defaults: SubagentDefaults;

  constructor(defaults: SubagentDefaults) {
    this.defaults = defaults;
  }

  buildTaskPrompt(config: SubagentConfig): string {
    const lines: string[] = [];

    lines.push(`You are a ${config.role}.`);
    lines.push(`Your job: ${config.task}`);
    lines.push('');

    if (config.files?.length) {
      lines.push('Files you need:');
      for (const f of config.files) lines.push(`- ${f}`);
      lines.push('');
    }

    if (config.skill) {
      lines.push(`Skill reference: read ${config.skill} for detailed instructions.`);
      lines.push('');
    }

    lines.push(`Exit criteria: ${config.exitCriteria}`);
    lines.push('');

    if (config.raiseHand ?? true) {
      const attempts = this.defaults.raiseHandAfter || 2;
      lines.push(`If you hit an error you can't resolve in ${attempts} attempts, STOP and report:`);
      lines.push('- What you tried');
      lines.push('- What failed');
      lines.push('- What you need from the parent agent');
      lines.push('Do NOT retry endlessly. Do NOT read files outside the scope above.');
    }

    return lines.join('\n');
  }

  getModel(config: SubagentConfig): string {
    return config.model || this.defaults.model || 'groq/llama-3.3-70b-versatile';
  }

  getMaxTokens(config: SubagentConfig): number {
    return config.maxContextTokens || this.defaults.maxContextTokens;
  }

  validate(config: SubagentConfig): string[] {
    const errors: string[] = [];
    if (!config.task) errors.push('task is required');
    if (!config.exitCriteria) errors.push('exitCriteria is required');
    if (!config.role) errors.push('role is required');

    const prompt = this.buildTaskPrompt(config);
    // Rough estimate: 1 token ≈ 4 chars
    const estimatedTokens = Math.ceil(prompt.length / 4);
    if (estimatedTokens > 2000) {
      errors.push(`task prompt is ~${estimatedTokens} tokens (max 2000). Split the task.`);
    }

    return errors;
  }
}
