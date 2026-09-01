// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { AmmoEquipment } from '../models/equipment.model';
import type { CriticalSlot } from '../models/force-serialization';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { resolveHeatScaleEffects } from '../models/rules/heat-management';
import {
    UNIT_CHECK_CAUSE,
    UNIT_CHECK_KIND,
    type HeatEffectDescriptor,
} from '../models/unit-check.model';
import {
    ammoExplosionDamagePerShot,
    ammoRackSize,
    criticalSlotTotalAmmo,
} from './mek-critical-hit.util';

export type { HeatEffectDescriptor, HeatEffectKind } from '../models/unit-check.model';

export interface HeatAmmoExplosionCandidate {
    readonly id: string;
    readonly equipment: string;
    readonly location?: string;
    readonly damagePerShot: number;
    readonly shots: number;
    readonly rawDamage: number;
    readonly slot?: CriticalSlot;
    readonly entry?: MountedEquipment;
}

export function getHeatEffectDescriptors(unit: CBTForceUnit, heat: number): HeatEffectDescriptor[] {
    const effects = resolveHeatScaleEffects(unit.rules.heatScale, heat);
    const descriptors: HeatEffectDescriptor[] = [];
    const shutdown = unit.getCondition('shutdown');
    const consciousPilot = unit.rules.getActivePilotCrewId() !== null;
    if (shutdown) {
        if (heat < 14) {
            descriptors.push({
                kind: UNIT_CHECK_KIND.SHUTDOWN_RECOVERY,
                result: { kind: 'automatic', outcome: 'success' },
            });
        } else if (consciousPilot
            && effects.shutdownTarget !== undefined
            && effects.shutdownTarget <= 12) {
            descriptors.push({
                kind: UNIT_CHECK_KIND.SHUTDOWN_RECOVERY,
                target: effects.shutdownTarget,
            });
        }
    } else if (effects.shutdownTarget !== undefined) {
        descriptors.push({
            kind: UNIT_CHECK_KIND.HEAT_SHUTDOWN,
            ...(effects.shutdownTarget >= 100 || !consciousPilot
                ? { result: { kind: 'automatic' as const, outcome: 'failed' as const } }
                : { target: effects.shutdownTarget }),
        });
    }
    if (effects.ammoExplosionTarget !== undefined && getHeatAmmoExplosionCandidates(unit).length > 0) {
        descriptors.push({
            kind: UNIT_CHECK_KIND.HEAT_AMMO_EXPLOSION,
            target: effects.ammoExplosionTarget,
        });
    }
    if (effects.randomMovementTarget !== undefined) {
        descriptors.push({
            kind: UNIT_CHECK_KIND.HEAT_RANDOM_MOVEMENT,
            target: effects.randomMovementTarget,
        });
    } else if (heat < 5 && unit.turnState().getPendingUnitChecks().some(check =>
        check.kind === UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY
        && check.cause === UNIT_CHECK_CAUSE.HEAT_RANDOM_MOVEMENT)) {
        descriptors.push({
            kind: UNIT_CHECK_KIND.HEAT_RANDOM_MOVEMENT,
            result: { kind: 'automatic', outcome: 'success' },
        });
    }
    if (effects.pilotDamageTarget !== undefined) {
        descriptors.push({
            kind: UNIT_CHECK_KIND.HEAT_PILOT_DAMAGE,
            target: effects.pilotDamageTarget,
            hits: 1,
        });
    }
    const lifeSupportHits = unit.rules.heatLifeSupportPilotHits(heat);
    if (lifeSupportHits > 0) {
        descriptors.push({
            kind: UNIT_CHECK_KIND.HEAT_LIFE_SUPPORT,
            result: { kind: 'automatic', outcome: 'failed' },
            hits: lifeSupportHits,
        });
    }
    const drowningHits = unit.rules.submergedLifeSupportPilotHits();
    if (drowningHits > 0) {
        descriptors.push({
            kind: UNIT_CHECK_KIND.LIFE_SUPPORT_DROWNING,
            result: { kind: 'automatic', outcome: 'failed' },
            hits: drowningHits,
        });
    }
    return descriptors;
}

/** Candidates tied after both mandated comparisons remain a controller choice. */
export function getPreferredHeatAmmoExplosionCandidates(unit: CBTForceUnit): HeatAmmoExplosionCandidate[] {
    const candidates = getHeatAmmoExplosionCandidates(unit);
    if (candidates.length <= 1) return candidates;
    const highestDamage = Math.max(...candidates.map(candidate => candidate.damagePerShot));
    const mostDestructive = candidates.filter(candidate => candidate.damagePerShot === highestDamage);
    const mostShots = Math.max(...mostDestructive.map(candidate => candidate.shots));
    return mostDestructive.filter(candidate => candidate.shots === mostShots);
}

export function getHeatAmmoExplosionCandidates(unit: CBTForceUnit): HeatAmmoExplosionCandidate[] {
    return unit.getUnit().type === 'Aero'
        ? getAeroHeatAmmoExplosionCandidates(unit)
        : getMekHeatAmmoExplosionCandidates(unit);
}

function getMekHeatAmmoExplosionCandidates(unit: CBTForceUnit): HeatAmmoExplosionCandidate[] {
    return unit.getCritSlots().flatMap(slot => {
        const ammo = slot.eq;
        if (!(ammo instanceof AmmoEquipment)
            || !ammo.isExplosive()
            || slot.destroyed
            || slot.destroying
            || (slot.loc && unit.isInternalLocDestroyed(slot.loc))) return [];
        const shots = Math.max(0, criticalSlotTotalAmmo(unit, slot, ammo) - (slot.consumed ?? 0));
        const damagePerShot = ammoRackSize(ammo) * ammoExplosionDamagePerShot(ammo);
        const rawDamage = shots * damagePerShot;
        return shots > 0 && rawDamage > 0 ? [{
            id: slot.id,
            equipment: ammo.name,
            location: slot.loc,
            damagePerShot,
            shots,
            rawDamage,
            slot,
        }] : [];
    });
}

function getAeroHeatAmmoExplosionCandidates(unit: CBTForceUnit): HeatAmmoExplosionCandidate[] {
    return unit.getInventory().flatMap(entry => {
        const ammo = entry.equipment;
        if (!(ammo instanceof AmmoEquipment)
            || !ammo.isExplosive()
            || entry.committedDestroyed()
            || entry.isDestroying()) return [];
        const shots = Math.max(0, (entry.totalAmmo ?? ammo.getShots(unit.gameRules, unit.getEquipmentRegistry()))
            - (entry.consumed ?? 0));
        const damagePerShot = ammoRackSize(ammo) * ammoExplosionDamagePerShot(ammo);
        const rawDamage = shots * damagePerShot;
        return shots > 0 && rawDamage > 0 ? [{
            id: entry.id,
            equipment: entry.getDisplayName(),
            location: Array.from(entry.locations ?? [])[0],
            damagePerShot,
            shots,
            rawDamage,
            entry,
        }] : [];
    });
}
