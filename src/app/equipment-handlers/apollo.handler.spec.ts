import { MountedEquipment } from '../models/mounted-equipment.model';
import { WeaponEquipment, type AmmoType, type Equipment } from '../models/equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import { APOLLO_MODE_STATE, APOLLO_SATURATION_MODE, APOLLO_STANDARD_MODE, ApolloHandler } from './apollo.handler';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';

function owner(unavailableEntry?: MountedEquipment, gameRules: CBTGameRules = CORE_2026_GAME_RULES) {
    return {
        gameRules,
        rules: { computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate === unavailableEntry || candidate.committedDestroyed(), isDisabled: false, hitMod: 0 }) },
        setInventoryEntry: jasmine.createSpy('setInventoryEntry')
    } as never;
}

function entry(flags: string[] = [], destroyed = false): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: flags.join('-') || 'entry', name: 'Entry', equipment: { flags: new Set(flags) } as Equipment, destroyed });
}

function weapon(
    ammoType: Extract<AmmoType, 'LRM' | 'MML' | 'MRM'>,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
    flags: string[] = ammoType === 'MRM' ? ['F_MRM'] : []
): MountedEquipment {
    return new MountedEquipment({
        owner: owner(undefined, gameRules),
        id: ammoType.toLowerCase(),
        name: ammoType,
        equipment: new WeaponEquipment({ id: ammoType, name: ammoType, type: 'weapon', flags, weapon: { ammoType } })
    });
}

describe('ApolloHandler', () => {
    const handler = new ApolloHandler();

    it('applies the TW Apollo bonus to an intact linked MRM', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        apollo.owner = owner(undefined, TW_GAME_RULES);

        expect(handler.getToHitAdjustments(apollo, { parent: weapon('MRM', TW_GAME_RULES) })).toEqual([{ kind: 'add', value: -1, weakened: false }]);
    });

    it('does not apply the TW Apollo bonus when Apollo is unavailable', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        apollo.owner = owner(apollo, TW_GAME_RULES);

        expect(handler.getToHitAdjustments(apollo, { parent: weapon('MRM', TW_GAME_RULES) })).toEqual([{ kind: 'add', value: 0, weakened: true }]);
    });

    it('keeps the Core 2026 Apollo modifier neutral for MRMs', () => {
        expect(handler.getToHitAdjustments(
            entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']),
            { parent: weapon('MRM') }
        )).toEqual([]);
    });

    it('does not apply the TW Apollo bonus to incompatible launchers', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        apollo.owner = owner(undefined, TW_GAME_RULES);

        expect(handler.getToHitAdjustments(apollo, { parent: weapon('LRM', TW_GAME_RULES) })).toEqual([]);
        expect(handler.getToHitAdjustments(apollo, { parent: weapon('MML', TW_GAME_RULES) })).toEqual([]);
    });

    it('identifies MRMs by F_MRM rather than their ammo type', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        apollo.owner = owner(undefined, TW_GAME_RULES);

        expect(handler.getToHitAdjustments(apollo, { parent: weapon('MRM', TW_GAME_RULES, []) })).toEqual([]);
        expect(handler.getToHitAdjustments(apollo, { parent: weapon('LRM', TW_GAME_RULES, ['F_MRM']) })).toEqual([{ kind: 'add', value: -1, weakened: false }]);
    });

    it('adds AE to Core 2026 MRM damage in saturation mode', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        const launcher = new MountedEquipment({
            owner: owner(),
            id: 'mrm',
            name: 'MRM 10',
            equipment: new WeaponEquipment({ id: 'MRM10', name: 'MRM 10', type: 'weapon', flags: ['F_MRM'], weapon: { ammoType: 'MRM' } }),
            linkedWith: [apollo]
        });
        launcher.setState('inventory_control_mode', APOLLO_SATURATION_MODE);

        const types = handler.applyLinkedWeaponTypes?.(
            apollo,
            launcher,
            new Set(['C', 'M']),
            {} as never
        );

        expect(Array.from(types ?? [])).toEqual(['C', 'M', 'AE']);
    });

    it('uses standard mode when the linked Apollo is unavailable', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        apollo.owner = owner(apollo);
        const launcher = new MountedEquipment({
            owner: owner(),
            id: 'mrm',
            name: 'MRM 10',
            equipment: new WeaponEquipment({ id: 'MRM10', name: 'MRM 10', type: 'weapon', flags: ['F_MRM'], weapon: { ammoType: 'MRM' } }),
            linkedWith: [apollo],
            states: new Map([[APOLLO_MODE_STATE, APOLLO_SATURATION_MODE]])
        });

        const types = handler.applyLinkedWeaponTypes?.(
            apollo,
            launcher,
            new Set(['C', 'M']),
            {} as never
        );

        expect(handler.getChoices(launcher, {} as never)?.[0].value).toBe(APOLLO_STANDARD_MODE);
        expect(Array.from(types ?? [])).toEqual(['C', 'M']);
    });

    it('keeps Apollo saturation independent from the launcher SVG mode', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        const launcher = new MountedEquipment({
            owner: owner(),
            id: 'mrm',
            name: 'MRM 10',
            equipment: new WeaponEquipment({ id: 'MRM10', name: 'MRM 10', type: 'weapon', flags: ['F_MRM'], weapon: { ammoType: 'MRM' } }),
            linkedWith: [apollo],
            states: new Map([[INVENTORY_CONTROL_MODE_STATE, 'Extended Range']])
        });

        handler.handleSelection(launcher, { value: APOLLO_SATURATION_MODE } as never, {} as never);

        expect(launcher.states.get(APOLLO_MODE_STATE)).toBe(APOLLO_SATURATION_MODE);
        expect(launcher.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('Extended Range');
        expect(handler.getChoices(launcher, {} as never)?.[0].value).toBe(APOLLO_SATURATION_MODE);
    });
});
