// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentStatus } from '../equipment-status.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { WeaponEquipment } from '../equipment.model';
import type { MekRuntimeIndex, MekIndexedBay } from './mek-runtime-index';

export interface ComponentBayRuntimePort {
    componentStatus(componentId: ComponentId, perspective?: 'committed' | 'preview'): EquipmentStatus;
    componentMode(componentId: ComponentId): string | undefined;
}

export type ComponentBayRole = 'controller' | 'member';

export interface ComponentBayMemberRuntimeFacts {
    readonly componentId: ComponentId;
    readonly status: EquipmentStatus;
    readonly operational: boolean;
}

export interface ComponentBayRuntimeFacts {
    readonly relation: MekIndexedBay;
    readonly role: ComponentBayRole;
    readonly subjectId: ComponentId;
    readonly controllerStatus?: EquipmentStatus;
    readonly controllerMode?: 'Linked' | 'Off';
    readonly members: readonly ComponentBayMemberRuntimeFacts[];
    readonly operationalMemberIds: readonly ComponentId[];
    readonly canFire: boolean;
}

export type ComponentBayRuntimeResolution =
    | { readonly kind: 'unrelated' }
    | { readonly kind: 'denied'; readonly reason: 'DUPLICATE_OWNERSHIP' | 'MALFORMED_RUNTIME_STATE' }
    | { readonly kind: 'resolved'; readonly facts: ComponentBayRuntimeFacts };

/** Entity-level validation owned beside the matching runtime bay projection. */
export function mekComponentBayTopologyProblem(entity: MekEntity): string | null {
    const owned = new Set<string>();
    for (const bay of entity.equipmentBays()) {
        if (bay.kind === 'weapon-bay') return 'UNSUPPORTED_MEK_WEAPON_BAY';
        if (bay.mounts.length === 0 || bay.mounts.length > 4 || bay.controller === undefined) {
            return 'MALFORMED_RELATION';
        }
        const claimed = [bay.controller, ...bay.mounts];
        if (new Set(claimed.map(mount => mount.mountId)).size !== claimed.length) {
            return 'MALFORMED_RELATION';
        }
        for (const mount of claimed) {
            if (owned.has(mount.mountId)) return 'DUPLICATE_OWNERSHIP';
            owned.add(mount.mountId);
        }
        const controller = bay.controller.equipment;
        if (!(controller instanceof WeaponEquipment)
            || !controller.hasFlag('F_MGA')) return 'MALFORMED_RELATION';
        for (const member of bay.mounts) {
            const weapon = member.equipment;
            if (!(weapon instanceof WeaponEquipment)
                || !weapon.hasFlag('F_MG')
                || weapon.hasFlag('F_MGA')
                || weapon.rackSize !== controller.rackSize
                || member.location !== bay.controller.location) return 'MALFORMED_RELATION';
        }
    }
    return null;
}

export function resolveComponentBayRuntime(
    index: MekRuntimeIndex,
    runtime: ComponentBayRuntimePort,
    componentId: ComponentId,
): ComponentBayRuntimeResolution {
    const claims: Array<Readonly<{ role: ComponentBayRole; relation: MekIndexedBay }>> = [];
    for (const relation of index.relationships.bays) {
        if (relation.controllerId === componentId) claims.push({ role: 'controller', relation });
        if (relation.memberIds.includes(componentId)) claims.push({ role: 'member', relation });
    }
    if (claims.length === 0) return Object.freeze({ kind: 'unrelated' });
    if (claims.length !== 1) return denied('DUPLICATE_OWNERSHIP');
    try {
        return resolvedFacts(runtime, componentId, claims[0].role, claims[0].relation);
    } catch {
        return denied('MALFORMED_RUNTIME_STATE');
    }
}

function resolvedFacts(
    runtime: ComponentBayRuntimePort,
    subjectId: ComponentId,
    role: ComponentBayRole,
    relation: MekIndexedBay,
): ComponentBayRuntimeResolution {
    const members = Object.freeze(relation.memberIds.map(componentId => {
        const status = runtime.componentStatus(componentId, 'committed');
        return Object.freeze({ componentId, status, operational: status === 'available' });
    }));
    const operationalMemberIds = Object.freeze(members
        .filter(member => member.operational)
        .map(member => member.componentId));
    const controllerStatus = relation.controllerId === undefined
        ? undefined
        : runtime.componentStatus(relation.controllerId, 'committed');
    let controllerMode: 'Linked' | 'Off' | undefined;
    if (relation.kind === 'machine-gun-array') {
        if (relation.controllerId === undefined) throw new Error('MGA has no controller');
        const mode = runtime.componentMode(relation.controllerId);
        if (mode !== 'Linked' && mode !== 'Off') throw new Error('Invalid MGA mode');
        controllerMode = mode;
    }
    const subject = members.find(member => member.componentId === subjectId);
    const canFire = role === 'controller'
        ? controllerStatus === 'available'
            && operationalMemberIds.length > 0
            && (relation.kind !== 'machine-gun-array' || controllerMode === 'Linked')
        : subject?.operational === true
            && relation.kind === 'machine-gun-array'
            && (controllerStatus !== 'available' || controllerMode === 'Off');
    return Object.freeze({
        kind: 'resolved',
        facts: Object.freeze({
            relation,
            role,
            subjectId,
            ...(controllerStatus === undefined ? {} : { controllerStatus }),
            ...(controllerMode === undefined ? {} : { controllerMode }),
            members,
            operationalMemberIds,
            canFire,
        }),
    });
}

function denied(
    reason: Extract<ComponentBayRuntimeResolution, { kind: 'denied' }>['reason'],
): Extract<ComponentBayRuntimeResolution, { kind: 'denied' }> {
    return Object.freeze({ kind: 'denied', reason });
}
