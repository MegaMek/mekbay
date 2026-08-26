// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import type { EncounterNetwork } from './encounter-runtime';
import type { UnitInstanceId } from './runtime-state';

export type C3EndpointOperationalQuery = (
    instanceId: UnitInstanceId,
    componentId: ComponentId,
) => boolean;

/**
 * The sole operational-network definition used by mechanics and presentation.
 * A standard C3 graph needs one surviving master and at least one surviving
 * member. Peer graphs need two surviving units.
 */
export function projectOperationalC3Networks(
    networks: readonly EncounterNetwork[],
    isEndpointOperational: C3EndpointOperationalQuery,
): readonly EncounterNetwork[] {
    return Object.freeze(networks.flatMap(network => {
        const endpoints = network.endpoints.filter(endpoint =>
            isEndpointOperational(endpoint.instanceId, endpoint.componentId));
        const distinctUnits = new Set(endpoints.map(endpoint => endpoint.instanceId));
        const usable = network.networkType === 'c3'
            ? endpoints.filter(endpoint => endpoint.role === 'master').length === 1
                && endpoints.some(endpoint => endpoint.role === 'member')
                && distinctUnits.size >= 2
            : distinctUnits.size >= 2;
        return usable
            ? [Object.freeze({ ...network, endpoints: Object.freeze(endpoints) })]
            : [];
    }));
}
