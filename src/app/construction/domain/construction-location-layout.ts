// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { AeroEntity } from '../../models/entity/entities/aero/aero-entity';
import { SmallCraftEntity } from '../../models/entity/entities/aero/small-craft-entity';
import { JumpShipEntity } from '../../models/entity/entities/largecraft/jumpship-entity';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { VehicleEntity } from '../../models/entity/entities/vehicle/vehicle-entity';
import { mekCriticalLocationMatrix } from '../../utils/mek-location-layout.util';

export type ConstructionLocationColumns = readonly (readonly string[])[];

export interface ConstructionLocationLayout {
    readonly kind: 'mek' | 'matrix' | 'list';
    readonly desktopColumns: ConstructionLocationColumns;
    readonly compactColumns: ConstructionLocationColumns;
}

// These use the native location IDs, including equipment-only Body/Hull/Wings.
// Unlike the details dialog's occupied-component matrix, empty locations keep
// their assigned columns. Only locations absent from this chassis are omitted.
const VEHICLE_COLUMNS: ConstructionLocationColumns = [
    ['Right', 'Front Right', 'Rear Right'],
    ['Front', 'Rotor', 'Front Turret', 'Turret', 'Body', 'Rear Turret', 'Rear'],
    ['Left', 'Front Left', 'Rear Left'],
];
const FIGHTER_COLUMNS: ConstructionLocationColumns = [
    ['Left Wing'],
    ['Nose', 'Fuselage', 'Body', 'Wings', 'Aft'],
    ['Right Wing'],
];
const SMALL_CRAFT_COLUMNS: ConstructionLocationColumns = [
    ['Left Side'], ['Nose', 'Hull', 'Aft'], ['Right Side'],
];
const CAPITAL_CRAFT_COLUMNS: ConstructionLocationColumns = [
    ['FLS', 'Left Broadside', 'ALS'],
    ['Nose', 'Hull', 'Aft'],
    ['FRS', 'Right Broadside', 'ARS'],
];

/** Fixed construction geometry; card heights may vary independently within each column. */
export function constructionLocationLayout(entity: BaseEntity): ConstructionLocationLayout {
    const locations = [...new Set([...entity.locationOrder, ...entity.validLocations])];
    if (entity instanceof MekEntity) {
        const matrix = mekCriticalLocationMatrix(entity.chassisConfig);
        const compact = [0, 1, 2].map(column => matrix.map(row => row[column])
            .filter((location): location is NonNullable<typeof location> => location !== null));
        const desktop = [
            [matrix[0][0]], [matrix[1][0], matrix[2][0]],
            [matrix[0][1], matrix[1][1], matrix[2][1]],
            [matrix[1][2], matrix[2][2]], [matrix[0][2]],
        ].map(column => column.filter((location): location is NonNullable<typeof location> => location !== null));
        return { kind: 'mek', desktopColumns: fitLocations(desktop, locations), compactColumns: fitLocations(compact, locations) };
    }
    const columns = entity instanceof VehicleEntity ? VEHICLE_COLUMNS
        : entity instanceof JumpShipEntity ? CAPITAL_CRAFT_COLUMNS
        : entity instanceof SmallCraftEntity ? SMALL_CRAFT_COLUMNS
        : entity instanceof AeroEntity ? FIGHTER_COLUMNS
        : undefined;
    if (columns) {
        const fixed = fitLocations(columns, locations);
        return { kind: 'matrix', desktopColumns: fixed, compactColumns: fixed };
    }
    // Infantry, BA troopers, ProtoMek hit locations and emplacement sections
    // have list-based sheet layouts rather than a fixed critical-location matrix.
    return { kind: 'list', desktopColumns: [locations], compactColumns: [locations] };
}

function fitLocations(columns: ConstructionLocationColumns, locations: readonly string[]): ConstructionLocationColumns {
    const available = new Set(locations);
    const placed = new Set(columns.flat());
    return columns.map((column, index) => [
        ...column.filter(location => available.has(location)),
        // Keep any newly modeled native location editable without reflowing
        // established panels; center-column additions retain native order.
        ...(index === Math.floor(columns.length / 2) ? locations.filter(location => !placed.has(location)) : []),
    ]);
}
