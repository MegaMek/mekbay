// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, signal } from '@angular/core';

type LogType = 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
    timestamp: Date;
    type: LogType;
    message: string;
}

@Injectable({ providedIn: 'root' })
export class LoggerService {
    private readonly MAX_LOGS = 1000;
    private readonly logsState = signal<readonly LogEntry[]>([]);
    public readonly logs = this.logsState.asReadonly();
    private pendingLogs: LogEntry[] = [];
    private flushScheduled = false;

    private log(type: LogType, message: string): void {
        const timestamp = new Date();
        this.pendingLogs.push({ timestamp, type, message });
        this.scheduleFlush();

        const timestampStr = '[' + timestamp.toISOString() + ']';
        if (type === 'INFO') console.log(timestampStr, message);
        else if (type === 'WARN') console.warn(timestampStr, message);
        else if (type === 'ERROR') console.error(timestampStr, message);
    }

    private scheduleFlush(): void {
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        queueMicrotask(() => this.flushPendingLogs());
    }

    private flushPendingLogs(): void {
        this.flushScheduled = false;
        if (this.pendingLogs.length === 0) return;

        const pending = this.pendingLogs;
        this.pendingLogs = [];
        this.logsState.update(currentLogs => {
            const pendingTail = pending.length > this.MAX_LOGS
                ? pending.slice(-this.MAX_LOGS)
                : pending;
            const retainedCount = this.MAX_LOGS - pendingTail.length;
            const retainedLogs = retainedCount > 0
                ? currentLogs.slice(-retainedCount)
                : [];
            return [...retainedLogs, ...pendingTail];
        });
    }

    public error(message: string): void {
        this.log('ERROR', message);
    }

    public warn(message: string): void {
        this.log('WARN', message);
    }

    public info(message: string): void {
        this.log('INFO', message);
    }

    handleError(error: any): void {
        const message = error?.message ? error.message : String(error);
        this.error(`Unhandled error: ${message}`);
        console.trace(error);
    }

    public clear(): void {
        this.pendingLogs = [];
        this.logsState.set([]);
    }
}
