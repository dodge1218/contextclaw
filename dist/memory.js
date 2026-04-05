"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStore = void 0;
const promises_1 = require("fs/promises");
const path_1 = require("path");
class MemoryStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    async init() {
        await (0, promises_1.mkdir)(this.dir, { recursive: true });
    }
    async flush(block) {
        try {
            await this.init();
            const filename = `evicted-${block.id}-${Date.now()}.md`;
            const path = (0, path_1.join)(this.dir, filename);
            const content = [
                `# Evicted Context Block`,
                `- ID: ${block.id}`,
                `- Type: ${block.type}`,
                `- Source: ${block.source || 'unknown'}`,
                `- Score: ${block.score}`,
                `- Created: ${new Date(block.createdAt).toISOString()}`,
                `- Evicted: ${new Date().toISOString()}`,
                ``,
                `## Content`,
                block.content,
            ].join('\n');
            await (0, promises_1.writeFile)(path, content, 'utf-8');
            return path;
        }
        catch (err) {
            console.error(`[ContextClaw] Failed to flush block ${block.id}:`, err);
            return null;
        }
    }
    async search(query, maxResults = 5) {
        await this.init();
        const files = await (0, promises_1.readdir)(this.dir);
        const results = [];
        const queryLower = query.toLowerCase();
        for (const file of files) {
            if (!file.endsWith('.md'))
                continue;
            const path = (0, path_1.join)(this.dir, file);
            const content = await (0, promises_1.readFile)(path, 'utf-8');
            const contentLower = content.toLowerCase();
            // Simple keyword scoring — replace with embeddings in v2
            const words = queryLower.split(/\s+/);
            const hits = words.filter(w => contentLower.includes(w)).length;
            if (hits === 0)
                continue;
            const score = hits / words.length;
            const idx = contentLower.indexOf(words[0]);
            const snippet = content.slice(Math.max(0, idx - 50), idx + 200);
            results.push({ path, snippet, score });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
    }
}
exports.MemoryStore = MemoryStore;
//# sourceMappingURL=memory.js.map