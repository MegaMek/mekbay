// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    isC3EmergencyMasterModeRequested,
    isC3EmergencyMasterOperatingTurnsFried,
} from '../c3-emergency-master.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekUnitQueryPort } from './unit-instance';
import type {
    EncounterNetwork,
    EncounterNetworkEndpoint,
} from './encounter-runtime';
import type { UnitInstanceId } from './runtime-state';

export interface MekC3RuntimeUnit {
    readonly instanceId: UnitInstanceId;
    readonly query: MekUnitQueryPort;
}

interface EmergencyPromotion {
    readonly configuredMaster: EncounterNetworkEndpoint;
    readonly emergencyMaster: EncounterNetworkEndpoint;
}

/**
 * Projects the configured encounter graph through current Entity/runtime facts.
 * The configured graph remains untouched and is the only graph persisted.
 */
export function projectEffectiveMekC3Networks(
    configured: readonly EncounterNetwork[],
    units: readonly MekC3RuntimeUnit[],
): readonly EncounterNetwork[] {
    const unitsById = new Map(units.map(unit => [unit.instanceId, unit] as const));
    if (unitsById.size !== units.length) throw new Error('Duplicate C3 runtime unit');

    const promotions = new Map<EncounterNetwork['id'], EmergencyPromotion>();
    for (const network of configured) {
        const promotion = emergencyPromotion(network, unitsById);
        if (promotion) promotions.set(network.id, promotion);
    }
    if (promotions.size === 0) return configured;

    const displacedMasters = new Set(
        [...promotions.values()].map(promotion => endpointKey(promotion.configuredMaster)),
    );
    return Object.freeze(configured.map(network => {
        const promotion = promotions.get(network.id);
        const endpoints = network.endpoints.filter(endpoint =>
            !displacedMasters.has(endpointKey(endpoint))
            && (promotion === undefined
                || endpoint.instanceId !== promotion.emergencyMaster.instanceId));
        if (promotion) endpoints.unshift(promotion.emergencyMaster);
        if (sameEndpoints(network.endpoints, endpoints)) return network;
        return Object.freeze({ ...network, endpoints: Object.freeze(endpoints) });
    }));
}

function emergencyPromotion(
    network: EncounterNetwork,
    units: ReadonlyMap<UnitInstanceId, MekC3RuntimeUnit>,
): EmergencyPromotion | null {
    if (network.networkType !== 'c3') return null;
    const configuredMasters = network.endpoints.filter(endpoint => endpoint.role === 'master');
    if (configuredMasters.length !== 1) return null;
    const configuredMaster = configuredMasters[0]!;
    if (!configuredMasterInstalled(configuredMaster, units)) return null;
    if (endpointAvailable(configuredMaster, units)) return null;

    for (const member of network.endpoints) {
        if (member.role !== 'member') continue;
        const unit = units.get(member.instanceId);
        if (!unit || unit.query.hasCondition('jammed')
            || unit.query.c3DisruptedByStealth('preview')) continue;
        const capabilities = unit.query.mekC3Endpoints();
        if (capabilities.kind !== 'supported') continue;
        const configuredMember = capabilities.endpoints.find(capability =>
            capability.componentId === member.componentId);
        if (!configuredMember || configuredMember.family !== 'c3'
            || configuredMember.role === 'peer') continue;
        for (const capability of capabilities.endpoints) {
            if (capability.family !== 'c3' || !capability.emergency) continue;
            const lifecycle = unit.query.componentC3EmergencyMaster(capability.componentId);
            const mode = lifecycle?.mode ?? 'auto';
            const turns = lifecycle?.operatingTurns ?? 0;
            if (!isC3EmergencyMasterModeRequested(mode, true)
                || isC3EmergencyMasterOperatingTurnsFried(turns)
                || unit.query.componentStatus(capability.componentId, 'preview') !== 'available') {
                continue;
            }
            return Object.freeze({
                configuredMaster,
                emergencyMaster: Object.freeze({
                    instanceId: unit.instanceId,
                    componentId: capability.componentId,
                    role: 'master' as const,
                }),
            });
        }
    }
    return null;
}

function endpointAvailable(
    endpoint: EncounterNetworkEndpoint,
    units: ReadonlyMap<UnitInstanceId, MekC3RuntimeUnit>,
): boolean {
    const unit = units.get(endpoint.instanceId);
    if (!unit || unit.query.hasCondition('jammed')
        || unit.query.c3DisruptedByStealth('preview')) return false;
    const capabilities = unit.query.mekC3Endpoints();
    if (capabilities.kind !== 'supported') return false;
    const capability = capabilities.endpoints.find(candidate =>
        candidate.componentId === endpoint.componentId);
    if (!capability || capability.family !== 'c3'
        || capability.role !== 'master' || capability.emergency) return false;
    return unit.query.componentStatus(endpoint.componentId, 'preview') === 'available';
}

function configuredMasterInstalled(
    endpoint: EncounterNetworkEndpoint,
    units: ReadonlyMap<UnitInstanceId, MekC3RuntimeUnit>,
): boolean {
    const unit = units.get(endpoint.instanceId);
    const capabilities = unit?.query.mekC3Endpoints();
    return capabilities?.kind === 'supported'
        && capabilities.endpoints.some(capability =>
            capability.componentId === endpoint.componentId
            && capability.family === 'c3'
            && capability.role === 'master'
            && !capability.emergency);
}

function endpointKey(endpoint: Pick<EncounterNetworkEndpoint, 'instanceId' | 'componentId'>): string {
    return `${endpoint.instanceId}\0${endpoint.componentId}`;
}

function sameEndpoints(
    left: readonly EncounterNetworkEndpoint[],
    right: readonly EncounterNetworkEndpoint[],
): boolean {
    return left.length === right.length && left.every((endpoint, index) => {
        const candidate = right[index];
        return candidate?.instanceId === endpoint.instanceId
            && candidate.componentId === endpoint.componentId
            && candidate.role === endpoint.role;
    });
}

export function c3EndpointKey(instanceId: UnitInstanceId, componentId: ComponentId): string {
    return `${instanceId}\0${componentId}`;
}
