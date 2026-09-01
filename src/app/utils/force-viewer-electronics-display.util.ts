// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { WeaponEquipment } from '../models/equipment.model';
import { getEffectiveEcmMode, isEcmModeActive } from './ecm-state.util';

export interface TagDisplay {
    readonly label: 'TAG' | 'LTAG';
    readonly unavailable: boolean;
}

export interface EcmDisplay {
    readonly mode: string;
    readonly unavailable: boolean;
}

interface MountedSystemSelection {
    readonly mount: MountedEquipment;
    readonly unavailable: boolean;
}

function selectMountedSystem(
    unit: CBTForceUnit,
    mounts: readonly MountedEquipment[],
    preferred: (mount: MountedEquipment) => boolean = () => true,
): MountedSystemSelection | null {
    if (mounts.length === 0) return null;

    const available = mounts.filter(mount => unit.canPerformEquipmentAction(mount, 'activate'));
    const mount = available.find(preferred)
        ?? available[0]
        ?? mounts.find(preferred)
        ?? mounts[0];
    return { mount, unavailable: available.length === 0 };
}

function getTagLabel(mount: MountedEquipment): TagDisplay['label'] {
    if (mount.equipment instanceof WeaponEquipment && mount.equipment.ranges[0] > 0) {
        return mount.equipment.ranges[0] < 5 ? 'LTAG' : 'TAG';
    }

    const names = [
        mount.name,
        mount.equipment?.name,
        mount.equipment?.shortName,
        mount.equipment?.sortingName,
    ].filter((name): name is string => !!name);
    return names.some(name => /\blight\b/i.test(name)) ? 'LTAG' : 'TAG';
}

export function getTagDisplay(unit: ForceUnit | null | undefined): TagDisplay | null {
    if (unit instanceof ASForceUnit) {
        const specials = unit.getUnit().as.specials;
        if (specials.includes('TAG')) return { label: 'TAG', unavailable: false };
        if (specials.includes('LTAG')) return { label: 'LTAG', unavailable: false };
        return null;
    }
    if (!(unit instanceof CBTForceUnit)) return null;

    const selection = selectMountedSystem(unit, unit.getMountedEquipmentByFlag('F_TAG'));
    if (!selection) return null;
    return {
        label: getTagLabel(selection.mount),
        unavailable: selection.unavailable,
    };
}

export function getEcmDisplay(unit: ForceUnit | null | undefined): EcmDisplay | null {
    if (unit instanceof ASForceUnit) {
        const mode = unit.getUnit().as.specials.find(special => (
            special === 'ECM' || special === 'AECM' || special === 'LECM'
        ));
        return mode ? { mode, unavailable: false } : null;
    }
    if (!(unit instanceof CBTForceUnit)) return null;

    const selection = selectMountedSystem(
        unit,
        unit.getMountedEquipmentByFlag('F_ECM'),
        isEcmModeActive,
    );
    if (!selection) return null;
    return {
        mode: getEffectiveEcmMode(selection.mount),
        unavailable: selection.unavailable,
    };
}
