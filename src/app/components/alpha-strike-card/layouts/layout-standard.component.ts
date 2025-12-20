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
    forceUnit = input.required<ASForceUnit>();
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
    skill = computed<number>(() => this.forceUnit().getPilotStats());
    basePV = computed<number>(() => this.asStats().PV);
    adjustedPV = computed<number>(() => {
        return PVCalculatorUtil.calculateAdjustedPV(this.asStats().PV, this.forceUnit().pilotSkill());
    });

    // Movement
    sprintMove = computed<string>(() => {
        const walkMove = this.parseMovement(this.asStats().MV);
        const sprintInches = Math.ceil(walkMove * 1.5);
        const display = this.formatMovement(Math.floor(sprintInches));
        return display;
    });

    movementDisplay = computed<string>(() => {
        const stats = this.asStats();
        const mvx = stats.MVx;
        const baseMove = this.parseMovement(stats.MV);

        if (!mvx || Object.keys(mvx).length === 0) {
            return this.formatMovement(baseMove);
        }

        let display = this.formatMovement(baseMove);
        for (const [mode, value] of Object.entries(mvx)) {
            if (mode === 'j' && value > 0) {
                display += '/' + this.formatMovement(value as number, 'j');
            }
        }
        return display;
    });

    tmmDisplay = computed<string>(() => {
        const stats = this.asStats();
        const tmm = stats.TMM;
        const mvx = stats.MVx;

        if (mvx?.['j'] && mvx['j'] > 0) {
            const jumpTMM = Math.max(0, tmm - 1);
            return `${tmm}/${jumpTMM}j`;
        }
        return `${tmm}`;
    });

    // To-hit values
    toHitShort = computed<number>(() => this.forceUnit().pilotSkill());
    toHitMedium = computed<number>(() => this.forceUnit().pilotSkill() + 2);
    toHitLong = computed<number>(() => this.forceUnit().pilotSkill() + 4);

    // Range distances
    rangeShort = computed<string>(() => this.useHex() ? '0-3' : '0-6"');
    rangeMedium = computed<string>(() => this.useHex() ? '3-12' : '6"-24"');
    rangeLong = computed<string>(() => this.useHex() ? '12-21' : '24"-42"');

    // Armor and structure
    armorPips = computed<number>(() => this.asStats().Arm);
    structurePips = computed<number>(() => this.asStats().Str);
    readonly pipThreshold = 30;
    showArmorAsNumber = computed<boolean>(() => this.armorPips() > this.pipThreshold);
    showStructureAsNumber = computed<boolean>(() => this.structurePips() > this.pipThreshold);

    // Heat level
    heatLevel = computed<number>(() => this.forceUnit().getHeat());

    // Helper methods
    private parseMovement(mv: string): number {
        const match = mv.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }

    private formatMovement(inches: number, suffix: string = ''): string {
        if (this.useHex()) {
            return Math.floor(inches / 2) + suffix;
        }
        return inches + '"' + suffix;
    }

    range(count: number): number[] {
        return Array.from({ length: count }, (_, i) => i);
    }

    onSpecialClick(special: string): void {
        this.specialClick.emit(special);
    }
}
