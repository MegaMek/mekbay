import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/force-serialization';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE } from '../models/rules/unit-type-rules';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import { isEquipmentDisabledByFailure } from './disabled-equipment.handler';

export const ESCALATING_FAILURE_HANDLER_ID = 'escalating-failure-handler';
export const ESCALATING_FAILURE_STATE_KEY = 'escalatingFailure';
export const ESCALATING_FAILURE_ACTIVE_STATE_KEY = 'escalatingFailureActive';
const ESCALATING_FAILURE_DISABLED_CHOICE_VALUE = 'escalating-failure-disabled';
export const DEFAULT_ESCALATING_FAILURE_SEQUENCE_LABELS = ['3+', '5+', '7+', '10+', '11+'] as const;
const ESCALATING_FAILURE_CHOICE_COLORS = {
    selected: 'var(--bt-yellow)',
    selectedText: '#000',
    mutedSelected: 'var(--bt-yellow-background)',
    mutedSelectedText: '#888',
    disabledText: '#888'
};
const ESCALATING_FAILURE_FAILURE_CHOICE_COLORS = {
    ...ESCALATING_FAILURE_CHOICE_COLORS,
    selected: '#f00',
    selectedText: '#fff',
    mutedSelected: '#800',
};

export class EscalatingFailureHandler extends EquipmentInteractionHandler {
    readonly id: string = ESCALATING_FAILURE_HANDLER_ID;
    override readonly flags = ['F_ESCALATING_FAILURE'];
    override readonly priority = 10;

    protected static readonly sequenceStateKey: string = ESCALATING_FAILURE_STATE_KEY;

    static getSequenceState(equipment: MountedEquipment): number {
        const rawState = Number(equipment.states.get(this.sequenceStateKey) ?? 0);
        if (!Number.isFinite(rawState)) return 0;
        return Math.max(0, Math.min(this.getSequenceLabels(equipment).length, Math.trunc(rawState)));
    }

    static setSequenceState(equipment: MountedEquipment, state: number): boolean {
        const nextState = Math.max(0, Math.min(this.getSequenceLabels(equipment).length, Math.trunc(state)));
        return nextState === 0
            ? equipment.deleteState(this.sequenceStateKey)
            : equipment.setState(this.sequenceStateKey, String(nextState));
    }

    protected static getSequenceLabels(equipment: MountedEquipment): readonly string[] {
        return equipment.owner?.rules.rulesData?.escalatingFailureLabels ?? DEFAULT_ESCALATING_FAILURE_SEQUENCE_LABELS;
    }

    protected readonly sequenceStateKey: string = ESCALATING_FAILURE_STATE_KEY;
    protected readonly activeStateKey: string = ESCALATING_FAILURE_ACTIVE_STATE_KEY;

    protected getSequenceLabels(equipment: MountedEquipment): readonly string[] {
        return EscalatingFailureHandler.getSequenceLabels(equipment);
    }

    protected canUseHandler(_equipment: MountedEquipment): boolean {
        return true;
    }

    protected getSequenceState(equipment: MountedEquipment): number {
        const rawState = Number(equipment.states.get(this.sequenceStateKey) ?? 0);
        if (!Number.isFinite(rawState)) return 0;
        return Math.max(0, Math.min(this.getSequenceLabels(equipment).length, Math.trunc(rawState)));
    }

    protected isActive(equipment: MountedEquipment): boolean {
        return equipment.states.get(this.activeStateKey) === 'true';
    }

    protected setActive(equipment: MountedEquipment, active: boolean): boolean {
        return active
            ? equipment.setState(this.activeStateKey, 'true')
            : equipment.deleteState(this.activeStateKey);
    }

    protected isSequenceButtonClickable(equipment: MountedEquipment, index: number): boolean {
        return this.canUseHandler(equipment) && !isEquipmentDisabledByFailure(equipment) && !equipment.isUnavailable()
            && index >= 0 && index < this.getSequenceLabels(equipment).length
            && index <= this.getSequenceState(equipment);
    }

    protected setSequenceState(equipment: MountedEquipment, state: number): boolean {
        const nextState = Math.max(0, Math.min(this.getSequenceLabels(equipment).length, Math.trunc(state)));
        return nextState === 0
            ? equipment.deleteState(this.sequenceStateKey)
            : equipment.setState(this.sequenceStateKey, String(nextState));
    }

    protected toggleSequenceButton(equipment: MountedEquipment, index: number): boolean {
        const currentState = this.getSequenceState(equipment);
        if (!this.isSequenceButtonClickable(equipment, index)) return false;
        if (index < currentState - 1) {
            this.setActive(equipment, false);
            return this.setSequenceState(equipment, index + 1);
        }
        if (index === currentState - 1) {
            return this.isActive(equipment)
                ? this.setActive(equipment, false)
                : this.setSequenceState(equipment, index);
        }
        const sequenceChanged = this.setSequenceState(equipment, index + 1);
        const activeChanged = this.setActive(equipment, true);
        return sequenceChanged || activeChanged;
    }

    getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        if (!this.canUseHandler(equipment)) return [];
        const state = this.getSequenceState(equipment);
        const active = this.isActive(equipment);
        const sequenceChoices: PickerChoice[] = this.getSequenceLabels(equipment).map((label, index) => ({
            label,
            shortLabel: label,
            value: index,
            displayType: 'toggle',
            disabled: !this.isSequenceButtonClickable(equipment, index),
            active: index < state,
            selectionTone: index === state - 1 && active ? 'selected' : 'muted',
            colors: label === '!!' ? ESCALATING_FAILURE_FAILURE_CHOICE_COLORS : ESCALATING_FAILURE_CHOICE_COLORS,
            keepOpen: true,
        }));
        const disabled = isEquipmentDisabledByFailure(equipment);
        const toggleLabel = _context.choiceSurface === 'turn-summary'
            ? '✖'
            : disabled ? 'Malfunctioning' : 'Operational';
        return [...sequenceChoices, {
            label: toggleLabel,
            shortLabel: toggleLabel,
            value: ESCALATING_FAILURE_DISABLED_CHOICE_VALUE,
            displayType: 'toggle',
            disabled: equipment.isDestroyed(),
            active: disabled,
            colors: disabled ? ESCALATING_FAILURE_FAILURE_CHOICE_COLORS : undefined,
            tooltipType: disabled ? 'error' : undefined,
        }];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): boolean {
        if (!this.canUseHandler(equipment)) return true;
        if (choice.value === ESCALATING_FAILURE_DISABLED_CHOICE_VALUE) {
            const disabled = isEquipmentDisabledByFailure(equipment);
            const changed = disabled
                ? equipment.deleteState(ENTRY_DISABLED_STATE_KEY)
                : equipment.setState(ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE);
            if (!disabled) this.setActive(equipment, false);
            if (!changed) return true;

            equipment.owner.setInventoryEntry(equipment);
            context.toastService.showToast(
                `${equipment.equipment?.name || equipment.name} ${disabled ? 'is operational' : 'has failed'}`,
                disabled ? 'info' : 'error'
            );
            return true;
        }
        if (isEquipmentDisabledByFailure(equipment)) return true;

        const changed = this.toggleSequenceButton(equipment, Number(choice.value));
        if (!changed) return true;

        equipment.owner.setInventoryEntry(equipment);
        const state = this.getSequenceState(equipment);
        context.toastService.showToast(
            `${equipment.equipment?.name || equipment.name} ${state === 0 ? 'reset' : `sequence ${state}`}`,
            'info'
        );
        return true;
    }

    override onEndTurn(equipment: MountedEquipment, context: HandlerContext): void {
        if (isEquipmentDisabledByFailure(equipment)) return;
        if (this.isActive(equipment)) {
            const changed = this.setActive(equipment, false);
            if (changed) {
                equipment.owner.setInventoryEntry(equipment);
            }
            return;
        }

        const currentState = this.getSequenceState(equipment);
        const changed = this.setSequenceState(equipment, currentState - 1);
        if (changed) {
            equipment.owner.setInventoryEntry(equipment);
            context.toastService.showToast(
                `${equipment.owner.getNotificationDisplayName()}: ${equipment.equipment?.name || equipment.name} sequence reduced to ${this.getSequenceState(equipment)}`,
                'info'
            );
        }
    }
}