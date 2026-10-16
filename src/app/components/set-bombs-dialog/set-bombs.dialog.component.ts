// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import {
    BOMB_SECTIONS,
    BOMB_TYPES,
    bombAmmo,
    bombLoadPoints,
    bombLoadoutIssue,
    type BombCapacity,
    type BombLoadChoice,
    type BombSection,
} from '../../models/aerospace-bomb.model';
import type { EquipmentRegistry } from '../../models/equipment-lookup';

export interface SetBombsDialogData {
    readonly capacity: BombCapacity;
    readonly loads: readonly BombLoadChoice[];
    readonly equipmentRegistry: EquipmentRegistry;
}

export type SetBombsDialogResult = readonly BombLoadChoice[];

const SECTION_LABELS: Readonly<Record<BombSection, string>> = {
    external: 'External Stores',
    internal: 'Internal Bomb Bay',
};

/** Chooses carried bombs per section; MegaMek's lobby bomb choice, sized in hardpoints. */
@Component({
    selector: 'set-bombs-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
        <div class="wide-dialog-body">
            @for (section of sections(); track section.section) {
                <section class="bomb-section">
                    <header class="bomb-section-header">
                        <span>{{ section.label }}</span>
                        <span class="bomb-points" [class.full]="section.used >= section.capacity">
                            {{ section.used }}/{{ section.capacity }} hardpoints
                        </span>
                    </header>
                    @for (row of section.rows; track row.bombId) {
                        <div class="bomb-row" [class.loaded]="row.count > 0">
                            <span class="bomb-name">{{ row.name }}</span>
                            <span class="bomb-facts">{{ row.points }} pt · BV {{ row.bv }}</span>
                            <span class="bomb-stepper">
                                <button class="bt-button square-small" type="button"
                                    (click)="adjust(section.section, row.bombId, -1)" [disabled]="row.count <= 0">-</button>
                                <span class="bomb-count">{{ row.count }}</span>
                                <button class="bt-button square-small" type="button"
                                    (click)="adjust(section.section, row.bombId, 1)"
                                    [disabled]="section.used + row.points > section.capacity">+</button>
                            </span>
                        </div>
                    }
                </section>
            }
            @if (issue(); as message) {
                <div class="bomb-issue">{{ message }}</div>
            }
        </div>
        <div class="wide-dialog-actions">
            <button (click)="submit()" class="bt-button" [disabled]="issue() !== null">CONFIRM</button>
            <button (click)="clear()" class="bt-button danger">CLEAR</button>
            <button (click)="dialogRef.close(null)" class="bt-button cancel">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .bomb-section { display: grid; gap: 2px; margin-bottom: 12px; text-align: left; }
        .bomb-section-header {
            display: flex; justify-content: space-between; gap: 12px; padding: 4px 8px;
            font-weight: 700; border-bottom: 1px solid var(--border-color);
        }
        .bomb-points { color: var(--text-color-secondary); font-weight: 500; }
        .bomb-points.full { color: var(--text-color); }
        .bomb-row {
            display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px;
            align-items: center; padding: 2px 8px; color: var(--text-color-secondary);
        }
        .bomb-row.loaded { color: var(--text-color); }
        .bomb-name { min-width: 0; overflow-wrap: anywhere; }
        .bomb-facts { font-size: 0.85em; white-space: nowrap; }
        .bomb-stepper { display: inline-flex; align-items: center; gap: 6px; }
        .bomb-stepper button { width: 28px; height: 28px; min-width: 28px; padding: 0; }
        .bomb-count { min-width: 2ch; text-align: center; font-weight: 700; }
        .bomb-issue { color: red; font-size: 0.9em; text-align: left; padding: 0 8px; }
    `]
})
export class SetBombsDialogComponent {
    readonly dialogRef = inject<DialogRef<SetBombsDialogResult | null, SetBombsDialogComponent>>(DialogRef);
    readonly data: SetBombsDialogData = inject(DIALOG_DATA);
    readonly counts = signal(new Map(this.data.loads.map(load => [key(load.section, load.bombId), load.count] as const)));

    readonly loads = computed<readonly BombLoadChoice[]>(() => BOMB_SECTIONS.flatMap(section =>
        BOMB_TYPES.flatMap(bomb => {
            const count = this.counts().get(key(section, bomb.id)) ?? 0;
            return count > 0 ? [{ section, bombId: bomb.id, count }] : [];
        })));

    readonly sections = computed(() => BOMB_SECTIONS
        .filter(section => this.data.capacity[section] > 0)
        .map(section => ({
            section,
            label: SECTION_LABELS[section],
            capacity: this.data.capacity[section],
            used: bombLoadPoints(this.loads(), section),
            rows: BOMB_TYPES.flatMap(bomb => {
                const ammo = bombAmmo(bomb.id, this.data.equipmentRegistry);
                return ammo ? [{
                    bombId: bomb.id,
                    name: ammo.name,
                    points: bomb.points,
                    bv: typeof ammo.bv === 'number' ? ammo.bv : '—',
                    count: this.counts().get(key(section, bomb.id)) ?? 0,
                }] : [];
            }),
        })));

    readonly issue = computed(() => bombLoadoutIssue(this.loads(), this.data.capacity));

    adjust(section: BombSection, bombId: string, delta: number): void {
        this.counts.update(counts => {
            const next = new Map(counts);
            const count = Math.max(0, (next.get(key(section, bombId)) ?? 0) + delta);
            if (count === 0) next.delete(key(section, bombId));
            else next.set(key(section, bombId), count);
            return next;
        });
    }

    clear(): void {
        this.counts.set(new Map());
    }

    submit(): void {
        if (this.issue() !== null) return;
        this.dialogRef.close(this.loads());
    }

}

function key(section: BombSection, bombId: string): string {
    return `${section}:${bombId}`;
}
