// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, signal } from "@angular/core";

type LogType = 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
    timestamp: Date;
    type: LogType;
    message: string;
}

@Injectable({ providedIn: 'root' })
export class LoggerService {
    private readonly MAX_LOGS = 1000;
    public readonly logs = signal<LogEntry[]>([]);
    
    constructor() {}

    private log(type: LogType, message: string) {
        const timestamp = new Date();
        this.logs.update(currentLogs => {
            const nextLogs = [...currentLogs, { timestamp, type, message }];
            if (nextLogs.length > this.MAX_LOGS) {
                return nextLogs.slice(nextLogs.length - this.MAX_LOGS);
            }
            return nextLogs;
        });
        const timestampStr = '[' + timestamp.toISOString() + ']';
        if (type === 'INFO') console.log(timestampStr, message);
        else if (type === 'WARN') console.warn(timestampStr, message);
        else if (type === 'ERROR') console.error(timestampStr, message);
    }

    public error(message: string) {
        this.log('ERROR', message);
    }

    public warn(message: string) {
        this.log('WARN', message);
    }

    public info(message: string) {
        this.log('INFO', message);
    }

    handleError(error: any): void {
        const message = error?.message ? error.message : String(error);
        this.error(`Unhandled error: ${message}`);
        console.trace(error);
    }

    public clear() {
        this.logs.set([]);
    }
}