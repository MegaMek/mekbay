// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed } from '@angular/core';
import type { CBTForceUnit, EquipmentAction } from '../cbt-force-unit.model';
import type { CrewStateControlDefinition, CrewStateDefinition, UnitConditionControl, UnitRuleModifier } from './unit-type-rules';
import type { EquipmentStatus, EquipmentStatusFacts, UnitSystemStatusFacts } from '../equipment-status.model';
import type { ToHitModifierBreakdownEntry } from './game-rules';
import { crewStateDefinitions, sortPSRModifiers, unitConditionControls, UnitTypeRulesBase } from './unit-type-rules';
import type { PSRCheck, TurnState } from '../turn-state.model';
import type { MountedEquipment } from '../mounted-equipment.model';
import type { CriticalSlot } from '../force-serialization';
import { WeaponEquipment } from '../equipment.model';
import { getDefaultAttackerMovementModifier } from '../target-number-calculator.model';
import type { MotiveModes } from '../motiveModes.model';
import { critId, timestampedMotiveHits, type MotiveHitTimestamp } from './vehicle-motive-hit.util';

interface VehicleMovementState {
    moveImpaired: boolean;
    walk: number;
    maxWalk: number;
    run: number;
    maxRun: number;
}

interface VehicleSystemsStatus {
    crewKilled: boolean;
    crewStunned: boolean;
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
 * 
 * Vehicle / Naval / VTOL / default game rules.
 */
 
export const VEHICLE_UNIT_CONDITION_CONTROLS: readonly UnitConditionControl[] = unitConditionControls(['swarmed', 'tagged', 'skidding', 'jammed']);
export const VEHICLE_CREW_STATE_CONTROLS: readonly CrewStateControlDefinition[] = crewStateDefinitions(['killed', 'stunned']) as readonly CrewStateControlDefinition[];
export const VEHICLE_CREW_STATE_DISPLAYS: readonly CrewStateDefinition[] = crewStateDefinitions(['killed', 'stunned']);

export class VehicleRules extends UnitTypeRulesBase {

    protected override supportsDroneOperatingSystem(): boolean {
        return true;
    }

    protected override readonly baseConditionControls: readonly UnitConditionControl[] = VEHICLE_UNIT_CONDITION_CONTROLS;
    protected override readonly baseCrewStateControls = VEHICLE_CREW_STATE_CONTROLS;
    protected override readonly crewStateDisplayDefinitions = VEHICLE_CREW_STATE_DISPLAYS;

    protected override readonly abandoned = computed<boolean>(() => this.systemsStatus().crewKilled);

    override readonly immobile = computed<boolean>(() => {
        const status = this.systemsStatus();
        return status.crewKilled || status.motiveHits.some(motiveHit => motiveHit.level === 4);
    });

    constructor(unit: CBTForceUnit) {
        super(unit, 'DSR', 'Driving Skill Rolls');
    }

    readonly systemsStatus = computed<VehicleSystemsStatus>(() => {
        const crits = this.unit.getCritSlots();
        const inventory = this.unit.getInventory();
        const unitType = this.unit.getUnit().type;
        const crewStates = this.unit.getCrewMembers().map(crewMember => crewMember.getState());
        const crewKilled = crewStates.some(state => state === 'killed');
        const crewStunned = crewStates.some(state => state === 'stunned');
        const committed = crits.filter(crit => !!crit.destroyed);
        const hasCrit = (id: string) => committed.some(crit => this.critId(crit) === id);
        const hasDroneOperatingSystem = this.hasDroneOperatingSystem();
        const hasWorkingSupercharger = inventory.some(entry => this.isSuperchargerEntry(entry)
            && this.unit.canPerformEquipmentAction(entry, 'provide-passive-effect'));
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

        return {
            crewKilled,
            crewStunned,
            commanderHit: !hasDroneOperatingSystem && hasCrit('commander_hit'),
            copilotHit: !hasDroneOperatingSystem && hasCrit('copilot_hit'),
            driverOrPilotHit: !hasDroneOperatingSystem && (hasCrit('driver_hit') || hasCrit('pilot_hit')),
            engineHit: this.hasCommittedEngineHit(),
            hasWorkingSupercharger,
            sensorHits,
            rotorHits,
            flightStabilizerHit: hasCrit('flight_stabilizer_hit'),
            motiveHits,
            stabilizerLocations,
        };
    });

    override hasComputedCondition(condition: string): boolean {
        if (condition === 'disconnected' && this.hasDroneOperatingSystem() && this.hasCommittedCrit('commander_hit')) return true;
        return super.hasComputedCondition(condition);
    }

    protected override buildRuleModifiers(): UnitRuleModifier[] {
        const status = this.systemsStatus();
        const modifiers: UnitRuleModifier[] = [];
        if (this.unit.getUnit().armorType === 'Hardened') {
            modifiers.push({ label: 'Mounts Hardened Armor', values: { psr: 1 } });
        }
        if (status.commanderHit) {
            modifiers.push({ label: 'Commander hit', values: { ranged: 1, physical: 1, psr: 1 }, weakened: true });
        }
        if (status.copilotHit) {
            modifiers.push({ label: 'Co-pilot hit', values: { ranged: 1 }, weakened: true });
        }
        if (status.driverOrPilotHit) {
            modifiers.push({ label: 'Driver/Pilot hit', values: { psr: 2 }, weakened: true });
        }
        if (status.flightStabilizerHit) {
            modifiers.push({ label: 'Flight stabilizer hit', values: { ranged: 1, psr: 3 }, weakened: true });
        }
        if (status.sensorHits > 0) {
            modifiers.push({ label: 'Sensor hits', values: { ranged: status.sensorHits }, weakened: true });
        }
        const appliedMotivePilotingLevels = new Set<number>();
        for (const motiveHit of status.motiveHits) {
            if (motiveHit.level >= 1 && motiveHit.level <= 3 && !appliedMotivePilotingLevels.has(motiveHit.level)) {
                modifiers.push({ label: 'Motive system hit', values: { psr: motiveHit.level }, weakened: true });
                appliedMotivePilotingLevels.add(motiveHit.level);
            }
        }
        return modifiers;
    }

    readonly movementState = computed<VehicleMovementState>(() => {
        const unit = this.unit.getUnit();
        const baseWalk = Math.max(0, unit.walk);
        const status = this.systemsStatus();
        if (this.immobile() || this.unit.getCondition('disconnected')) {
            return {
                moveImpaired: true,
                walk: 0,
                maxWalk: 0,
                run: 0,
                maxRun: 0,
            };
        }
        const walkAfterMotiveDamage = status.engineHit ? 0 : this.applyMotiveDamage(baseWalk, status.motiveHits);
        const walk = unit.type === 'VTOL'
            ? Math.max(0, walkAfterMotiveDamage - status.rotorHits)
            : walkAfterMotiveDamage;
        let run = walk === 0 ? 0 : Math.round(walk * 1.5);
        const runValueCoeff = status.hasWorkingSupercharger ? 2 : 1.5;
        let maxRun = walk === 0 ? 0 : Math.round(walk * runValueCoeff);
        if (status.flightStabilizerHit || status.crewStunned) {
            run = 0;
            maxRun = 0;
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

    override getEffectiveMaxDistanceForMoveMode(moveMode: MotiveModes, turnState: TurnState): number | null {
        const movement = this.movementState();
        if (moveMode === 'walk') return movement.walk;
        if (moveMode !== 'run') return null;
        if (movement.run === 0) return 0;

        const runValueCoeff = 1.5 + this.unit.getRunMovementMultiplierBonus(turnState);
        return Math.max(0, Math.round(movement.walk * runValueCoeff));
    }

    override isMotiveModeAvailable(moveMode: MotiveModes): boolean {
        const status = this.systemsStatus();
        if (status.crewKilled) return false;
        if (moveMode === 'run' && (status.flightStabilizerHit || status.crewStunned)) return false;
        return true;
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
        const projected = this.psrModifiers();
        return {
            modifier: projected.reduce((total, modifier) => total + modifier.modifier, 0),
            modifiers: sortPSRModifiers(projected.map(modifier => ({ pilotCheck: modifier.modifier, reason: modifier.label }))),
        };
    });

    override readonly PSRTargetRoll = computed<number>(() => this.unit.pilotingSkill() + this.PSRModifiers().modifier);

    override getUnitSystemStatusFacts(): UnitSystemStatusFacts {
        return {
            ...super.getUnitSystemStatusFacts(),
            engineHit: this.hasCommittedEngineHit(),
        };
    }

    override getEquipmentStatusContribution(facts: EquipmentStatusFacts): EquipmentStatus {
        return facts.unitSystemFacts.engineHit && facts.equipmentFlags.has('F_ENERGY')
            ? 'disabled'
            : 'available';
    }

    override canPerformEquipmentAction(entry: MountedEquipment, action: EquipmentAction): boolean {
        return action !== 'fire' || entry.isPhysicalWeapon() || this.systemsStatus().sensorHits < 4;
    }

    override getEquipmentToHitModifiers(entry: MountedEquipment): readonly ToHitModifierBreakdownEntry[] {
        const status = this.systemsStatus();
        const hitModifierBreakdown: ToHitModifierBreakdownEntry[] = [];

        if (!this.isPhysicalEntry(entry)) {
            hitModifierBreakdown.push(...this.getMountedTargetingComputerModifiers(entry));
            const stabilizerModifier = this.stabilizerHitModifier(entry, status);
            if (this.stabilizerHitApplies(entry, status)) {
                hitModifierBreakdown.push({ label: 'Stabilizer Hit', modifier: stabilizerModifier, weakened: true });
            }
        }
        return [...hitModifierBreakdown, ...this.getUnitEquipmentToHitModifiers(entry)];
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
        return entry.isPhysicalWeapon();
    }

    private isSuperchargerEntry(entry: MountedEquipment): boolean {
        const flags = entry.equipment?.flags;
        return !!flags?.has('F_MASC');
    }

    private rotorCommittedCritHits(crit: CriticalSlot | undefined): number {
        return (crit?.hits ?? 0);
    }

    private hasCommittedEngineHit(): boolean {
        return this.unit.getCritSlots().some(crit => !!crit.destroyed && /^engine_hit_\d+$/.test(this.critId(crit)));
    }

    private hasCommittedCrit(id: string): boolean {
        return this.unit.getCritSlots().some(crit => !!crit.destroyed && this.critId(crit) === id);
    }

    private critId(crit: CriticalSlot): string {
        return critId(crit);
    }
}
