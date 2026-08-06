// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentInteractionRegistryService } from '../services/equipment-interaction-registry.service';
import { ECMHandler } from './ecm.handler';
import { BAPHandler } from './bap.handler';
import { StealthHandler } from './stealth.handler';
import { UACJammingHandler } from './uacjamming.handler';
import { C3Handler } from './c3.handler';
import { InventoryModeHandler } from './inventory-mode.handler';
import { PpcCapacitorHandler } from './ppc-capacitor.handler';
import { MmlHandler } from './mml.handler';
import { AtmHandler } from './atm.handler';
import { ArtemisVHandler } from './artemis-v.handler';
import { ApolloHandler } from './apollo.handler';
import { LaserInsulatorHandler } from './laser-insulator.handler';
import { RiscLaserPulseModuleHandler } from './risc-laser-pulse-module.handler';
import { HagHandler } from './hag.handler';
import { MascHandler } from './masc.handler';
import { DisabledEquipmentHandler } from './disabled-equipment.handler';
import { VibrobladeHandler } from './vibroblade.handler';
import { BombastLaserHandler } from './bombast-laser.handler';
import { C3EmergencyMasterHandler } from './c3-emergency-master.handler';

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
    registry.register(new InventoryModeHandler());
    registry.register(new MmlHandler());
    registry.register(new AtmHandler());
    registry.register(new ArtemisVHandler());
    registry.register(new ApolloHandler());
    registry.register(new VibrobladeHandler());
    registry.register(new LaserInsulatorHandler());
    registry.register(new RiscLaserPulseModuleHandler());
    registry.register(new HagHandler());
    registry.register(new MascHandler());
    registry.register(new C3EmergencyMasterHandler());
    registry.register(new DisabledEquipmentHandler());
    registry.register(new PpcCapacitorHandler());
    registry.register(new BombastLaserHandler());
    registry.register(new UACJammingHandler());
    registry.register(new C3Handler());
    // registry.register(new WeaponAmmoHandler()); // TODO: is a bit annoying
}