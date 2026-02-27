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

// ============================================================================
// Infantry Specializations
// ============================================================================

export type InfantrySpecialization =
  | 'bridge-engineers' | 'demo-engineers' | 'fire-engineers' | 'mine-engineers'
  | 'sensor-engineers' | 'trench-engineers' | 'marines' | 'mountain-troops'
  | 'paramedics' | 'paratroops' | 'tag-troops' | 'xct' | 'scuba';

export const INFANTRY_SPECIALIZATION_FROM_BIT: Record<number, InfantrySpecialization> = {
  0: 'bridge-engineers', 1: 'demo-engineers', 2: 'fire-engineers',
  3: 'mine-engineers', 4: 'sensor-engineers', 5: 'trench-engineers',
  6: 'marines', 7: 'mountain-troops', 8: 'paramedics',
  9: 'paratroops', 10: 'tag-troops', 11: 'xct', 12: 'scuba',
};

export const INFANTRY_SPECIALIZATION_TO_BIT: Record<InfantrySpecialization, number> = {
  'bridge-engineers': 0, 'demo-engineers': 1, 'fire-engineers': 2,
  'mine-engineers': 3, 'sensor-engineers': 4, 'trench-engineers': 5,
  'marines': 6, 'mountain-troops': 7, 'paramedics': 8,
  'paratroops': 9, 'tag-troops': 10, 'xct': 11, 'scuba': 12,
};
