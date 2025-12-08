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

import { Component, ChangeDetectionStrategy, input, computed, inject, signal, effect } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { ForceUnit } from '../../models/force-unit.model';
import { AlphaStrikeUnitStats, Unit } from '../../models/units.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { DialogsService } from '../../services/dialogs.service';
import { AbilityInfoDialogComponent, AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';

/*
 * Author: Drake
 */

@Component({
    selector: 'alpha-strike-card',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UpperCasePipe],
    templateUrl: './alpha-strike-card.component.html',
    styleUrl: './alpha-strike-card.component.scss',
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
        '[class.selected]': 'isSelected()'
    }
})
export class AlphaStrikeCardComponent {
    private readonly abilityLookup = inject(AsAbilityLookupService);
    private readonly dialogs = inject(DialogsService);
    
    forceUnit = input.required<ASForceUnit>();
    useHex = input<boolean>(false);
    cardStyle = input<'colored' | 'monochrome'>('colored');
    isSelected = input<boolean>(false);
    
    imageUrl = signal<string>('');
    
    unit = computed<Unit>(() => this.forceUnit().getUnit());
    asStats = computed<AlphaStrikeUnitStats>(() => this.unit().as);
    
    chassis = computed<string>(() => this.unit().chassis);
    model = computed<string>(() => this.unit().model);
    
    // Flag for long chassis names that need smaller font
    isLongChassis = computed<boolean>(() => this.chassis().length > 20);
    
    // Crew and skill
    skill = computed<number>(() => {
        return this.forceUnit().getPilotStats();
    });
    
    // PV calculations
    basePV = computed<number>(() => this.asStats().PV);
    adjustedPV = computed<number>(() => this.calculateAdjustedPV(this.basePV(), this.skill()));
    
    // Sprint movement
    sprintMove = computed<number>(() => {
        const walkMove = this.parseMovement(this.asStats().MV);
        const sprintInches = Math.ceil(walkMove * 1.5);
        if (this.useHex()) {
            return Math.floor(sprintInches / 2);
        }
        return sprintInches;
    });
    
    // Range distances based on hex mode
    rangeShort = computed<string>(() => this.useHex() ? '0-3' : '0-6"');
    rangeMedium = computed<string>(() => this.useHex() ? '3-12' : '6"-24"');
    rangeLong = computed<string>(() => this.useHex() ? '12-21' : '24"-42"');
    
    // Armor and structure pips
    armorPips = computed<number>(() => this.asStats().Arm);
    structurePips = computed<number>(() => this.asStats().Str);
    
    // Threshold for showing numeric values instead of pips
    readonly pipThreshold = 30;
    showArmorAsNumber = computed<boolean>(() => this.armorPips() > this.pipThreshold);
    showStructureAsNumber = computed<boolean>(() => this.structurePips() > this.pipThreshold);
    
    // Critical hits (simplified for now)
    engineHits = 2;
    fireControlHits = 4;
    mpHits = 4;
    weaponsHits = 4;
    
    // Heat level
    heatLevel = computed<number>(() => this.forceUnit().getHeat());
    
    constructor() {
        // Effect to load image when forceUnit changes
        effect(() => {
            const unit = this.unit();
            const imagePath = unit.fluff?.img;
            if (imagePath) {
                this.loadFluffImage(imagePath);
            } else {
                this.imageUrl.set('');
            }
        });
    }

    private parseMovement(mv: string): number {
        // Parse movement string like "6"" or "12"j" to get the base number
        const match = mv.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }
    
    private calculateAdjustedPV(basePV: number, skill: number): number {
        // PV adjustment based on skill (skill 4 is baseline)
        const skillModifiers: Record<number, number> = {
            0: 2.4,
            1: 1.9,
            2: 1.5,
            3: 1.2,
            4: 1.0,
            5: 0.9,
            6: 0.8,
            7: 0.7,
            8: 0.6
        };
        const modifier = skillModifiers[skill] ?? 1.0;
        return Math.round(basePV * modifier);
    }
    
    private async loadFluffImage(imagePath: string): Promise<void> {
        try {    
            if (imagePath.endsWith('hud.png')) {
                this.imageUrl.set('');
                return;
            }
            const fluffImageUrl = `https://db.mekbay.com/images/fluff/${imagePath}`;
            this.imageUrl.set(fluffImageUrl);
        } catch {
            // Ignore errors, image will just not display
            this.imageUrl.set('');
        }
    }
    
    // Generate array of numbers for ngFor
    range(count: number): number[] {
        return Array.from({ length: count }, (_, i) => i);
    }
    
    // Get special items
    getSpecialItems(): string[] {
        return this.asStats().specials;
    }
    
    // Handle special ability click
    onSpecialClick(special: string): void {
        const parsedAbility = this.abilityLookup.parseAbility(special);
        
        this.dialogs.createDialog<void>(AbilityInfoDialogComponent, {
            data: { parsedAbility } as AbilityInfoDialogData
        });
    }
    
    // Convert inches to hex
    private inchesToHex(inches: number): number {
        return Math.floor(inches / 2);
    }
    
    // Format movement value based on hex mode
    private formatMovement(inches: number, suffix: string = ''): string {
        if (this.useHex()) {
            return this.inchesToHex(inches) + suffix;
        }
        return inches + '"' + suffix;
    }
    
    // Get movement modes display
    getMovementDisplay(): string {
        const stats = this.asStats();
        const mvx = stats.MVx;
        const baseMove = this.parseMovement(stats.MV);
        
        if (!mvx || Object.keys(mvx).length === 0) {
            return this.formatMovement(baseMove);
        }
        
        // Build movement string with modes
        let display = this.formatMovement(baseMove);
        for (const [mode, value] of Object.entries(mvx)) {
            if (mode === 'j' && value > 0) {
                display += '/' + this.formatMovement(value as number, 'j');
            }
        }
        return display;
    }
    
    // Get TMM display with jump modifier
    getTMMDisplay(): string {
        const stats = this.asStats();
        const tmm = stats.TMM;
        const mvx = stats.MVx;
        
        if (mvx?.['j'] && mvx['j'] > 0) {
            // Calculate jump TMM (simplified)
            const jumpTMM = Math.max(0, tmm - 1);
            return `${tmm}/${jumpTMM}j`;
        }
        return `${tmm}`;
    }
}
