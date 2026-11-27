// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { isAeroEntity, isBattleArmorEntity, isInfantryEntity, isInfantryFamilyEntity, isMekEntity, isProtoMekEntity, isVehicleEntity } from '../entity/utils/entity-type-guards';
import { INFANTRY_TRANSPORT_WEIGHTS } from '../entity/types/transport';
import { getBayTransporterType } from '../entity/bays/bay-definitions';

export type InternalBayLoad = Readonly<{ bay: string; unitId: string; tons: number; spaces?: number } | { bay: string; cargo: string; tons: number }>;

export function remainingInternalBayLoads(loads: readonly InternalBayLoad[] = [], destroyed: readonly InternalBayLoad[] = []): readonly InternalBayLoad[] {
    if (!destroyed.length) return loads;
    return loads.flatMap(load => {
        const loss = destroyed.find(hit => sameBayLoad(load, hit));
        if (!loss) return [load];
        return 'cargo' in load && loss.tons < load.tons ? [{ ...load, tons: load.tons - loss.tons }] : [];
    });
}

function sameBayLoad(a: InternalBayLoad, b: InternalBayLoad): boolean {
    return a.bay === b.bay && ('unitId' in a ? 'unitId' in b && a.unitId === b.unitId : 'cargo' in b && a.cargo === b.cargo);
}

/** Accumulate only losses still aboard; multiple criticals can consume portions of the same cargo. */
export function accumulateBayLosses(aboard: readonly InternalBayLoad[], pending: readonly InternalBayLoad[],
    losses: readonly InternalBayLoad[]): readonly InternalBayLoad[] | null {
    const available = remainingInternalBayLoads(aboard, pending);
    const combined = [...pending];
    for (const loss of readInternalBayLoads(losses)) {
        const load = available.find(candidate => sameBayLoad(candidate, loss));
        if (!load || loss.tons > load.tons || ('unitId' in loss && loss.tons !== load.tons)) return null;
        const existing = combined.findIndex(candidate => sameBayLoad(candidate, loss));
        if (existing < 0) combined.push(loss);
        else combined[existing] = { ...loss, tons: combined[existing].tons + loss.tons };
    }
    return combined;
}

export function internalCargoBays(entity: BaseEntity) {
    return entity.transporters().flatMap(t => {
        if (t.kind === 'troop-space') return [{ id: t.id, label: 'Infantry compartment', troops: true, cargo: false, capacity: t.totalSpace, byTons: true, suitBerths: false }];
        if (t.kind !== 'bay') return [];
        const cargo = t.configuration.type.includes('cargo');
        const troops = cargo || t.configuration.type === 'infantry' || t.configuration.type === 'battle-armor';
        const unitBay = isAeroEntity(entity) && ['mek', 'light-vehicle', 'heavy-vehicle', 'super-heavy-vehicle',
            'protomek', 'fighter', 'small-craft', 'drop-shuttle'].includes(t.configuration.type);
        return troops || unitBay ? [{ id: t.id, label: getBayTransporterType(t.configuration), troops: troops || unitBay, cargo,
            capacity: t.configuration.type === 'protomek' ? t.capacity * 5 : t.capacity, byTons: cargo || t.configuration.type === 'infantry', suitBerths: t.configuration.type === 'battle-armor' }] : [];
    });
}

export function usedBayCapacity(bay: ReturnType<typeof internalCargoBays>[number], loads: readonly InternalBayLoad[]): number {
    return loads.filter(load => load.bay === bay.id).reduce((sum, load) => {
        if ('unitId' in load && (bay.byTons || bay.suitBerths) && load.spaces !== undefined) return sum + load.spaces;
        return sum + (bay.byTons ? load.tons : 1);
    }, 0);
}

/** TW pp. 89, 213–214 and TechManual p. 240 distinguish cargo tonnage from troop accommodation. */
export function internalPassengerLoad(carrier: BaseEntity, bayId: string, passenger: BaseEntity, unitId: string): InternalBayLoad {
    const bay = carrier.transporters().find(t => t.id === bayId);
    const kind = bay?.kind === 'bay' ? bay.configuration : null;
    const tons = passenger.tonnage();
    if (isBattleArmorEntity(passenger)) {
        const suits = passenger.squadSize() * passenger.squadCount();
        if (kind?.type === 'battle-armor') {
            const berths = kind.comStar ? 6 : kind.techBase === 'Clan' ? 5 : 4;
            return { bay: bayId, unitId, tons, spaces: suits / berths };
        }
        return { bay: bayId, unitId, tons, spaces: suits };
    }
    if (isInfantryEntity(passenger)) {
        const mode = passenger.motiveType();
        if (kind?.type === 'infantry') {
            const type = passenger.isMechanized() ? 'Mechanized' : mode === 'Jump' || mode === 'Motorized' ? mode : 'Foot';
            const spaces = type === 'Mechanized' ? INFANTRY_TRANSPORT_WEIGHTS.Mechanized * passenger.squadCount()
                : INFANTRY_TRANSPORT_WEIGHTS[type] * Math.ceil(passenger.squadSize() * passenger.squadCount() / 30);
            return { bay: bayId, unitId, tons, spaces };
        }
        // The TW generic platoons have fixed transport tonnages; custom formations carry their design tonnage.
        const generic: Partial<Record<typeof mode, readonly [string, number]>> = {
            Leg: ['Foot', 3], Jump: ['Jump', 4], Motorized: ['Motorized', 6],
            Hover: ['Mechanized Hover', 20], Wheeled: ['Mechanized Wheeled', 24], Tracked: ['Mechanized Tracked', 28],
        };
        const platoon = generic[mode];
        const chassis = passenger.chassis();
        const listed = platoon && (chassis === platoon[0] + ' Platoon' || chassis === 'Clan ' + platoon[0] + ' Point')
            && /^\((?:Rifle|Laser|MG|SRM|LRM|Flamer)\)$/u.test(passenger.model());
        return { bay: bayId, unitId, tons, spaces: listed ? platoon[1] : tons };
    }
    return { bay: bayId, unitId, tons };
}

/** Legacy manifests stored design tons alone; retain that recorded weight and recover the accommodation from the passenger. */
export function hydrateInternalPassengerSpaces(carrier: BaseEntity, loads: readonly InternalBayLoad[],
    resolvePassenger: (id: string) => BaseEntity | undefined): readonly InternalBayLoad[] {
    let updated: InternalBayLoad[] | undefined;
    loads.forEach((load, index) => {
        if (!('unitId' in load) || load.spaces !== undefined) return;
        const passenger = resolvePassenger(load.unitId);
        if (!passenger || !isInfantryFamilyEntity(passenger) || !internalBayAccepts(carrier, load.bay, passenger)) return;
        const resolved = internalPassengerLoad(carrier, load.bay, passenger, load.unitId);
        if (!('unitId' in resolved) || resolved.spaces === undefined || !(resolved.spaces > 0 && Number.isFinite(resolved.spaces))) return;
        updated ??= [...loads];
        updated[index] = { ...load, spaces: resolved.spaces };
    });
    return updated ?? loads;
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
        if (row.spaces !== undefined && (typeof row.unitId !== 'string' || !Number.isFinite(row.spaces) || row.spaces <= 0)) throw new Error('Invalid passenger space');
        const load = typeof row.unitId === 'string'
            ? { bay: row.bay, unitId: row.unitId, tons: row.tons, ...(row.spaces === undefined ? {} : { spaces: row.spaces }) } : { bay: row.bay, cargo: row.cargo, tons: row.tons };
        const id = row.unitId !== undefined ? 'unit:' + row.unitId : JSON.stringify([row.bay, row.cargo]);
        if (!(row.unitId ?? row.cargo).trim() || seen.has(id)) throw new Error('Empty or duplicate internal bay load');
        seen.add(id);
        return Object.freeze(load);
    }));
}
