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

import { Directive, input, output, computed, inject, signal } from '@angular/core';
import { ASForceUnit, AbilitySelection } from '../../../models/as-force-unit.model';
import { AlphaStrikeUnitStats, Unit } from '../../../models/units.model';
import { Era } from '../../../models/eras.model';
import { DataService } from '../../../services/data.service';
import { AsAbilityLookupService } from '../../../services/as-ability-lookup.service';
import { AS_PILOT_ABILITIES, ASPilotAbility, ASCustomPilotAbility } from '../../../models/as-abilities.model';
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

/**
 * Represents the state of a single pip for rendering.
 */
export interface PipState {
    index: number;
    isDamaged: boolean;           // Committed damage
    isPendingDamage: boolean;     // Pending damage (not yet committed)
    isPendingHeal: boolean;       // Pending heal (not yet committed)
}

/**
 * Represents a special ability with both original and effective values.
 */
export interface SpecialAbilityState {
    original: string;
    effective: string;
    /** True if this ability is exhausted (should show strikethrough) */
    isExhausted?: boolean;
    /** For consumable abilities, how many have been consumed */
    consumedCount?: number;
    /** For consumable abilities, the max count */
    maxCount?: number;
}

/**
 * Event data for special ability click.
 */
export interface SpecialAbilityClickEvent {
    state: SpecialAbilityState;
    event: MouseEvent;
}

@Directive()
export abstract class AsLayoutBaseComponent {
    protected readonly dataService = inject(DataService);
    protected readonly abilityLookup = inject(AsAbilityLookupService);

    protected readonly pilotAbilityById = new Map<string, ASPilotAbility>(
        AS_PILOT_ABILITIES.map((ability) => [ability.id, ability])
    );

    // Common inputs
    forceUnit = input<ASForceUnit>();
    unit = input.required<Unit>();
    useHex = input<boolean>(false);
    cardStyle = input<'colored' | 'monochrome'>('colored');
    imageUrl = input<string>('');
    interactive = input<boolean>(false);

    // Image loading state (hidden on error)
    protected imageLoadFailed = signal(false);
    protected onImageError(): void {
        this.imageLoadFailed.set(true);
    }

    // Common outputs
    specialClick = output<SpecialAbilityClickEvent>();
    pilotAbilityClick = output<AbilitySelection>();
    editPilotClick = output<void>();
    rollCriticalClick = output<void>();

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
    pilotAbilities = computed<AbilitySelection[]>(() => {
        return this.forceUnit()?.pilotAbilities() ?? [];
    });

    // Armor and structure
    armorPips = computed<number>(() => this.asStats().Arm);
    structurePips = computed<number>(() => this.asStats().Str);

    // ===== Damage State =====

    /**
     * Get committed armor damage.
     */
    committedArmorDamage = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().armor();
    });

    /**
     * Get committed internal damage.
     */
    committedInternalDamage = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().internal();
    });

    /**
     * Get pending armor change.
     */
    pendingArmorChange = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().pendingArmor();
    });

    /**
     * Get pending internal change.
     */
    pendingInternalChange = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().pendingInternal();
    });

    /**
     * Get armor pip states for rendering.
     */
    armorPipStates = computed<PipState[]>(() => {
        const maxArmor = this.armorPips();
        const committed = this.committedArmorDamage();
        const pending = this.pendingArmorChange();
        const effective = committed + pending;

        return this.calculatePipStates(maxArmor, committed, pending, effective);
    });

    /**
     * Get structure pip states for rendering.
     */
    structurePipStates = computed<PipState[]>(() => {
        const maxStructure = this.structurePips();
        const committed = this.committedInternalDamage();
        const pending = this.pendingInternalChange();
        const effective = committed + pending;

        return this.calculatePipStates(maxStructure, committed, pending, effective);
    });

    /**
     * Calculate pip states for a given set of pips.
     */
    protected calculatePipStates(max: number, committed: number, pending: number, effective: number): PipState[] {
        const states: PipState[] = [];
        for (let i = 0; i < max; i++) {
            const pipIndex = i; // Pips fill from left to right (low to high)
            const isCommittedDamaged = pipIndex < committed;
            const isEffectiveDamaged = pipIndex < effective;

            states.push({
                index: i,
                isDamaged: isCommittedDamaged,
                isPendingDamage: !isCommittedDamaged && isEffectiveDamaged && pending > 0,
                isPendingHeal: isCommittedDamaged && !isEffectiveDamaged && pending < 0
            });
        }
        return states;
    }

    /**
     * Check if a specific crit pip is damaged (for rendering).
     * Pips fill from left (index 0) up to committed count.
     */
    isCritPipDamaged(key: string, pipIndex: number): boolean {
        const fu = this.forceUnit();
        if (!fu) return false;
        const committed = fu.getState().getCommittedCritHits(key);
        return pipIndex < committed;
    }

    /**
     * Check if a specific crit pip has pending damage.
     * Pending damage pips come after committed pips.
     */
    isCritPipPendingDamage(key: string, pipIndex: number): boolean {
        const fu = this.forceUnit();
        if (!fu) return false;
        const committed = fu.getState().getCommittedCritHits(key);
        const pendingChange = fu.getState().getPendingCritChange(key);
        
        // If pending is positive (damage), pips from committed to committed+pending are pending damage
        if (pendingChange > 0) {
            return pipIndex >= committed && pipIndex < committed + pendingChange;
        }
        return false;
    }

    /**
     * Check if a specific crit pip has pending heal.
     * Pending heal pips are the last committed pips that will be removed.
     */
    isCritPipPendingHeal(key: string, pipIndex: number): boolean {
        const fu = this.forceUnit();
        if (!fu) return false;
        const committed = fu.getState().getCommittedCritHits(key);
        const pendingChange = fu.getState().getPendingCritChange(key);
        
        // If pending is negative (heal), the last |pendingChange| committed pips are pending heal
        if (pendingChange < 0) {
            const healCount = -pendingChange;
            const startHealIndex = Math.max(0, committed - healCount);
            return pipIndex >= startHealIndex && pipIndex < committed;
        }
        return false;
    }

    /**
     * Check if unit is destroyed.
     */
    isDestroyed = computed<boolean>(() => {
        const fu = this.forceUnit();
        if (!fu) return false;
        return fu.isDestroyed();
    });

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

    // To-hit values (affected by crew and fire control critical hits: +2 per hit)
    toHitShort = computed<number>(() => this.skill() + this.heatLevelToHitModifier() + (this.crewHits() * 2) + (this.fireControlHits() * 2));
    toHitMedium = computed<number>(() => this.skill() + 2 + this.heatLevelToHitModifier() + (this.crewHits() * 2) + (this.fireControlHits() * 2));
    toHitLong = computed<number>(() => this.skill() + 4 + this.heatLevelToHitModifier() + (this.crewHits() * 2) + (this.fireControlHits() * 2));
    toHitExtreme = computed<number>(() => this.skill() + 6 + this.heatLevelToHitModifier() + (this.crewHits() * 2) + (this.fireControlHits() * 2));

    hasExtremeRange = computed<boolean>(() => {
        const tp = this.asStats().TP;
        return tp === 'AF' || tp === 'CF';
    });

    heatLevelToHitModifier = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return Math.max(0, this.heatLevel() - (fu.hasHotDog() ? 1 : 0));
    });

    // Heat level (committed)
    heatLevel = computed<number>(() => {
        return this.forceUnit()?.getHeat() ?? 0;
    });

    movementDisplay = computed<string>(() => {
        const fu = this.forceUnit();
        if (!fu) {
            const movements = this.asStats().MVm;
            return Object.entries(movements)
                .map(([mode, inches]) => this.formatMovement(inches, mode))
                .join('/');
        }

        const effectiveMv = fu.effectiveMovement();
        const entries = this.getMovementEntries(effectiveMv);
        if (entries.length === 0) {
            return '';
        };

        return entries
            .map(([mode, inches]) => this.formatMovement(inches, mode))
            .join('/');
    });

    // ===== Critical Hit Effects on Stats =====
    // NOTE: These use COMMITTED hits only, not pending. Effects only apply after commit.

    /**
     * Get committed fire control hits (affects to-hit).
     */
    fireControlHits = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().getCommittedCritHits('fire-control');
    });

    /**
     * Get committed crew hits (affects to-hit and control rolls).
     */
    crewHits = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().getCommittedCritHits('crew');
    });

    /**
     * Get committed MP hits (affects movement).
     */
    mpHits = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().getCommittedCritHits('mp');
    });

    /**
     * Get committed engine hits (affects heat).
     */
    engineHits = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().getCommittedCritHits('engine');
    });

    /**
     * Get committed weapon hits (affects damage).
     */
    weaponHits = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.weaponHits();
    });
    
    effectiveSpecials = computed<SpecialAbilityState[]>(() => {
        const fu = this.forceUnit();
        if (fu) {
            return fu.effectiveSpecials();
        }
        // No force unit - build from raw unit specials without damage reduction
        const specials = this.asStats().specials || [];
        return specials.map(special => {
            const specialAbilityState: SpecialAbilityState = { original: special, effective: special };
            return specialAbilityState;
        });
    });

    getMovementEntries(mvm: Record<string, number> | undefined): Array<[string, number]> {
        if (!mvm) return [];

        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number') as Array<[string, number]>;

        return entries;
    }
    
    formatMovement(inches: number, suffix: string = ''): string {
        if (this.useHex()) {
            return Math.ceil(inches / 2) + suffix;
        }
        return inches + '"' + suffix;
    }

    formatPilotAbility(selection: AbilitySelection): string {
        if (typeof selection === 'string') {
            const ability = this.pilotAbilityById.get(selection);
            return ability ? `${ability.name} (${ability.cost})` : selection;
        }
        return `${selection.name} (${selection.cost})`;
    }

    onPilotAbilityClick(selection: AbilitySelection): void {
        this.pilotAbilityClick.emit(selection);
    }

    range(count: number): number[] {
        return Array.from({ length: count }, (_, i) => i);
    }

    onSpecialClick(state: SpecialAbilityState, event: MouseEvent): void {
        this.specialClick.emit({ state, event });
    }

    onEditPilotClick(): void {
        this.editPilotClick.emit();
    }

    onRollCriticalClick(): void {
        this.rollCriticalClick.emit();
    }
}
