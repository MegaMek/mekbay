/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ForceAlignment } from '../../models/force-slot.model';
import { GameSystem } from '../../models/common.model';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';

/*
 * Author: Drake
 *
 * Reusable operation preview showing Friendly vs Opposing sides
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
    factionId?: number;
    exists?: boolean;
}

@Component({
    selector: 'op-preview',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FactionImgPipe, DragDropModule],
    templateUrl: './op-preview.component.html',
    styleUrls: ['./op-preview.component.scss']
})
export class OpPreviewComponent {
    /** The forces to display in the preview. */
    forces = model.required<OpPreviewForce[]>();
    
    /** Whether to allow drag and drop between the two lists. */
    allowDragDrop = input<boolean>(false);

    friendlyForces = computed(() => this.forces().filter(f => f.alignment === 'friendly'));
    enemyForces = computed(() => this.forces().filter(f => f.alignment === 'enemy'));

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

    onDrop(event: CdkDragDrop<OpPreviewForce[]>, targetAlignment: ForceAlignment) {
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
