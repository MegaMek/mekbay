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

export enum GameSystem {
    CLASSIC = 'cbt',
    ALPHA_STRIKE = 'as'
}

export type TechBase = 'Inner Sphere' | 'Clan' | 'Mixed';

export enum ECMMode {
    ECM = 'ecm',
    ECCM = 'eccm',
    GHOST = 'ghost',
    ECM_ECCM = 'ecm-eccm',
    ECM_GHOST = 'ecm-ghost',
    ECCM_GHOST = 'eccm-ghost',
    OFF = 'off'
}

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
export const REMOTE_HOST = 'https://db.mekbay.com';

// BT heatscale colors configuration
export const heatLevels = [
    { min: 0, max: 0, class: 'heat0', color: '#FFFFFF', nightColor: '#000000' },
    { min: 1, max: 1, class: 'heat1', color: '#FFFFEE', nightColor: '#090900' },
    { min: 2, max: 2, class: 'heat2', color: '#FFFFDD', nightColor: '#121200' },
    { min: 3, max: 3, class: 'heat3', color: '#FFFFCC', nightColor: '#1B1B00' },
    { min: 4, max: 4, class: 'heat4', color: '#FFFFBB', nightColor: '#242400' },
    { min: 5, max: 5, class: 'heat5', color: '#FFFFAA', nightColor: '#2D2D00' },
    { min: 6, max: 6, class: 'heat6', color: '#FFFF99', nightColor: '#363600' },
    { min: 7, max: 7, class: 'heat7', color: '#FFFF88', nightColor: '#3F3F00' },
    { min: 8, max: 8, class: 'heat8', color: '#FFFF77', nightColor: '#484800' },
    { min: 9, max: 9, class: 'heat9', color: '#FFFF66', nightColor: '#515100' },
    { min: 10, max: 10, class: 'heat10', color: '#FFFF55', nightColor: '#5A5A00' },
    { min: 11, max: 11, class: 'heat11', color: '#FFFF44', nightColor: '#636300' },
    { min: 12, max: 12, class: 'heat12', color: '#FFFF33', nightColor: '#6C6C00' },
    { min: 13, max: 13, class: 'heat13', color: '#FFFF22', nightColor: '#757500' },
    { min: 14, max: 14, class: 'heat14', color: '#FFFF11', nightColor: '#7F7F00' },
    { min: 15, max: 15, class: 'heat15', color: '#FFFF00', nightColor: '#888800' },
    { min: 16, max: 16, class: 'heat16', color: '#FFEE00', nightColor: '#907F00' },
    { min: 17, max: 17, class: 'heat17', color: '#FFDD00', nightColor: '#987600' },
    { min: 18, max: 18, class: 'heat18', color: '#FFCC00', nightColor: '#A06D00' },
    { min: 19, max: 19, class: 'heat19', color: '#FFBB00', nightColor: '#A86400' },
    { min: 20, max: 20, class: 'heat20', color: '#FFAA00', nightColor: '#B05B00' },
    { min: 21, max: 21, class: 'heat21', color: '#FF9900', nightColor: '#B85200' },
    { min: 22, max: 22, class: 'heat22', color: '#FF8800', nightColor: '#C04900' },
    { min: 23, max: 23, class: 'heat23', color: '#FF7700', nightColor: '#C84000' },
    { min: 24, max: 24, class: 'heat24', color: '#FF6600', nightColor: '#D03700' },
    { min: 25, max: 25, class: 'heat25', color: '#FF5500', nightColor: '#D82E00' },
    { min: 26, max: 26, class: 'heat26', color: '#FF4400', nightColor: '#E02500' },
    { min: 27, max: 27, class: 'heat27', color: '#FF3300', nightColor: '#E81C00' },
    { min: 28, max: 28, class: 'heat28', color: '#FF2200', nightColor: '#F01300' },
    { min: 29, max: 29, class: 'heat29', color: '#FF1100', nightColor: '#F80A00' },
    { min: 30, max: Infinity, class: 'heat30', color: '#FF0000', nightColor: '#FF0000' }
  ];

export const uidTranslations: { [key: string]: string } = {
        'Engine': 'engine_hit_',
        'Gyro': 'gyro_hit_',
        'Sensors': 'sensor_hit_',
        'Life Support': 'life_support_hit_',
        'Avionics': 'avionics_hit_',
        'Landing Gear': 'landing_gear_hit_',
        'Cockpit': 'cockpit_hit_',
    };
    

export const linkedLocs: { [key: string]: string[] } = {
    'RT': ['RA'],
    'LT': ['LA'],
};

export const LEG_LOCATIONS = new Set(['LL', 'RL', 'CL', 'FRL', 'FLL', 'RRL', 'RLL']);
export const FOUR_LEGGED_LOCATIONS = new Set(['FRL', 'FLL', 'RRL', 'RLL']);