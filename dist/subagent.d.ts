import type { SubagentConfig, SubagentDefaults } from './types.js';
export declare class SubagentLauncher {
    private defaults;
    constructor(defaults: SubagentDefaults);
    buildTaskPrompt(config: SubagentConfig): string;
    getModel(config: SubagentConfig): string;
    getMaxTokens(config: SubagentConfig): number;
    validate(config: SubagentConfig): string[];
}
//# sourceMappingURL=subagent.d.ts.map