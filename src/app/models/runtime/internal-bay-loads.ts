// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { isAeroEntity, isInfantryFamilyEntity, isMekEntity, isProtoMekEntity, isVehicleEntity } from '../entity/utils/entity-type-guards';
import { getBayTransporterType } from '../entity/bays/bay-definitions';

export type InternalBayLoad = Readonly<{ bay: string; unitId: string; tons: number } | { bay: string; cargo: string; tons: number }>;

export function remainingInternalBayLoads(loads: readonly InternalBayLoad[] = [], destroyed: readonly InternalBayLoad[] = []): readonly InternalBayLoad[] {
    if (!destroyed.length) return loads;
    return loads.filter(load => !('cargo' in load) || !destroyed.some(hit => 'cargo' in hit && hit.bay === load.bay && hit.cargo === load.cargo));
}

export function internalCargoBays(entity: BaseEntity) {
    return entity.transporters().flatMap(t => {
        if (t.kind === 'troop-space') return [{ id: t.id, label: 'Infantry compartment', troops: true, cargo: false }];
        if (t.kind !== 'bay') return [];
        const cargo = t.configuration.type.includes('cargo');
        const troops = cargo || t.configuration.type === 'infantry' || t.configuration.type === 'battle-armor';
        const unitBay = isAeroEntity(entity) && ['mek', 'light-vehicle', 'heavy-vehicle', 'super-heavy-vehicle',
            'protomek', 'fighter', 'small-craft', 'drop-shuttle'].includes(t.configuration.type);
        return troops || unitBay ? [{ id: t.id, label: getBayTransporterType(t.configuration), troops: troops || unitBay, cargo }] : [];
    });
}

export function internalBayAccepts(entity: BaseEntity, bayId: string, passenger: BaseEntity): boolean {
    const bay = entity.transporters().find(t => t.id === bayId);
    if (bay?.kind === 'troop-space') return isInfantryFamilyEntity(passenger);
    if (bay?.kind !== 'bay') return false;
    const kind = bay.configuration.type;
    if (kind.includes('cargo') || kind === 'infantry') return isInfantryFamilyEntity(passenger);
    if (kind === 'battle-armor') return passenger.entityType === 'BattleArmor';
    if (kind === 'mek') return isMekEntity(passenger);
    if (kind === 'protomek') return isProtoMekEntity(passenger);
    if (kind === 'light-vehicle' || kind === 'heavy-vehicle' || kind === 'super-heavy-vehicle')
        return isVehicleEntity(passenger) && passenger.tonnage() <= (kind === 'light-vehicle' ? 50 : kind === 'heavy-vehicle' ? 100 : 200);
    if (kind === 'fighter') return passenger.entityType === 'Aero' || passenger.entityType === 'ConvFighter';
    return (kind === 'small-craft' || kind === 'drop-shuttle') && passenger.entityType === 'SmallCraft';
}

export function readInternalBayLoads(value: unknown): readonly InternalBayLoad[] {
    if (!Array.isArray(value)) throw new Error('Invalid internal bay loadout');
    const seen = new Set<string>();
    return Object.freeze(value.map(row => {
        if (!row || typeof row !== 'object' || typeof row.bay !== 'string' || !row.bay
            || !Number.isFinite(row.tons) || row.tons <= 0
            || (typeof row.unitId === 'string') === (typeof row.cargo === 'string')) throw new Error('Invalid internal bay load');
        const load = typeof row.unitId === 'string'
            ? { bay: row.bay, unitId: row.unitId, tons: row.tons } : { bay: row.bay, cargo: row.cargo, tons: row.tons };
        const id = row.unitId !== undefined ? 'unit:' + row.unitId : JSON.stringify([row.bay, row.cargo]);
        if (!(row.unitId ?? row.cargo).trim() || seen.has(id)) throw new Error('Empty or duplicate internal bay load');
        seen.add(id);
        return Object.freeze(load);
    }));
}
