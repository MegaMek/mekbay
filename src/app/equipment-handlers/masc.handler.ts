import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/force-serialization';
import type { TurnState } from '../models/turn-state.model';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';

export const MASC_SEQUENCE_STATE_KEY = 'masc';
export const MASC_ACTIVE_STATE_KEY = 'mascActive';
export const MASC_SEQUENCE_LABELS = ['3+', '5+', '7+', '11+', '!!'] as const;
const MASC_CHOICE_COLORS = {
    selected: 'var(--bt-yellow)',
    selectedText: '#000',
    mutedSelected: 'var(--bt-yellow-background)',
    mutedSelectedText: '#888',
    disabledText: '#888'
};
const MASC_FAILURE_CHOICE_COLORS = {
    ...MASC_CHOICE_COLORS,
    selected: '#f00',
    selectedText: '#fff',
    mutedSelected: '#800',
};

export function getMascSequenceState(equipment: MountedEquipment): number {
    const rawState = Number(equipment.states.get(MASC_SEQUENCE_STATE_KEY) ?? 0);
    if (!Number.isFinite(rawState)) return 0;
    return Math.max(0, Math.min(MASC_SEQUENCE_LABELS.length, Math.trunc(rawState)));
}

export function isMascSequenceButtonOn(equipment: MountedEquipment, index: number): boolean {
    return index >= 0 && index < getMascSequenceState(equipment);
}

export function isMascActive(equipment: MountedEquipment): boolean {
    return equipment.states.get(MASC_ACTIVE_STATE_KEY) === 'true';
}

export function isJetBoosterMasc(equipment: MountedEquipment): boolean {
    const flags = equipment.equipment?.flags;
    return !!flags?.has('F_MASC') && !!flags?.has('F_JET_BOOSTER');
}

export function canUseMascHandler(equipment: MountedEquipment): boolean {
    return !isJetBoosterMasc(equipment) || equipment.owner?.turnState?.().airborne() === true;
}

export function canUseMascMovementBonus(equipment: MountedEquipment, turnState: TurnState): boolean {
    return !isJetBoosterMasc(equipment) || turnState.airborne() === true;
}

export function setMascActive(equipment: MountedEquipment, active: boolean): boolean {
    return active
        ? equipment.setState(MASC_ACTIVE_STATE_KEY, 'true')
        : equipment.deleteState(MASC_ACTIVE_STATE_KEY);
}

export function isMascSequenceButtonClickable(equipment: MountedEquipment, index: number): boolean {
    return canUseMascHandler(equipment) && !equipment.isUnavailable() && index >= 0 && index < MASC_SEQUENCE_LABELS.length
        && index <= getMascSequenceState(equipment);
}

export function setMascSequenceState(equipment: MountedEquipment, state: number): boolean {
    const nextState = Math.max(0, Math.min(MASC_SEQUENCE_LABELS.length, Math.trunc(state)));
    return nextState === 0
        ? equipment.deleteState(MASC_SEQUENCE_STATE_KEY)
        : equipment.setState(MASC_SEQUENCE_STATE_KEY, String(nextState));
}

export function toggleMascSequenceButton(equipment: MountedEquipment, index: number): boolean {
    const currentState = getMascSequenceState(equipment);
    if (!isMascSequenceButtonClickable(equipment, index)) return false;
    if (index < currentState - 1) { 
        // we click a previously active (now not the active one), we go back to it and we keep it not-active
        setMascActive(equipment, false);
        return setMascSequenceState(equipment, index + 1);
    }
    if (index === currentState - 1) {
        if (isMascActive(equipment)) {
            // we click our currently selected state, we set it to not active
            return setMascActive(equipment, false);
        } else {
            // we click the last entry in the sequence and is not active, we turn it off.
            return setMascSequenceState(equipment, index);
        }
    }
    // we are clicking the new entry, we go up to it and we set active
    const sequenceChanged = setMascSequenceState(equipment, index + 1);
    const activeChanged = setMascActive(equipment, true);
    return sequenceChanged || activeChanged;
}

export class MascHandler extends EquipmentInteractionHandler {
    readonly id = 'masc-handler';
    override readonly flags = ['F_MASC'];
    override readonly priority = 10;

    getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        if (!canUseMascHandler(equipment)) return [];
        const state = getMascSequenceState(equipment);
        const active = isMascActive(equipment);
        return MASC_SEQUENCE_LABELS.map((label, index) => ({
            label,
            shortLabel: label,
            value: index,
            displayType: 'toggle',
            disabled: !isMascSequenceButtonClickable(equipment, index),
            active: index < state,
            selectionTone: index === state - 1 && active ? 'selected' : 'muted',
            colors: label === '!!' ? MASC_FAILURE_CHOICE_COLORS : MASC_CHOICE_COLORS,
            keepOpen: true,
        }));
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): boolean {
        if (!canUseMascHandler(equipment)) return true;
        const changed = toggleMascSequenceButton(equipment, Number(choice.value));
        if (!changed) return true;

        equipment.owner.setInventoryEntry(equipment);
        const state = getMascSequenceState(equipment);
        context.toastService.showToast(
            `${equipment.equipment?.name || equipment.name} ${state === 0 ? 'reset' : `sequence ${state}`}`,
            'info'
        );
        return true;
    }

    override onEndTurn(equipment: MountedEquipment, _context: HandlerContext): void {
        if (setMascActive(equipment, false)) {
            equipment.owner.setInventoryEntry(equipment);
        }
    }

    override getRunMovementMultiplierBonus(equipment: MountedEquipment, turnState: TurnState): number {
        return isMascActive(equipment) && canUseMascMovementBonus(equipment, turnState) ? 0.5 : 0;
    }
}