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

/*
 * Author: Drake
 */

@Component({
    selector: 'alpha-strike-card',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UpperCasePipe],
    templateUrl: './alpha-strike-card.component.html',
    styleUrl: './alpha-strike-card.component.scss'
})
export class AlphaStrikeCardComponent {
    forceUnit = input.required<ForceUnit>();
    
    imageUrl = signal<string>('');
    
    unit = computed<Unit>(() => this.forceUnit().getUnit());
    asStats = computed<AlphaStrikeUnitStats>(() => this.unit().as);
    
    chassis = computed<string>(() => this.unit().chassis);
    model = computed<string>(() => this.unit().model);
    
    // Crew and skill
    skill = computed<number>(() => {
        const crew = this.forceUnit().getCrewMembers();
        return crew[0]?.getSkill('gunnery') ?? 4;
    });
    
    // PV calculations
    basePV = computed<number>(() => this.asStats().PV);
    adjustedPV = computed<number>(() => this.calculateAdjustedPV(this.basePV(), this.skill()));
    
    // Sprint movement
    sprintMove = computed<string>(() => {
        const walkMove = this.parseMovement(this.asStats().MV);
        return Math.ceil(walkMove * 1.5) + '"';
    });
    
    // Armor and structure pips
    armorPips = computed<number>(() => this.asStats().Arm);
    structurePips = computed<number>(() => this.asStats().Str);
    
    // Critical hits (simplified for now)
    engineHits = 2;
    fireControlHits = 4;
    mpHits = 4;
    weaponsHits = 4;
    
    // Heat level
    heatLevel = computed<number>(() => this.forceUnit().getHeat().current);
    
    // Hovered special ability index
    hoveredSpecial = signal<number | null>(null);
    
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
    
    // Get special items with calculated positions for word wrapping
    getSpecialItems(): { value: string; index: number; x: number | null; dy: number }[] {
        const specials = this.asStats().specials;
        const items: { value: string; index: number; x: number | null; dy: number }[] = [];
        
        const startX = 42;
        const maxWidth = 940; // Box width minus padding
        const lineHeight = 32;
        const charWidth = 12.5; // Approximate character width
        const labelWidth = 85; // Width of "SPECIAL: " label
        
        let currentX = startX + labelWidth;
        let currentLine = 0;
        
        for (let i = 0; i < specials.length; i++) {
            const special = specials[i];
            const isLast = i === specials.length - 1;
            const textWidth = (special.length + (isLast ? 0 : 2)) * charWidth; // +2 for comma and space
            
            // Check if we need to wrap to next line
            if (currentX + textWidth > startX + maxWidth && currentLine < 2) {
                currentLine++;
                currentX = startX;
            }
            
            items.push({
                value: special,
                index: i,
                x: currentLine > 0 && currentX === startX ? startX : null,
                dy: currentLine > 0 && currentX === startX ? lineHeight : 0
            });
            
            currentX += textWidth;
        }
        
        return items;
    }
    
    // Handle special ability hover
    onSpecialHover(index: number | null): void {
        this.hoveredSpecial.set(index);
    }
    
    // Handle special ability click
    onSpecialClick(special: string): void {
        console.log('Special clicked:', special);
        // TODO: Implement special ability details popup
    }
    
    // Get movement modes display
    getMovementDisplay(): string {
        const stats = this.asStats();
        const mvx = stats.MVx;
        if (!mvx || Object.keys(mvx).length === 0) {
            return stats.MV;
        }
        
        // Build movement string with modes
        let display = stats.MV;
        for (const [mode, value] of Object.entries(mvx)) {
            if (mode === 'j' && value > 0) {
                display = display.replace(/"$/, `"/${value}"j`);
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
