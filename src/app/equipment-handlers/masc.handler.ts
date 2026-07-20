import type { MountedEquipment } from '../models/force-serialization';
import type { TurnState } from '../models/turn-state.model';
import { EscalatingFailureHandler, DEFAULT_ESCALATING_FAILURE_SEQUENCE_LABELS } from './escalatingfailure.handler';

export const MASC_SEQUENCE_STATE_KEY = 'masc';
export const MASC_ACTIVE_STATE_KEY = 'mascActive';
export const MASC_HANDLER_ID = 'masc-handler';

function isJetBoosterMasc(equipment: MountedEquipment): boolean {
    const flags = equipment.equipment?.flags;
    return !!flags?.has('F_MASC') && !!flags?.has('F_JET_BOOSTER');
}

function canUseMascMovementBonus(equipment: MountedEquipment, turnState: TurnState): boolean {
    return !isJetBoosterMasc(equipment) || turnState.airborne() === true;
}

export class MascHandler extends EscalatingFailureHandler {
    override readonly id = MASC_HANDLER_ID;
    override readonly flags = ['F_MASC'];
    override readonly priority = 10;

    static isActive(equipment: MountedEquipment): boolean {
        return equipment.states.get(MASC_ACTIVE_STATE_KEY) === 'true';
    }

    protected static override readonly sequenceStateKey = MASC_SEQUENCE_STATE_KEY;

    static canUseHandler(equipment: MountedEquipment): boolean {
        return !isJetBoosterMasc(equipment) || equipment.owner?.turnState?.().airborne() === true;
    }

    protected override readonly sequenceStateKey = MASC_SEQUENCE_STATE_KEY;
    protected override readonly activeStateKey = MASC_ACTIVE_STATE_KEY;

    protected override canUseHandler(equipment: MountedEquipment): boolean {
        return MascHandler.canUseHandler(equipment);
    }

    override isActive(equipment: MountedEquipment): boolean {
        return MascHandler.isActive(equipment);
    }

    override getRunMovementMultiplierBonus(equipment: MountedEquipment, turnState: TurnState): number {
        return this.isActive(equipment) && canUseMascMovementBonus(equipment, turnState) ? 0.5 : 0;
    }
}