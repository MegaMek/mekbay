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
// Vehicle-specific Types
// ============================================================================

// ── Suspension Factor Table ─────────────────────────────────────────────────

export const SUSPENSION_FACTOR_TABLE: Record<string, (tonnage: number) => number> = {
  'Tracked':   (_t: number) => 0,
  'Wheeled':   (t: number) => t <= 80 ? 20 : 40,
  'Hover':     (t: number) => t <= 10 ? 40 : t <= 20 ? 85 : t <= 30 ? 130 : t <= 40 ? 175 : 220,
  'Naval':     (_t: number) => 30,
  'Submarine': (_t: number) => 35,
  'Hydrofoil': (_t: number) => 60,
  'WiGE':      (t: number) => t <= 80 ? 45 : 80,
  'VTOL':      (t: number) => t <= 10 ? 50 : t <= 20 ? 95 : t <= 30 ? 140 : 140,
};
