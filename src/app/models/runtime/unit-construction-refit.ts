// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { MekEntity } from '../entity/entities/mek/mek-entity';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MountId } from '../entity/types';
import type { NativeUnitSourceHandle } from '../native-unit-source-handle';
import { attackerActionTargetKey, type AttackerTargetingState } from './attacker-targeting-state';
import { createMekUnit } from './cbt-mek-unit';
import { createNonMekUnit } from './cbt-non-mek-unit';
import { CBTUnit, isCBTMekUnit, isCBTNonMekUnit } from './cbt-unit';
import type { CBTUnitRuntimeIndex, CBTUnitRuntimeState } from './cbt-unit-runtime';
import { entityAmmoLoadout, mekAmmoCapacity } from './mek-ammo';
import { remapMekMovementPsrStateIdsV2 } from './mek-movement-psr-v2';
import { buildMekRuntimeIndex } from './mek-runtime-index';
import { buildNonMekRuntimeIndex } from './non-mek-runtime-index';
import { createNonMekRuntimeBinding } from './non-mek-unit-instance';
import type { MekUnitRuntimeState } from './runtime-state';
import { createMekRuntimeBinding } from './unit-instance';
import type { ScenarioRules } from './unit-state-initializer';
import { rebaseConstructionMekTurn } from './construction-refit-turn-state';
import { refitCriticalDamage, refitCriticalSlotTargets } from './construction-refit-critical-slots';

/** Editor mount -> original live mount. Missing entries are newly installed equipment. */
export type ConstructionMountOrigins = ReadonlyMap<MountId, MountId>;

export interface ConstructionRefit {
    readonly entity: BaseEntity;
    readonly source: NativeUnitSourceHandle;
    readonly origins: ConstructionMountOrigins;
}

/** Maps only retained components. Coincidentally reused native IDs are never evidence of identity. */
export function refitComponentIds(
    original: CBTUnitRuntimeIndex, next: CBTUnitRuntimeIndex, origins: ConstructionMountOrigins,
): ReadonlyMap<ComponentId, ComponentId> {
    const originalMounts = new Map([...original.components.values()].flatMap(component =>
        component.mount ? [[component.mount.mountId, component.id] as const] : []));
    const result = new Map<ComponentId, ComponentId>();
    for (const component of next.components.values()) {
        if (component.mount) {
            const sourceMount = origins.get(component.mount.mountId);
            const sourceId = sourceMount && originalMounts.get(sourceMount);
            const source = sourceId && original.components.get(sourceId)?.mount;
            if (sourceId && source && source.equipmentId === component.mount.equipmentId) {
                if (result.has(sourceId)) throw new Error('A refit cannot duplicate an original equipment identity');
                result.set(sourceId, component.id);
            }
        } else if (original.components.get(component.id)?.kind === 'system') {
            result.set(component.id, component.id);
        }
    }
    return result;
}

/** Builds a detached replacement; the force must fence and install it atomically. */
export async function prepareConstructionRefit(
    current: CBTUnit, entity: BaseEntity, nativeSource: NativeUnitSourceHandle | undefined,
    origins: ConstructionMountOrigins, scenario: ScenarioRules,
): Promise<Readonly<{ unit: CBTUnit; componentIds: ReadonlyMap<ComponentId, ComponentId> }>> {
    if (current.getUnit().entityType !== entity.entityType) {
        throw new Error('A force refit must retain the unit family');
    }
    if (current.revision() >= Number.MAX_SAFE_INTEGER) throw new Error('Unit revision is exhausted');
    const nextIndex = entity instanceof MekEntity ? buildMekRuntimeIndex(entity) : buildNonMekRuntimeIndex(entity);
    const originalAssignment = current.getCrewAssignment();
    const crewAssignment = { schemaVersion: 1 as const,
        positions: originalAssignment.positions.filter(position => nextIndex.crewPositions.has(position.positionId)) };
    const deployment = { ...current.getDeployment().values, crewAssignment };
    const profile = current.baselineRef.initialStateProfile;
    const next = entity instanceof MekEntity
        ? await createMekUnit({ uuid: entity.uuid(), instanceId: current.instanceId }, entity, entity.uuid(), {
            initializerRevision: profile.initializerRevision, profileId: profile.profileId, deployment, scenario,
        }, nativeSource)
        : createNonMekUnit(entity, { uuid: entity.uuid(), instanceId: current.instanceId, deployment,
            scenario, initialStateProfileId: profile.profileId }, nativeSource);
    const componentIds = refitComponentIds(current.getIndex(), next.getIndex(), origins);
    const shared = rebaseCommonState(current, next, componentIds);
    let unit: CBTUnit;
    if (isCBTMekUnit(current) && isCBTMekUnit(next)) {
        const old = current.snapshot();
        const index = next.getIndex();
        const targets = refitCriticalSlotTargets(current.getIndex(), index, componentIds);
        const slotIds = new Map([...targets].flatMap(([id, targets]) => targets.length === 1 ? [[id, targets[0]] as const] : []));
        const { slots, pendingHits } = refitCriticalDamage(current.getIndex(), index, next.ruleset(), old.slots,
            old.pendingCombat.criticalHits, targets);
        const movement = remapMekMovementPsrStateIdsV2(old.movementPsr, {
            componentId: id => componentIds.has(id) ? [componentIds.get(id)!] : [],
            criticalSlotId: id => targets.get(id) ?? [],
            locationId: id => index.locations.has(id) ? [id] : [],
        });
        if (!movement.accepted) {
            throw new Error('Resolve the unit’s pending movement or pilot checks before removing equipment they reference');
        }
        const state: MekUnitRuntimeState = { ...old, ...shared, heat: old.heat,
            turn: rebaseConstructionMekTurn(old.turn, current.getIndex(), index, componentIds, slotIds), slots, movementPsr: movement.state,
            locations: new Map([...shared.locations].map(([id, value]) => [id, {
                ...value, conditions: old.locations.get(id)?.conditions ?? new Map(),
            }])),
            ruleChecks: new Map([...old.ruleChecks].filter(([, check]) => index.locations.has(check.triggerLocationId))),
            pendingCombat: { ...old.pendingCombat, ...shared.pendingCombat,
                criticalHits: pendingHits,
                shieldDamage: remapEntries(old.pendingCombat.shieldDamage, componentIds),
                modularArmorDamage: remapEntries(old.pendingCombat.modularArmorDamage, componentIds),
                locationConditions: retainEntries(old.pendingCombat.locationConditions, index.locations),
            },
        };
        const mechanics = next.mechanics();
        const prepared = createMekRuntimeBinding(next.getUnit(), index, next.ruleset(), state, crewAssignment,
            mechanics.heatContext, mechanics.mechanicsContext);
        if (mechanics.heatContext.kind === 'supported' && prepared.binding.heatContext.kind !== 'supported') {
            throw new Error('Finish this unit’s End Turn heat steps before changing systems used by its current heat state');
        }
        unit = new CBTUnit<'mek'>({ uuid: next.uuid, instanceId: next.instanceId, baselineRef: next.baselineRef,
            nativeSource, runtime: { kind: 'mek', ...prepared, deployment: next.getDeployment() } });
    } else if (isCBTNonMekUnit(current) && isCBTNonMekUnit(next)) {
        const old = current.snapshot();
        const index = next.getIndex();
        const damageTracks = new Map([...old.damageTracks].flatMap(([id, value]) => {
            const definition = index.damageTracks.get(id);
            if (!definition) return [];
            const hits = Math.min(value.hits, definition.maximumHits);
            return [[id, { hits, hitTimestamps: value.hitTimestamps.slice(0, hits) }] as const];
        }));
        const state = { ...old, ...shared, damageTracks,
            turn: { ...old.turn, movement: old.turn.movement === null ? null : { ...old.turn.movement,
                boosterComponentIds: old.turn.movement.boosterComponentIds.flatMap(id => componentIds.has(id)
                    ? [componentIds.get(id)!] : []),
            } },
            pendingCombat: { ...old.pendingCombat, ...shared.pendingCombat,
                damageTrackHits: new Map([...old.pendingCombat.damageTrackHits].flatMap(([id, value]) => {
                    const definition = index.damageTracks.get(id);
                    if (!definition) return [];
                    const hitDelta = clampDelta(value.hitDelta, damageTracks.get(id)?.hits ?? 0, definition.maximumHits);
                    return hitDelta === 0 ? [] : [[id, { hitDelta, hitTimestamps: value.hitTimestamps.slice(0, Math.max(0, hitDelta)) }] as const];
                })),
            },
        };
        const prepared = createNonMekRuntimeBinding(entity, next.ruleset(), state,
            next.mechanics().forcedWithdrawal, crewAssignment, next.mechanics().hotLoadedAmmo);
        unit = new CBTUnit<'non-mek'>({ uuid: next.uuid, instanceId: next.instanceId, baselineRef: next.baselineRef,
            nativeSource, runtime: { kind: 'non-mek', ...prepared, deployment: next.getDeployment() } });
    } else throw new Error('A force refit cannot change its runtime family');
    // Location loss is deliberately derived by the runtime. Moving equipment out of a lost
    // location must not repair it, so retain that destruction only when it stops being derivable.
    for (const [previousId, nextId] of componentIds) {
        if (current.getIndex().components.get(previousId)?.kind !== 'equipment') continue;
        const committed = current.query().componentStatus(previousId, 'committed');
        const preview = current.query().componentStatus(previousId, 'preview');
        if (committed === 'destroyed' && unit.query().componentStatus(nextId, 'committed') !== 'destroyed') {
            unit.dispatch({ type: 'set-component-status', componentId: nextId, status: 'destroyed', target: 'committed' });
        }
        if ((preview === 'destroyed' || committed === 'destroyed')
            && unit.query().componentStatus(nextId, 'preview') !== preview) {
            unit.dispatch({ type: 'set-component-status', componentId: nextId, status: preview, target: 'pending' });
        }
    }
    // Run the canonical serializer before the candidate can reach the force owner.
    unit.serialize();
    return Object.freeze({ unit, componentIds });
}

function rebaseCommonState(
    current: CBTUnit, next: CBTUnit, componentIds: ReadonlyMap<ComponentId, ComponentId>,
): CBTUnitRuntimeState {
    const state = current.snapshot();
    const index = next.getIndex();
    const locations = new Map([...state.locations].flatMap(([id, value]) => {
        const location = index.locations.get(id);
        if (!location) return [];
        return [[id, { ...value, internalDamage: Math.min(value.internalDamage, location.internalPoints),
            armorDamage: value.armorDamage.flatMap(damage => {
                const face = index.armorFaces.get(damage.faceId);
                return face && face.maximumPoints > 0 ? [{ ...damage, damage: Math.min(damage.damage, face.maximumPoints) }] : [];
            }),
        }] as const];
    }).filter(([, location]) => location.internalDamage > 0 || location.armorDamage.length > 0
        || ('conditions' in location && (location.conditions as ReadonlyMap<unknown, unknown>).size > 0)));
    const components = remapEntries(state.components, componentIds, value => {
        const { ppcCapacitor, ...facts } = value;
        const weaponId = ppcCapacitor && componentIds.get(ppcCapacitor.weaponId);
        return { ...facts, ...(ppcCapacitor && weaponId ? { ppcCapacitor: { ...ppcCapacitor, weaponId } } : {}) };
    });
    const ammo = remapEntries(state.ammo, componentIds, (value, id) => {
        const capacity = isCBTMekUnit(next)
            ? mekAmmoCapacity(next.getUnit(), next.getIndex(), id, next.ruleset(), value.munitionOverride)
            : entityAmmoLoadout(next.getUnit(), next.getIndex().components.get(id)?.mount!, next.ruleset(), value.munitionOverride)?.capacity;
        return { ...value, shotsSpent: Math.min(value.shotsSpent, capacity ?? 0) };
    });
    for (const [id, value] of ammo) if (value.shotsSpent === 0 && value.munitionOverride === undefined && !value.hotLoaded) ammo.delete(id);
    return { ...state, stateRevision: state.stateRevision + 1, locations, components, ammo,
        crew: retainEntries(state.crew, index.crewPositions),
        attackerTargeting: rebaseTargeting(state.attackerTargeting, componentIds),
        equipmentRowOrder: undefined,
        pendingCombat: {
            locationInternalDamage: nonzeroEntries(new Map([...state.pendingCombat.locationInternalDamage].flatMap(([id, value]) => {
                const location = index.locations.get(id);
                return location ? [[id, clampDelta(value, locations.get(id)?.internalDamage ?? 0, location.internalPoints)] as const] : [];
            }))),
            armorDamage: nonzeroEntries(new Map([...state.pendingCombat.armorDamage].flatMap(([id, value]) => {
                const face = index.armorFaces.get(id);
                const damage = face ? locations.get(face.locationId)?.armorDamage.find(entry => entry.faceId === id)?.damage ?? 0 : 0;
                return face ? [[id, clampDelta(value, damage, face.maximumPoints)] as const] : [];
            }))),
            componentStatus: remapEntries(state.pendingCombat.componentStatus, componentIds),
        },
    };
}

function rebaseTargeting(state: AttackerTargetingState, ids: ReadonlyMap<ComponentId, ComponentId>): AttackerTargetingState {
    return { ...state,
        components: remapEntries(state.components, ids, value => {
            const preferredSourceId = value.ammo?.preferredSourceId && ids.get(value.ammo.preferredSourceId);
            return { ...value, ...(value.ammo ? { ammo: { munitionKey: value.ammo.munitionKey,
                ...(preferredSourceId ? { preferredSourceId } : {}) } } : {}) };
        }),
        actions: new Map([...state.actions].flatMap(([key, value]) => {
            if (value.target.kind !== 'component') return [[key, value] as const];
            const componentId = ids.get(value.target.componentId);
            if (!componentId) return [];
            const target = { kind: 'component' as const, componentId };
            return [[attackerActionTargetKey(target), { ...value, target }] as const];
        })),
    };
}

function retainEntries<K, V>(values: ReadonlyMap<K, V>, targets: ReadonlyMap<K, unknown>): Map<K, V> {
    return new Map([...values].filter(([id]) => targets.has(id)));
}
function remapEntries<K, V>(values: ReadonlyMap<K, V>, ids: ReadonlyMap<K, K>, map: (value: V, id: K) => V = value => value): Map<K, V> {
    return new Map([...values].flatMap(([id, value]) => {
        const target = ids.get(id);
        return target === undefined ? [] : [[target, map(value, target)] as const];
    }));
}
function clampDelta(delta: number, committed: number, maximum: number): number {
    return Math.min(maximum, Math.max(0, committed + delta)) - committed;
}
function nonzeroEntries<K>(values: ReadonlyMap<K, number>): Map<K, number> {
    return new Map([...values].filter(([, value]) => value !== 0));
}
