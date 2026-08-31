// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { EquipmentStatus } from '../equipment-status.model';
import type { Equipment } from '../equipment.model';
import { AmmoEquipment, MiscEquipment, WeaponEquipment, resolveWeaponDamage } from '../equipment.model';
import { isBombastLaserEquipment } from '../bombast-laser-mode.model';
import {
    isCaseIIEquipment,
    isStandardOrPrototypeCaseEquipment,
} from '../case-equipment.model';
import { structureConstructionKind } from '../construction-equipment.model';
import { isPpcCapacitorEquipment, isPpcEquipment } from '../ppc-capacitor.model';
import type {
    ArmorFaceId,
    ComponentId,
    CriticalSlotId,
    LocationId,
} from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import {
    getTopologyFor,
    LEG_LOCATIONS,
    MEK_TORSO_LOCATIONS,
    type MekLocation,
} from '../entity/types';
import { gameRulesFor, type MekExplosionProtection } from '../rules/game-rules';
import {
    BOMBAST_LASER_CHARGED_STATE,
    isCoreBombastLaserComponent,
} from './component-bombast-laser';
import {
    PPC_CAPACITOR_CHARGED_STATE,
    ppcCapacitorWeaponId,
} from './component-ppc-capacitor';
import type { AmmoLoadout } from './mek-ammo';
import {
    componentCriticalSlotIds,
    mekCriticalSlotHittable,
    mekCriticalSlotDirectHitThreshold,
    mekCriticalSlotMaximumHits,
} from './mek-critical-slot-rules';
import { mekCriticalDamageThreshold } from './equipment-status-kernel';
import {
    componentLocationIds,
    equipmentForComponent,
    type MekRuntimeIndex,
    type MekIndexedCriticalSlot,
} from './mek-runtime-index';
import type {
    BombastLaserRuntimeState,
    EscalatingFailureRuntimeState,
    PpcCapacitorRuntimeState,
} from './runtime-state';
import { isGaussPoweredDown, type MekGaussPowerState } from './mek-gauss-power';
import { isGaussEquipment } from '../gauss-equipment.model';
import { riscLaserPulseCriticalExplosion } from './component-risc-laser-pulse';
import { escalatingFailureCriticalExplosionDamage } from './component-escalating-failure';
import { jumpJetCriticalExplosionDamage } from '../jump-equipment.model';
import { supportEquipmentExplosionDamage } from '../support-equipment.model';

export type MekCriticalMutationTarget = 'committed' | 'pending';

/** Narrow read-only facts needed by the critical-hit rules. */
export interface MekCriticalRuntimeViewV2 {
    remainingArmor(faceId: ArmorFaceId, perspective: 'committed' | 'preview'): number;
    remainingInternal(locationId: LocationId, perspective: 'committed' | 'preview'): number;
    criticalHits(slotId: CriticalSlotId, perspective: 'committed' | 'preview'): number;
    componentStatus(componentId: ComponentId, perspective: 'committed' | 'preview'): EquipmentStatus;
    componentMode(componentId: ComponentId): string | undefined;
    componentGaussPower(componentId: ComponentId): MekGaussPowerState;
    componentEscalatingFailure(componentId: ComponentId): EscalatingFailureRuntimeState | undefined;
    componentPpcCapacitor(componentId: ComponentId): PpcCapacitorRuntimeState | undefined;
    componentBombastLaser(componentId: ComponentId): BombastLaserRuntimeState | undefined;
    ammoLoadout(componentId: ComponentId): AmmoLoadout;
    remainingAmmo(componentId: ComponentId): number;
}

export type MekCriticalChanceResult =
    | Readonly<{ kind: 'none' }>
    | Readonly<{ kind: 'critical-hits'; count: 1 | 2 | 3 | 4 }>
    | Readonly<{ kind: 'blown-off' }>;

export interface MekCriticalChanceModifier {
    readonly label: string;
    readonly value: number;
    readonly optional?: boolean;
    readonly enabled?: boolean;
}

export interface MekCriticalChanceProfileV2 {
    readonly locationId: LocationId;
    readonly locationCode: MekLocation;
    readonly canBlowOff: boolean;
    readonly industrialMek: boolean;
    readonly modifiers: readonly MekCriticalChanceModifier[];
}

export type MekBlowOffPlanV2 =
    | Readonly<{
        kind: 'absorbed';
        equipment: 'Shoulder' | 'Hip';
        slotId: CriticalSlotId;
    }>
    | Readonly<{
        kind: 'blown-off';
        locationId: LocationId;
    }>;

export interface MekExplosionLocationDamageV2 {
    readonly locationId: LocationId;
    readonly locationCode: MekLocation;
    readonly internalDamage: number;
    readonly armorFaceId?: ArmorFaceId;
    readonly armorDamage: number;
    readonly armorRear: boolean;
    readonly protection: MekExplosionProtection;
}

export interface MekAutomaticCriticalV2 {
    readonly equipment: string;
    readonly locationId: LocationId;
    readonly locationCode: MekLocation;
    readonly slotId: CriticalSlotId;
    readonly slotNumber: number;
    readonly hits: number;
    readonly armoredAbsorption: false;
}

export interface MekEquipmentExplosionPlanV2 {
    readonly equipment: string;
    readonly rawDamage: number;
    readonly pilotHits: number;
    readonly locations: readonly MekExplosionLocationDamageV2[];
    readonly destroyComponentIds: readonly ComponentId[];
    readonly automaticCritical?: MekAutomaticCriticalV2;
}

export interface MekPendingEquipmentExplosionV2 {
    readonly equipment: string;
    readonly rawDamage: number;
}

export type MekCriticalRollPlanV2 =
    | Readonly<{
        kind: 'invalid';
        reason: 'invalid-dice' | 'unknown-location';
    }>
    | Readonly<{
        kind: 'not-applied';
        targetLocationId: LocationId;
        targetLocationCode: string;
        slotNumber: number;
        equipment: string | null;
        reason: 'empty' | 'unhittable' | 'already-damaged';
    }>
    | Readonly<{
        kind: 'applied';
        targetLocationId: LocationId;
        targetLocationCode: string;
        slotId: CriticalSlotId;
        slotNumber: number;
        equipment: string;
        armoredAbsorption: boolean;
        explosion?: MekEquipmentExplosionPlanV2;
        pendingExplosion?: MekPendingEquipmentExplosionV2;
    }>;

export interface MekCriticalRollProfileV2 {
    readonly sourceLocationId: LocationId;
    readonly targetLocationId: LocationId;
    readonly sourceLocationCode: string;
    readonly targetLocationCode: string;
    readonly diceCount: 1 | 2;
    readonly validRolls: readonly (readonly number[])[];
    readonly explosionProtection: MekExplosionProtection;
    readonly explosionProtectionNote: string | null;
}

export interface MekPendingCriticalExplosionV2 {
    readonly key: string;
    readonly explosion: MekEquipmentExplosionPlanV2;
}

interface ExplosionSource {
    readonly equipment: string;
    readonly rawDamage: number;
    readonly pilotHits: number;
    readonly destroyComponentIds?: readonly ComponentId[];
    readonly automaticCriticalComponentId?: ComponentId;
}

interface DelayedExplosionCandidate {
    readonly key: string;
    readonly source: ExplosionSource;
}

export function resolveMekCriticalChance(
    total: number,
    canBlowOff: boolean,
    industrialMek = false,
): MekCriticalChanceResult {
    if (total <= 7) return Object.freeze({ kind: 'none' });
    if (total <= 9) return Object.freeze({ kind: 'critical-hits', count: 1 });
    if (total <= 11) return Object.freeze({ kind: 'critical-hits', count: 2 });
    if (!industrialMek || total <= 13) {
        return canBlowOff
            ? Object.freeze({ kind: 'blown-off' })
            : Object.freeze({ kind: 'critical-hits', count: 3 });
    }
    return canBlowOff
        ? Object.freeze({ kind: 'blown-off' })
        : Object.freeze({ kind: 'critical-hits', count: 4 });
}

export function projectMekCriticalChanceV2(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    locationId: LocationId,
    target: MekCriticalMutationTarget,
): MekCriticalChanceProfileV2 {
    const location = requireLocation(index, locationId);
    const modifiers: MekCriticalChanceModifier[] = [];
    if (location.structure.structure.name.toLowerCase().includes('reinforced')) {
        modifiers.push(Object.freeze({ label: 'Reinforced structure', value: -1 }));
    }
    const industrialMek = ruleset === 'total-warfare' && entity.isIndustrial();
    if (industrialMek) {
        modifiers.push(Object.freeze({ label: 'IndustrialMech', value: 2 }));
    }
    if (ruleset === 'total-warfare' && entity.mountedCockpit().isPrimitive) {
        modifiers.push(Object.freeze({ label: 'Primitive Mek', value: 2 }));
    }
    if (location.armor.armor.name.toLowerCase().includes('hardened')) {
        const enabled = location.armorFaceIds.some(faceId =>
            runtime.remainingArmor(faceId, criticalPerspective(target)) > 0);
        modifiers.push(Object.freeze({
            label: 'Hardened armor in damaged facing',
            value: -2,
            optional: true,
            enabled,
        }));
    }
    return Object.freeze({
        locationId,
        locationCode: location.code,
        canBlowOff: location.code === 'HD' || !MEK_TORSO_LOCATIONS.has(location.code),
        industrialMek,
        modifiers: Object.freeze(modifiers),
    });
}

export function projectMekBlowOffV2(
    index: MekRuntimeIndex,
    runtime: MekCriticalRuntimeViewV2,
    locationId: LocationId,
    target: MekCriticalMutationTarget,
): MekBlowOffPlanV2 {
    const location = requireLocation(index, locationId);
    const equipment = location.code === 'LA' || location.code === 'RA'
        ? 'Shoulder'
        : LEG_LOCATIONS.has(location.code) ? 'Hip' : null;
    if (equipment !== null) {
        const slot = slotsAt(index, locationId).find(candidate =>
            candidate.armored
            && criticalSlotLabel(index, candidate) === equipment
            && runtime.criticalHits(candidate.id, criticalPerspective(target)) === 0);
        if (slot) return Object.freeze({ kind: 'absorbed', equipment, slotId: slot.id });
    }
    return Object.freeze({ kind: 'blown-off', locationId });
}

export function projectMekCriticalRollProfileV2(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    sourceLocationId: LocationId,
    target: MekCriticalMutationTarget,
): MekCriticalRollProfileV2 {
    const source = requireLocation(index, sourceLocationId);
    const targetLocationId = criticalRollLocation(index, ruleset, runtime, sourceLocationId, target);
    const targetLocation = requireLocation(index, targetLocationId);
    const diceCount = criticalRollDiceCount(targetLocation.code);
    const validRolls = rollableSlotIndexes(index, ruleset, runtime, targetLocationId, target)
        .map(slotIndex => Object.freeze(diceForSlotIndex(targetLocation.code, slotIndex)));
    const protection = mekExplosionProtection(index, ruleset, runtime, targetLocationId, target);
    return Object.freeze({
        sourceLocationId,
        targetLocationId,
        sourceLocationCode: source.code,
        targetLocationCode: targetLocation.code,
        diceCount,
        validRolls: Object.freeze(validRolls),
        explosionProtection: protection,
        explosionProtectionNote: gameRulesFor(ruleset).getMekExplosionProtectionNote(protection),
    });
}

export function projectMekCriticalRollV2(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    sourceLocationId: LocationId,
    results: readonly number[],
    target: MekCriticalMutationTarget,
): MekCriticalRollPlanV2 {
    const source = index.locations.get(sourceLocationId);
    if (!source) return Object.freeze({ kind: 'invalid', reason: 'unknown-location' });
    const targetLocationId = criticalRollLocation(index, ruleset, runtime, sourceLocationId, target);
    const targetLocation = requireLocation(index, targetLocationId);
    const slotIndex = criticalSlotIndexForRoll(targetLocation.code, results);
    if (slotIndex === null) return Object.freeze({ kind: 'invalid', reason: 'invalid-dice' });
    const slot = slotAt(index, targetLocationId, slotIndex);
    const rollability = criticalSlotRollability(index, ruleset, runtime, slot, target);
    if (!slot || rollability !== 'rollable') {
        return Object.freeze({
            kind: 'not-applied',
            targetLocationId,
            targetLocationCode: targetLocation.code,
            slotNumber: slotIndex + 1,
            equipment: slot ? criticalSlotLabel(index, slot) : null,
            reason: rollability === 'rollable' ? 'empty' : rollability,
        });
    }

    const currentHits = runtime.criticalHits(slot.id, criticalPerspective(target));
    const directHitApplied = currentHits + 1 >= mekCriticalSlotDirectHitThreshold(slot);
    const sourceExplosion = directHitApplied
        ? criticalExplosionSource(entity, index, ruleset, runtime, slot, target)
        : null;
    const pendingExplosion = sourceExplosion !== null && target === 'pending'
        && isDelayedCriticalExplosion(sourceExplosion)
        ? Object.freeze({ equipment: sourceExplosion.equipment, rawDamage: sourceExplosion.rawDamage })
        : undefined;
    const explosion = sourceExplosion !== null && pendingExplosion === undefined
        ? resolveExplosionPlan(
            entity,
            index,
            ruleset,
            runtime,
            targetLocationId,
            target,
            sourceExplosion,
            slot,
        )
        : undefined;
    return Object.freeze({
        kind: 'applied',
        targetLocationId,
        targetLocationCode: targetLocation.code,
        slotId: slot.id,
        slotNumber: slotIndex + 1,
        equipment: criticalSlotLabel(index, slot) ?? 'System',
        armoredAbsorption: !directHitApplied,
        ...(explosion === undefined ? {} : { explosion }),
        ...(pendingExplosion === undefined ? {} : { pendingExplosion }),
    });
}

/** Resolves one still-charged component whose pending critical becomes direct at consolidation. */
export function projectPendingMekCriticalExplosionV2(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    excludedKeys: ReadonlySet<string>,
): MekPendingCriticalExplosionV2 | null {
    const slots = [...index.slots.values()].sort((left, right) =>
        left.locationId.localeCompare(right.locationId) || left.slotIndex - right.slotIndex);
    for (const slot of slots) {
        const threshold = mekCriticalSlotDirectHitThreshold(slot);
        if (runtime.criticalHits(slot.id, 'committed') >= threshold
            || runtime.criticalHits(slot.id, 'preview') < threshold) continue;
        const candidate = delayedExplosionCandidate(entity, index, ruleset, runtime, slot, 'committed');
        if (!candidate || excludedKeys.has(candidate.key)) continue;
        return Object.freeze({
            key: candidate.key,
            explosion: resolveExplosionPlan(
                entity,
                index,
                ruleset,
                runtime,
                slot.locationId,
                'pending',
                candidate.source,
                slot,
            ),
        });
    }
    return null;
}

export function criticalRollDiceCount(locationCode: MekLocation): 1 | 2 {
    return locationCode === 'HD' || LEG_LOCATIONS.has(locationCode) ? 1 : 2;
}

export function criticalSlotIndexForRoll(
    locationCode: MekLocation,
    results: readonly number[],
): number | null {
    if (criticalRollDiceCount(locationCode) === 1) {
        return isD6(results[0]) && results.length === 1 ? results[0] - 1 : null;
    }
    if (results.length !== 2 || !isD6(results[0]) || !isD6(results[1])) return null;
    return (results[0] <= 3 ? 0 : 6) + results[1] - 1;
}

export function mekExplosionProtection(
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    locationId: LocationId,
    target: MekCriticalMutationTarget,
    directHitSlot?: MekIndexedCriticalSlot,
): MekExplosionProtection {
    if (hasOperationalProtection(
        index,
        ruleset,
        runtime,
        locationId,
        target,
        isCaseIIEquipment,
        directHitSlot,
    )) {
        return 'case-ii';
    }
    if (hasOperationalProtection(
        index,
        ruleset,
        runtime,
        locationId,
        target,
        isStandardOrPrototypeCaseEquipment,
        directHitSlot,
    )) {
        return 'case';
    }
    return 'none';
}

function criticalRollLocation(
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    sourceLocationId: LocationId,
    target: MekCriticalMutationTarget,
): LocationId {
    const byCode = new Map([...index.locations.values()].map(location => [location.code, location.id] as const));
    const topology = getTopologyFor([...byCode.keys()]);
    const visited = new Set<LocationId>();
    let current = sourceLocationId;
    while (!visited.has(current)) {
        const location = requireLocation(index, current);
        if (location.code === 'HD' || location.code === 'CT'
            || locationHadApplicableSlotAtPhaseStart(index, ruleset, runtime, current, target)) break;
        visited.add(current);
        const nextCode = topology[location.code as keyof typeof topology]?.transfersTo;
        const next = nextCode === null || nextCode === undefined ? undefined : byCode.get(nextCode);
        if (next === undefined) break;
        current = next;
    }
    return current;
}

function locationHadApplicableSlotAtPhaseStart(
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    locationId: LocationId,
    _target: MekCriticalMutationTarget,
): boolean {
    return slotIndexesForLocation(index, locationId).some(slotIndex => {
        const slot = slotAt(index, locationId, slotIndex);
        return slot !== undefined
            && criticalSlotRollability(index, ruleset, runtime, slot, 'committed') === 'rollable';
    });
}

function rollableSlotIndexes(
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    locationId: LocationId,
    target: MekCriticalMutationTarget,
): number[] {
    return slotIndexesForLocation(index, locationId).filter(slotIndex =>
        criticalSlotRollability(index, ruleset, runtime, slotAt(index, locationId, slotIndex), target)
            === 'rollable');
}

function criticalSlotRollability(
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    slot: MekIndexedCriticalSlot | undefined,
    target: MekCriticalMutationTarget,
): 'rollable' | 'empty' | 'unhittable' | 'already-damaged' {
    if (!slot) return 'empty';
    if (!mekCriticalSlotHittable(index, slot)) return 'unhittable';
    if (target === 'pending'
        && runtime.criticalHits(slot.id, 'preview') !== runtime.criticalHits(slot.id, 'committed')) {
        return 'already-damaged';
    }
    const hits = runtime.criticalHits(slot.id, criticalPerspective(target));
    return hits < mekCriticalSlotMaximumHits(index, ruleset, slot)
        ? 'rollable'
        : 'already-damaged';
}

function criticalExplosionSource(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    slot: MekIndexedCriticalSlot,
    target: MekCriticalMutationTarget,
): ExplosionSource | null {
    const rules = gameRulesFor(ruleset);
    const delayed = delayedExplosionSource(entity, index, ruleset, runtime, slot, target);
    if (delayed) return delayed;

    for (const componentId of slot.componentIds) {
        const component = index.components.get(componentId);
        if (component?.kind !== 'equipment' || !component.mount.equipment) continue;
        const equipment = component.mount.equipment;
        const previousHits = componentCriticalHits(index, runtime, componentId, target);
        if (equipment instanceof AmmoEquipment) {
            const loadout = runtime.ammoLoadout(componentId);
            const ammo = loadout?.equipment ?? equipment;
            const remaining = runtime.remainingAmmo(componentId);
            const rawDamage = ammo.ammoType === 'COOLANT_POD'
                ? (remaining > 0 ? (ruleset === 'core-2026' ? 2 : 10) : 0)
                : ammo.isExplosive() ? remaining * ammoRackSize(ammo) * ammoExplosionDamagePerShot(ammo) : 0;
            if (rawDamage > 0) return explosionSource(ammo.name, rawDamage, rules.getMekInternalExplosionPilotHits());
            continue;
        }
        if (previousHits > 0) continue;
        if (equipment instanceof WeaponEquipment) {
            if (!weaponExplodes(runtime, componentId, equipment)
                || (equipment.hasWeaponTrait('heavy-vehicle-autocannon')
                    && !hasUsableAmmo(index, runtime, equipment))) {
                continue;
            }
            const rawDamage = rules.getExplosiveWeaponDamage(
                equipment,
                componentCriticalSlotIds(index, componentId).length,
            );
            if (rawDamage > 0) return explosionSource(equipment.name, rawDamage, rules.getMekInternalExplosionPilotHits());
            continue;
        }
        if (!(equipment instanceof MiscEquipment) || !mekMiscEquipmentExplodes(equipment)) continue;
        const escalatingDamage = escalatingFailureCriticalExplosionDamage(
            equipment,
            runtime.componentEscalatingFailure(componentId)?.active === true,
        );
        if (escalatingDamage !== undefined) {
            if (escalatingDamage > 0) {
                return explosionSource(equipment.name, escalatingDamage, rules.getMekInternalExplosionPilotHits());
            }
            continue;
        }
        const riscExplosion = riscLaserPulseCriticalExplosion(
            equipment,
            index,
            componentId,
            candidateId => runtime.componentStatus(candidateId, criticalPerspective(target)) === 'available',
        );
        if (riscExplosion.kind !== 'unrelated') {
            if (riscExplosion.kind === 'explode') {
                return {
                    ...explosionSource(
                        equipment.name,
                        riscExplosion.damage,
                        rules.getMekInternalExplosionPilotHits(),
                    ),
                    automaticCriticalComponentId: riscExplosion.automaticCriticalComponentId,
                };
            }
            continue;
        }
        const rawDamage = jumpJetCriticalExplosionDamage(equipment)
            ?? supportEquipmentExplosionDamage(equipment)
            ?? componentCriticalSlotIds(index, componentId).length * 2;
        if (rawDamage > 0) return explosionSource(equipment.name, rawDamage, rules.getMekInternalExplosionPilotHits());
    }
    return null;
}

function delayedExplosionSource(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    slot: MekIndexedCriticalSlot,
    target: MekCriticalMutationTarget,
): ExplosionSource | null {
    return delayedExplosionCandidate(entity, index, ruleset, runtime, slot, target)?.source ?? null;
}

function delayedExplosionCandidate(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    slot: MekIndexedCriticalSlot,
    target: MekCriticalMutationTarget,
): DelayedExplosionCandidate | null {
    for (const componentId of slot.componentIds) {
        const pair = ppcPairForComponent(entity, index, componentId);
        if (pair) {
            const lifecycle = runtime.componentPpcCapacitor(pair.capacitorId);
            if (lifecycle?.chargeState === PPC_CAPACITOR_CHARGED_STATE
                && lifecycle.weaponId === pair.weaponId
                && runtime.componentStatus(pair.weaponId, criticalPerspective(target)) === 'available'
                && runtime.componentStatus(pair.capacitorId, criticalPerspective(target)) === 'available'
                && componentCriticalHits(index, runtime, pair.weaponId, target) === 0
                && componentCriticalHits(index, runtime, pair.capacitorId, target) === 0) {
                const weapon = equipmentForComponent(index, pair.weaponId);
                const capacitor = equipmentForComponent(index, pair.capacitorId);
                if (weapon instanceof WeaponEquipment && capacitor) {
                    const rawDamage = ruleset === 'core-2026'
                        ? (componentCriticalSlotIds(index, pair.weaponId).length
                            + componentCriticalSlotIds(index, pair.capacitorId).length) * 2
                        : resolveWeaponDamage(weapon, entity.getEquipmentRegistry()).maximum;
                    return Object.freeze({
                        key: `ppc:${pair.capacitorId}:${pair.weaponId}`,
                        source: Object.freeze({
                            ...explosionSource(
                                `${weapon.name} + ${capacitor.name}`,
                                rawDamage,
                                gameRulesFor(ruleset).getMekInternalExplosionPilotHits(),
                            ),
                            destroyComponentIds: Object.freeze([pair.weaponId, pair.capacitorId]),
                        }),
                    });
                }
            }
        }
        if (isCoreBombastLaserComponent(index, componentId, ruleset)
            && runtime.componentBombastLaser(componentId)?.chargeState === BOMBAST_LASER_CHARGED_STATE
            && runtime.componentStatus(componentId, criticalPerspective(target)) === 'available'
            && componentCriticalHits(index, runtime, componentId, target) === 0) {
            const equipment = equipmentForComponent(index, componentId);
            if (equipment instanceof WeaponEquipment) {
                return Object.freeze({
                    key: `bombast:${componentId}`,
                    source: Object.freeze({
                        ...explosionSource(
                            equipment.name,
                            gameRulesFor(ruleset).getExplosiveWeaponDamage(
                                equipment,
                                componentCriticalSlotIds(index, componentId).length,
                            ),
                            gameRulesFor(ruleset).getMekInternalExplosionPilotHits(),
                        ),
                        destroyComponentIds: Object.freeze([componentId]),
                    }),
                });
            }
        }
    }
    return null;
}

function isDelayedCriticalExplosion(source: ExplosionSource): boolean {
    return (source.destroyComponentIds?.length ?? 0) > 0;
}

function resolveExplosionPlan(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    sourceLocationId: LocationId,
    target: MekCriticalMutationTarget,
    source: ExplosionSource,
    directHitSlot?: MekIndexedCriticalSlot,
): MekEquipmentExplosionPlanV2 {
    const rules = gameRulesFor(ruleset);
    const byCode = new Map([...index.locations.values()].map(location => [location.code, location.id] as const));
    const topology = getTopologyFor([...byCode.keys()]);
    const internalDamage = new Map<LocationId, number>();
    const armorDamage = new Map<ArmorFaceId, number>();
    const locations: MekExplosionLocationDamageV2[] = [];
    const visited = new Set<LocationId>();
    let locationId: LocationId | null = sourceLocationId;
    let damage = Math.max(0, source.rawDamage);
    let armorBlowoutPending = false;
    while (locationId !== null && damage > 0 && !visited.has(locationId)) {
        visited.add(locationId);
        const location = requireLocation(index, locationId);
        const protection = mekExplosionProtection(index, ruleset, runtime, locationId, target, directHitSlot);
        if (ruleset === 'core-2026' && protection === 'none' && damage > 20) armorBlowoutPending = true;
        const composite = structureConstructionKind(location.structure.structure) === 'composite';
        const multiplier = composite ? 2 : 1;
        const remainingInternalPips = Math.max(
            0,
            runtime.remainingInternal(locationId, criticalPerspective(target))
                - (internalDamage.get(locationId) ?? 0),
        );
        const torso = MEK_TORSO_LOCATIONS.has(location.code);
        const armorFace = location.armorFaceIds
            .map(faceId => index.armorFaces.get(faceId))
            .find(face => face?.face === (torso ? 'rear' : 'front'))
            ?? index.armorFaces.get(location.armorFaceIds[0]!);
        const remainingArmor = armorFace === undefined ? 0 : Math.max(
            0,
            runtime.remainingArmor(armorFace.id, criticalPerspective(target))
                - (armorDamage.get(armorFace.id) ?? 0),
        );
        const resolution = rules.resolveMekExplosionDamage({
            damage,
            protection,
            remainingInternal: remainingInternalPips / multiplier,
            remainingArmor,
            originalArmor: armorFace?.maximumPoints ?? 0,
            torso,
            armorBlowoutPending,
        });
        const appliedArmor = Math.min(remainingArmor, resolution.armorDamage);
        const appliedInternal = Math.min(remainingInternalPips, resolution.internalDamage * multiplier);
        if (armorFace && appliedArmor > 0) {
            armorDamage.set(armorFace.id, (armorDamage.get(armorFace.id) ?? 0) + appliedArmor);
        }
        if (appliedInternal > 0) {
            internalDamage.set(locationId, (internalDamage.get(locationId) ?? 0) + appliedInternal);
        }
        locations.push(Object.freeze({
            locationId,
            locationCode: location.code,
            internalDamage: appliedInternal,
            ...(armorFace === undefined ? {} : { armorFaceId: armorFace.id }),
            armorDamage: appliedArmor,
            armorRear: resolution.armorRear,
            protection,
        }));
        const overflow = Math.max(0, resolution.internalDamage - appliedInternal / multiplier);
        if (overflow === 0 || resolution.stopsTransfer) break;
        const nextCode = topology[location.code as keyof typeof topology]?.transfersTo;
        locationId = nextCode === null || nextCode === undefined ? null : byCode.get(nextCode) ?? null;
        damage = overflow;
        directHitSlot = undefined;
    }
    const automaticCritical = source.automaticCriticalComponentId === undefined
        ? undefined
        : automaticCriticalPlan(
            index,
            ruleset,
            runtime,
            source.automaticCriticalComponentId,
            target,
        );
    return Object.freeze({
        equipment: source.equipment,
        rawDamage: source.rawDamage,
        pilotHits: source.pilotHits,
        locations: Object.freeze(locations),
        destroyComponentIds: Object.freeze([...(source.destroyComponentIds ?? [])]),
        ...(automaticCritical === undefined ? {} : { automaticCritical }),
    });
}

function automaticCriticalPlan(
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    componentId: ComponentId,
    target: MekCriticalMutationTarget,
): MekAutomaticCriticalV2 | undefined {
    const slot = componentCriticalSlotIds(index, componentId)
        .map(slotId => index.slots.get(slotId))
        .filter((candidate): candidate is MekIndexedCriticalSlot => candidate !== undefined)
        .sort((left, right) => left.slotIndex - right.slotIndex)
        .find(candidate => criticalSlotRollability(index, ruleset, runtime, candidate, target) === 'rollable');
    if (!slot) return undefined;
    const location = requireLocation(index, slot.locationId);
    const hits = Math.max(
        1,
        mekCriticalSlotDirectHitThreshold(slot)
            - runtime.criticalHits(slot.id, criticalPerspective(target)),
    );
    return Object.freeze({
        equipment: equipmentForComponent(index, componentId)?.name ?? 'Equipment',
        locationId: slot.locationId,
        locationCode: location.code,
        slotId: slot.id,
        slotNumber: slot.slotIndex + 1,
        hits,
        armoredAbsorption: false,
    });
}

function hasOperationalProtection(
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekCriticalRuntimeViewV2,
    locationId: LocationId,
    target: MekCriticalMutationTarget,
    protects: (equipment: Equipment) => boolean,
    directHitSlot?: MekIndexedCriticalSlot,
): boolean {
    return [...index.components.entries()].some(([componentId, component]) => {
        const equipment = component.kind === 'equipment' ? component.mount.equipment : undefined;
        if (!equipment || !protects(equipment) || !componentLocationIds(index, componentId).includes(locationId)
            || runtime.componentStatus(componentId, criticalPerspective(target)) !== 'available') return false;
        if (!directHitSlot?.componentIds.includes(componentId)) return true;
        const nextHits = componentCriticalHits(index, runtime, componentId, target) + 1;
        return nextHits < mekCriticalDamageThreshold(ruleset, equipment.flags);
    });
}

function ppcPairForComponent(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
): Readonly<{ capacitorId: ComponentId; weaponId: ComponentId }> | null {
    const directWeapon = ppcCapacitorWeaponId(entity, index, componentId);
    if (directWeapon !== undefined) return Object.freeze({ capacitorId: componentId, weaponId: directWeapon });
    const source = index.relationships.linkedSourceByTarget.get(componentId);
    if (source === undefined || ppcCapacitorWeaponId(entity, index, source) !== componentId) return null;
    return Object.freeze({ capacitorId: source, weaponId: componentId });
}

function componentCriticalHits(
    index: MekRuntimeIndex,
    runtime: MekCriticalRuntimeViewV2,
    componentId: ComponentId,
    target: MekCriticalMutationTarget,
): number {
    return componentCriticalSlotIds(index, componentId).reduce((total, slotId) => {
        const slot = index.slots.get(slotId)!;
        return total + Math.max(
            0,
            runtime.criticalHits(slotId, criticalPerspective(target)) - (slot.armored ? 1 : 0),
        );
    }, 0);
}

function weaponExplodes(
    runtime: MekCriticalRuntimeViewV2,
    componentId: ComponentId,
    equipment: WeaponEquipment,
): boolean {
    if (isPpcEquipment(equipment) || isBombastLaserEquipment(equipment)) return false;
    if (isGaussEquipment(equipment) && isGaussPoweredDown(runtime.componentGaussPower(componentId))) return false;
    return equipment.getWeaponTypes().includes('X');
}

function mekMiscEquipmentExplodes(equipment: MiscEquipment): boolean {
    return equipment.isExplosive() && !isPpcCapacitorEquipment(equipment);
}

function hasUsableAmmo(
    index: MekRuntimeIndex,
    runtime: MekCriticalRuntimeViewV2,
    weapon: WeaponEquipment,
): boolean {
    return [...index.components.entries()].some(([componentId, component]) => {
        if (component.kind !== 'equipment' || !(component.mount.equipment instanceof AmmoEquipment)) return false;
        const loadout = runtime.ammoLoadout(componentId);
        return loadout?.equipment.ammoType === weapon.ammoType && runtime.remainingAmmo(componentId) > 0;
    });
}

function explosionSource(equipment: string, rawDamage: number, pilotHits: number): ExplosionSource {
    return Object.freeze({ equipment, rawDamage: Math.max(0, rawDamage), pilotHits });
}

export function ammoRackSize(ammo: AmmoEquipment): number {
    if (ammo.hasWeaponTrait('capital-missile') || ammo.ammoType === 'SCREEN_LAUNCHER') return 1;
    return Math.max(0, ammo.rackSize);
}

export function ammoExplosionDamagePerShot(ammo: AmmoEquipment): number {
    if (ammo.ammoType === 'SCREEN_LAUNCHER') return 15;
    if (ammo.ammoType === 'TASER') return 6;
    if (ammo.ammoType === 'MEK_MORTAR') {
        return ammo.hasMunitionType('M_AIRBURST')
            || ammo.hasMunitionType('M_FLARE')
            || ammo.hasMunitionType('M_SMOKE_WARHEAD') ? 1 : 2;
    }
    return ammo.damagePerShot + (
        ammo.hasMunitionType('M_DEAD_FIRE') || ammo.hasMunitionType('M_TANDEM_CHARGE') ? 1 : 0
    );
}

function slotsAt(index: MekRuntimeIndex, locationId: LocationId): MekIndexedCriticalSlot[] {
    return [...index.slots.values()]
        .filter(slot => slot.locationId === locationId)
        .sort((left, right) => left.slotIndex - right.slotIndex);
}

function slotAt(
    index: MekRuntimeIndex,
    locationId: LocationId,
    slotIndex: number,
): MekIndexedCriticalSlot | undefined {
    return [...index.slots.values()].find(slot =>
        slot.locationId === locationId && slot.slotIndex === slotIndex);
}

function slotIndexesForLocation(index: MekRuntimeIndex, locationId: LocationId): number[] {
    const code = requireLocation(index, locationId).code;
    const count = criticalRollDiceCount(code) === 1 ? 6 : 12;
    return Array.from({ length: count }, (_, slotIndex) => slotIndex);
}

function criticalSlotLabel(index: MekRuntimeIndex, slot: MekIndexedCriticalSlot): string | null {
    const labels = slot.componentIds.flatMap(componentId => {
        const component = index.components.get(componentId);
        if (component?.kind === 'system') return [component.systemType];
        const label = component?.mount.displayName();
        return label?.trim() ? [label.trim()] : [];
    });
    return labels.length === 0 ? null : labels.join(' / ');
}

function diceForSlotIndex(locationCode: MekLocation, slotIndex: number): number[] {
    if (criticalRollDiceCount(locationCode) === 1) return [slotIndex + 1];
    return [slotIndex < 6 ? 1 : 4, slotIndex % 6 + 1];
}

function isD6(value: number | undefined): value is number {
    return Number.isInteger(value) && value! >= 1 && value! <= 6;
}

function criticalPerspective(target: MekCriticalMutationTarget): 'committed' | 'preview' {
    return target === 'pending' ? 'preview' : 'committed';
}

function requireLocation(index: MekRuntimeIndex, locationId: LocationId) {
    const location = index.locations.get(locationId);
    if (!location) throw new Error(`Unknown Mek location ${locationId}`);
    return location;
}
