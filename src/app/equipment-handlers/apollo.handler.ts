import type { PickerChoice } from '../components/picker/picker.interface';
import type { WeaponType } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import { EquipmentInteractionHandler, type HandlerContext, type ToHitAdjustmentContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';

export const APOLLO_STANDARD_MODE = 'Standard';
export const APOLLO_SATURATION_MODE = 'Saturation';
export const APOLLO_MODE_STATE = 'apollo_mode';

export class ApolloHandler extends EquipmentInteractionHandler {
    readonly id = 'apollo-handler';

    override applicableTo(equipment: MountedEquipment): boolean {
        return isApollo(equipment) || isMrmWithApollo(equipment);
    }

    getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        if (!equipment.owner.gameRules.supportsApolloSaturationMode || !isMrmWithApollo(equipment)) return [];
        const apollo = linkedApollo(equipment);
        return [{
            label: 'Mode',
            value: selectedApolloMode(equipment),
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: APOLLO_STANDARD_MODE },
                { label: 'SAT', value: APOLLO_SATURATION_MODE }
            ],
            disabled: equipment.isUnavailable() || apollo?.isUnavailable() === true,
            keepOpen: true
        }];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, _context: HandlerContext): boolean {
        if (isMrmWithApollo(equipment)) {
            if (equipment.setState(APOLLO_MODE_STATE, String(choice.value))) {
                equipment.owner.setInventoryEntry(equipment);
            }
        }
        return false;
    }

    override getToHitAdjustments(equipment: MountedEquipment, context: ToHitAdjustmentContext): readonly ToHitAdjustment[] {
        const parent = context.parent;
        if (!parent || equipment.owner.gameRules.supportsApolloSaturationMode || !isApollo(equipment) || !isMrmWeapon(parent)) return [];
        const weakened = equipment.isUnavailable();
        return [{ kind: 'add', value: weakened ? 0 : -1, weakened }];
    }

    override applyLinkedWeaponTypes(
        equipment: MountedEquipment,
        parent: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        _context: HandlerContext
    ): ReadonlySet<WeaponType> {
        if (!equipment.owner.gameRules.supportsApolloSaturationMode
            || !isApollo(equipment)
            || !isMrmWithApollo(parent)
            || equipment.isUnavailable()
            || selectedApolloMode(parent) !== APOLLO_SATURATION_MODE) {
            return types;
        }
        return new Set([...types, 'AE']);
    }
}

function isApollo(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_WEAPON_ENHANCEMENT') === true
        && equipment.equipment.flags.has('F_APOLLO') === true;
}

function isMrmWeapon(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_MRM') === true;
}

function isMrmWithApollo(equipment: MountedEquipment): boolean {
    return isMrmWeapon(equipment) && linkedApollo(equipment) !== null;
}

export function linkedApollo(equipment: MountedEquipment): MountedEquipment | null {
    return equipment.linkedWith?.find(isApollo) ?? null;
}

export function selectedApolloMode(equipment: MountedEquipment): string {
    if (linkedApollo(equipment)?.isUnavailable()) return APOLLO_STANDARD_MODE;

    const mode = equipment.states.get(APOLLO_MODE_STATE) ?? equipment.states.get(INVENTORY_CONTROL_MODE_STATE);
    return mode === APOLLO_SATURATION_MODE
        ? APOLLO_SATURATION_MODE
        : APOLLO_STANDARD_MODE;
}