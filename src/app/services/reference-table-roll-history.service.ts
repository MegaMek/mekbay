// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, Injectable, signal } from '@angular/core';

export interface ReferenceRollHistoryEntry {
    readonly id: number;
    readonly dice: string;
    readonly faces: readonly number[];
    readonly roll: number;
    readonly table: string;
    readonly column: string;
    readonly result: string;
}

export type NewReferenceRollHistoryEntry = Omit<ReferenceRollHistoryEntry, 'id'>;

@Injectable({ providedIn: 'root' })
export class ReferenceTableRollHistoryService {
    private readonly history = signal<readonly ReferenceRollHistoryEntry[]>([]);
    private nextId = 1;

    readonly entries = this.history.asReadonly();
    readonly count = computed(() => this.history().length);

    add(entry: NewReferenceRollHistoryEntry): ReferenceRollHistoryEntry {
        const storedEntry = { ...entry, id: this.nextId++ };
        this.history.update(history => [...history, storedEntry]);
        return storedEntry;
    }

    reset(): void {
        this.history.set([]);
        this.nextId = 1;
    }
}
