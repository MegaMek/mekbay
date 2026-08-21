// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { AmmoEquipment } from '../models/equipment.model';
import type { CriticalSlot } from '../models/force-serialization';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { resolveHeatScaleEffects } from '../models/rules/heat-management';
import {
    ammoExplosionDamagePerShot,
    ammoRackSize,
    criticalSlotTotalAmmo,
} from './mek-critical-hit.util';

export type HeatEffectKind =
    | 'heat-shutdown'
    | 'heat-ammo-explosion'
    | 'heat-random-movement'
    | 'heat-pilot-damage'
    | 'heat-life-support'
    | 'life-support-drowning';

export interface HeatEffectDescriptor {
    readonly kind: HeatEffectKind;
    readonly description: string;
    readonly target?: number;
    readonly automaticOutcome?: 'success' | 'failed';
    readonly hits?: number;
}

export function isPilotHitHeatEffect(descriptor: HeatEffectDescriptor): boolean {
    return descriptor.kind === 'heat-pilot-damage'
        || descriptor.kind === 'heat-life-support'
        || descriptor.kind === 'life-support-drowning';
}

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
    if (effects.shutdownTarget !== undefined) {
        const consciousPilot = unit.rules.getActivePilotCrewId() !== null;
        descriptors.push({
            kind: 'heat-shutdown',
            description: effects.shutdownTarget >= 100
                ? `Automatic shutdown!`
                : `Avoid shutdown at heat ${heat}.`,
            ...(effects.shutdownTarget >= 100 || !consciousPilot
                ? { automaticOutcome: 'failed' as const }
                : { target: effects.shutdownTarget }),
        });
    } else if (unit.getCondition('shutdown') && heat < 14) {
        descriptors.push({
            kind: 'heat-shutdown',
            description: `Heat ${heat} permits an automatic restart.`,
            automaticOutcome: 'success',
        });
    }
    if (effects.ammoExplosionTarget !== undefined && getHeatAmmoExplosionCandidates(unit).length > 0) {
        descriptors.push({
            kind: 'heat-ammo-explosion',
            description: `Avoid an ammunition explosion at heat ${heat}.`,
            target: effects.ammoExplosionTarget,
        });
    }
    if (effects.randomMovementTarget !== undefined) {
        descriptors.push({
            kind: 'heat-random-movement',
            description: `Keep the navigation and piloting systems online at heat ${heat}.`,
            target: effects.randomMovementTarget,
        });
    } else if (heat < 5 && unit.turnState().getPendingUnitChecks().some(check =>
        check.kind === 'aero-control-recovery'
        && check.cause === 'heat-random-movement')) {
        descriptors.push({
            kind: 'heat-random-movement',
            description: `Heat ${heat} ends the heat-induced random-movement effect.`,
            automaticOutcome: 'success',
        });
    }
    if (effects.pilotDamageTarget !== undefined) {
        descriptors.push({
            kind: 'heat-pilot-damage',
            description: `Avoid pilot damage from heat ${heat}.`,
            target: effects.pilotDamageTarget,
            hits: 1,
        });
    }
    const lifeSupportHits = unit.rules.heatLifeSupportPilotHits(heat);
    if (lifeSupportHits > 0) {
        descriptors.push({
            kind: 'heat-life-support',
            description: `Damaged life support (${lifeSupportHits} pilot hit${lifeSupportHits === 1 ? '' : 's'})`,
            automaticOutcome: 'failed',
            hits: lifeSupportHits,
        });
    }
    const drowningHits = unit.rules.submergedLifeSupportPilotHits();
    if (drowningHits > 0) {
        descriptors.push({
            kind: 'life-support-drowning',
            description: 'Damaged life support (1 pilot hit).',
            automaticOutcome: 'failed',
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
