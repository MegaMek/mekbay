// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import type { Equipment } from '../equipment.model';
import { isWeaponEnhancementEquipment } from '../weapon-enhancement.model';
import {
    RISC_LASER_PULSE_MODE,
    RISC_LASER_STANDARD_MODE,
    RISC_LASER_MODES,
    RISC_LASER_PULSE_EXPLOSION_DAMAGE,
    RISC_LASER_PULSE_MODULE_FLAG,
    isRiscLaserPulseEnhancement,
    isRiscLaserPulseLink,
    isRiscLaserMode,
} from '../risc-laser-mode.model';
import {
    componentStatusDefinition,
    type ComponentStatusDefinition,
} from './component-status';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';
import type { CBTUnitInstance } from './unit-instance';

export interface MekRiscLaserPulseLink {
    readonly moduleId: ComponentId;
    readonly laserId: ComponentId;
    readonly moduleLabel: string;
}

export interface MekRiscLaserPulseRuntimeView {
    componentStatus(componentId: ComponentId): EquipmentStatus;
    componentMode(componentId: ComponentId): string | undefined;
}

export type RiscLaserPulseCriticalExplosion =
    | Readonly<{ readonly kind: 'unrelated' }>
    | Readonly<{ readonly kind: 'inert' }>
    | Readonly<{
        readonly kind: 'explode';
        readonly damage: 2;
        readonly automaticCriticalComponentId: ComponentId;
    }>;

/** Complete RISC pulse-module critical explosion rule. */
export function riscLaserPulseCriticalExplosion(
    equipment: Equipment | undefined,
    index: MekRuntimeIndex,
    moduleId: ComponentId,
    componentAvailable: (componentId: ComponentId) => boolean,
): RiscLaserPulseCriticalExplosion {
    if (!isRiscLaserPulseEnhancement(equipment)) return Object.freeze({ kind: 'unrelated' });
    const laserId = index.relationships.linkedTargetBySource.get(moduleId);
    return laserId !== undefined && componentAvailable(laserId)
        ? Object.freeze({
            kind: 'explode' as const,
            damage: RISC_LASER_PULSE_EXPLOSION_DAMAGE,
            automaticCriticalComponentId: laserId,
        })
        : Object.freeze({ kind: 'inert' as const });
}

/** Returns the one exact entity-owned RISC module-to-laser relation, if present. */
export function mekRiscLaserPulseLink(
    index: MekRuntimeIndex,
    laserId: ComponentId,
): MekRiscLaserPulseLink | null {
    const moduleId = index.relationships.linkedSourceByTarget.get(laserId);
    if (moduleId === undefined
        || index.relationships.linkedTargetBySource.get(moduleId) !== laserId) return null;
    const module = equipmentForComponent(index, moduleId);
    const laser = equipmentForComponent(index, laserId);
    if (!module || !isRiscLaserPulseLink(module, laser)) return null;
    return Object.freeze({
        moduleId,
        laserId,
        moduleLabel: module.shortName || module.name,
    });
}

export function isMekRiscLaserPulsePair(
    index: MekRuntimeIndex,
    moduleId: ComponentId,
    laserId: ComponentId,
): boolean {
    return mekRiscLaserPulseLink(index, laserId)?.moduleId === moduleId;
}

/** Runtime activation is sparse state over the immutable entity relation. */
export function mekRiscLaserPulseActive(
    index: MekRuntimeIndex,
    runtime: MekRiscLaserPulseRuntimeView,
    laserId: ComponentId,
): boolean {
    const link = mekRiscLaserPulseLink(index, laserId);
    return link !== null
        && runtime.componentStatus(link.moduleId) === 'available'
        && runtime.componentStatus(laserId) === 'available'
        && runtime.componentMode(laserId) === RISC_LASER_PULSE_MODE;
}

export function mekRiscLaserPulseComponentModes(
    index: MekRuntimeIndex,
    laserId: ComponentId,
): { readonly modes: readonly string[]; readonly defaultMode: string } | null {
    return mekRiscLaserPulseLink(index, laserId) === null
        ? null
        : Object.freeze({
            modes: Object.freeze([...RISC_LASER_MODES]),
            defaultMode: RISC_LASER_MODES[0],
        });
}

export interface ComponentRiscLaserPulseDefinition {
    readonly module: ComponentStatusDefinition;
    readonly laser: ComponentStatusDefinition;
    readonly moduleLabel: string;
    readonly relation: {
        readonly kind: 'linked';
        readonly sourceId: ComponentId;
        readonly targetId: ComponentId;
    };
}

/** Immutable definition derived only from the entity's exact directed link. */
export function componentRiscLaserPulseDefinition(
    index: MekRuntimeIndex,
    moduleId: ComponentId,
    laserId: ComponentId,
): ComponentRiscLaserPulseDefinition {
    const link = mekRiscLaserPulseLink(index, laserId);
    if (link?.moduleId !== moduleId) {
        throw new Error('RISC Laser Pulse link is not exact and compatible');
    }
    return Object.freeze({
        module: componentStatusDefinition(index, moduleId),
        laser: componentStatusDefinition(index, laserId),
        moduleLabel: link.moduleLabel,
        relation: Object.freeze({
            kind: 'linked' as const,
            sourceId: moduleId,
            targetId: laserId,
        }),
    });
}

/** RISC pulse-module link, modes, activation, heat, and interaction owner. */
export class RiscLaserPulseModuleHandler extends EquipmentInteractionHandler {
    readonly id = 'risc-laser-pulse-module-handler';
    readonly kind = 'risc-laser-pulse';
    readonly scope = 'link' as const;
    override readonly priority = 105;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = this.definition(input);
        return this.applicableToComponentRiscLaserPulse(definition)
            ? this.getComponentRiscLaserPulseChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = this.definition(input);
        return this.applicableToComponentRiscLaserPulse(definition)
            && this.handleComponentRiscLaserPulseSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentRiscLaserPulse(definition: ComponentRiscLaserPulseDefinition): boolean {
        return isWeaponEnhancementEquipment(definition.module.flags)
            && definition.module.flags.has(RISC_LASER_PULSE_MODULE_FLAG)
            && definition.laser.flags.has('F_ENERGY')
            && definition.laser.flags.has('F_LASER');
    }

    getComponentRiscLaserPulseChoices(
        runtime: CBTUnitInstance,
        definition: ComponentRiscLaserPulseDefinition,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        const query = runtime.query();
        if (query.componentStatus(definition.module.componentId) !== 'available'
            || query.componentStatus(definition.laser.componentId) !== 'available') return [];
        const mode = query.componentMode(definition.laser.componentId);
        if (!isRiscLaserMode(mode)) return [];
        return [{
            label: 'Mode',
            value: mode,
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: RISC_LASER_STANDARD_MODE },
                { label: 'PULSE', value: RISC_LASER_PULSE_MODE },
            ],
            keepOpen: true,
        }];
    }

    handleComponentRiscLaserPulseSelection(
        runtime: CBTUnitInstance,
        definition: ComponentRiscLaserPulseDefinition,
        choice: PickerChoice,
        _context: EquipmentInteractionCommandContext,
    ): boolean {
        if (!isRiscLaserMode(choice.value)) return false;
        if (runtime.query().componentMode(definition.laser.componentId) === choice.value) return true;
        return runtime.dispatch({
            type: 'set-component-mode',
            componentId: definition.laser.componentId,
            mode: choice.value,
        }).accepted;
    }

    private definition(input: EquipmentInteractionInput): ComponentRiscLaserPulseDefinition {
        if (input.relatedComponentId === undefined) {
            throw new Error('RISC pulse module requires an authored link');
        }
        return componentRiscLaserPulseDefinition(input.index, input.relatedComponentId, input.componentId);
    }
}

export { RISC_LASER_PULSE_MODE, RISC_LASER_STANDARD_MODE };
