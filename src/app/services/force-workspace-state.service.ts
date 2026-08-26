// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, effect, inject, Injectable, signal } from '@angular/core';

import { GameSystem } from '../models/common.model';
import type { Force } from '../models/force.model';
import type { ForceMember } from '../models/force-member.model';
import type { ForceSlot } from '../models/force-slot.model';
import { DataService } from './data.service';

export type ForceAlignmentFilter = 'friendly' | 'enemy' | 'all';

/** Owns the loaded workspace and its active presentation selection. */
@Injectable({ providedIn: 'root' })
export class ForceWorkspaceStateService {
    private readonly dataService = inject(DataService);
    private readonly savedSelectionByFilter = new Map<ForceAlignmentFilter, string | null>();

    readonly selectedUnit = signal<ForceMember | null>(null, { equal: () => false });
    readonly loadedForces = signal<ForceSlot[]>([]);
    readonly alignmentFilter = signal<ForceAlignmentFilter>('friendly');
    readonly followLastModifiedUnit = signal(false);

    readonly currentForce = computed<Force | null>(() => this.selectedUnit()?.force ?? null);
    readonly smartCurrentForce = computed<Force | null>(() => {
        const ownedSlots = this.loadedForces().filter(slot => slot.force.owned());
        return ownedSlots.length === 1 ? ownedSlots[0].force : this.currentForce();
    });
    readonly hasMixedAlignments = computed(() => {
        const slots = this.loadedForces();
        if (slots.length < 2) return false;
        const alignments = new Set(slots.map(slot => slot.alignment));
        return alignments.has('friendly') && alignments.has('enemy');
    });
    readonly filteredLoadedForces = computed(() => {
        const filter = this.alignmentFilter();
        return filter === 'all'
            ? this.loadedForces()
            : this.loadedForces().filter(slot => slot.alignment === filter);
    });
    readonly hasForces = computed(() => this.loadedForces().length > 0);
    readonly forceGameSystem = computed<GameSystem | null>(() => this.smartCurrentForce()?.gameSystem ?? null);

    constructor() {
        effect(() => {
            if (this.hasMixedAlignments()) return;
            const slots = this.loadedForces();
            this.alignmentFilter.set(slots[0]?.alignment ?? 'friendly');
        });
    }

    getForceSlot(force: Force): ForceSlot | undefined {
        return this.loadedForces().find(slot => slot.force === force);
    }

    selectUnit(unit: ForceMember | null): void {
        this.selectedUnit.set(unit);
    }

    cycleAlignmentFilter(): void {
        const current = this.alignmentFilter();
        this.savedSelectionByFilter.set(current, this.selectedUnit()?.id ?? null);
        this.alignmentFilter.set(current === 'enemy' ? 'friendly' : 'enemy');
        this.restoreVisibleSelection();
    }

    private restoreVisibleSelection(): void {
        const visibleUnits = this.filteredLoadedForces()
            .flatMap(slot => slot.force.members());
        const selected = this.selectedUnit();
        if (selected && visibleUnits.some(unit => unit.id === selected.id)) return;

        const savedId = this.savedSelectionByFilter.get(this.alignmentFilter());
        this.selectUnit(visibleUnits.find(unit => unit.id === savedId) ?? visibleUnits[0] ?? null);
    }
}
