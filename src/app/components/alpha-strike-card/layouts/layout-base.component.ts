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

import { Directive, input, output, computed, inject } from '@angular/core';
import { ASForceUnit, AbilitySelection } from '../../../models/as-force-unit.model';
import { AlphaStrikeUnitStats, Unit } from '../../../models/units.model';
import { Era } from '../../../models/eras.model';
import { DataService } from '../../../services/data.service';
import { AS_PILOT_ABILITIES, ASPilotAbility } from '../../../models/as-abilities.model';
import { CriticalHitsVariant, getLayoutForUnitType } from '../card-layout.config';
import { PVCalculatorUtil } from '../../../utils/pv-calculator.util';

/*
 * Author: Drake
 *
 * Base class for Alpha Strike card layout components.
 * Contains common inputs, computed signals, and methods shared across layouts.
 */

export interface EraAvailability {
    era: Era;
    isAvailable: boolean;
}

@Directive()
export abstract class AsLayoutBaseComponent {
    protected readonly dataService = inject(DataService);

    protected readonly pilotAbilityById = new Map<string, ASPilotAbility>(
        AS_PILOT_ABILITIES.map((ability) => [ability.id, ability])
    );

    // Common inputs
    forceUnit = input<ASForceUnit>();
    unit = input.required<Unit>();
    useHex = input<boolean>(false);
    cardStyle = input<'colored' | 'monochrome'>('colored');
    imageUrl = input<string>('');

    // Common outputs
    specialClick = output<string>();

    // Derived from unit
    asStats = computed<AlphaStrikeUnitStats>(() => this.unit().as);
    model = computed<string>(() => this.unit().model);
    chassis = computed<string>(() => this.unit().chassis);

    // Critical hits variant from layout config
    criticalHitsVariant = computed<CriticalHitsVariant>(() => {
        const config = getLayoutForUnitType(this.asStats().TP);
        return config.cards[0]?.criticalHits ?? 'none';
    });

    // Skill and PV
    skill = computed<number>(() => this.forceUnit()?.getPilotStats() ?? 4);
    basePV = computed<number>(() => this.asStats().PV);
    adjustedPV = computed<number>(() => {
        return PVCalculatorUtil.calculateAdjustedPV(this.asStats().PV, this.skill());
    });
    pilotAbilities = computed<string[]>(() => {
        const selections = this.forceUnit()?.pilotAbilities() ?? [];
        return selections.map((selection) => this.formatPilotAbility(selection));
    });

    // Armor and structure
    armorPips = computed<number>(() => this.asStats().Arm);
    structurePips = computed<number>(() => this.asStats().Str);

    // Era availability (grouped by image)
    eraAvailability = computed<EraAvailability[]>(() => {
        const u = this.unit();
        const allEras = this.dataService.getEras().sort((a, b) => (a.years.from || 0) - (b.years.from || 0));
        if (allEras.length === 0) return [];

        const unitId = u.id;
        const unitYear = u.year;

        // Check if unit exists in any era's unit list
        const unitExistsInAnyEra = allEras.some(era => {
            const units = era.units;
            if (units instanceof Set) {
                return units.has(unitId);
            }
            return Array.isArray(units) && units.includes(unitId);
        });

        // Helper to check if unit is available in a specific era
        const isUnitInEra = (era: Era): boolean => {
            if (unitExistsInAnyEra) {
                const units = era.units;
                if (units instanceof Set) {
                    return units.has(unitId);
                }
                return Array.isArray(units) && units.includes(unitId);
            } else {
                // Unit not in era data, use year-based calculation
                const eraEnd = era.years.to ?? Infinity;
                return unitYear <= eraEnd;
            }
        };

        // Group eras by their image
        const erasByIcon = new Map<string, Era[]>();
        for (const era of allEras) {
            const icon = era.icon ?? '';
            if (!icon) continue; // Skip eras without images
            
            const group = erasByIcon.get(icon) ?? [];
            group.push(era);
            erasByIcon.set(icon, group);
        }

        // For each unique image, check if unit is available in ANY era with that image
        const result: EraAvailability[] = [];
        for (const [, eras] of erasByIcon) {
            // Use the first era in the group as the representative
            const representativeEra = eras[0];
            // Available if unit exists in ANY era that shares this image
            const isAvailable = eras.some(era => isUnitInEra(era));
            result.push({ era: representativeEra, isAvailable });
        }

        return result;
    });

    protected formatPilotAbility(selection: AbilitySelection): string {
        if (typeof selection === 'string') {
            const ability = this.pilotAbilityById.get(selection);
            return ability ? `${ability.name} (${ability.cost})` : selection;
        }

        return `${selection.name} (${selection.cost})`;
    }

    range(count: number): number[] {
        return Array.from({ length: count }, (_, i) => i);
    }

    onSpecialClick(special: string): void {
        this.specialClick.emit(special);
    }
}
