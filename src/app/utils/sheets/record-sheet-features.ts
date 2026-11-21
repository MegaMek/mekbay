// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isChassisSystemEquipment, isVstolEquipment } from '../../models/chassis-equipment.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import { getBayTransporterType } from '../../models/entity/bays/bay-definitions';
import { fireControlFeatureFromFlagLookup } from '../../models/entity/utils/fire-control';
import { formatNumber, formatRecordSheetTonnage } from './record-sheet-svg-rendering';

/**
 * The Features line of vehicle and aerospace sheets, in MegaMekLab's order: the cockpit, the chassis mods as one entry
 * ("Armored Chassis, Off-Road Chassis Mods"), VSTOL equipment, fire control, seats, then the infantry compartment.
 * Cargo prints in the sheet's Cargo block instead.
 */
export function recordSheetFeatures(entity: BaseEntity): string[] {
    const own = entity.entityFeatures();
    const vstol = own.includes('VSTOL Equipment');
    const features = own.filter(feature => !feature.startsWith('Bay: ') && feature !== 'Infantry Compartment'
        && !feature.startsWith('Chassis Mod: ') && feature !== 'VSTOL Equipment');
    // A VSTOL chassis mod prints as VSTOL equipment
    const modifications = [...new Set(entity.equipment()
        .filter(mount => isChassisSystemEquipment(mount.equipment) && !(vstol && isVstolEquipment(mount.equipment)))
        .map(mount => mount.equipment!.shortName))];
    if (modifications.length > 0) {
        features.push(`${modifications.join(', ')} Chassis ${modifications.length === 1 ? 'Mod' : 'Mods'}`);
    }
    if (vstol) features.push('VSTOL Equipment');
    const fireControl = fireControlFeatureFromFlagLookup(flag =>
        entity.equipment().some(mount => mount.equipment?.hasFlag(flag)));
    if (fireControl) features.push(fireControl);
    for (const type of ['standard-seats', 'pillion-seats', 'ejection-seats'] as const) {
        const seats = entity.transporters().reduce((sum, transporter) => sum + (transporter.kind === 'bay'
            && transporter.configuration.type === type ? Math.trunc(transporter.capacity) : 0), 0);
        if (seats === 0) continue;
        const name = getBayTransporterType({ type });
        features.push(`${formatNumber(seats)} ${seats === 1 ? name.replace('Seats', 'Seat') : name}`);
    }
    const troopSpace = entity.transporters()
        .filter(transporter => transporter.kind === 'troop-space')
        .reduce((sum, transporter) => sum + transporter.totalSpace, 0);
    if (troopSpace > 0) {
        // Small support vehicles weigh their equipment in kilograms
        const weight = entity.weightClass() === 'Small Support' ? formatRecordSheetTonnage(troopSpace, true)
            : `${formatNumber(troopSpace)} ${troopSpace === 1 ? 'ton' : 'tons'}`;
        features.push(`Infantry Compartment (${weight})`);
    }
    return features;
}
