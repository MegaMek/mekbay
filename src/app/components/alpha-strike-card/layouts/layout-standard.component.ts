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
import { UpperCasePipe } from '@angular/common';
import { ASForceUnit } from '../../../models/as-force-unit.model';
import { AlphaStrikeUnitStats, Unit } from '../../../models/units.model';
import { CriticalHitsVariant, getLayoutForUnitType } from '../card-layout.config';
import {
    AsCriticalHitsMekComponent,
    AsCriticalHitsVehicleComponent,
    AsCriticalHitsProtomekComponent,
    AsCriticalHitsAerofighterComponent,
} from '../critical-hits';
import { PVCalculatorUtil } from '../../../utils/pv-calculator.util';

/*
 * Author: Drake
 *
 * Standard layout component for Alpha Strike cards.
 */

@Component({
    selector: 'as-layout-standard',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        UpperCasePipe,
        AsCriticalHitsMekComponent,
        AsCriticalHitsProtomekComponent,
        AsCriticalHitsVehicleComponent,
        AsCriticalHitsAerofighterComponent
    ],
    templateUrl: './layout-standard.component.html',
    styleUrls: ['./layout-standard.component.scss'],
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    }
})
export class AsLayoutStandardComponent {
    forceUnit = input<ASForceUnit>();
    unit = input.required<Unit>();
    useHex = input<boolean>(false);
    cardStyle = input<'colored' | 'monochrome'>('colored');
    imageUrl = input<string>('');

    specialClick = output<string>();

    asStats = computed<AlphaStrikeUnitStats>(() => this.unit().as);
    model = computed<string>(() => this.unit().model);
    chassis = computed<string>(() => this.unit().chassis);
    isLongChassis = computed<boolean>(() => this.chassis().length > 20);

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

    // Movement
    movementDisplay = computed<string>(() => {
        const mvm = this.asStats().MVm;
        const entries = this.getMovementEntries(mvm);
        if (entries.length === 0) return this.asStats().MV ?? '';

        return entries
            .map(([mode, inches]) => this.formatMovement(inches, mode))
            .join('/');
    });
    
    sprintMove = computed<string | null>(() => {
        const mvm = this.asStats().MVm;
        const entries = this.getMovementEntries(mvm);
        const groundEntries = entries.filter(([mode]) => mode !== 'j');
        if (groundEntries.length === 0) return null;

        // Sprinting is based on the unit's current ground Move (in inches), x1.5, rounded up.
        // Prefer the default ("" key) ground move when present.
        const defaultGround = groundEntries.find(([mode]) => mode === '') ?? groundEntries[0];
        const groundMoveInches = defaultGround[1];
        if (groundMoveInches <= 0) return null;
        const sprintInches = Math.ceil(groundMoveInches * 1.5);
        return this.formatMovement(sprintInches);
    });

    tmmDisplay = computed<string>(() => {
        const stats = this.asStats();
        const baseTmm = stats.TMM;
        if (baseTmm === undefined || baseTmm === null) return '';

        const jumpMod = this.getSignedSpecialModifier(stats.specials, 'JMPS', 'JMPW');
        const subMod = this.getSignedSpecialModifier(stats.specials, 'SUBS', 'SUBW');

        const parts: string[] = [baseTmm.toString()];

        if (jumpMod !== null) {
            const jumpTmm = Math.max(0, baseTmm + jumpMod);
            parts.push(`${jumpTmm}j`);
        }

        if (subMod !== null) {
            const subTmm = Math.max(0, baseTmm + subMod);
            parts.push(`${subTmm}s`);
        }

        return parts.join('/');
    });

    // To-hit values
    toHitShort = computed<number>(() => this.skill() );
    toHitMedium = computed<number>(() => this.skill() + 2);
    toHitLong = computed<number>(() => this.skill() + 4);

    // Range distances
    rangeShort = computed<string>(() => this.useHex() ? '0~3' : '0~6"');
    rangeMedium = computed<string>(() => this.useHex() ? '4~12' : '6"~24"');
    rangeLong = computed<string>(() => this.useHex() ? '13~21' : '24"~42"');

    // Armor and structure
    armorPips = computed<number>(() => this.asStats().Arm);
    structurePips = computed<number>(() => this.asStats().Str);
    readonly pipThreshold = 30;
    showArmorAsNumber = computed<boolean>(() => this.armorPips() > this.pipThreshold);
    showStructureAsNumber = computed<boolean>(() => this.structurePips() > this.pipThreshold);

    // Heat level
    heatLevel = computed<number>(() => {
        return this.forceUnit()?.getHeat() ?? 0;
    });

    private getMovementEntries(mvm: Record<string, number> | undefined): Array<[string, number]> {
        if (!mvm) return [];

        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number' && value > 0) as Array<[string, number]>;

        // If the unit only has jumping movement, treat it as also having a default ("" key)
        // ground movement with the same value.
        if (entries.length === 1) {
            switch (entries[0][0]) {
                case '': 
                    return entries;
                case 'j':
                return [['', entries[0][1]], ...entries];
            }
        }

        // Prefer the default movement (empty key) first if present, then preserve insertion order.
        const defaultIndex = entries.findIndex(([mode]) => mode === '');
        if (defaultIndex >= 0) {
            const [def] = entries.splice(defaultIndex, 1);
            return [def, ...entries];
        }
        return entries;
    }

    private getTmmForMoveInches(inches: number): number {
        // Alpha Strike TMM ranges
        if (inches <= 4) return 0;
        if (inches <= 8) return 1;
        if (inches <= 12) return 2;
        if (inches <= 18) return 3;
        if (inches <= 34) return 4;
        return 5;
    }

    private formatMovement(inches: number, suffix: string = ''): string {
        if (this.useHex()) {
            return Math.ceil(inches / 2) + suffix;
        }
        return inches + '"' + suffix;
    }

    private getFirstSpecialModifier(specials: string[] | undefined, prefixes: string[]): number | null {
        if (!specials || specials.length === 0) return null;

        for (const special of specials) {
            for (const prefix of prefixes) {
                const match = new RegExp(`^${prefix}([+-]?\\d+)$`).exec(special);
                if (!match) continue;

                const value = Number.parseInt(match[1], 10);
                if (Number.isNaN(value)) return null;
                return value;
            }
        }

        return null;
    }

    private getSignedSpecialModifier(
        specials: string[] | undefined,
        addPrefix: string,
        removePrefix: string
    ): number | null {
        const addValue = this.getFirstSpecialModifier(specials, [addPrefix]);
        if (addValue !== null) return addValue;

        const removeValue = this.getFirstSpecialModifier(specials, [removePrefix]);
        if (removeValue !== null) return -removeValue;

        return null;
    }

    range(count: number): number[] {
        return Array.from({ length: count }, (_, i) => i);
    }

    onSpecialClick(special: string): void {
        this.specialClick.emit(special);
    }
}
