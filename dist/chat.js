"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startChat = startChat;
const node_readline_1 = require("node:readline");
const gateway_client_js_1 = require("./gateway-client.js");
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
function formatBudget(claw) {
    const state = claw.inspect();
    const used = Math.round(state.totalTokens / 1000);
    const total = Math.round((state.totalTokens + state.budgetTokens) / 1000);
    return `${CYAN}[${used}K/${total}K]${RESET} > `;
}
async function startChat(claw, wsUrl) {
    const client = new gateway_client_js_1.GatewayClient();
    console.log(`${DIM}Connecting to ${wsUrl}...${RESET}`);
    try {
        await client.connect(wsUrl);
    }
    catch (err) {
        console.error(`${YELLOW}Could not connect to gateway. Running in local-only mode.${RESET}`);
    }
    const rl = (0, node_readline_1.createInterface)({
        input: process.stdin,
        output: process.stdout,
        prompt: formatBudget(claw),
    });
    console.log(`${GREEN}ContextClaw Chat${RESET} ${DIM}(type /help for commands)${RESET}`);
    rl.prompt();
    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }
        if (input === '/clear') {
            try {
                await client.clearSession();
                console.log(`${GREEN}Session cleared.${RESET}`);
            }
            catch {
                console.log(`${YELLOW}Clear failed (not connected to gateway).${RESET}`);
            }
        }
        else if (input === '/status') {
            const state = claw.inspect();
            console.log(`${CYAN}Blocks:${RESET} ${state.blocks.length}`);
            console.log(`${CYAN}Tokens:${RESET} ${state.totalTokens} / ${state.totalTokens + state.budgetTokens}`);
            console.log(`${CYAN}Utilization:${RESET} ${state.utilizationPercent}%`);
        }
        else if (input === '/inspect') {
            const { startInspector } = await import('./inspector/server.js');
            await startInspector(claw, 3333);
            console.log(`${GREEN}Inspector running at http://localhost:3333${RESET}`);
        }
        else if (input === '/help') {
            console.log(`${DIM}/clear   — clear session${RESET}`);
            console.log(`${DIM}/status  — show context stats${RESET}`);
            console.log(`${DIM}/inspect — launch web inspector${RESET}`);
        }
        else {
            // Ingest user message into budget
            await claw.ingest({
                type: 'user',
                content: input,
                tokens: Math.ceil(input.length / 4), // rough estimate
            });
            try {
                const response = await client.send(input);
                console.log(`\n${GREEN}Assistant:${RESET} ${response}\n`);
            }
            catch {
                console.log(`${YELLOW}(gateway unavailable)${RESET}`);
            }
        }
        rl.setPrompt(formatBudget(claw));
        rl.prompt();
    });
    rl.on('close', () => {
        client.close();
        process.exit(0);
    });
}
//# sourceMappingURL=chat.js.map