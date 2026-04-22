import type { CdpConnection } from './connection.js';
export type ConsoleLevel = 'log' | 'debug' | 'info' | 'error' | 'warning' | 'dir' | 'dirxml' | 'table' | 'trace' | 'clear' | 'startGroup' | 'startGroupCollapsed' | 'endGroup' | 'assert' | 'profile' | 'profileEnd' | 'count' | 'timeEnd';
export interface ConsoleMessage {
    type: ConsoleLevel;
    text: string;
    url?: string;
    lineNumber?: number;
    timestamp: number;
}
type ConsoleHandler = (message: ConsoleMessage) => void;
export declare class ConsoleDomain {
    private conn;
    private sessionId?;
    private handlers;
    private messages;
    private enabled;
    constructor(conn: CdpConnection, sessionId?: string | undefined);
    enable(): Promise<void>;
    onMessage(handler: ConsoleHandler): void;
    offMessage(handler: ConsoleHandler): void;
    getMessages(): ConsoleMessage[];
    getErrors(): ConsoleMessage[];
    clear(): void;
}
export {};
//# sourceMappingURL=console.d.ts.map