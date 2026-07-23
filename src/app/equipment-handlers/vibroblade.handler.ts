import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import type { TurnState } from '../models/turn-state.model';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';
import type { InventoryControlPhysicalDamageEffect } from '../utils/inventory-control-physical-damage.util';

export const VIBROBLADE_MODE_STATE = 'vibroblade_mode';
export const VIBROBLADE_ON_MODE = 'ON';
export const VIBROBLADE_OFF_MODE = 'OFF';

interface VibrobladeProfile {
    readonly activeDamage: number;
    readonly activeHeat: number;
}

export function getVibrobladeProfile(equipment: MountedEquipment): VibrobladeProfile | null {
    const flags = equipment.equipment?.flags;
    if (!flags?.has('F_CLUB')) return null;
    if (flags.has('S_VIBRO_SMALL')) return { activeDamage: 7, activeHeat: 3 };
    if (flags.has('S_VIBRO_MEDIUM')) return { activeDamage: 10, activeHeat: 5 };
    if (flags.has('S_VIBRO_LARGE')) return { activeDamage: 14, activeHeat: 7 };
    return null;
}

export function getVibrobladeMode(equipment: MountedEquipment): typeof VIBROBLADE_ON_MODE | typeof VIBROBLADE_OFF_MODE {
    return equipment.states.get(VIBROBLADE_MODE_STATE) === VIBROBLADE_ON_MODE
        ? VIBROBLADE_ON_MODE
        : VIBROBLADE_OFF_MODE;
}

export function isActiveVibroblade(equipment: MountedEquipment): boolean {
    return getVibrobladeProfile(equipment) !== null && getVibrobladeMode(equipment) === VIBROBLADE_ON_MODE;
}

export function getVibrobladeBaseDamage(equipment: MountedEquipment): number | null {
    const profile = getVibrobladeProfile(equipment);
    if (!profile) return null;
    if (getVibrobladeMode(equipment) === VIBROBLADE_ON_MODE) return profile.activeDamage;

    const tonnage = Math.max(0, equipment.owner.getUnit().tons);
    return Math.min(Math.ceil(tonnage / 10) + 1, profile.activeDamage);
}

export class VibrobladeHandler extends EquipmentInteractionHandler {
    readonly id = 'vibroblade-handler';
    override readonly flags = ['F_CLUB'];
    override readonly priority = 20;

    override applicableTo(equipment: MountedEquipment): boolean {
        return getVibrobladeProfile(equipment) !== null;
    }

    override getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [{
            label: 'Mode',
            value: getVibrobladeMode(equipment),
            displayType: 'dropdown',
            choices: [
                { label: VIBROBLADE_ON_MODE, value: VIBROBLADE_ON_MODE },
                { label: VIBROBLADE_OFF_MODE, value: VIBROBLADE_OFF_MODE },
            ],
            disabled: equipment.isUnavailable(),
            keepOpen: true,
        }];
    }

    override handleSelection(equipment: MountedEquipment, choice: PickerChoice, _context: HandlerContext): boolean {
        const mode = choice.value === VIBROBLADE_ON_MODE ? VIBROBLADE_ON_MODE : VIBROBLADE_OFF_MODE;
        if (equipment.setState(VIBROBLADE_MODE_STATE, mode)) {
            equipment.owner.setInventoryEntry(equipment);
        }
        return false;
    }

    override getToHitAdjustments(): readonly ToHitAdjustment[] {
        return [{ kind: 'replace-base', value: -2 }];
    }

    override applyInventoryControlDisplayEffects(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        _options: InventoryControlDisplayEffectOptions,
        _context: HandlerContext,
    ): InventoryControlDisplayData {
        const profile = getVibrobladeProfile(equipment);
        if (!profile) return display;
        const active = getVibrobladeMode(equipment) === VIBROBLADE_ON_MODE;
        return {
            ...display,
            heat: active ? `${profile.activeHeat}` : `[${profile.activeHeat}]`,
            damage: active
                ? `${profile.activeDamage}`
                : `${Number.parseInt(display.damage, 10)} [${profile.activeDamage}]`,
        };
    }

    override applyInventoryControlPhysicalDamageEffects(
        equipment: MountedEquipment,
        effect: InventoryControlPhysicalDamageEffect,
        _context: HandlerContext,
    ): InventoryControlPhysicalDamageEffect {
        const profile = getVibrobladeProfile(equipment);
        const baseDamage = getVibrobladeBaseDamage(equipment);
        if (!profile || baseDamage === null) return effect;
        const active = getVibrobladeMode(equipment) === VIBROBLADE_ON_MODE;
        return {
            baseDamage,
            ignoreMyomer: active,
        };
    }

    override getInventoryHeatSources(equipment: MountedEquipment, _turnState: TurnState): UnitHeatSource[] {
        const profile = getVibrobladeProfile(equipment);
        if (!profile || getVibrobladeMode(equipment) !== VIBROBLADE_ON_MODE || equipment.isUnavailable()) return [];
        return [{
            id: `vibroblade:${equipment.id}`,
            label: equipment.equipment?.name ?? equipment.name,
            value: profile.activeHeat,
        }];
    }
}
