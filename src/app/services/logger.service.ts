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

    handleError(error: unknown): void {
        this.error(`Unhandled error:\n${this.formatErrorDetails(error)}`);
        console.error(error);
    }

    private formatErrorDetails(error: unknown, seen = new Set<object>()): string {
        if (typeof error !== 'object' || error === null) return String(error);
        if (seen.has(error)) return '[Circular error cause]';
        seen.add(error);

        if (error instanceof Error) {
            const details = [`${error.name}: ${error.message}`];
            if (error.stack) details.push(error.stack);
            if (error.cause !== undefined) {
                details.push(`Caused by:\n${this.formatErrorDetails(error.cause, seen)}`);
            }
            return details.join('\n');
        }

        if (typeof ErrorEvent !== 'undefined' && error instanceof ErrorEvent) {
            const location = [error.filename, error.lineno || '', error.colno || '']
                .filter(Boolean)
                .join(':');
            const details = [`ErrorEvent: ${error.message}`];
            if (location) details.push(`Source: ${location}`);
            if (error.error != null) {
                details.push(`Event error:\n${this.formatErrorDetails(error.error, seen)}`);
            }
            return details.join('\n');
        }

        return String(error);
    }

    public clear(): void {
        this.pendingLogs = [];
        this.logsState.set([]);
    }
}
