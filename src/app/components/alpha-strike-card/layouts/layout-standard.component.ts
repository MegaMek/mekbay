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

import {
    Component,
    ChangeDetectionStrategy,
    computed,
    signal,
    inject,
    ElementRef,
    DestroyRef,
    afterNextRender,
    viewChild,
} from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { CriticalHitsVariant, getLayoutForUnitType } from '../card-layout.config';
import {
    AsCriticalHitsMekComponent,
    AsCriticalHitsVehicleComponent,
    AsCriticalHitsProtomekComponent,
    AsCriticalHitsAerofighterComponent,
} from '../critical-hits';
import { AsLayoutBaseComponent } from './layout-base.component';

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
export class AsLayoutStandardComponent extends AsLayoutBaseComponent {
    private readonly elRef = inject(ElementRef<HTMLElement>);
    private readonly destroyRef = inject(DestroyRef);
    private readonly statsContainerRef = viewChild('statsContainer', { read: ElementRef<HTMLElement> });

    private readonly statsToHostHeightThreshold = 0.67;
    private resizeObserver: ResizeObserver | null = null;
    chassisSmall = signal(false);

    isLongChassis = computed<boolean>(() => this.chassis().length > 20);

    // Critical hits variant from layout config (override for standard units)
    override criticalHitsVariant = computed<CriticalHitsVariant>(() => {
        const config = getLayoutForUnitType(this.asStats().TP);
        return config.cards[0]?.criticalHits ?? 'none';
    });

    // Check if this is a vehicle unit
    isVehicle = computed<boolean>(() => this.asStats().TP === 'CV' || this.asStats().TP === 'SV');

    // Check if unit is immobilized (all movement values are 0 after reductions)
    isImmobilized = computed<boolean>(() => {
        const heat = this.heatLevel();
        if (heat >= 4) return true; // shutdown!
        const mvm = this.asStats().MVm;
        const entries = this.getMovementEntries(mvm);
        if (entries.length === 0) return false;

        const heatReduction = heat * 2;

        for (const [mode, inches] of entries) {
            let reducedInches: number;
            if (this.isVehicle()) {
                reducedInches = this.applyVehicleMotiveReduction(inches);
            } else {
                reducedInches = this.applyMpHitsReduction(inches, this.mpHits());
            }
            // Apply heat reduction only to ground movement (not 'j')
            if (mode !== 'j') {
                reducedInches = Math.max(0, reducedInches - heatReduction);
            }
            if (reducedInches > 0) return false;
        }
        return true;
    });

    // Movement
    movementDisplay = computed<string>(() => {
        const mvm = this.asStats().MVm;
        const entries = this.getMovementEntries(mvm);
        if (entries.length === 0) return this.asStats().MV ?? '';

        const heat = this.heatLevel();
        // Heat reduces ground movement by 2" per heat level
        const heatReduction = heat * 2;

        return entries
            .map(([mode, inches]) => {
                let reducedInches: number;
                if (this.isVehicle()) {
                    reducedInches = this.applyVehicleMotiveReduction(inches);
                } else {
                    reducedInches = this.applyMpHitsReduction(inches, this.mpHits());
                }
                // Apply heat reduction only to ground movement (not 'j')
                if (mode !== 'j') {
                    reducedInches = Math.max(0, reducedInches - heatReduction);
                }
                return this.formatMovement(reducedInches, mode);
            })
            .join('/');
    });

    sprintMove = computed<string | null>(() => {
        const mvm = this.asStats().MVm;
        const entries = this.getMovementEntries(mvm);
        // Ground entries exclude jump ('j')
        const groundEntries = entries.filter(([mode]) => mode !== 'j');
        if (groundEntries.length === 0) return null;

        // Sprinting is based on the unit's current ground Move (in inches), x1.5, rounded up.
        // Prefer the default ("" key) ground move when present.
        const defaultGround = groundEntries.find(([mode]) => mode === '') ?? groundEntries[0];
        let groundMoveInches = defaultGround[1];
        if (groundMoveInches <= 0) return null;

        // Apply MP/motive hits reduction
        if (this.isVehicle()) {
            groundMoveInches = this.applyVehicleMotiveReduction(groundMoveInches);
        } else {
            groundMoveInches = this.applyMpHitsReduction(groundMoveInches, this.mpHits());
        }

        // Apply heat reduction (2" per heat level)
        const heat = this.heatLevel();
        groundMoveInches = Math.max(0, groundMoveInches - (heat * 2));

        if (groundMoveInches <= 0) return this.formatMovement(0);
        const sprintInches = Math.ceil(groundMoveInches * 1.5);
        return this.formatMovement(sprintInches);
    });

    tmmDisplay = computed<string>(() => {
        // Immobilized units (all movement = 0 or shutdown) have TMM of -4
        if (this.isImmobilized()) {
            return (-4).toString();
        }
        const stats = this.asStats();
        let baseTmm = stats.TMM;
        if (baseTmm === undefined || baseTmm === null) return '';
        let jumpTmm = null;
        let subTmm = null;
        
        const jumpMod = this.getSignedSpecialModifier(stats.specials, 'JMPS', 'JMPW');
        const subMod = this.getSignedSpecialModifier(stats.specials, 'SUBS', 'SUBW');
        
        if (jumpMod !== null) {
            // Jump TMM is NOT affected by heat
            jumpTmm = Math.max(0, baseTmm + jumpMod);
        }

        if (subMod !== null) {
            subTmm = Math.max(0, baseTmm + subMod);
        }

        // Apply motive/MP hit TMM penalties
        let tmmPenalty: number;
        if (this.isVehicle()) {
            tmmPenalty = this.calculateVehicleTmmPenalty();
        } else {
            // Each MP hit reduces TMM by 1
            tmmPenalty = this.mpHits();
        }
        baseTmm = Math.max(0, baseTmm - tmmPenalty);

        // Apply heat TMM penalty: -1 at heat level 2+ (ground movement only)
        const heat = this.heatLevel();
        const heatTmmPenalty = heat >= 2 ? 1 : 0;
        baseTmm = Math.max(0, baseTmm - heatTmmPenalty);

        const parts: string[] = [baseTmm.toString()];

        if (jumpTmm !== null) {
            jumpTmm = Math.max(0, jumpTmm - tmmPenalty);
            // Jump TMM is NOT affected by heat
            if (baseTmm !== jumpTmm) {
                parts.push(`${jumpTmm}j`);
            }
        }

        if (subTmm !== null) {
            subTmm = Math.max(0, subTmm - tmmPenalty);
            subTmm = Math.max(0, subTmm - heatTmmPenalty);
            if (baseTmm !== subTmm) {
                parts.push(`${subTmm}s`);
            }
        }

        return parts.join('/');
    });

    // Range distances
    rangeShort = computed<string>(() => this.useHex() ? '0~3' : '0"~6"');
    rangeMedium = computed<string>(() => this.useHex() ? '4~12' : '>6"~24"');
    rangeLong = computed<string>(() => this.useHex() ? '13~21' : '>24"~42"');

    // Pending heat change (delta: 0 = no change)
    pendingHeat = computed<number>(() => {
        return this.forceUnit()?.getState().pendingHeat() ?? 0;
    });

    // Damage values affected by weapon critical hits: -1 per hit
    effectiveDamageS = computed<string>(() => {
        const base = this.asStats().dmg.dmgS;
        return this.calculateReducedDamage(base, this.weaponHits());
    });

    effectiveDamageM = computed<string>(() => {
        const base = this.asStats().dmg.dmgM;
        return this.calculateReducedDamage(base, this.weaponHits());
    });

    effectiveDamageL = computed<string>(() => {
        const base = this.asStats().dmg.dmgL;
        return this.calculateReducedDamage(base, this.weaponHits());
    });

    private calculateReducedDamage(base: string, weaponHits: number): string {
        if (weaponHits <= 0) return base;

        // Determine the position in the sequence: 9 8 7 6 5 4 3 2 1 0* 0
        let position: number;

        if (base === '0*') {
            position = 1;
        } else if (base === '0') {
            position = 0;
        } else {
            const numericValue = parseInt(base, 10);
            if (isNaN(numericValue) || numericValue < 0) {
                // Non-numeric (like "-"), return as-is
                return base;
            }
            position = numericValue + 1;
        }

        // Reduce position
        const newPosition = Math.max(0, position - weaponHits);

        // Convert back to string
        if (newPosition === 0) return '0';
        if (newPosition === 1) return '0*';
        return (newPosition - 1).toString();
    }

    constructor() {
        super();
        afterNextRender(() => {
            const hostEl = this.elRef.nativeElement;
            const statsEl = this.statsContainerRef()?.nativeElement;
            if (!hostEl || !statsEl) return;

            this.resizeObserver?.disconnect();
            this.resizeObserver = new ResizeObserver(() => {
                this.updateChassisSmallClass();
            });

            this.resizeObserver.observe(hostEl);
            this.resizeObserver.observe(statsEl);

            // Initial calculation after layout.
            requestAnimationFrame(() => this.updateChassisSmallClass());
        });

        this.destroyRef.onDestroy(() => {
            this.resizeObserver?.disconnect();
        });
    }

    private updateChassisSmallClass(): void {
        const hostEl = this.elRef.nativeElement;
        const statsEl = this.statsContainerRef()?.nativeElement;
        if (!hostEl || !statsEl) {
            this.chassisSmall.set(false);
            return;
        }

        const hostHeight = hostEl.clientHeight;
        if (hostHeight <= 0) {
            this.chassisSmall.set(false);
            return;
        }

        const ratio = statsEl.clientHeight / hostHeight;
        this.chassisSmall.set(ratio > this.statsToHostHeightThreshold);
    }

    /**
     * Applies MP hit reduction to movement.
     * Each hit halves movement (rounded down), but always reduces by at least 2".
     * Example: 10" → 5" (hit 1) → 2" (hit 2) → 0" (hit 3)
     */
    private applyMpHitsReduction(inches: number, mpHits: number): number {
        let current = inches;
        for (let i = 0; i < mpHits && current > 0; i++) {
            const halved = Math.floor(current / 2);
            // Reduce by at least 2"
            const reduction = Math.max(2, current - halved);
            current = Math.max(0, current - reduction);
        }
        return current;
    }

    /**
     * Apply vehicle motive critical hits to movement value.
     * Effects are applied in timestamp order (order the crits were taken).
     * 
     * Motive crit effects:
     * - motive1: -2" MV each (2 pips)
     * - motive2: ½ MV (2 pips) 
     * - motive3: 0 MV (1 pip) - immobilized
     */
    private applyVehicleMotiveReduction(baseInches: number): number {
        const fu = this.forceUnit();
        if (!fu) return baseInches;

        const orderedCrits = fu.getState().getCommittedCritsOrdered();
        let current = baseInches;

        for (const crit of orderedCrits) {
            if (current <= 0) break;
            
            switch (crit.key) {
                case 'motive1':
                    // -2" per hit
                    current = Math.max(0, current - 2);
                    break;
                case 'motive2':
                    // ½ movement (round down). There is a minimum Move loss of 2” and TMM loss of 1.
                    let newCurrent = Math.floor(current / 2);
                    // Ensure at least -2" loss
                    if (newCurrent > 0 && (current - newCurrent) < 2) {
                        newCurrent = Math.max(0, current - 2);
                    }
                    current = newCurrent;
                    break;
                case 'motive3':
                    // Immobilized
                    current = 0;
                    break;
            }
        }

        return current;
    }

    /**
     * Calculate total TMM penalty from vehicle motive critical hits.
     * Effects are applied in timestamp order.
     * 
     * Motive TMM effects:
     * - motive1: -1 TMM each (2 pips)
     * - motive2: ½ TMM (round down) (2 pips)
     * - motive3: TMM becomes -4 (1 pip)
     */
    private calculateVehicleTmmPenalty(): number {
        const fu = this.forceUnit();
        if (!fu) return 0;

        const orderedCrits = fu.getState().getCommittedCritsOrdered();
        const baseTmm = this.asStats().TMM ?? 0;
        let currentTmm = baseTmm;

        for (const crit of orderedCrits) {
            switch (crit.key) {
                case 'motive1':
                    // -1 TMM per hit
                    currentTmm = Math.max(0, currentTmm - 1);
                    break;
                case 'motive2':
                    // ½ TMM (round down). There is a minimum Move loss of 2” and TMM loss of 1.
                    let newTmm = Math.floor(currentTmm / 2);
                    // Ensure at least -1 TMM loss
                    if (newTmm > 0 && newTmm >= currentTmm) {
                        newTmm = Math.max(0, currentTmm - 1);
                    }
                    currentTmm = newTmm;
                    break;
                // motive3: TMM becomes -4, is handled separately
            }
        }

        return baseTmm - currentTmm; // Return the penalty (difference from base)
    }

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
}