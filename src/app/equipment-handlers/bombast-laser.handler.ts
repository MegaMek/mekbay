import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { WeaponEquipment, type WeaponDamage, type WeaponType } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import {
    EquipmentInteractionHandler,
    type HandlerContext,
    type ToHitAdjustmentContext
} from '../services/equipment-interaction-registry.service';
import type { InventoryControlDamageContext } from '../utils/inventory-control-damage.util';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';
import { INVENTORY_CONTROL_MODE_STATE, setInventoryControlMode } from '../utils/inventory-control.util';

export const BOMBAST_LASER_DAMAGE_8_MODE = 'Damage 8';
export const BOMBAST_LASER_DAMAGE_12_MODE = 'Damage 12';
export const BOMBAST_LASER_DAMAGE_16_MODE = 'Damage 16';
export const BOMBAST_LASER_CHARGE_STATE_KEY = 'bombast_laser_charge_state';
export const BOMBAST_LASER_CHARGING_STATE = 'charging';
export const BOMBAST_LASER_CHARGED_STATE = 'charged';
export const BOMBAST_LASER_FIRED_STATE_KEY = 'bombast_laser_fired';
export const BOMBAST_LASER_CHARGED_COLOR = '#00a8ff';
export const BOMBAST_LASER_CHARGED_TEXT_COLOR = '#001829';

type BombastLaserMode =
    | typeof BOMBAST_LASER_DAMAGE_8_MODE
    | typeof BOMBAST_LASER_DAMAGE_12_MODE
    | typeof BOMBAST_LASER_DAMAGE_16_MODE;

type BombastLaserChargeState =
    | typeof BOMBAST_LASER_CHARGING_STATE
    | typeof BOMBAST_LASER_CHARGED_STATE;

interface BombastLaserProfile {
    readonly damage: number;
    readonly heat: number;
    readonly toHitModifier: number;
}

const BOMBAST_LASER_PROFILES: Readonly<Record<BombastLaserMode, BombastLaserProfile>> = {
    [BOMBAST_LASER_DAMAGE_8_MODE]: { damage: 8, heat: 6, toHitModifier: 0 },
    [BOMBAST_LASER_DAMAGE_12_MODE]: { damage: 12, heat: 9, toHitModifier: 1 },
    [BOMBAST_LASER_DAMAGE_16_MODE]: { damage: 16, heat: 12, toHitModifier: 2 }
};

export class BombastLaserHandler extends EquipmentInteractionHandler {
    readonly id = 'bombast-laser-handler';
    override readonly flags: EquipmentFlag[] = ['F_BOMBAST_LASER'];
    override readonly priority = 105;

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.owner.gameRules.supportsBombastLaserRules
            && equipment.equipment instanceof WeaponEquipment;
    }

    override getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        if (!supportsBombastLaserRules(equipment)) return [];

        const chargeState = bombastLaserChargeState(equipment);
        const active = chargeState !== null;
        return [
            {
                label: 'Mode',
                value: selectedBombastLaserMode(equipment),
                displayType: 'dropdown',
                choices: [
                    { label: '8 DMG', value: BOMBAST_LASER_DAMAGE_8_MODE },
                    { label: '12 DMG', value: BOMBAST_LASER_DAMAGE_12_MODE },
                    { label: '16 DMG', value: BOMBAST_LASER_DAMAGE_16_MODE }
                ],
                disabled: equipment.isUnavailable(),
                keepOpen: true
            },
            {
                label: chargeState === BOMBAST_LASER_CHARGED_STATE
                    ? 'Laser Charged!'
                    : chargeState === BOMBAST_LASER_CHARGING_STATE ? 'Laser Charging..' : 'Charge Laser',
                shortLabel: chargeState === BOMBAST_LASER_CHARGED_STATE
                    ? 'Charged!'
                    : chargeState === BOMBAST_LASER_CHARGING_STATE ? 'Charging' : 'Charge',
                value: active ? 'discharged' : BOMBAST_LASER_CHARGING_STATE,
                active,
                disabled: equipment.isUnavailable() || equipment.states.has(BOMBAST_LASER_FIRED_STATE_KEY),
                colors: active
                    ? { selected: BOMBAST_LASER_CHARGED_COLOR, selectedText: BOMBAST_LASER_CHARGED_TEXT_COLOR }
                    : undefined,
                displayType: 'toggle'
            }
        ];
    }

    override handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): boolean {
        if (!supportsBombastLaserRules(equipment)) return true;

        const mode = validBombastLaserMode(String(choice.value));
        if (mode) {
            setInventoryControlMode(equipment, mode);
            return true;
        }

        if (choice.value === BOMBAST_LASER_CHARGING_STATE) {
            if (equipment.states.has(BOMBAST_LASER_FIRED_STATE_KEY)) {
                context.toastService.showToast('A fired Bombast Laser cannot charge this turn.', 'error');
                return true;
            }
            if (setBombastLaserChargeState(equipment, BOMBAST_LASER_CHARGING_STATE)) {
                equipment.owner.setInventoryEntry(equipment);
            }
            context.toastService.showToast('Bombast Laser charging', 'info');
            return true;
        }

        if (choice.value === 'discharged') {
            if (setBombastLaserChargeState(equipment, null)) {
                equipment.owner.setInventoryEntry(equipment);
            }
            context.toastService.showToast('Bombast Laser discharged', 'info');
        }
        return true;
    }

    override afterInventoryControlFire(equipment: MountedEquipment, _context: HandlerContext): void {
        if (!supportsBombastLaserRules(equipment)) return;
        const discharged = setBombastLaserChargeState(equipment, null);
        const markedFired = equipment.setState(BOMBAST_LASER_FIRED_STATE_KEY, '1');
        if (discharged || markedFired) equipment.owner.setInventoryEntry(equipment);
    }

    override onEndTurn(equipment: MountedEquipment, _context: HandlerContext): void {
        if (!supportsBombastLaserRules(equipment)) return;
        let changed = equipment.deleteState(BOMBAST_LASER_FIRED_STATE_KEY);
        if (!equipment.isUnavailable() && bombastLaserChargeState(equipment) === BOMBAST_LASER_CHARGING_STATE) {
            changed = setBombastLaserChargeState(equipment, BOMBAST_LASER_CHARGED_STATE) || changed;
        }
        if (changed) equipment.owner.setInventoryEntry(equipment);
    }

    override isInventoryControlSelectable(equipment: MountedEquipment, _context: HandlerContext): boolean | null {
        return supportsBombastLaserRules(equipment)
            && bombastLaserChargeState(equipment) === BOMBAST_LASER_CHARGING_STATE
            ? false
            : null;
    }

    override applyInventoryControlDamageEffects(
        equipment: MountedEquipment,
        damage: WeaponDamage,
        _damageContext: InventoryControlDamageContext,
        _context: HandlerContext
    ): WeaponDamage {
        if (!supportsBombastLaserRules(equipment)) return damage;
        const selectedDamage = selectedBombastLaserProfile(equipment).damage;
        return { ...damage, values: damage.values.map(() => selectedDamage), maximum: selectedDamage };
    }

    override applyInventoryControlHeatEffects(
        equipment: MountedEquipment,
        effect: InventoryControlHeatEffect,
        _context: HandlerContext
    ): InventoryControlHeatEffect {
        return supportsBombastLaserRules(equipment)
            ? { ...effect, value: selectedBombastLaserProfile(equipment).heat }
            : effect;
    }

    override applyInventoryControlWeaponTypes(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        _context: HandlerContext
    ): ReadonlySet<WeaponType> {
        return supportsBombastLaserRules(equipment)
            && bombastLaserChargeState(equipment) === BOMBAST_LASER_CHARGED_STATE
            ? new Set([...types, 'X'])
            : types;
    }

    override getToHitAdjustments(
        equipment: MountedEquipment,
        _adjustmentContext: ToHitAdjustmentContext,
        _context: HandlerContext
    ): readonly ToHitAdjustment[] {
        if (!supportsBombastLaserRules(equipment)
            || bombastLaserChargeState(equipment) === BOMBAST_LASER_CHARGED_STATE) return [];

        const mode = selectedBombastLaserMode(equipment);
        const modifier = BOMBAST_LASER_PROFILES[mode].toHitModifier;
        return modifier === 0
            ? []
            : [{
                kind: 'replace-base',
                value: modifier,
                label: `${equipment.equipment?.shortName ?? equipment.name} (${mode})`
            }];
    }
}

export function selectedBombastLaserMode(equipment: MountedEquipment): BombastLaserMode {
    return validBombastLaserMode(equipment.states.get(INVENTORY_CONTROL_MODE_STATE))
        ?? BOMBAST_LASER_DAMAGE_12_MODE;
}

export function bombastLaserChargeState(equipment: MountedEquipment): BombastLaserChargeState | null {
    const state = equipment.states.get(BOMBAST_LASER_CHARGE_STATE_KEY);
    return state === BOMBAST_LASER_CHARGING_STATE || state === BOMBAST_LASER_CHARGED_STATE ? state : null;
}

function selectedBombastLaserProfile(equipment: MountedEquipment): BombastLaserProfile {
    return BOMBAST_LASER_PROFILES[selectedBombastLaserMode(equipment)];
}

function validBombastLaserMode(mode: string | undefined): BombastLaserMode | null {
    return mode === BOMBAST_LASER_DAMAGE_8_MODE
        || mode === BOMBAST_LASER_DAMAGE_12_MODE
        || mode === BOMBAST_LASER_DAMAGE_16_MODE
        ? mode
        : null;
}

function supportsBombastLaserRules(equipment: MountedEquipment): boolean {
    return equipment.owner.gameRules.supportsBombastLaserRules;
}

function setBombastLaserChargeState(equipment: MountedEquipment, state: BombastLaserChargeState | null): boolean {
    return state === null
        ? equipment.deleteState(BOMBAST_LASER_CHARGE_STATE_KEY)
        : equipment.setState(BOMBAST_LASER_CHARGE_STATE_KEY, state);
}