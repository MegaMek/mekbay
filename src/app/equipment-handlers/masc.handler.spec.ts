import { MiscEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/force-serialization';
import { CORE_2026_RULES_DATA } from '../models/rules/cbt-rules-data';
import { ENTRY_DISABLED_STATE_KEY } from '../models/rules/unit-type-rules';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import {
    MASC_ACTIVE_STATE_KEY,
    MASC_SEQUENCE_STATE_KEY,
    MascHandler,
} from './masc.handler';

function owner(
    airborne: boolean | null = null,
    turnStateOverrides: Record<string, unknown> = {},
    rulesData?: typeof CORE_2026_RULES_DATA
) {
    const turnState = {
        airborne: () => airborne,
        ...turnStateOverrides,
    };
    return {
        rules: {
            computeEntryState: (entry: MountedEquipment) => ({ isDamaged: entry.committedDestroyed(), isDisabled: false, hitMod: 0 }),
            rulesData,
        },
        getNotificationDisplayName: () => 'Atlas AS7-D (Natasha Kerensky)',
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        turnState: () => turnState,
    } as never;
}

function mascEntry(
    flags: string[] = ['F_MASC'],
    airborne: boolean | null = null,
    turnStateOverrides: Record<string, unknown> = {},
    rulesData?: typeof CORE_2026_RULES_DATA
): MountedEquipment {
    return new MountedEquipment({
        owner: owner(airborne, turnStateOverrides, rulesData),
        id: 'masc',
        name: 'MASC',
        equipment: new MiscEquipment({ id: 'masc', name: 'MASC', type: 'misc', flags })
    });
}

function context(choiceSurface: HandlerContext['choiceSurface'] = 'turn-summary'): HandlerContext {
    return {
        toastService: { showToast: jasmine.createSpy('showToast') },
        choiceSurface,
    } as unknown as HandlerContext;
}

describe('MascHandler', () => {
    const handler = new MascHandler();

    it('starts with only the first sequence button clickable', () => {
        const choices = handler.getChoices(mascEntry(), context());

        expect(choices.slice(0, 5).map(choice => ({ label: choice.label, disabled: choice.disabled, active: choice.active, displayType: choice.displayType }))).toEqual([
            { label: '3+', disabled: false, active: false, displayType: 'toggle' },
            { label: '5+', disabled: true, active: false, displayType: 'toggle' },
            { label: '7+', disabled: true, active: false, displayType: 'toggle' },
            { label: '10+', disabled: true, active: false, displayType: 'toggle' },
            { label: '11+', disabled: true, active: false, displayType: 'toggle' },
        ]);
        expect(choices[5]).toEqual(jasmine.objectContaining({ label: '✖', shortLabel: '✖' }));
    });

    it('uses the Core2026 sequence progression for Core2026 units', () => {
        const choices = handler.getChoices(mascEntry(['F_MASC'], null, {}, CORE_2026_RULES_DATA), context());

        expect(choices.slice(0, 5).map(choice => choice.label)).toEqual(['3+', '5+', '7+', '10+', '11+']);
        expect(choices[4].colors).toEqual(jasmine.objectContaining({ selected: 'var(--bt-yellow)' }));
    });

    it('advances one step at a time and unlocks the next button', () => {
        const entry = mascEntry();

        handler.handleSelection(entry, handler.getChoices(entry, context())[0], context());

        expect(MascHandler.getSequenceState(entry)).toBe(1);
        expect(handler.isActive(entry)).toBeTrue();
        expect(handler.getChoices(entry, context()).slice(0, 5).map(choice => ({ disabled: choice.disabled, active: choice.active }))).toEqual([
            { disabled: false, active: true },
            { disabled: false, active: false },
            { disabled: true, active: false },
            { disabled: true, active: false },
            { disabled: true, active: false },
        ]);
        expect(handler.getChoices(entry, context()).slice(0, 5).map(choice => choice.selectionTone)).toEqual(['selected', 'muted', 'muted', 'muted', 'muted']);
    });

    it('uses muted tone for previous buttons and inactive current button', () => {
        const entry = mascEntry();
        MascHandler.setSequenceState(entry, 3);

        expect(handler.getChoices(entry, context()).slice(0, 5).map(choice => ({ active: choice.active, tone: choice.selectionTone }))).toEqual([
            { active: true, tone: 'muted' },
            { active: true, tone: 'muted' },
            { active: true, tone: 'muted' },
            { active: false, tone: 'muted' },
            { active: false, tone: 'muted' },
        ]);

        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        expect(handler.getChoices(entry, context()).slice(0, 5).map(choice => ({ active: choice.active, tone: choice.selectionTone }))).toEqual([
            { active: true, tone: 'muted' },
            { active: true, tone: 'muted' },
            { active: true, tone: 'selected' },
            { active: false, tone: 'muted' },
            { active: false, tone: 'muted' },
        ]);
    });

    it('turns off active state when the current sequence button is clicked again', () => {
        const entry = mascEntry();
        MascHandler.setSequenceState(entry, 3);
        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        handler.handleSelection(entry, handler.getChoices(entry, context())[2], context());

        expect(MascHandler.getSequenceState(entry)).toBe(3);
        expect(handler.isActive(entry)).toBeFalse();
    });

    it('truncates the sequence and clears active state when a previous button is clicked', () => {
        const entry = mascEntry();
        MascHandler.setSequenceState(entry, 3);
        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        handler.handleSelection(entry, handler.getChoices(entry, context())[0], context());

        expect(MascHandler.getSequenceState(entry)).toBe(1);
        expect(handler.isActive(entry)).toBeFalse();
    });

    it('hides Jet Booster choices when the unit is not airborne', () => {
        const entry = mascEntry(['F_MASC', 'F_JET_BOOSTER'], false);

        expect(MascHandler.canUseHandler(entry)).toBeFalse();
        expect(handler.getChoices(entry, context())).toEqual([]);
    });

    it('allows Jet Booster choices when the unit is airborne', () => {
        const entry = mascEntry(['F_MASC', 'F_JET_BOOSTER'], true);

        expect(MascHandler.canUseHandler(entry)).toBeTrue();
        expect(handler.getChoices(entry, context()).length).toBe(6);
    });

    it('ignores Jet Booster selections when the unit is not airborne', () => {
        const entry = mascEntry(['F_MASC', 'F_JET_BOOSTER'], false);

        handler.handleSelection(entry, { label: '3+', value: 0, displayType: 'toggle' }, context());

        expect(MascHandler.getSequenceState(entry)).toBe(0);
        expect(handler.isActive(entry)).toBeFalse();
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

    it('does not add a movement bonus while disabled', () => {
        const entry = mascEntry();
        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');
        entry.setState(ENTRY_DISABLED_STATE_KEY, 'true');

        expect(handler.getRunMovementMultiplierBonus(entry, entry.owner.turnState())).toBe(0);
    });

    it('resets active state at end turn without changing sequence state', () => {
        const entry = mascEntry();
        MascHandler.setSequenceState(entry, 2);
        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');

        handler.onEndTurn(entry, context());

        expect(MascHandler.getSequenceState(entry)).toBe(2);
        expect(handler.isActive(entry)).toBeFalse();
        expect(entry.states.has(MASC_SEQUENCE_STATE_KEY)).toBeTrue();
    });

    it('reduces the sequence at end turn when it was not active', () => {
        const entry = mascEntry();
        MascHandler.setSequenceState(entry, 2);
        const handlerContext = context();

        handler.onEndTurn(entry, handlerContext);

        expect(MascHandler.getSequenceState(entry)).toBe(1);
        expect(handler.isActive(entry)).toBeFalse();
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledWith(entry);
        expect(handlerContext.toastService.showToast).toHaveBeenCalledWith(
            'Atlas AS7-D (Natasha Kerensky): MASC sequence reduced to 1',
            'info'
        );
    });

    it('does not reduce the sequence below zero at end turn', () => {
        const entry = mascEntry();

        handler.onEndTurn(entry, context());

        expect(MascHandler.getSequenceState(entry)).toBe(0);
        expect(entry.owner.setInventoryEntry).not.toHaveBeenCalled();
    });

    it('uses text labels normally and an icon in the turn summary', () => {
        const entry = mascEntry();

        expect(handler.getChoices(entry, context('inventory')).at(-1)).toEqual(jasmine.objectContaining({
            label: 'Operational',
            value: 'escalating-failure-disabled',
        }));
        expect(handler.getChoices(entry, context('turn-summary'))).toHaveSize(6);
        expect(handler.getChoices(entry, context('turn-summary')).at(-1)).toEqual(jasmine.objectContaining({
            label: '✖',
            value: 'escalating-failure-disabled',
        }));

        entry.setState(ENTRY_DISABLED_STATE_KEY, 'true');

        expect(handler.getChoices(entry, context('turn-summary')).at(-1)?.colors).toEqual(
            jasmine.objectContaining({ selectedText: '#fff' })
        );
    });

    it('prevents state changes and end-turn decay while disabled', () => {
        const entry = mascEntry();
        MascHandler.setSequenceState(entry, 2);
        entry.setState(ENTRY_DISABLED_STATE_KEY, 'true');

        handler.handleSelection(entry, { label: '5+', value: 1, displayType: 'toggle' }, context());
        handler.onEndTurn(entry, context());

        expect(MascHandler.getSequenceState(entry)).toBe(2);
        expect(handler.isActive(entry)).toBeFalse();
    });

    it('disables and re-enables escalating failure equipment', () => {
        const entry = mascEntry();
        const handlerContext = context('inventory');
        entry.setState(MASC_ACTIVE_STATE_KEY, 'true');
        const disableChoice = handler.getChoices(entry, handlerContext).at(-1)!;

        handler.handleSelection(entry, disableChoice, handlerContext);

        expect(entry.states.get(ENTRY_DISABLED_STATE_KEY)).toBe('true');
        expect(handler.isActive(entry)).toBeFalse();

        handler.handleSelection(entry, handler.getChoices(entry, handlerContext).at(-1)!, handlerContext);

        expect(entry.states.has(ENTRY_DISABLED_STATE_KEY)).toBeFalse();
    });

    it('ignores locked buttons', () => {
        const entry = mascEntry();

        handler.handleSelection(entry, handler.getChoices(entry, context())[2], context());

        expect(MascHandler.getSequenceState(entry)).toBe(0);
    });

    it('disables every button when the equipment is unavailable', () => {
        const entry = mascEntry();
        entry.setCommittedDestroyed(true);

        expect(handler.getChoices(entry, context()).every(choice => choice.disabled)).toBeTrue();
    });
});