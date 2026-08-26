// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentInteractionRegistryService } from '../../services/equipment-interaction-registry.service';
import { ApolloHandler } from './component-apollo';
import { BAPHandler } from './component-bap';
import { BombastLaserHandler, TwBombastLaserHandler } from './component-bombast-laser';
import { C3Handler } from './component-c3-configuration';
import { C3EmergencyMasterHandler } from './component-c3-emergency-master';
import { ECMHandler } from './component-ecm-mode';
import {
    BlueShieldHandler,
    MascHandler,
    RadicalHeatSinkHandler,
    RiscEmergencyCoolantSystemHandler,
    RiscViralJammerHandler,
} from './component-escalating-failure';
import { FlamerHandler } from './component-flamer';
import { HagHandler } from './component-hag-mode';
import { InventoryModeHandler } from './component-inventory-mode';
import { PpcCapacitorHandler } from './component-ppc-capacitor';
import { UACFiringModeHandler, UACJammingHandler } from './component-rapid-fire-autocannon';
import { RiscLaserPulseModuleHandler } from './component-risc-laser-pulse';
import { StealthHandler } from './component-stealth';
import { VibrobladeHandler } from './component-vibroblade';
import { GaussPowerHandler } from './mek-gauss-power';
import type { EquipmentInteractionHandler } from './equipment-interaction';

/** The only composition root. Feature behavior remains in each equipment-owned module. */
export function createEquipmentInteractionHandlers(): readonly EquipmentInteractionHandler[] {
    return Object.freeze([
        new ECMHandler(),
        new BAPHandler(),
        new GaussPowerHandler(),
        new StealthHandler(),
        new InventoryModeHandler(),
        new ApolloHandler(),
        new VibrobladeHandler(),
        new RiscLaserPulseModuleHandler(),
        new HagHandler(),
        new MascHandler(),
        new RadicalHeatSinkHandler(),
        new BlueShieldHandler(),
        new RiscEmergencyCoolantSystemHandler(),
        new RiscViralJammerHandler(),
        new C3EmergencyMasterHandler(),
        new C3Handler(),
        new PpcCapacitorHandler(),
        new BombastLaserHandler(),
        new TwBombastLaserHandler(),
        new FlamerHandler(),
        new UACFiringModeHandler(),
        new UACJammingHandler(),
    ]);
}

export function registerAllEquipmentBehaviors(
    registryService: EquipmentInteractionRegistryService,
): void {
    const registry = registryService.getRegistry();
    for (const behavior of createEquipmentInteractionHandlers()) registry.register(behavior);
}
