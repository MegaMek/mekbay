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

import { Component, ChangeDetectionStrategy, input, inject, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../../models/units.model';
import { DataService } from '../../../services/data.service';
import { compareUnitsByName } from '../../../utils/sort.util';
import { UnitCardExpandedComponent } from '../../unit-card-expanded/unit-card-expanded.component';
import { TagClickEvent } from '../../unit-tags/unit-tags.component';

/**
 * Author: Drake
 * Component for the "Variants" tab in the Unit Details Dialog.
 */
@Component({
    selector: 'unit-details-variants-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, UnitCardExpandedComponent],
    templateUrl: './unit-details-variants-tab.component.html',
    styleUrls: ['./unit-details-variants-tab.component.css']
})
export class UnitDetailsVariantsTabComponent {
    private dataService = inject(DataService);

    /** The current unit to find variants for */
    unit = input.required<Unit>();

    /** Gunnery skill for BV/PV adjustment */
    gunnerySkill = input<number | undefined>(undefined);

    /** Piloting skill for BV adjustment */
    pilotingSkill = input<number | undefined>(undefined);

    /** Emitted when a variant card is clicked */
    variantClick = output<{ variant: Unit, variants: Unit[] }>();

    /** Emitted when the info button is clicked on a variant */
    variantInfoClick = output<Unit>();

    /** Emitted when a tag is clicked */
    tagClick = output<TagClickEvent>();

    /** All variants of the same chassis (same type and chassis name) */
    variants = computed<Unit[]>(() => {
        const currentUnit = this.unit();
        if (!currentUnit) return [];

        const targetType = currentUnit.type;
        const targetChassis = currentUnit.chassis;

        return this.dataService.getUnits()
            .filter(u => u.type === targetType && u.chassis === targetChassis)
            .sort((a, b) => {
                // Sort by year first, then by name
                const yearDiff = (a.year ?? 0) - (b.year ?? 0);
                if (yearDiff !== 0) return yearDiff;
                return compareUnitsByName(a, b);
            });
    });

    /** Check if a variant is the current unit */
    isCurrentUnit(variant: Unit): boolean {
        return variant.id === this.unit()?.id;
    }

    onVariantClick(variant: Unit, variants: Unit[]): void {
        this.variantClick.emit({ variant, variants });
    }

    onTagClick(event: TagClickEvent): void {
        this.tagClick.emit(event);
    }
}
