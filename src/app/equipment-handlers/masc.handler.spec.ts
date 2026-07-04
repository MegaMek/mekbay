import { MiscEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/force-serialization';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import {
    canUseMascHandler,
    isMascActive,
    MASC_ACTIVE_STATE_KEY,
    getMascSequenceState,
    MASC_SEQUENCE_STATE_KEY,
    MascHandler,
    setMascSequenceState,
} from './masc.handler';

function owner(airborne: boolean | null = null, turnStateOverrides: Record<string, unknown> = {}) {
    const turnState = {
        airborne: () => airborne,
        ...turnStateOverrides,
    };
    return {
        rules: { computeEntryState: (entry: MountedEquipment) => ({ isDamaged: entry.committedDestroyed(), isDisabled: false, hitMod: 0 }) },
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        turnState: () => turnState,
    } as never;
}

function mascEntry(flags: string[] = ['F_MASC'], airborne: boolean | null = null, turnStateOverrides: Record<string, unknown> = {}): MountedEquipment {
    return new MountedEquipment({
        owner: owner(airborne, turnStateOverrides),
        id: 'masc',
        name: 'MASC',
        equipment: new MiscEquipment({ id: 'masc', name: 'MASC', type: 'misc', flags })
    });
}

function context(): HandlerContext {
    return {
        toastService: { showToast: jasmine.createSpy('showToast') },
    } as unknown as HandlerContext;
}

describe('MascHandler', () => {
    const handler = new MascHandler();

    it('starts with only the first sequence button clickable', () => {
        const choices = handler.getChoices(mascEntry(), context());

        expect(choices.map(choice => ({ label: choice.label, disabled: choice.disabled, active: choice.active, displayType: choice.displayType }))).toEqual([
            { label: '3+', disabled: false, active: false, displayType: 'toggle' },
            { label: '5+', disabled: true, active: false, displayType: 'toggle' },
            { label: '7+', disabled: true, active: false, displayType: 'toggle' },
            { label: '11+', disabled: true, active: false, displayType: 'toggle' },
            { label: '!!', disabled: true, active: false, displayType: 'toggle' },
        ]);
    });

    it('advances one step at a time and unlocks the next button', () => {
        const entry = mascEntry();

        handler.handleSelection(entry, handler.getChoices(entry, context())[0], context());

        expect(getMascSequenceState(entry)).toBe(1);
        expect(isMascActive(entry)).toBeTrue();
        expect(handler.getChoices(entry, context()).map(choice => ({ disabled: choice.disabled, active: choice.active }))).toEqual([
            { disabled: false, active: true },
            { disabled: false, active: false },
            { disabled: true, active: false },
            { disabled: true, active: false },
            { disabled: true, active: false },
        ]);
        expect(handler.getChoices(entry, context()).map(choice => choice.selectionTone)).toEqual(['selected', 'muted', 'muted', 'muted', 'muted']);
    });

    it('uses muted tone for previous buttons and inactive current button', () => {
        const entry = mascEntry();
        setMascSequenceState(entry, 3);

        expect(handler.getChoices(entry, context()).map(choice => ({ active: choice.active, tone: choice.selectionTone }))).toEqual([
            { active: true, tone: 'muted' },
            { active: true, tone: 'muted' },
            { active: true, tone: 'muted' },
            { active: false, tone: 'muted' },
            { active: false, tone: 'muted' },
        ]);

        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        expect(handler.getChoices(entry, context()).map(choice => ({ active: choice.active, tone: choice.selectionTone }))).toEqual([
            { active: true, tone: 'muted' },
            { active: true, tone: 'muted' },
            { active: true, tone: 'selected' },
            { active: false, tone: 'muted' },
            { active: false, tone: 'muted' },
        ]);
    });

    it('turns off active state when the current sequence button is clicked again', () => {
        const entry = mascEntry();
        setMascSequenceState(entry, 3);
        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        handler.handleSelection(entry, handler.getChoices(entry, context())[2], context());

        expect(getMascSequenceState(entry)).toBe(3);
        expect(isMascActive(entry)).toBeFalse();
    });

    it('truncates the sequence and clears active state when a previous button is clicked', () => {
        const entry = mascEntry();
        setMascSequenceState(entry, 3);
        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        handler.handleSelection(entry, handler.getChoices(entry, context())[0], context());

        expect(getMascSequenceState(entry)).toBe(1);
        expect(isMascActive(entry)).toBeFalse();
    });

    it('hides Jet Booster choices when the unit is not airborne', () => {
        const entry = mascEntry(['F_MASC', 'F_JET_BOOSTER'], false);

        expect(canUseMascHandler(entry)).toBeFalse();
        expect(handler.getChoices(entry, context())).toEqual([]);
    });

    it('allows Jet Booster choices when the unit is airborne', () => {
        const entry = mascEntry(['F_MASC', 'F_JET_BOOSTER'], true);

        expect(canUseMascHandler(entry)).toBeTrue();
        expect(handler.getChoices(entry, context()).length).toBe(5);
    });

    it('ignores Jet Booster selections when the unit is not airborne', () => {
        const entry = mascEntry(['F_MASC', 'F_JET_BOOSTER'], false);

        handler.handleSelection(entry, { label: '3+', value: 0, displayType: 'toggle' }, context());

        expect(getMascSequenceState(entry)).toBe(0);
        expect(isMascActive(entry)).toBeFalse();
    });

    it('adds a run movement multiplier bonus while active', () => {
        const entry = mascEntry();

        expect(handler.getRunMovementMultiplierBonus(entry, entry.owner.turnState())).toBe(0);

        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        expect(handler.getRunMovementMultiplierBonus(entry, entry.owner.turnState())).toBe(0.5);
    });

    it('adds Jet Booster run movement bonus only while airborne', () => {
        const groundedEntry = mascEntry(['F_MASC', 'F_JET_BOOSTER'], false);
        const airborneEntry = mascEntry(['F_MASC', 'F_JET_BOOSTER'], true);
        groundedEntry.setState(MASC_ACTIVE_STATE_KEY, 'true');
        airborneEntry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        expect(handler.getRunMovementMultiplierBonus(groundedEntry, groundedEntry.owner.turnState())).toBe(0);
        expect(handler.getRunMovementMultiplierBonus(airborneEntry, airborneEntry.owner.turnState())).toBe(0.5);
    });

    it('resets active state at end turn without changing sequence state', () => {
        const entry = mascEntry();
        setMascSequenceState(entry, 2);
        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        handler.onEndTurn(entry, context());

        expect(getMascSequenceState(entry)).toBe(2);
        expect(isMascActive(entry)).toBeFalse();
        expect(entry.states.has(MASC_SEQUENCE_STATE_KEY)).toBeTrue();
    });

    it('ignores locked buttons', () => {
        const entry = mascEntry();

        handler.handleSelection(entry, handler.getChoices(entry, context())[2], context());

        expect(getMascSequenceState(entry)).toBe(0);
    });

    it('disables every button when the equipment is unavailable', () => {
        const entry = mascEntry();
        entry.setCommittedDestroyed(true);

        expect(handler.getChoices(entry, context()).every(choice => choice.disabled)).toBeTrue();
    });
});