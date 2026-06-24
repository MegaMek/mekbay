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

import { computed } from '@angular/core';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import type { UnitSkillModifier } from './unit-type-rules';
import { UnitTypeRulesBase } from './unit-type-rules';
import type { PSRCheck } from '../turn-state.model';
import type { CriticalSlot, MountedEquipment } from '../force-serialization';
import { WeaponEquipment } from '../equipment.model';
import { getDefaultAttackerMovementModifier } from '../target-number-calculator.model';
import type { MotiveModes } from '../motiveModes.model';
import { critId, timestampedMotiveHits, type MotiveHitTimestamp } from './vehicle-motive-hit.util';

type VehicleEntryState = { isDamaged: boolean; isDisabled: boolean; hitMod: number };

interface VehicleMovementState {
    moveImpaired: boolean;
    walk: number;
    maxWalk: number;
    run: number;
    maxRun: number;
}

interface VehicleSystemsStatus {
    commanderHit: boolean;
    copilotHit: boolean;
    driverOrPilotHit: boolean;
    engineHit: boolean;
    hasWorkingSupercharger: boolean;
    sensorHits: number;
    rotorHits: number;
    flightStabilizerHit: boolean;
    motiveHits: MotiveHitTimestamp[];
    stabilizerLocations: Set<string>;
    gunneryModifier: number;
    pilotingModifier: number;
}

const STABILIZER_HIT_LOCATIONS: Record<string, readonly string[]> = {
    stabilizer_hit_front: ['FR', 'FRRS', 'FRLS'],
    stabilizer_hit_rear: ['RR', 'RRRS', 'RRLS'],
    stabilizer_hit_turret: ['TU'],
    stabilizer_hit_left: ['LS', 'FRLS', 'RRLS'],
    stabilizer_hit_right: ['RS', 'FRRS', 'RRRS'],
    stabilizer_hit_turret_f: ['FT'],
    stabilizer_hit_turret_r: ['TU'],
};

/**
 * Author: Drake
 * 
 * Vehicle / Naval / VTOL / default game rules.
 */
export class VehicleRules extends UnitTypeRulesBase {

    constructor(private unit: CBTForceUnit) {
        super();
    }

    readonly systemsStatus = computed<VehicleSystemsStatus>(() => {
        const crits = this.unit.getCritSlots();
        const inventory = this.unit.getInventory();
        const unitType = this.unit.getUnit().type;
        const committed = crits.filter(crit => !!crit.destroyed);
        const hasCrit = (id: string) => committed.some(crit => this.critId(crit) === id);
        const hasWorkingSupercharger = inventory.some(entry => this.isSuperchargerEntry(entry) && !this.isEntryDestroyed(entry));
        const rotorHits = unitType === 'VTOL'
            ? Math.max(0, this.rotorCommittedCritHits(crits.find(crit => this.critId(crit) === 'rotor')))
            : 0;
        const sensorHits = committed.reduce((highest, crit) => {
            const match = this.critId(crit).match(/^sensor_hit_(\d+)$/);
            return match ? Math.max(highest, parseInt(match[1], 10)) : highest;
        }, 0);
        const motiveHits = timestampedMotiveHits(crits);
        const stabilizerLocations = new Set<string>();
        for (const crit of committed) {
            const locations = STABILIZER_HIT_LOCATIONS[this.critId(crit)];
            if (locations) {
                locations.forEach(loc => stabilizerLocations.add(loc));
            }
        }

        let gunneryModifier = 0;
        let pilotingModifier = 0;
        if (hasCrit('commander_hit')) {
            gunneryModifier += 1;
            pilotingModifier += 1;
        }
        if (hasCrit('copilot_hit')) {
            gunneryModifier += 1;
        }
        if (hasCrit('driver_hit') || hasCrit('pilot_hit')) {
            pilotingModifier += 2;
        }
        gunneryModifier += sensorHits;
        if (hasCrit('flight_stabilizer_hit')) {
            gunneryModifier += 1;
            pilotingModifier += 3;
        }
        const appliedMotivePilotingLevels = new Set<number>();
        for (const motiveHit of motiveHits) {
            if (motiveHit.level >= 1 && motiveHit.level <= 3 && !appliedMotivePilotingLevels.has(motiveHit.level)) {
                pilotingModifier += motiveHit.level;
                appliedMotivePilotingLevels.add(motiveHit.level);
            }
        }

        return {
            commanderHit: hasCrit('commander_hit'),
            copilotHit: hasCrit('copilot_hit'),
            driverOrPilotHit: hasCrit('driver_hit') || hasCrit('pilot_hit'),
            engineHit: committed.some(crit => /^engine_hit_\d+$/.test(this.critId(crit))),
            hasWorkingSupercharger,
            sensorHits,
            rotorHits,
            flightStabilizerHit: hasCrit('flight_stabilizer_hit'),
            motiveHits,
            stabilizerLocations,
            gunneryModifier,
            pilotingModifier,
        };
    });

    override readonly gunneryModifier = computed<number>(() => this.systemsStatus().gunneryModifier);
    override readonly pilotingModifier = computed<number>(() => this.systemsStatus().pilotingModifier);

    override readonly gunneryModifiers = computed<UnitSkillModifier[]>(() => {
        const status = this.systemsStatus();
        const modifiers: UnitSkillModifier[] = [];
        if (status.commanderHit) {
            modifiers.push({ modifier: 1, reason: 'Commander hit' });
        }
        if (status.copilotHit) {
            modifiers.push({ modifier: 1, reason: 'Co-Pilot hit' });
        }
        if (status.sensorHits > 0) {
            modifiers.push({ modifier: status.sensorHits, reason: `Sensor hit ${status.sensorHits}` });
        }
        if (status.flightStabilizerHit) {
            modifiers.push({ modifier: 1, reason: 'Flight stabilizer hit' });
        }
        return modifiers;
    });

    readonly movementState = computed<VehicleMovementState>(() => {
        const unit = this.unit.getUnit();
        const baseWalk = Math.max(0, unit.walk);
        const status = this.systemsStatus();
        const walkAfterMotiveDamage = status.engineHit ? 0 : this.applyMotiveDamage(baseWalk, status.motiveHits);
        const walk = unit.type === 'VTOL'
            ? Math.max(0, walkAfterMotiveDamage - status.rotorHits)
            : walkAfterMotiveDamage;
        let run = walk === 0 ? 0 : Math.round(walk * 1.5);
        const runValueCoeff = status.hasWorkingSupercharger ? 2 : 1.5;
        let maxRun = walk === 0 ? 0 : Math.round(walk * runValueCoeff);
        if (status.flightStabilizerHit) {
            run = walk;
            maxRun = walk;
        }

        return {
            moveImpaired: walk !== baseWalk || run !== Math.round(baseWalk * 1.5),
            walk,
            maxWalk: walk,
            run,
            maxRun,
        };
    });

    override getMaxDistanceForMoveMode(moveMode: MotiveModes): number | null {
        const movement = this.movementState();
        if (moveMode === 'walk') return movement.walk;
        if (moveMode === 'run') return movement.maxRun;
        return null;
    }

    override getAttackMovementModifier(moveMode: MotiveModes | null | undefined): number {
        return getDefaultAttackerMovementModifier(moveMode);
    }

    evaluateDestroyed(): void {
        // Destruction: critLocs with 'destroy' attribute, SI, or any internal location destroyed.
        let destroyed = false;

        // Check critLocs with 'destroy' attribute (vehicle-style crits)
        for (const crit of this.unit.getCritSlots()) {
            if (crit.destroyed && crit.el?.getAttribute('destroy')) {
                destroyed = true;
                break;
            }
        }

        // Check SI (structural integrity)
        if (!destroyed && this.unit.locations?.internal?.has('SI')) {
            if (this.unit.isInternalLocCommittedDestroyed('SI')) {
                destroyed = true;
            }
        }

        // For Naval/Tank/VTOL: any internal location destroyed = unit destroyed
        const unitType = this.unit.getUnit().type;
        if (!destroyed && (unitType === 'Naval' || unitType === 'Tank' || unitType === 'VTOL')) {
            this.unit.locations?.internal?.forEach((_value, loc) => {
                if (this.unit.isInternalLocCommittedDestroyed(loc)) {
                    destroyed = true;
                }
            });
        }

        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    override readonly PSRModifiers = computed<{ modifier: number; modifiers: PSRCheck[] }>(() => {
        const status = this.systemsStatus();
        const modifiers: PSRCheck[] = [];
        if (status.commanderHit) {
            modifiers.push({ pilotCheck: 1, reason: 'Commander hit' });
        }
        if (status.driverOrPilotHit) {
            modifiers.push({ pilotCheck: 2, reason: 'Driver/Pilot hit' });
        }
        if (status.sensorHits > 0) {
            modifiers.push({ pilotCheck: status.sensorHits, reason: `Sensor hit` });
        }
        if (status.flightStabilizerHit) {
            modifiers.push({ pilotCheck: 3, reason: 'Flight stabilizer hit' });
        }
        const appliedMotivePilotingLevels = new Set<number>();
        for (const motiveHit of status.motiveHits) {
            if (motiveHit.level >= 1 && motiveHit.level <= 3 && !appliedMotivePilotingLevels.has(motiveHit.level)) {
                modifiers.push({ pilotCheck: motiveHit.level, reason: `Motive system hit` });
                appliedMotivePilotingLevels.add(motiveHit.level);
            }
        }
        return { modifier: status.pilotingModifier, modifiers };
    });

    override readonly PSRTargetRoll = computed<number>(() => this.unit.pilotingSkill() + this.PSRModifiers().modifier);

    computeAllEntryStates(): Map<MountedEquipment, VehicleEntryState> {
        const result = new Map<MountedEquipment, VehicleEntryState>();
        for (const entry of this.unit.getInventory()) {
            result.set(entry, this.computeEntryState(entry));
        }
        return result;
    }

    computeEntryState(entry: MountedEquipment): VehicleEntryState {
        const status = this.systemsStatus();
        const isDamaged = !!(entry.critSlots?.some(slot => slot.destroyed) || entry.destroyed);
        let isDisabled = false;
        let hitMod = 0;
        const isPhysical = this.isPhysicalEntry(entry);

        if (!isPhysical) {
            if (status.engineHit && entry.equipment?.flags.has('F_ENERGY')) {
                isDisabled = true;
            }
            if (status.sensorHits >= 4 && entry.equipment instanceof WeaponEquipment) {
                isDisabled = true;
            }
            hitMod += this.stabilizerHitModifier(entry, status);
        }

        if (entry.states?.get('state') === 'jammed') {
            isDisabled = true;
        }

        return { isDamaged, isDisabled, hitMod };
    }

    hasDamagedStabilizerAffectingEntry(entry: MountedEquipment): boolean {
        if (this.isPhysicalEntry(entry)) return false;
        return this.stabilizerHitApplies(entry, this.systemsStatus());
    }

    private applyMotiveDamage(base: number, motiveHits: MotiveHitTimestamp[]): number {
        let current = base;
        for (const hit of motiveHits) {
            if (current <= 0) return 0;
            switch (hit.level) {
                case 2:
                    current = Math.max(0, current - 1);
                    break;
                case 3:
                    current = Math.ceil(current / 2);
                    break;
                case 4:
                    current = 0;
                    break;
            }
        }
        return current;
    }

    private stabilizerHitModifier(entry: MountedEquipment, status: VehicleSystemsStatus): number {
        if (!this.stabilizerHitApplies(entry, status)) return 0;
        return this.unit.turnState().getAttackMovementModifier(); // We re-apply the current movement modifier (becomes x2)
    }

    private stabilizerHitApplies(entry: MountedEquipment, status: VehicleSystemsStatus): boolean {
        if (status.stabilizerLocations.size === 0 || !entry.locations || entry.locations.size === 0) return false;
        return Array.from(entry.locations).some(loc => status.stabilizerLocations.has(loc));
    }

    private isPhysicalEntry(entry: MountedEquipment): boolean {
        return !!entry.physical
            || !!entry.equipment?.flags.has('F_CLUB')
            || !!entry.equipment?.flags.has('F_HAND_WEAPON');
    }

    private isSuperchargerEntry(entry: MountedEquipment): boolean {
        const flags = entry.equipment?.flags;
        return !!flags?.has('F_MASC');
    }

    private isEntryDestroyed(entry: MountedEquipment): boolean {
        return !!entry.destroyed || !!entry.critSlots?.some(slot => slot.destroyed);
    }

    private rotorCommittedCritHits(crit: CriticalSlot | undefined): number {
        return (crit?.hits ?? 0);
    }

    private critId(crit: CriticalSlot): string {
        return critId(crit);
    }
}
