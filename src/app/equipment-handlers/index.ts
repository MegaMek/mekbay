// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentInteractionRegistryService } from '../services/equipment-interaction-registry.service';
import { ECMHandler } from './ecm.handler';
import { BAPHandler } from './bap.handler';
import { GaussPowerHandler } from './gauss-power.handler';
import { StealthHandler } from './stealth.handler';
import { UACJammingHandler } from './uacjamming.handler';
import { UACFiringModeHandler } from './uac-firing-mode.handler';
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
import { RadicalHeatSinkHandler } from './radical-heat-sink.handler';
import { BlueShieldHandler } from './blue-shield.handler';
import { RiscEmergencyCoolantSystemHandler } from './risc-emergency-coolant-system.handler';
import { RiscViralJammerHandler } from './risc-viral-jammer.handler';
import { VibrobladeHandler } from './vibroblade.handler';
import { BombastLaserHandler } from './bombast-laser.handler';
import { TwBombastLaserHandler } from './tw-bombast-laser.handler';
import { C3EmergencyMasterHandler } from './c3-emergency-master.handler';
import { FlamerHandler } from './flamer.handler';
import { PrecisionAmmoHandler } from './precision-ammo.handler';

/**
 * Register all equipment handlers.
 * This is called during app initialization to ensure all handlers are available.
 */
export function registerAllHandlers(registryService: EquipmentInteractionRegistryService): void {
    const registry = registryService.getRegistry();
    
    // Register all handlers
    registry.register(new ECMHandler());
    registry.register(new BAPHandler());
    registry.register(new GaussPowerHandler());
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
    registry.register(new RadicalHeatSinkHandler());
    registry.register(new BlueShieldHandler());
    registry.register(new RiscEmergencyCoolantSystemHandler());
    registry.register(new RiscViralJammerHandler());
    registry.register(new C3EmergencyMasterHandler());
    registry.register(new PpcCapacitorHandler());
    registry.register(new BombastLaserHandler());
    registry.register(new TwBombastLaserHandler());
    registry.register(new FlamerHandler());
    registry.register(new PrecisionAmmoHandler());
    registry.register(new UACFiringModeHandler());
    registry.register(new UACJammingHandler());
    registry.register(new C3Handler());
    // registry.register(new WeaponAmmoHandler()); // TODO: is a bit annoying
}
