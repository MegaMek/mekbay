/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

/*
 * Author: Drake
 */
export const weaponTypes: Array<{ code: string, color: string, name: string, img: string }> = [
    { code: 'B', color: '#9482B4', name: 'Ballistic', img: '/images/ballistic.svg' },
    { code: 'E', color: '#6082F6', name: 'Energy', img: '/images/energy.svg' },
    { code: 'M', color: '#86C86E', name: 'Missile', img: '/images/missile.svg' },
    { code: 'A', color: '#A35958', name: 'Artillery', img: '/images/artillery.svg' },
    { code: 'P', color: '#c2c727', name: 'Physical', img: '/images/physical.svg' },
    { code: 'O', color: '#d0a34f', name: 'Other', img: '/images/crate.svg' }
    ];

export function getWeaponTypeCSSClass(typeCode: string): string {
    if (typeCode === 'HIDDEN') return '';
    if (typeCode === 'X') return 'ammo'; // We don't have it in the list above, maybe should be added?
    const found = weaponTypes.find(t => t.code === typeCode);
    return found ? found.name.toLowerCase() : 'other';
}