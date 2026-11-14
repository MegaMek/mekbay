// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isMobileHpgEquipment } from '../aerospace-support-equipment.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { ComponentId,LocationId } from '../entity/entity-identifiers';
import type { MekLocation } from '../entity/types';
import type { IntrinsicWeapon } from '../entity/types/weapon';
import type { AttackerActionTarget } from './attacker-targeting-state';
import { type CBTRuntimeEquipment } from './cbt-unit-runtime';
import { mobileHpgBlocksWeaponAttacks } from './component-mobile-hpg';
import { ppcCapacitorChargingForWeapon } from './component-ppc-capacitor';
import {
shieldBlocksComponentAttack,
shieldBlocksIntrinsicAttack,
} from './component-shield-mode';
import { isGaussPoweredDown } from './mek-gauss-power';
import { kickLegIds, weaponFiredLocationIds, type MekKickKind } from './mek-kicking-leg';
import { mekLocationDestructionParentId } from './mek-location-state-kernel';
import { type MekIndexedCriticalSlot,type MekRuntimeIndex } from './mek-runtime-index';
import type { MekUnitQueryPort } from './unit-instance';

/** `configure-network` remains owned by the C3 encounter/runtime boundary. */
export type MekAction =
    | 'fire'
    | 'physical-attack'
    | 'activate'
    | 'change-mode'
    | 'provide-passive-effect';

export type MekActionDestructionCapability =
    | { readonly kind: 'supported'; readonly destroyed: boolean }
    | { readonly kind: 'unsupported' };

export type MekActionRuntimePort = Pick<
    MekUnitQueryPort,
    | 'remainingInternal'
    | 'criticalHits'
    | 'componentStatus'
    | 'componentMode'
    | 'componentGaussPower'
    | 'componentJammed'
    | 'componentBombastLaser'
    | 'componentPpcCapacitor'
    | 'locationCondition'
    | 'hasCondition'
    | 'mekMovementMode'
    | 'mekShields'
    | 'attackerTargetingState'
    | 'turnState'
> & {
    mekDestruction(): MekActionDestructionCapability;
};

/** Pure committed-state Mek action availability. Unknown targets default-deny. */
export function canPerformMekAction(
    entity: MekEntity,
    index: MekRuntimeIndex,
    runtime: MekActionRuntimePort,
    target: AttackerActionTarget,
    action: MekAction,
    ruleset: CBTRuleset,
): boolean {
    try {
        const resolved = resolveTarget(index, target);
        if (resolved === null || !targetOperational(index, runtime, resolved)) return false;
        const destruction = runtime.mekDestruction();
        if (destruction.kind === 'unsupported'
            || destruction.destroyed
            || runtime.hasCondition('shutdown')) return false;

        const movement = runtime.mekMovementMode();
        if ((action === 'fire' || action === 'physical-attack')
            && movement.kind === 'supported'
            && movement.mode === 'sprint') return false;

        if (action === 'fire' && mobileHpgBlocksWeaponAttacks(
            [...index.components].flatMap(([componentId, component]) => {
                const equipment = component.kind === 'equipment' ? component.mount.equipment : undefined;
                return equipment && isMobileHpgEquipment(equipment)
                    ? [Object.freeze({
                        componentId,
                        equipment,
                        mode: runtime.componentMode(componentId),
                        operational: runtime.componentStatus(componentId, 'committed') === 'available',
                    })]
                    : [];
            }),
        )) return false;

        if ((action === 'fire' || action === 'physical-attack')
            && !coreAmsExempt(resolved, action, ruleset)
            && shieldBlocksTargetAttack(entity, index, ruleset, runtime, resolved)) return false;

        // A weapon fires once a turn; End Turn, or undoing the fire, frees it.
        if (action === 'fire' && target.kind === 'component'
            && (runtime.turnState().firedWeapons?.includes(target.componentId) === true
                || runtime.componentJammed(target.componentId)
                || isGaussPoweredDown(runtime.componentGaussPower(target.componentId))
                || runtime.componentBombastLaser(target.componentId)?.chargeState === 'charging'
                || ppcCapacitorChargingForWeapon(index, runtime, target.componentId)
                || componentBayFirePermission(index, runtime, target.componentId) === false)) return false;

        switch (action) {
            case 'fire': return mekCanFire(index, runtime);
            case 'physical-attack':
                if (!isPhysicalTarget(resolved)) return true;
                if (physicalMovementUnavailable(runtime, resolved)) return false;
                return physicalTargetAvailable(index, runtime, resolved, ruleset);
            case 'activate':
            case 'change-mode':
            case 'provide-passive-effect':
                return true;
            default:
                return false;
        }
    } catch {
        return false;
    }
}

function shieldBlocksTargetAttack(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekActionRuntimePort,
    target: ResolvedTarget,
): boolean {
    return target.kind === 'component'
        ? shieldBlocksComponentAttack(entity, index, ruleset, runtime, target.definition.id)
        : shieldBlocksIntrinsicAttack(entity, index, ruleset, runtime, target.definition.locations);
}

function coreAmsExempt(
    target: ResolvedTarget,
    action: MekAction,
    ruleset: CBTRuleset,
): boolean {
    return ruleset === 'core-2026'
        && action === 'fire'
        && target.kind === 'component'
        && target.definition.mount.equipment?.hasAnyFlag(['F_AMS', 'F_AMS_BAY']) === true;
}

type ResolvedTarget =
    | { readonly kind: 'component'; readonly definition: CBTRuntimeEquipment }
    | { readonly kind: 'intrinsic'; readonly definition: IntrinsicWeapon };

function resolveTarget(index: MekRuntimeIndex, target: AttackerActionTarget): ResolvedTarget | null {
    if (target.kind === 'component') {
        const definition = index.components.get(target.componentId);
        return definition?.kind === 'equipment' ? { kind: 'component', definition } : null;
    }
    const matches = index.intrinsicActions.filter(candidate => candidate.id === target.actionId);
    return matches.length === 1 ? { kind: 'intrinsic', definition: matches[0] } : null;
}

function targetOperational(
    index: MekRuntimeIndex,
    runtime: MekActionRuntimePort,
    target: ResolvedTarget,
): boolean {
    if (target.kind === 'component') {
        return runtime.componentStatus(target.definition.id, 'committed') === 'available';
    }
    return target.definition.locations.every(code => {
        const locationId = locationIdForCode(index, code);
        return locationId !== null && !locationUnavailable(index, runtime, locationId);
    });
}

function mekCanFire(index: MekRuntimeIndex, runtime: MekActionRuntimePort): boolean {
    const slots = slotsInEntityOrder(index);
    const cockpit = slots.find(slot => slotHasSystem(index, slot, name => name.includes('Cockpit')));
    const cockpitCode = cockpit === undefined ? 'HD' : index.locations.get(cockpit.locationId)?.code ?? 'HD';
    const unavailableSensors = slots.filter(slot =>
        slotHasSystem(index, slot, name => name.includes('Sensor'))
        && slotUnavailable(index, runtime, slot)).length;
    return cockpitCode === 'HD' ? unavailableSensors < 2 : unavailableSensors < 3;
}

function isPhysicalTarget(target: ResolvedTarget): boolean {
    return target.kind === 'intrinsic' || target.definition.mount.isPhysicalWeapon();
}

function physicalMovementUnavailable(runtime: MekActionRuntimePort, target: ResolvedTarget): boolean {
    const kind = target.kind === 'intrinsic' ? target.definition.kind : null;
    // Prone, a 'Mech can only thrash at infantry or punch a vehicle in its hex (TW p. 151); thrashing needs prone.
    if (runtime.hasCondition('prone')) return kind !== 'thrash' && kind !== 'punch';
    if (kind === 'thrash') return true;
    const movement = runtime.mekMovementMode();
    if (movement.kind === 'unsupported') return true;
    const moveMode = movement.mode;
    if (moveMode === null) return false;
    if (kind === 'death-from-above') return moveMode !== 'jump';
    if (moveMode === 'jump' && kind === 'charge') return true;
    return moveMode === 'stationary' && (kind === 'charge' || kind === 'airmek-ram');
}

/** The kinds of the other physical actions selected this turn: an intrinsic attack's kind, or 'weapon'. */
function otherSelectedActionKinds(index: MekRuntimeIndex, runtime: MekActionRuntimePort, actionId: string): string[] {
    return [...runtime.attackerTargetingState().actions.values()].flatMap(({ target }) => {
        if (target.kind === 'component') return ['weapon'];
        if (target.actionId === actionId) return [];
        return index.intrinsicActions.filter(candidate => candidate.id === target.actionId).map(candidate => candidate.kind);
    });
}

function physicalTargetAvailable(
    index: MekRuntimeIndex,
    runtime: MekActionRuntimePort,
    target: ResolvedTarget,
    ruleset: CBTRuleset,
): boolean {
    const physical = physicalCapabilities(index, runtime, ruleset);
    // Brushing swarming infantry off is the 'Mech's only physical attack that turn, made with up to both arms
    // (TW p. 221).
    const brushingOff = target.kind === 'intrinsic' && target.definition.kind === 'brush-off';
    const others = otherSelectedActionKinds(index, runtime, target.kind === 'intrinsic' ? target.definition.id : '');
    if (brushingOff ? others.some(kind => kind !== 'brush-off') : others.includes('brush-off')) return false;
    if (target.kind === 'intrinsic') {
        switch (target.definition.kind) {
            case 'punch': {
                const location = target.definition.locations[0];
                // Prone, the 'Mech props itself up on one arm and punches once with the other, and not as well as
                // thrashing (TW p. 151).
                if (runtime.hasCondition('prone') && (!physical.canPunchProne
                    || otherSelectedActionKinds(index, runtime, target.definition.id)
                        .some(kind => kind === 'punch' || kind === 'thrash'))) return false;
                return location === undefined || !(location in physical.canPunch)
                    || physical.canPunch[location as ArmCode];
            }
            // Only a swarmed 'Mech brushes infantry off, with an arm that could punch and fired no weapon
            // (TW p. 221).
            case 'brush-off': {
                const location = target.definition.locations[0] as ArmCode | undefined;
                return runtime.hasCondition('swarmed') && location !== undefined
                    && physical.canPunch[location] && !physical.armFired[location];
            }
            // Thrashing is the 'Mech's only attack that turn: no weapon fired and no other attack (TW p. 151).
            case 'thrash': return physical.noWeaponFired
                && otherSelectedActionKinds(index, runtime, target.definition.id).length === 0;
            case 'club': return physical.canClub;
            case 'push': return physical.canPush;
            case 'kick': return physical.canKick;
            case 'mule-kick': return physical.canMuleKick;
            default: return true;
        }
    }
    return target.definition.mount.getOccupiedLocations().every(location =>
        !(location in physical.canPhysicalWeapon)
        || physical.canPhysicalWeapon[location as ArmCode]);
}

type ArmCode = 'LA' | 'RA';

interface PhysicalCapabilities {
    readonly canKick: boolean;
    readonly canMuleKick: boolean;
    readonly canPunch: Readonly<Record<ArmCode, boolean>>;
    readonly canPhysicalWeapon: Readonly<Record<ArmCode, boolean>>;
    readonly canPush: boolean;
    readonly canClub: boolean;
    /** A prone 'Mech props itself on one arm to punch, so both arms must be intact and unfired (TW p. 151). */
    readonly canPunchProne: boolean;
    /** The arm's weapons fire this turn. */
    readonly armFired: Readonly<Record<ArmCode, boolean>>;
    readonly noWeaponFired: boolean;
}

function physicalCapabilities(
    index: MekRuntimeIndex,
    runtime: MekActionRuntimePort,
    ruleset: CBTRuleset,
): PhysicalCapabilities {
    const locationCodes = new Set([...index.locations.values()].map(location => location.code));
    const bipedLegCodes: readonly MekLocation[] = locationCodes.has('CL')
        ? ['LL', 'RL', 'CL']
        : ['LL', 'RL'];
    const quadLegCodes: readonly MekLocation[] = ['RLL', 'FLL', 'RRL', 'FRL'];
    const legCodes: readonly MekLocation[] = locationCodes.has('LL') && locationCodes.has('RL')
        ? bipedLegCodes
        : quadLegCodes.every(code => locationCodes.has(code))
            ? quadLegCodes
            : [];
    const lostLegs = new Set<LocationId>();
    const lostHips = new Set<LocationId>();
    for (const code of legCodes) {
        const locationId = locationIdForCode(index, code)!;
        if (locationUnavailable(index, runtime, locationId)) lostLegs.add(locationId);
        else if (unavailableSystemSlotsAt(index, runtime, code, 'Hip') > 0) lostHips.add(locationId);
    }

    const arms = Object.fromEntries((['LA', 'RA'] as const).map(code => {
        const locationId = locationIdForCode(index, code);
        const locationLost = locationId === null || locationUnavailable(index, runtime, locationId);
        const hasFrontArmor = locationId !== null && index.locations.get(locationId)?.armorFaceIds.some(
            faceId => index.armorFaces.get(faceId)?.face === 'front',
        ) === true;
        if (!hasFrontArmor) return [code, { canPunch: false, canPhysicalWeapon: false, locationLost }] as const;
        const shoulderLost = unavailableSystemSlotsAt(index, runtime, code, 'Shoulder') > 0;
        const handLost = unavailableSystemSlotsAt(index, runtime, code, 'Hand') > 0;
        return [code, {
            canPunch: !shoulderLost && !locationLost,
            canPhysicalWeapon: !shoulderLost && !handLost && !locationLost,
            locationLost,
        }] as const;
    })) as Record<ArmCode, {
        readonly canPunch: boolean;
        readonly canPhysicalWeapon: boolean;
        readonly locationLost: boolean;
    }>;
    const fired = weaponFiredLocationIds(index, runtime.attackerTargetingState());
    const quad = legCodes === quadLegCodes;
    const canKick = (kind: MekKickKind): boolean => {
        const kickLegs = kickLegIds(index, kind);
        // A leg whose weapons fired cannot kick; a mule kick uses both rear legs (TW p. 147, Core p. 81).
        const weaponsAllow = kind === 'mule-kick'
            ? kickLegs.every(locationId => !fired.has(locationId))
            : kickLegs.some(locationId => !fired.has(locationId));
        if (!weaponsAllow || (kind === 'mule-kick' && !quad)) return false;
        // Total Warfare needs every leg and the hips of the legs used: both of a biped, a quad's front or rear pair
        // (TW p. 147; MegaMek needs all four).
        if (!quad || ruleset === 'total-warfare') {
            return lostLegs.size === 0 && kickLegs.every(locationId => !lostHips.has(locationId));
        }
        // Core p. 238: a second hip hit or a second lost leg acts as a biped hip hit, which forbids kicks; a quad
        // that lost one leg cannot mule kick.
        return lostHips.size < 2
            && lostLegs.size < (kind === 'mule-kick' ? 1 : 2)
            && kickLegs.every(locationId => !lostLegs.has(locationId) && !lostHips.has(locationId));
    };
    return Object.freeze({
        canKick: canKick('kick'),
        canMuleKick: canKick('mule-kick'),
        canPunch: Object.freeze({ LA: arms.LA.canPunch, RA: arms.RA.canPunch }),
        canPhysicalWeapon: Object.freeze({ LA: arms.LA.canPhysicalWeapon, RA: arms.RA.canPhysicalWeapon }),
        canPush: !arms.LA.locationLost && !arms.RA.locationLost,
        canPunchProne: (['LA', 'RA'] as const).every(code => {
            const locationId = locationIdForCode(index, code);
            return !arms[code].locationLost && locationId !== null && !fired.has(locationId);
        }),
        noWeaponFired: fired.size === 0,
        armFired: Object.freeze(Object.fromEntries((['LA', 'RA'] as const).map(code => {
            const locationId = locationIdForCode(index, code);
            return [code, locationId !== null && fired.has(locationId)];
        })) as Record<ArmCode, boolean>),
        canClub: arms.LA.canPhysicalWeapon && arms.RA.canPhysicalWeapon,
    });
}

function unavailableSystemSlotsAt(
    index: MekRuntimeIndex,
    runtime: MekActionRuntimePort,
    locationCode: string,
    systemName: string,
): number {
    return [...index.slots.values()].filter(slot =>
        index.locations.get(slot.locationId)?.code === locationCode
        && slotHasSystem(index, slot, name => name.includes(systemName))
        && slotUnavailable(index, runtime, slot)).length;
}

function slotUnavailable(
    index: MekRuntimeIndex,
    runtime: MekActionRuntimePort,
    slot: MekIndexedCriticalSlot,
): boolean {
    return runtime.criticalHits(slot.id, 'committed') >= (slot.armored ? 2 : 1)
        || locationUnavailable(index, runtime, slot.locationId);
}

function locationUnavailable(
    index: MekRuntimeIndex,
    runtime: MekActionRuntimePort,
    locationId: LocationId,
    visited: Set<LocationId> = new Set(),
): boolean {
    if (visited.has(locationId)) return false;
    visited.add(locationId);
    if (runtime.remainingInternal(locationId, 'committed') <= 0
        || runtime.locationCondition(locationId, 'flooded', 'committed') > 0
        || runtime.locationCondition(locationId, 'blown-off', 'committed') > 0) return true;
    const parentId = mekLocationDestructionParentId(index, locationId);
    return parentId !== null && locationUnavailable(index, runtime, parentId, visited);
}

function slotHasSystem(
    index: MekRuntimeIndex,
    slot: MekIndexedCriticalSlot,
    predicate: (name: string) => boolean,
): boolean {
    return slot.componentIds.some(componentId => {
        const component = index.components.get(componentId);
        return component?.kind === 'system' && predicate(component.systemType);
    });
}

function slotsInEntityOrder(index: MekRuntimeIndex): readonly MekIndexedCriticalSlot[] {
    const locationOrder = new Map([...index.locations.keys()].map((id, position) => [id, position] as const));
    return [...index.slots.values()].sort((left, right) =>
        (locationOrder.get(left.locationId) ?? Number.MAX_SAFE_INTEGER)
        - (locationOrder.get(right.locationId) ?? Number.MAX_SAFE_INTEGER)
        || left.slotIndex - right.slotIndex);
}

function locationIdForCode(index: MekRuntimeIndex, code: string): LocationId | null {
    const matches = [...index.locations.values()].filter(location => location.code === code);
    return matches.length === 1 ? matches[0].id : null;
}

/** Null means unrelated; false is an explicit bay denial. */
function componentBayFirePermission(
    index: MekRuntimeIndex,
    runtime: MekActionRuntimePort,
    componentId: ComponentId,
): boolean | null {
    const claims = index.relationships.bays.filter(bay =>
        bay.controllerId === componentId || bay.memberIds.includes(componentId));
    if (claims.length === 0) return null;
    if (claims.length !== 1) return false;
    const bay = claims[0];
    const role = bay.controllerId === componentId ? 'controller' : 'member';
    const operationalMembers = bay.memberIds.filter(id => runtime.componentStatus(id, 'committed') === 'available');
    const controllerStatus = bay.controllerId === undefined
        ? undefined
        : runtime.componentStatus(bay.controllerId, 'committed');
    const controllerMode = bay.kind === 'machine-gun-array' && bay.controllerId !== undefined
        ? runtime.componentMode(bay.controllerId)
        : undefined;
    if (bay.kind === 'machine-gun-array' && controllerMode !== 'Linked' && controllerMode !== 'Off') return false;
    if (role === 'controller') {
        return controllerStatus === 'available'
            && operationalMembers.length > 0
            && (bay.kind !== 'machine-gun-array' || controllerMode === 'Linked');
    }
    if (!operationalMembers.includes(componentId)) return false;
    if (bay.kind === 'weapon-bay') return false;
    return controllerStatus !== 'available' || controllerMode === 'Off';
}
