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

import { EquipmentInteractionRegistryService } from '../services/equipment-interaction-registry.service';
import { ECMHandler } from './ecm.handler';
import { BAPHandler } from './bap.handler';
import { StealthHandler } from './stealth.handler';
import { MASCHandler } from './masc.handler';
import { UACJammingHandler } from './uacjamming.handler';
import { C3Handler } from './c3.handler';

/**
 * Register all equipment handlers.
 * This is called during app initialization to ensure all handlers are available.
 */
export function registerAllHandlers(registryService: EquipmentInteractionRegistryService): void {
    const registry = registryService.getRegistry();
    
    // Register all handlers
    registry.register(new ECMHandler());
    registry.register(new BAPHandler());
    registry.register(new StealthHandler());
    registry.register(new MASCHandler());
    registry.register(new UACJammingHandler());
    registry.register(new C3Handler());
}