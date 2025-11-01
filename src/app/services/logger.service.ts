/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Injectable, signal } from "@angular/core";

type LogType = 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
    timestamp: Date;
    type: LogType;
    message: string;
}

@Injectable({ providedIn: 'root' })
export class LoggerService {
    private readonly MAX_LOGS = 10000;
    public readonly logs = signal<LogEntry[]>([]);
    
    constructor() {}

    private log(type: LogType, message: string) {
        const timestamp = new Date();
        const currentLogs = this.logs();
        currentLogs.push({ timestamp, type, message });
        if (currentLogs.length > this.MAX_LOGS) {
            currentLogs.splice(0, currentLogs.length - this.MAX_LOGS);
        }
        this.logs.set(currentLogs);
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

    public clear() {
        this.logs.set([]);
    }
}