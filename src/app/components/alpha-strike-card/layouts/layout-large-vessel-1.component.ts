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

import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { ASForceUnit } from '../../../models/as-force-unit.model';
import { AlphaStrikeUnitStats, Unit } from '../../../models/units.model';
import { CriticalHitsVariant, getLayoutForUnitType } from '../card-layout.config';
import {
    AsCriticalHitsAerospace1Component,
    AsCriticalHitsDropship1Component,
} from '../critical-hits';

/*
 * Author: Drake
 *
 * Large Vessel Card 1 layout component for Alpha Strike cards.
 */

@Component({
    selector: 'as-layout-large-vessel-1',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AsCriticalHitsAerospace1Component,
        AsCriticalHitsDropship1Component
    ],
    templateUrl: './layout-large-vessel-1.component.html',
    styleUrls: ['./layout-large-vessel-1.component.scss'],
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    }
})
export class AsLayoutLargeVessel1Component {
    // Core inputs - minimal set needed
    forceUnit = input.required<ASForceUnit>();
    unit = input.required<Unit>();
    useHex = input<boolean>(false);
    cardStyle = input<'colored' | 'monochrome'>('colored');
    imageUrl = input<string>('');

    specialClick = output<string>();

    // Derived from unit
    asStats = computed<AlphaStrikeUnitStats>(() => this.unit().as);
    model = computed<string>(() => this.unit().model);
    chassis = computed<string>(() => this.unit().chassis);

    // Critical hits variant from layout config (first card for large vessels)
    criticalHitsVariant = computed<CriticalHitsVariant>(() => {
        const config = getLayoutForUnitType(this.asStats().TP);
        return config.cards[0]?.criticalHits ?? 'none';
    });

    // Skill and PV
    skill = computed<number>(() => this.forceUnit().getPilotStats());
    basePV = computed<number>(() => this.asStats().PV);
    adjustedPV = computed<number>(() => {
        const skillModifiers: Record<number, number> = {
            0: 2.4, 1: 1.9, 2: 1.5, 3: 1.2, 4: 1.0, 5: 0.9, 6: 0.8, 7: 0.7, 8: 0.6
        };
        const modifier = skillModifiers[this.skill()] ?? 1.0;
        return Math.round(this.basePV() * modifier);
    });

    // Armor and structure
    armorPips = computed<number>(() => this.asStats().Arm);
    structurePips = computed<number>(() => this.asStats().Str);

    onSpecialClick(special: string): void {
        this.specialClick.emit(special);
    }
}
