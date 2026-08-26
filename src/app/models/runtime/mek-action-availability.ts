// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId, LocationId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { getMekLocationParent } from '../entity/types';
import type { IntrinsicWeapon } from '../entity/types/weapon';
import type { MekUnitQueryPort } from './unit-instance';
import type { AttackerActionTarget } from './attacker-targeting-state';
import {
    type MekRuntimeIndex,
    type MekIndexedCriticalSlot,
    type MekIndexedEquipment,
} from './mek-runtime-index';
import { isGaussPoweredDown } from './mek-gauss-power';
import { ppcCapacitorChargingForWeapon } from './component-ppc-capacitor';

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
): boolean {
    try {
        const resolved = resolveTarget(index, target);
        if (resolved === null || !targetOperational(index, runtime, resolved)) return false;
        const destruction = runtime.mekDestruction();
        if (destruction.kind === 'unsupported'
            || destruction.destroyed
            || runtime.hasCondition('shutdown')) return false;

        if (action === 'fire' && target.kind === 'component'
            && (runtime.componentJammed(target.componentId)
                || isGaussPoweredDown(runtime.componentGaussPower(target.componentId))
                || runtime.componentBombastLaser(target.componentId)?.chargeState === 'charging'
                || ppcCapacitorChargingForWeapon(index, runtime, target.componentId)
                || componentBayFirePermission(index, runtime, target.componentId) === false)) return false;

        switch (action) {
            case 'fire': return mekCanFire(index, runtime);
            case 'physical-attack':
                if (!isPhysicalTarget(resolved)) return true;
                if (physicalMovementUnavailable(runtime, resolved)) return false;
                return physicalTargetAvailable(entity, index, runtime, resolved);
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

type ResolvedTarget =
    | { readonly kind: 'component'; readonly definition: MekIndexedEquipment }
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
    if (runtime.hasCondition('prone')) return true;
    const movement = runtime.mekMovementMode();
    if (movement.kind === 'unsupported') return true;
    const moveMode = movement.mode;
    if (moveMode === null) return false;
    const kind = target.kind === 'intrinsic' ? target.definition.kind : null;
    if (kind === 'death-from-above') return moveMode !== 'jump';
    if (moveMode === 'jump' && kind === 'charge') return true;
    return moveMode === 'stationary' && (kind === 'charge' || kind === 'airmek-ram');
}

function physicalTargetAvailable(
    entity: MekEntity,
    index: MekRuntimeIndex,
    runtime: MekActionRuntimePort,
    target: ResolvedTarget,
): boolean {
    const physical = physicalCapabilities(index, runtime);
    if (target.kind === 'intrinsic') {
        switch (target.definition.kind) {
            case 'punch': {
                const location = target.definition.locations[0];
                return location === undefined || !(location in physical.canPunch)
                    || physical.canPunch[location as ArmCode];
            }
            case 'club': return physical.canClub;
            case 'push': return physical.canPush;
            case 'kick': return physical.canKick;
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
    readonly canPunch: Readonly<Record<ArmCode, boolean>>;
    readonly canPhysicalWeapon: Readonly<Record<ArmCode, boolean>>;
    readonly canPush: boolean;
    readonly canClub: boolean;
}

function physicalCapabilities(index: MekRuntimeIndex, runtime: MekActionRuntimePort): PhysicalCapabilities {
    const locationCodes = new Set([...index.locations.values()].map(location => location.code));
    const legCodes = locationCodes.has('LL') && locationCodes.has('RL')
        ? ['LL', 'RL', ...(locationCodes.has('CL') ? ['CL'] : [])]
        : ['RLL', 'FLL', 'RRL', 'FRL'].every(code => locationCodes.has(code))
            ? ['RLL', 'FLL', 'RRL', 'FRL']
            : [];
    let destroyedLegs = 0;
    let destroyedHips = 0;
    for (const code of legCodes) {
        const locationId = locationIdForCode(index, code)!;
        if (locationUnavailable(index, runtime, locationId)) destroyedLegs += 1;
        else destroyedHips += unavailableSystemSlotsAt(index, runtime, code, 'Hip');
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
    return Object.freeze({
        canKick: destroyedLegs === 0 && destroyedHips === 0,
        canPunch: Object.freeze({ LA: arms.LA.canPunch, RA: arms.RA.canPunch }),
        canPhysicalWeapon: Object.freeze({ LA: arms.LA.canPhysicalWeapon, RA: arms.RA.canPhysicalWeapon }),
        canPush: !arms.LA.locationLost && !arms.RA.locationLost,
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
    const parentId = locationParentId(index, locationId);
    return parentId !== null && locationUnavailable(index, runtime, parentId, visited);
}

function locationParentId(index: MekRuntimeIndex, locationId: LocationId): LocationId | null {
    const location = index.locations.get(locationId);
    if (location === undefined) return null;
    const locations = [...index.locations.values()];
    const parentCode = getMekLocationParent(locations.map(candidate => candidate.code), location.code);
    return parentCode === null ? null : locations.find(candidate => candidate.code === parentCode)?.id ?? null;
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

export const mekActionAvailabilityInternals = Object.freeze({ mekCanFire });
