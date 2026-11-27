// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { StaticEmplacementEntity } from '../models/entity/entities/misc/static-emplacement-entity';
import { buildingHexKey, parseBuildingLocation, type BuildingHex } from '../models/entity/types/building';
import { buildingElevatorRange, buildingRoofFacility } from '../models/entity/utils/building-construction';
import { buildingLinkedDoorGeometry, type BuildingDoorGeometry } from '../models/entity/utils/building-doors';

export const BUILDING_MAP_KEY = {
    bay: { label: 'Bay / quarters', color: '#f3b0b4', glyph: 'B' },
    elevator: { label: 'Elevator', color: '#efcb8d', glyph: 'E' },
    deck: { label: 'Roof facility', color: '#b5d1bf', glyph: 'D' },
    turret: { label: 'Roof turret', color: '#aca6d2', glyph: 'T' },
    door: { label: 'Door', color: '#fff', glyph: '' },
    'large-door': { label: 'Large Door', color: '#fff', glyph: '' },
    'elevator-door': { label: 'Elevator door', color: '#efcb8d', glyph: '' },
};
export type BuildingMapSymbol = keyof typeof BUILDING_MAP_KEY;

/** Editor labels only; the entity's display grid remains the source for printed sheet coordinates. */
export function buildingMapHexLabel(entity: StaticEmplacementEntity, hex: BuildingHex, absolute: boolean): string {
    return absolute ? buildingHexKey(hex) : entity.displayHex(hex);
}

export function buildingMapLocationLabel(entity: StaticEmplacementEntity, location: string, absolute: boolean, compact = false): string {
    const position = absolute ? parseBuildingLocation(location) : null;
    if (!position) return entity.displayLocation(location, compact);
    const floor = entity.isBridge() ? entity.deckLevel(position.hex) : position.floor;
    return `${buildingMapHexLabel(entity, position.hex, true)}/${entity.levelLabel(floor, compact)}`;
}

export function buildingMapFeatures(entity: StaticEmplacementEntity, hex: BuildingHex, level: number): BuildingMapSymbol[] {
    const key = buildingHexKey(hex), features: BuildingMapSymbol[] = [];
    if (entity.transporters().some(bay => bay.kind === 'bay' && entity.baySpaces(bay).some(space =>
        space.tons > 0 && buildingHexKey(space.position.hex) === key && space.position.floor === level))) features.push('bay');
    if (entity.elevators().some(lift => buildingHexKey(lift.hex) === key
        && level >= buildingElevatorRange(lift)[0] && level <= buildingElevatorRange(lift)[1])) features.push('elevator');
    const mounts = entity.getEquipmentInHex(hex);
    if (level === entity.hexHeight(hex) - 1) {
        if (mounts.some(mount => buildingRoofFacility(mount.equipment))) features.push('deck');
        if (mounts.some(mount => mount.turretType === 'sponson')) features.push('turret');
    }
    for (const door of buildingMapDoors(entity, hex, level)) {
        const symbol = door.geometry ? 'large-door' : door.symbol;
        if (!features.includes(symbol)) features.push(symbol);
    }
    return features;
}

/** Door markers on this level, including each configured elevator access side. */
export function buildingMapDoors(entity: StaticEmplacementEntity, hex: BuildingHex, level: number, visibleHexes?: ReadonlySet<string>) {
    const key = buildingHexKey(hex);
    const linked = buildingLinkedDoorGeometry(entity.doors(), door => !visibleHexes || visibleHexes.has(buildingHexKey(door.position.hex)));
    const doors: { facing: number; symbol: 'door' | 'elevator-door'; geometry?: BuildingDoorGeometry }[] = entity.mapDoors()
        .filter(door => buildingHexKey(door.position.hex) === key
            && level >= door.position.floor && level < door.position.floor + door.height)
        .map(door => ({ facing: door.facing, symbol: 'door', geometry: linked.get(door) }));
    const access = entity.elevators().filter(lift => buildingHexKey(lift.hex) === key)
        .reduce((mask, lift) => mask | (lift.exits.get(level) ?? 0), 0);
    for (let facing = 0; facing < 6; facing++) {
        if (access & (1 << facing)) doors.push({ facing, symbol: 'elevator-door' });
    }
    return doors;
}

/** Center the triangle on its hexside, then apply the hex's shear and vertical compression. */
export function buildingDoorPoints(a: readonly number[], b: readonly number[]): readonly (readonly [number, number])[] {
    const dx = (a[0] + b[0]) / 2, dy = (a[1] + b[1]) / 2;
    return [[dx * 1.3, dy * 1.3], [dx * .85 - (b[0] - a[0]) * .18, dy * .85 - (b[1] - a[1]) * .18],
        [dx * .85 + (b[0] - a[0]) * .18, dy * .85 + (b[1] - a[1]) * .18]];
}

export function buildingMapFill(features: readonly BuildingMapSymbol[]): string | undefined {
    const feature = (['elevator', 'bay', 'deck', 'turret'] as const).find(symbol => features.includes(symbol));
    return feature ? BUILDING_MAP_KEY[feature].color : undefined;
}
