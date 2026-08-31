// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { type CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import type { ForceAlignment } from '../../models/force-slot.model';
import type { GameSystem } from '../../models/common.model';
import { type FactionId, getFactionImg } from '../../models/factions.model';
import { DataService } from '../../services/data.service';

/*
 *
 * Reusable operation preview showing Friendly vs Hostile sides
 * with force names, BV/PV values, and totals.
 */

/** Minimal force shape accepted by the preview. */
export interface OpPreviewForce {
    name?: string;
    instanceId: string;
    alignment: ForceAlignment;
    type?: GameSystem;
    bv?: number;
    pv?: number;
    factionId?: FactionId;
    eraId?: number;
    exists?: boolean;
}

interface OpPreviewDisplayForce extends OpPreviewForce {
    factionImgUrl?: string;
    eraImgUrl?: string;
    eraName?: string;
}

@Component({
    selector: 'op-preview',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DecimalPipe, DragDropModule],
    templateUrl: './op-preview.component.html',
    styleUrl: './op-preview.component.scss'
})
export class OpPreviewComponent {
    dataService = inject(DataService);
    
    /** The forces to display in the preview. */
    forces = model.required<OpPreviewForce[]>();
    
    /** Whether to allow drag and drop between the two lists. */
    allowDragDrop = input<boolean>(false);

    private displayForces = computed<OpPreviewDisplayForce[]>(() => {
        return this.forces().map(force => {
            const faction = force.factionId == null
                ? undefined
                : this.dataService.getFactionById(force.factionId);
            const era = force.eraId == null
                ? undefined
                : this.dataService.getEraById(force.eraId);

            return {
                ...force,
                factionImgUrl: faction ? getFactionImg(faction) : undefined,
                eraImgUrl: era?.img || era?.icon,
                eraName: era?.name,
            };
        });
    });

    friendlyForces = computed(() => this.displayForces().filter(f => f.alignment === 'friendly'));
    enemyForces = computed(() => this.displayForces().filter(f => f.alignment === 'enemy'));

    friendlyBv = computed(() =>
        this.friendlyForces()
            .filter(f => (f.type || 'cbt') !== 'as')
            .reduce((sum, f) => sum + (f.bv || 0), 0)
    );

    friendlyPv = computed(() =>
        this.friendlyForces()
            .filter(f => f.type === 'as')
            .reduce((sum, f) => sum + (f.pv || f.bv || 0), 0)
    );

    enemyBv = computed(() =>
        this.enemyForces()
            .filter(f => (f.type || 'cbt') !== 'as')
            .reduce((sum, f) => sum + (f.bv || 0), 0)
    );

    enemyPv = computed(() =>
        this.enemyForces()
            .filter(f => f.type === 'as')
            .reduce((sum, f) => sum + (f.pv || f.bv || 0), 0)
    );

    hasCbt = computed(() => this.forces().some(f => (f.type || 'cbt') !== 'as'));
    hasAs = computed(() => this.forces().some(f => f.type === 'as'));

    onDrop(event: CdkDragDrop<OpPreviewDisplayForce[]>, targetAlignment: ForceAlignment) {
        if (!this.allowDragDrop()) return;

        const item = event.item.data as OpPreviewForce;
        const currentForces = [...this.forces()];
        
        const friendly = currentForces.filter(f => f.alignment === 'friendly');
        const enemy = currentForces.filter(f => f.alignment === 'enemy');

        const sourceList = item.alignment === 'friendly' ? friendly : enemy;
        const targetList = targetAlignment === 'friendly' ? friendly : enemy;

        if (event.previousContainer === event.container) {
            moveItemInArray(sourceList, event.previousIndex, event.currentIndex);
        } else {
            transferArrayItem(
                sourceList,
                targetList,
                event.previousIndex,
                event.currentIndex
            );
            targetList[event.currentIndex] = { ...targetList[event.currentIndex], alignment: targetAlignment };
        }

        this.forces.set([...friendly, ...enemy]);
    }
}
