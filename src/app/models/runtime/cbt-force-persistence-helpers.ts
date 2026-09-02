// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { uuidv7 } from '../../utils/uuid.util';
import { compareText } from '../../utils/string.util';
import { CBT_FORCE_UNASSIGNED_GROUP_ID } from './cbt-force-roster';
import {
    asForceId,
    emptyRuntimeHistory,
    validateSerializedCBTForceV2,
    type SerializedCBTEncounterStateV2,
    type SerializedCBTForceV2,
    type SerializedEncounterNetworkV2,
} from './persistence-v2';

export function nextForceRevision(revision: number): number {
    if (revision >= Number.MAX_SAFE_INTEGER) throw new Error('Force revision is exhausted');
    return revision + 1;
}

export async function remapCBTForceCloneEnvelope(
    source: SerializedCBTForceV2,
): Promise<SerializedCBTForceV2> {
    const instanceIds = new Map<string, string>(source.units.map(entry => [
        entry.instanceId,
        uuidv7(),
    ]));
    const remapInstanceId = (instanceId: string): string => {
        const remapped = instanceIds.get(instanceId);
        if (!remapped) throw new Error(`Clone references unknown unit ${instanceId}`);
        return remapped;
    };
    const units = source.units.map(entry => {
        const instanceId = remapInstanceId(entry.instanceId);
        return { ...entry, instanceId, unit: { ...entry.unit, instanceId } };
    });
    const roster = {
        ...source.roster,
        groups: source.roster.groups.map(group => ({
            ...group,
            groupId: group.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID
                ? group.groupId
                : uuidv7(),
            members: group.members.map(member => ({
                ...member,
                instanceId: remapInstanceId(member.instanceId),
            })),
        })),
    };
    const encounter = {
        ...source.encounter,
        networks: source.encounter.networks.map(network =>
            remapEncounterNetwork(network, remapInstanceId)),
        ...(source.encounter.c3Positions === undefined ? {} : {
            c3Positions: source.encounter.c3Positions
                .map(position => Object.freeze({
                    ...position,
                    unitId: remapInstanceId(position.unitId),
                }))
                .sort((left, right) => compareText(left.unitId, right.unitId)),
        }),
    };
    return validateSerializedCBTForceV2({
        ...source,
        forceId: asForceId(uuidv7()),
        forceRevision: 0,
        units,
        roster,
        encounter,
        history: emptyRuntimeHistory(),
    });
}

export function pruneRemovedUnitsFromEncounter(
    encounter: SerializedCBTEncounterStateV2,
    removedInstanceIds: ReadonlySet<string>,
): SerializedCBTEncounterStateV2 {
    const networks = encounter.networks.flatMap(network => {
        const retained = pruneEncounterNetwork(network, removedInstanceIds);
        return retained === null ? [] : [retained];
    });
    const c3Positions = encounter.c3Positions
        ?.filter(position => !removedInstanceIds.has(position.unitId));
    if (networks.length === encounter.networks.length
        && networks.every((network, index) => network === encounter.networks[index])
        && c3Positions?.length === encounter.c3Positions?.length) {
        return encounter;
    }
    return Object.freeze({
        networks: Object.freeze(networks),
        ...(c3Positions === undefined || c3Positions.length === 0
            ? {}
            : { c3Positions: Object.freeze(c3Positions) }),
    });
}

function remapEncounterNetwork(
    network: SerializedEncounterNetworkV2,
    remapInstanceId: (instanceId: string) => string,
): SerializedEncounterNetworkV2 {
    const endpoints = network.endpoints
        .map(endpoint => ({ ...endpoint, instanceId: remapInstanceId(endpoint.instanceId) }))
        .sort((left, right) => {
            const leftKey = `${left.instanceId}\0${left.componentId}`;
            const rightKey = `${right.instanceId}\0${right.componentId}`;
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        });
    return { ...network, endpoints };
}

function pruneEncounterNetwork(
    network: SerializedEncounterNetworkV2,
    instanceIds: ReadonlySet<string>,
): SerializedEncounterNetworkV2 | null {
    const endpoints = network.endpoints.filter(endpoint => !instanceIds.has(endpoint.instanceId));
    if (endpoints.length === network.endpoints.length) return network;
    if (endpoints.length < 2
        || (network.networkType === 'c3' && !endpoints.some(endpoint => endpoint.role === 'master'))) {
        return null;
    }
    return Object.freeze({ ...network, endpoints: Object.freeze(endpoints) });
}
