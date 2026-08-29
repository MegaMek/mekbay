// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentInteractionRegistryService } from '../services/equipment-interaction-registry.service';
import { ApolloHandler } from './apollo.handler';
import { ArtemisVHandler } from './artemis-v.handler';
import { AtmHandler } from './atm.handler';
import { BAPHandler } from './bap.handler';
import { BlueShieldHandler } from './blue-shield.handler';
import { BoobyTrapHandler } from './booby-trap.handler';
import { BombastLaserHandler } from './bombast-laser.handler';
import { C3EmergencyMasterHandler } from './c3-emergency-master.handler';
import { C3Handler } from './c3.handler';
import { CoolantPodHandler } from './coolant-pod.handler';
import { ECMHandler } from './ecm.handler';
import { EquipmentPowerHandler } from './equipment-power.handler';
import { FlamerHandler } from './flamer.handler';
import { GaussPowerHandler } from './gauss-power.handler';
import { HagHandler } from './hag.handler';
import { InventoryModeHandler } from './inventory-mode.handler';
import { LaserInsulatorHandler } from './laser-insulator.handler';
import { MascHandler } from './masc.handler';
import { MobileHpgHandler } from './mobile-hpg.handler';
import { MgaActivationHandler } from './mga-activation.handler';
import { MmlHandler } from './mml.handler';
import { NovaCewsHandler } from './nova-cews.handler';
import { PpcCapacitorHandler } from './ppc-capacitor.handler';
import { PrecisionAmmoHandler } from './precision-ammo.handler';
import { PrototypeLaserHandler } from './prototype-laser.handler';
import { RadicalHeatSinkHandler } from './radical-heat-sink.handler';
import { RiscEmergencyCoolantSystemHandler } from './risc-emergency-coolant-system.handler';
import { RiscLaserPulseModuleHandler } from './risc-laser-pulse-module.handler';
import { RiscViralJammerHandler } from './risc-viral-jammer.handler';
import { SearchlightHandler } from './searchlight.handler';
import { ShieldModeHandler } from './shield-mode.handler';
import { StealthHandler } from './stealth.handler';
import { SpotWelderHandler } from './spot-welder.handler';
import { TwBombastLaserHandler } from './tw-bombast-laser.handler';
import { UACFiringModeHandler } from './uac-firing-mode.handler';
import { UACJammingHandler } from './uacjamming.handler';
import { VibrobladeHandler } from './vibroblade.handler';

/**
 * Register all equipment handlers.
 * This is called during app initialization to ensure all handlers are available.
 */
export function registerAllHandlers(registryService: EquipmentInteractionRegistryService): void {
    const registry = registryService.getRegistry();

    // Register all handlers
    registry.register(new ApolloHandler());
    registry.register(new ArtemisVHandler());
    registry.register(new AtmHandler());
    registry.register(new BAPHandler());
    registry.register(new BlueShieldHandler());
    registry.register(new BoobyTrapHandler());
    registry.register(new BombastLaserHandler());
    registry.register(new C3EmergencyMasterHandler());
    registry.register(new C3Handler());
    registry.register(new CoolantPodHandler());
    registry.register(new ECMHandler());
    registry.register(new EquipmentPowerHandler());
    registry.register(new FlamerHandler());
    registry.register(new GaussPowerHandler());
    registry.register(new HagHandler());
    registry.register(new InventoryModeHandler());
    registry.register(new LaserInsulatorHandler());
    registry.register(new MascHandler());
    registry.register(new MobileHpgHandler());
    registry.register(new MgaActivationHandler());
    registry.register(new MmlHandler());
    registry.register(new NovaCewsHandler());
    registry.register(new PpcCapacitorHandler());
    registry.register(new PrecisionAmmoHandler());
    registry.register(new PrototypeLaserHandler());
    registry.register(new RadicalHeatSinkHandler());
    registry.register(new RiscEmergencyCoolantSystemHandler());
    registry.register(new RiscLaserPulseModuleHandler());
    registry.register(new RiscViralJammerHandler());
    registry.register(new SearchlightHandler());
    registry.register(new ShieldModeHandler());
    registry.register(new StealthHandler());
    registry.register(new SpotWelderHandler());
    registry.register(new TwBombastLaserHandler());
    registry.register(new UACFiringModeHandler());
    registry.register(new UACJammingHandler());
    registry.register(new VibrobladeHandler());
    // registry.register(new WeaponAmmoHandler()); // TODO: is a bit annoying
}
