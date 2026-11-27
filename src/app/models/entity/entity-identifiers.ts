// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

declare const componentIdBrand: unique symbol;
declare const locationIdBrand: unique symbol;
declare const armorFaceIdBrand: unique symbol;
declare const criticalSlotIdBrand: unique symbol;
declare const systemDamageTrackIdBrand: unique symbol;
declare const crewPositionIdBrand: unique symbol;

export type ComponentId = string & { readonly [componentIdBrand]: true };
export type LocationId = string & { readonly [locationIdBrand]: true };
export type ArmorFaceId = string & { readonly [armorFaceIdBrand]: true };
export type CriticalSlotId = string & { readonly [criticalSlotIdBrand]: true };
export type SystemDamageTrackId = string & { readonly [systemDamageTrackIdBrand]: true };
export type CrewPositionId = string & { readonly [crewPositionIdBrand]: true };

export function asComponentId(value: string): ComponentId {
    return nonempty(value, 'component ID') as ComponentId;
}

export function asLocationId(value: string): LocationId {
    return nonempty(value, 'location ID') as LocationId;
}

export function asArmorFaceId(value: string): ArmorFaceId {
    return nonempty(value, 'armor-face ID') as ArmorFaceId;
}

export function asCriticalSlotId(value: string): CriticalSlotId {
    return nonempty(value, 'critical-slot ID') as CriticalSlotId;
}

export function asSystemDamageTrackId(value: string): SystemDamageTrackId {
    return nonempty(value, 'system-damage-track ID') as SystemDamageTrackId;
}

export function asCrewPositionId(value: string): CrewPositionId {
    return nonempty(value, 'crew-position ID') as CrewPositionId;
}

function nonempty(value: string, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
        throw new Error(`Invalid ${label}`);
    }
    return value;
}
