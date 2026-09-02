// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentInteractionRegistry } from '../../services/equipment-interaction-registry.service';
import { ApolloHandler } from './component-apollo';
import { EquipmentPowerHandler } from './component-equipment-power';
import { MobileHpgHandler } from './component-mobile-hpg';
import { BoobyTrapHandler } from './component-booby-trap';
import { BombastLaserHandler, TwBombastLaserHandler } from './component-bombast-laser';
import { C3Handler } from './component-c3-configuration';
import { C3EmergencyMasterHandler } from './component-c3-emergency-master';
import { ECMHandler } from './component-ecm-mode';
import { EscalatingFailureHandler } from './component-escalating-failure';
import { FlamerHandler } from './component-flamer';
import { HagHandler } from './component-hag-mode';
import { InventoryModeHandler } from './component-inventory-mode';
import { MachineGunArrayHandler } from './component-machine-gun-array';
import { ShieldModeHandler } from './component-shield-mode';
import { CoolantPodHandler } from './component-coolant-pod';
import { PpcCapacitorHandler } from './component-ppc-capacitor';
import { UACFiringModeHandler, UACJammingHandler } from './component-rapid-fire-autocannon';
import { RiscLaserPulseModuleHandler } from './component-risc-laser-pulse';
import { StealthHandler } from './component-stealth';
import { VibrobladeHandler } from './component-vibroblade';
import { GaussPowerHandler } from './mek-gauss-power';

/** The only composition root. Feature behavior remains in each equipment-owned module. */
export function registerAllEquipmentBehaviors(
    registry: EquipmentInteractionRegistry,
): void {
    for (const behavior of [
        new BoobyTrapHandler(),
        new ECMHandler(),
        new EquipmentPowerHandler(),
        new MobileHpgHandler(),
        new GaussPowerHandler(),
        new StealthHandler(),
        new MachineGunArrayHandler(),
        new ShieldModeHandler(),
        new CoolantPodHandler(),
        new InventoryModeHandler(),
        new ApolloHandler(),
        new VibrobladeHandler(),
        new RiscLaserPulseModuleHandler(),
        new HagHandler(),
        new EscalatingFailureHandler(),
        new C3EmergencyMasterHandler(),
        new C3Handler(),
        new PpcCapacitorHandler(),
        new BombastLaserHandler(),
        new TwBombastLaserHandler(),
        new FlamerHandler(),
        new UACFiringModeHandler(),
        new UACJammingHandler(),
    ]) registry.register(behavior);
}
