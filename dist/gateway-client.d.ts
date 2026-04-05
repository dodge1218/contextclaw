export declare class GatewayClient {
    private ws;
    private token;
    private readToken;
    connect(url: string, token?: string): Promise<void>;
    send(message: string): Promise<string>;
    getSessionInfo(): Promise<{
        sessionId: string;
        tokens: number;
    }>;
    clearSession(): Promise<void>;
    close(): void;
}
//# sourceMappingURL=gateway-client.d.ts.map