// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import { WeaponEquipment } from '../equipment.model';
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
import { ecmEquipmentModes } from '../ecm-mode.model';

export interface MekComponentModes {
    readonly modes: readonly string[];
    readonly defaultMode?: string;
}

/** One direct rules path for pristine defaults and runtime mode validation. */
export function mekComponentModes(
    entity: MekEntity,
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
    const ecmModes = ecmEquipmentModes(equipment);
    if (ecmModes !== null) return ecmModes;
    const modes = Object.freeze([...equipment.modes]);
    return fixedModes(modes, defaultMode(modes));
}

function defaultMode(modes: readonly string[]): string | undefined {
    return modes.find(mode => mode.toLowerCase() === 'off') ?? modes[0];
}

function fixedModes(modes: readonly string[], selected?: string): MekComponentModes {
    const copy = Object.freeze([...modes]);
    return Object.freeze({
        modes: copy,
        ...(selected === undefined ? {} : { defaultMode: selected }),
    });
}
