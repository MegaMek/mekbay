// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import {
    bombastLaserEquipmentModes,
} from '../bombast-laser-mode.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import { mekRiscLaserPulseComponentModes } from './component-risc-laser-pulse';
import { flamerComponentModes } from '../flamer-mode.model';
import { vibrobladeComponentModes } from '../vibroblade-mode.model';
import { componentApolloModes } from './component-apollo';
import { inventoryEquipmentModes } from './component-inventory-mode';
import { hagEquipmentModes } from './component-hag-mode';
import { machineGunArrayComponentModes } from './component-machine-gun-array';
import { shieldComponentModes } from './component-shield-mode';
import { coolantPodComponentModes } from './component-coolant-pod';
import {
    electronicComponentModes,
} from './component-electronic-suite';
import { mobileHpgComponentModes } from './component-mobile-hpg';
import { boobyTrapComponentModes } from './component-booby-trap';
import { rapidFireAutocannonComponentModes } from '../rapid-fire-autocannon-mode.model';
import { stealthComponentModes } from '../stealth-equipment.model';

export interface MekComponentModes {
    readonly modes: readonly string[];
    readonly defaultMode?: string;
}

/** One direct rules path for pristine defaults and runtime mode validation. */
export function mekComponentModes(
    _entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
): MekComponentModes {
    const equipment = equipmentForComponent(index, componentId);
    if (equipment === undefined) return Object.freeze({ modes: Object.freeze([]) });

    const riscPulseModes = mekRiscLaserPulseComponentModes(index, componentId);
    if (riscPulseModes !== null) return riscPulseModes;

    const apolloModes = componentApolloModes(index, componentId, ruleset);
    if (apolloModes !== null) return apolloModes;
    const hpgModes = mobileHpgComponentModes(equipment);
    if (hpgModes !== null) return hpgModes;
    const boobyTrapModes = boobyTrapComponentModes(equipment);
    if (boobyTrapModes !== null) return boobyTrapModes;
    const inventoryModes = inventoryEquipmentModes(equipment);
    if (inventoryModes !== null) return inventoryModes;
    const bombastModes = bombastLaserEquipmentModes(equipment, ruleset);
    if (bombastModes !== null) return bombastModes;
    const flamerModes = flamerComponentModes(equipment, ruleset);
    if (flamerModes !== null) return flamerModes;
    const hagModes = hagEquipmentModes(equipment);
    if (hagModes !== null) return hagModes;
    const vibrobladeModes = vibrobladeComponentModes(equipment);
    if (vibrobladeModes !== null) return vibrobladeModes;
    const electronicModes = electronicComponentModes(equipment);
    if (electronicModes !== null) return electronicModes;
    const machineGunArrayModes = machineGunArrayComponentModes(equipment);
    if (machineGunArrayModes !== null) return machineGunArrayModes;
    const shieldModes = shieldComponentModes(equipment, ruleset);
    if (shieldModes !== null) return shieldModes;
    const coolantPodModes = coolantPodComponentModes(equipment);
    if (coolantPodModes !== null) return coolantPodModes;
    const rapidFireModes = rapidFireAutocannonComponentModes(equipment);
    if (rapidFireModes !== null) return rapidFireModes;
    const stealthModes = stealthComponentModes(equipment);
    if (stealthModes !== null) return stealthModes;
    return Object.freeze({ modes: Object.freeze([]) });
}
