// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from './entity/entity-identifiers';
import type { SerializedC3NetworkGroup } from './force-serialization';
import { C3Network, C3NetworkType, C3Role, type C3Component } from './c3-network.model';
import { C3NetworkEditor } from './c3-network-editor';
import {
    asEncounterNetworkId,
    type EncounterNetwork,
    type EncounterNetworkEndpoint,
} from './runtime/encounter-runtime';

/** Short-lived editor projection. Stable runtime identities remain authoritative. */
export interface C3EncounterPresentationUnit {
    readonly instanceId: string;
    readonly c3Components: readonly C3Component[];
}

/**
 * Applies only roles that stable facts can state unambiguously. `member` is a
 * storage relationship, not a capability role: it may be a Slave or a Master.
 */
export function projectEncounterC3Components(
    instanceId: string,
    components: readonly C3Component[],
    networks: readonly EncounterNetwork[],
): readonly C3Component[] {
    const explicitRoles = new Map<ComponentId, C3Role>();
    for (const network of networks) {
        for (const endpoint of network.endpoints) {
            if (endpoint.instanceId !== instanceId || endpoint.role === 'member') continue;
            if (endpoint.role === 'master') explicitRoles.set(endpoint.componentId, C3Role.MASTER);
            else if (!explicitRoles.has(endpoint.componentId)) explicitRoles.set(endpoint.componentId, C3Role.PEER);
        }
    }
    return Object.freeze(components.map(component => Object.freeze({
        ...component,
        ...(component.componentId === undefined
            ? {}
            : { role: explicitRoles.get(component.componentId) ?? component.role }),
    })));
}

/**
 * Validates stable encounter networks by round-tripping them through the one
 * canonical C3 rule utility. This layer owns identity projection, not rules.
 */
export function validateEncounterNetworks(
    networks: readonly EncounterNetwork[],
    units: readonly C3EncounterPresentationUnit[],
): boolean {
    try {
        const unitsById = indexUnits(units);
        return C3NetworkEditor.validate(
            projectEncounterNetworksToC3Editor(networks, units),
            unitsById,
        );
    } catch {
        return false;
    }
}

/** Projects stable encounter endpoints into the existing visual editor grammar. */
export function projectEncounterNetworksToC3Editor(
    networks: readonly EncounterNetwork[],
    units: readonly C3EncounterPresentationUnit[],
): SerializedC3NetworkGroup[] {
    const unitsById = indexUnits(units);
    return networks.map(network => {
        if (network.networkType !== C3NetworkType.C3) {
            const peerIds = network.endpoints.map(endpoint => {
                if (endpoint.role !== 'peer') {
                    throw new Error(`Peer C3 network "${network.id}" contains a non-peer endpoint.`);
                }
                requireVisualComponent(unitsById, endpoint, network.networkType, C3Role.PEER);
                return String(endpoint.instanceId);
            });
            return {
                id: network.id,
                type: network.networkType,
                color: network.color,
                peerIds,
            };
        }

        const masters = network.endpoints.filter(endpoint => endpoint.role === 'master');
        if (masters.length !== 1) {
            throw new Error(`C3 network "${network.id}" has no unique root master.`);
        }
        const master = masters[0];
        const masterComponent = requireVisualComponent(
            unitsById,
            master,
            C3NetworkType.C3,
            C3Role.MASTER,
        );
        const members = network.endpoints
            .filter(endpoint => endpoint !== master)
            .map(endpoint => {
                if (endpoint.role !== 'member') {
                    throw new Error(`C3 network "${network.id}" contains an invalid member role.`);
                }
                const component = requireVisualComponent(unitsById, endpoint, C3NetworkType.C3);
                return component.role === C3Role.MASTER
                    ? C3Network.masterMember(String(endpoint.instanceId), component.index)
                    : String(endpoint.instanceId);
            });
        return {
            id: network.id,
            type: C3NetworkType.C3,
            color: network.color,
            masterId: String(master.instanceId),
            masterCompIndex: masterComponent.index,
            members,
        };
    });
}

/** Converts edited visual rows back to encounter-owned stable component identities. */
export function projectC3EditorNetworksToEncounter(
    networks: readonly SerializedC3NetworkGroup[],
    units: readonly C3EncounterPresentationUnit[],
): EncounterNetwork[] {
    const unitsById = indexUnits(units);
    return networks.map(network => {
        const endpoints: EncounterNetworkEndpoint[] = [];
        if (network.type === C3NetworkType.C3) {
            if (network.masterId === undefined || network.masterCompIndex === undefined) {
                throw new Error(`C3 network "${network.id}" has no root master.`);
            }
            endpoints.push(stableEndpointAt(
                unitsById,
                network.masterId,
                network.masterCompIndex,
                network.type,
                C3Role.MASTER,
                'master',
            ));
            for (const rawMember of network.members ?? []) {
                const member = C3Network.parseMember(rawMember);
                endpoints.push(member.compIndex === undefined
                    ? uniqueStableEndpoint(unitsById, member.unitId, network.type, C3Role.SLAVE, 'member')
                    : stableEndpointAt(
                        unitsById,
                        member.unitId,
                        member.compIndex,
                        network.type,
                        C3Role.MASTER,
                        'member',
                    ));
            }
        } else {
            for (const unitId of network.peerIds ?? []) {
                endpoints.push(uniqueStableEndpoint(
                    unitsById,
                    unitId,
                    network.type,
                    C3Role.PEER,
                    'peer',
                ));
            }
        }
        return Object.freeze({
            id: asEncounterNetworkId(network.id),
            networkType: network.type,
            color: network.color,
            endpoints: Object.freeze(endpoints),
        });
    });
}

function indexUnits(
    units: readonly C3EncounterPresentationUnit[],
): ReadonlyMap<string, C3EncounterPresentationUnit> {
    const result = new Map<string, C3EncounterPresentationUnit>();
    for (const unit of units) {
        const key = String(unit.instanceId);
        if (result.has(key)) throw new Error(`Duplicate C3 presentation unit "${key}".`);
        result.set(key, unit);
    }
    return result;
}

function requireVisualComponent(
    unitsById: ReadonlyMap<string, C3EncounterPresentationUnit>,
    endpoint: EncounterNetworkEndpoint,
    networkType: C3NetworkType,
    role?: C3Role,
): C3Component {
    const unit = unitsById.get(String(endpoint.instanceId));
    const component = unit?.c3Components.find(candidate => candidate.componentId === endpoint.componentId);
    if (!component || component.networkType !== networkType || (role !== undefined && component.role !== role)) {
        throw new Error(`C3 endpoint "${endpoint.instanceId}/${endpoint.componentId}" is not present in the current entity.`);
    }
    return component;
}

function stableEndpointAt(
    unitsById: ReadonlyMap<string, C3EncounterPresentationUnit>,
    unitId: string,
    componentIndex: number,
    networkType: C3NetworkType,
    capabilityRole: C3Role,
    role: EncounterNetworkEndpoint['role'],
): EncounterNetworkEndpoint {
    const unit = unitsById.get(unitId);
    const component = unit?.c3Components[componentIndex];
    if (!unit || !component?.componentId
        || component.networkType !== networkType || component.role !== capabilityRole) {
        throw new Error(`C3 endpoint "${unitId}:${componentIndex}" is not present in the current entity.`);
    }
    return Object.freeze({
        instanceId: unit.instanceId,
        componentId: component.componentId,
        role,
    });
}

function uniqueStableEndpoint(
    unitsById: ReadonlyMap<string, C3EncounterPresentationUnit>,
    unitId: string,
    networkType: C3NetworkType,
    capabilityRole: C3Role,
    role: EncounterNetworkEndpoint['role'],
): EncounterNetworkEndpoint {
    const unit = unitsById.get(unitId);
    const matches = unit?.c3Components.filter(component => component.networkType === networkType
        && component.role === capabilityRole && component.componentId !== undefined) ?? [];
    if (!unit || matches.length !== 1) {
        throw new Error(`C3 endpoint for "${unitId}" is missing or ambiguous in the current entity.`);
    }
    return Object.freeze({
        instanceId: unit.instanceId,
        componentId: matches[0].componentId as ComponentId,
        role,
    });
}
