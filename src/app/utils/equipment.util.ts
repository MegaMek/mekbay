// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake


import { AmmoEquipment, type AmmoCategory, type Equipment } from '../models/equipment.model';
import type { UnitComponent } from '../models/unit-summary.model';

export const weaponTypes: Array<{ code: string, color: string, name: string, img: string }> = [
    { code: 'B', color: '#9482B4', name: 'Ballistic', img: '/images/ballistic.svg' },
    { code: 'E', color: '#6082F6', name: 'Energy', img: '/images/energy.svg' },
    { code: 'M', color: '#86C86E', name: 'Missile', img: '/images/missile.svg' },
    { code: 'A', color: '#A35958', name: 'Artillery', img: '/images/artillery.svg' },
    { code: 'P', color: '#c2c727', name: 'Physical', img: '/images/physical.svg' },
    { code: 'O', color: '#d0a34f', name: 'Other', img: '/images/crate.svg' }
    ];

const AMMO_CATEGORY_CSS_CLASS: Record<AmmoCategory, string> = {
    Ballistic: 'ballistic',
    Missile: 'missile',
    Energy: 'energy',
    Artillery: 'artillery',
    Bomb: 'ammo-bomb',
    Chemical: 'ammo-chemical',
    Special: 'ammo-special'
};

export function getWeaponTypeCSSClass(typeCode: UnitComponent['t'] | '', equipment?: Equipment | null): string {
    if (typeCode === 'HIDDEN') return '';
    if (typeCode === 'C') return 'misc';
    if (typeCode === 'S') return 'structural';
    if (typeCode === 'X') return getAmmoTypeCSSClass(equipment);
    const found = weaponTypes.find(t => t.code === typeCode);
    return found ? found.name.toLowerCase() : 'other';
}

function getAmmoTypeCSSClass(equipment?: Equipment | null): string {
    const category = equipment instanceof AmmoEquipment ? equipment.category : 'Special';
    return `ammo ${AMMO_CATEGORY_CSS_CLASS[category]}`;
}
