// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { InfantryBaseEntity } from '../entity/entities/infantry/infantry-base-entity';
import { InfantryEntity } from '../entity/entities/infantry/infantry-entity';
import type { ComponentId } from '../entity/entity-identifiers';
import { ImmutableSet } from '../entity/immutable-collections';
import { WeaponEquipment } from '../equipment.model';
import type { MotiveModes } from '../motiveModes.model';
import { type CBTRuntimeEquipment } from '../runtime/cbt-unit-runtime';
import type { NonMekRuntimeIndex } from '../runtime/non-mek-runtime-index';
import type { NonMekUnitRuntimeState } from '../runtime/non-mek-unit-instance';
import { isBattleArmorEntity } from '../entity/utils/entity-type-guards';
import { isUnitWaterDepth } from '../unit-cover.model';
import { isAntiPersonnelWeaponMount, isDisposableWeaponMount } from './conventional-infantry-combat-rules';

export interface InfantryRuntimeRulesProjection {
    readonly destroyed: boolean;
    readonly movementMinimums: Readonly<Record<MotiveModes, number>>;
    readonly fireBlockedComponentIds: ReadonlySet<ComponentId>;
}

const INFANTRY_MOVEMENT_MINIMUMS: Readonly<Record<MotiveModes, number>> = Object.freeze({
    stationary: 0,
    walk: 0,
    run: 0,
    sprint: 0,
    jump: 1,
    UMU: 0,
    VTOL: 0,
    tracked: 0,
});

/** Production Infantry/Battle Armor rules over the canonical Entity and sparse state. */
export function projectInfantryRuntimeRules(
    entity: InfantryBaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
): InfantryRuntimeRulesProjection {
    return Object.freeze({
        destroyed: state.explicitlyDestroyed || allTroopLocationsDestroyed(index, state),
        movementMinimums: INFANTRY_MOVEMENT_MINIMUMS,
        fireBlockedComponentIds: new ImmutableSet([
            ...uncrewedFieldGuns(entity, index, state),
            ...infantryAttackBlocks(entity, index, state),
        ]),
    });
}

/**
 * Weapons ruled out by the others this turn's attack uses, those fired this turn and those selected to fire, so the
 * player can neither select nor fire them together:
 * - A disposable weapon attack is made instead of the unit's standard attack (TO:AuE p. 116): a disposable weapon
 *   rules out every other weapon, and any other weapon rules it out. SCUBA troops may not employ disposable weapons
 *   underwater (TO:AuE p. 153), and a battle armor squad only when every suit carries the same one.
 * - Battle armor makes one anti-personnel weapon attack a turn (TW p. 218).
 */
function infantryAttackBlocks(
    entity: InfantryBaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
): ComponentId[] {
    const weapons = [...index.components.values()].filter(component =>
        component.mount.equipment instanceof WeaponEquipment && !component.mount.isPhysicalWeapon());
    const disposable = (component: CBTRuntimeEquipment) => isDisposableWeaponMount(entity, component.mount);
    const antiPersonnel = (component: CBTRuntimeEquipment) => isAntiPersonnelWeaponMount(entity, component.mount);
    const fired = new Set(state.turn.firedWeapons ?? []);
    const used = weapons.filter(component => fired.has(component.id)
        || (state.attackerTargeting.components.get(component.id)?.selection !== undefined
            && canStillFire(index, state, component)));
    const usedBesides = (component: CBTRuntimeEquipment, kind: (other: CBTRuntimeEquipment) => boolean) =>
        used.some(other => other.id !== component.id && kind(other));
    const underwater = entity instanceof InfantryEntity && isUnitWaterDepth(state.turn.cover);
    return weapons
        .filter(component => disposable(component)
            ? underwater || usedBesides(component, () => true)
            : usedBesides(component, disposable)
                || (antiPersonnel(component) && usedBesides(component, antiPersonnel))
                || (isBattleArmorEntity(entity) && component.mount.equipment?.hasFlag('F_INF_DISPOSABLE') === true))
        .map(component => component.id);
}

/** A selected weapon not yet spent or destroyed, whose trooper, when one carries it alone, still fights. */
function canStillFire(index: NonMekRuntimeIndex, state: NonMekUnitRuntimeState, component: CBTRuntimeEquipment): boolean {
    if (state.components.get(component.id)?.statusOverride === 'destroyed') return false;
    const location = [...index.locations.values()].find(candidate => candidate.code === component.mount.location);
    return location === undefined || (state.locations.get(location.id)?.internalDamage ?? 0) < location.internalPoints;
}

function allTroopLocationsDestroyed(
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
): boolean {
    const locations = [...index.locations.values()];
    return locations.length > 0 && locations.every(location => {
        const runtime = state.locations.get(location.id);
        const internalDestroyed = location.internalPoints <= 0
            || (runtime?.internalDamage ?? 0) >= location.internalPoints;
        const armorDestroyed = location.armorFaceIds.every(faceId => {
            const face = index.armorFaces.get(faceId);
            const damage = runtime?.armorDamage.find(entry => entry.faceId === faceId)?.damage ?? 0;
            return face !== undefined && damage >= face.maximumPoints;
        });
        return internalDestroyed && armorDestroyed;
    });
}

function uncrewedFieldGuns(
    entity: InfantryBaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
): Set<ComponentId> {
    const blocked = new Set<ComponentId>();
    if (!(entity instanceof InfantryEntity)) return blocked;

    const troopLocation = [...index.locations.values()].find(location => location.code === 'Infantry');
    const troopCount = troopLocation === undefined
        ? 0
        : Math.max(
            0,
            troopLocation.internalPoints
                - (state.locations.get(troopLocation.id)?.internalDamage ?? 0),
        );
    const groups = new Map<string, CBTRuntimeEquipment[]>();
    for (const component of index.components.values()) {
        if (component.mount.location !== 'Field Guns'
            || !(component.mount.equipment instanceof WeaponEquipment)) continue;
        const group = groups.get(component.mount.equipmentId) ?? [];
        group.push(component);
        groups.set(component.mount.equipmentId, group);
    }
    for (const components of groups.values()) {
        const mount = components[0]!.mount;
        const crewSize = Math.max(2, Math.ceil(mount.getTonnage(entity) ?? 0));
        const functionalCount = Math.min(components.length, Math.floor(troopCount / crewSize));
        components.slice(functionalCount).forEach(component => blocked.add(component.id));
    }
    return blocked;
}
