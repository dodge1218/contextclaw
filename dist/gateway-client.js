"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayClient = void 0;
const ws_1 = __importDefault(require("ws"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
class GatewayClient {
    ws = null;
    token = '';
    readToken() {
        try {
            const configPath = (0, node_path_1.join)((0, node_os_1.homedir)(), '.openclaw', 'openclaw.json');
            const raw = (0, node_fs_1.readFileSync)(configPath, 'utf-8');
            const config = JSON.parse(raw);
            return config?.gateway?.auth?.token ?? '';
        }
        catch {
            return '';
        }
    }
    async connect(url, token) {
        this.token = token ?? this.readToken();
        return new Promise((resolve, reject) => {
            const headers = {};
            if (this.token)
                headers['Authorization'] = `Bearer ${this.token}`;
            this.ws = new ws_1.default(url, { headers });
            this.ws.on('open', () => resolve());
            this.ws.on('error', (err) => reject(err));
        });
    }
    async send(message) {
        if (!this.ws)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            const ws = this.ws;
            const handler = (data) => {
                ws.off('message', handler);
                try {
                    const parsed = JSON.parse(data.toString());
                    resolve(parsed.content ?? parsed.message ?? data.toString());
                }
                catch {
                    resolve(data.toString());
                }
            };
            ws.on('message', handler);
            ws.send(JSON.stringify({ type: 'message', content: message }), (err) => {
                if (err)
                    reject(err);
            });
        });
    }
    async getSessionInfo() {
        if (!this.ws)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            const ws = this.ws;
            const handler = (data) => {
                ws.off('message', handler);
                try {
                    const parsed = JSON.parse(data.toString());
                    resolve({ sessionId: parsed.sessionId ?? '', tokens: parsed.tokens ?? 0 });
                }
                catch {
                    reject(new Error('Failed to parse session info'));
                }
            };
            ws.on('message', handler);
            ws.send(JSON.stringify({ type: 'session-info' }), (err) => {
                if (err)
                    reject(err);
            });
        });
    }
    async clearSession() {
        if (!this.ws)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            const ws = this.ws;
            const handler = () => {
                ws.off('message', handler);
                resolve();
            };
            ws.on('message', handler);
            ws.send(JSON.stringify({ type: 'session-clear' }), (err) => {
                if (err)
                    reject(err);
            });
        });
    }
    close() {
        this.ws?.close();
        this.ws = null;
    }
}
exports.GatewayClient = GatewayClient;
//# sourceMappingURL=gateway-client.js.map