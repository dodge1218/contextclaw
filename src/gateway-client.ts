import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class GatewayClient {
  private ws: WebSocket | null = null;
  private token: string = '';

  private readToken(): string {
    try {
      const configPath = join(homedir(), '.openclaw', 'openclaw.json');
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);
      return config?.gateway?.auth?.token ?? '';
    } catch {
      return '';
    }
  }

  async connect(url: string, token?: string): Promise<void> {
    this.token = token ?? this.readToken();
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
      this.ws = new WebSocket(url, { headers });
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
    });
  }

  async send(message: string): Promise<string> {
    if (!this.ws) throw new Error('Not connected');
    return new Promise((resolve, reject) => {
      const ws = this.ws!;
      const handler = (data: WebSocket.RawData) => {
        ws.off('message', handler);
        try {
          const parsed = JSON.parse(data.toString());
          resolve(parsed.content ?? parsed.message ?? data.toString());
        } catch {
          resolve(data.toString());
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ type: 'message', content: message }), (err) => {
        if (err) reject(err);
      });
    });
  }

  async getSessionInfo(): Promise<{ sessionId: string; tokens: number }> {
    if (!this.ws) throw new Error('Not connected');
    return new Promise((resolve, reject) => {
      const ws = this.ws!;
      const handler = (data: WebSocket.RawData) => {
        ws.off('message', handler);
        try {
          const parsed = JSON.parse(data.toString());
          resolve({ sessionId: parsed.sessionId ?? '', tokens: parsed.tokens ?? 0 });
        } catch {
          reject(new Error('Failed to parse session info'));
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ type: 'session-info' }), (err) => {
        if (err) reject(err);
      });
    });
  }

  async clearSession(): Promise<void> {
    if (!this.ws) throw new Error('Not connected');
    return new Promise((resolve, reject) => {
      const ws = this.ws!;
      const handler = () => {
        ws.off('message', handler);
        resolve();
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ type: 'session-clear' }), (err) => {
        if (err) reject(err);
      });
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
