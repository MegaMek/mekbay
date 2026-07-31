import type { PickerChoice } from '../components/picker/picker.interface';
import { MiscEquipment, WeaponEquipment, type WeaponDamage, type WeaponType } from '../models/equipment.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import { EquipmentInteractionRegistry, type HandlerContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';
import {
    BOMBAST_LASER_CHARGED_COLOR,
    BOMBAST_LASER_CHARGED_STATE,
    BOMBAST_LASER_CHARGED_TEXT_COLOR,
    BOMBAST_LASER_CHARGE_STATE_KEY,
    BOMBAST_LASER_CHARGING_STATE,
    BOMBAST_LASER_DAMAGE_12_MODE,
    BOMBAST_LASER_DAMAGE_16_MODE,
    BOMBAST_LASER_DAMAGE_8_MODE,
    BOMBAST_LASER_FIRED_STATE_KEY,
    BombastLaserHandler,
    bombastLaserChargeState,
    selectedBombastLaserMode
} from './bombast-laser.handler';

function owner(gameRules: CBTGameRules = CORE_2026_GAME_RULES) {
    return {
        gameRules,
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        isEquipmentActionUnavailable: jasmine.createSpy('isEquipmentActionUnavailable').and.returnValue(false),
        rules: {
            computeEntryState: (entry: MountedEquipment) => ({
                isDamaged: entry.committedDestroyed(),
                isDisabled: false,
                hitMod: 0
            })
        }
    } as never;
}

function bombastLaser(
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
    states = new Map<string, string>(),
    destroyed = false
): MountedWeapon {
    return new MountedWeapon({
        owner: owner(gameRules),
        id: 'bombast-laser',
        name: 'Bombast Laser',
        states,
        destroyed,
        equipment: new WeaponEquipment({
            id: 'Bombast Laser',
            name: 'Bombast Laser',
            shortName: 'Bombast',
            type: 'weapon',
            flags: ['F_BOMBAST_LASER', 'F_DIRECT_FIRE', 'F_ENERGY', 'F_LASER'],
            weapon: { ammoType: 'NA', damage: 12, heat: 12 }
        })
    });
}

function context(): HandlerContext {
    return {
        toastService: { showToast: jasmine.createSpy('showToast') }
    } as unknown as HandlerContext;
}

const damageContext = {} as never;
const baseDamage: WeaponDamage = { values: [12], maximum: 12 };

function select(handler: BombastLaserHandler, entry: MountedEquipment, value: string, handlerContext = context()): void {
    handler.handleSelection(entry, { value } as PickerChoice, handlerContext);
}

describe('BombastLaserHandler', () => {
    const handler = new BombastLaserHandler();

    it('offers the three Core damage levels and a charge control', () => {
        const choices = handler.getChoices(bombastLaser(), context());

        expect(choices[0]).toEqual(jasmine.objectContaining({
            label: 'Mode',
            value: BOMBAST_LASER_DAMAGE_12_MODE,
            displayType: 'dropdown',
            choices: [
                { label: '8 DMG', value: BOMBAST_LASER_DAMAGE_8_MODE },
                { label: '12 DMG', value: BOMBAST_LASER_DAMAGE_12_MODE },
                { label: '16 DMG', value: BOMBAST_LASER_DAMAGE_16_MODE }
            ],
            keepOpen: true
        }));
        expect(choices[1]).toEqual(jasmine.objectContaining({
            label: 'Charge Laser',
            shortLabel: 'Charge',
            value: BOMBAST_LASER_CHARGING_STATE,
            active: false,
            displayType: 'toggle'
        }));
    });

    it('defaults missing and invalid mode and charge states safely', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, 'Damage 99'],
            [BOMBAST_LASER_CHARGE_STATE_KEY, 'invalid']
        ]));

        expect(selectedBombastLaserMode(entry)).toBe(BOMBAST_LASER_DAMAGE_12_MODE);
        expect(bombastLaserChargeState(entry)).toBeNull();
    });

    it('persists valid damage selections without changing charge state', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
        ]));

        select(handler, entry, BOMBAST_LASER_DAMAGE_16_MODE);

        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe(BOMBAST_LASER_DAMAGE_16_MODE);
        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGED_STATE);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledWith(entry);
    });

    it('resolves damage and heat for every selectable damage level', () => {
        const profiles = [
            { mode: BOMBAST_LASER_DAMAGE_8_MODE, damage: 8, heat: 6 },
            { mode: BOMBAST_LASER_DAMAGE_12_MODE, damage: 12, heat: 9 },
            { mode: BOMBAST_LASER_DAMAGE_16_MODE, damage: 16, heat: 12 }
        ];

        for (const profile of profiles) {
            const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([[INVENTORY_CONTROL_MODE_STATE, profile.mode]]));
            expect(handler.applyInventoryControlDamageEffects(entry, baseDamage, damageContext, context()))
                .toEqual({ values: [profile.damage], maximum: profile.damage });
            expect(handler.applyInventoryControlHeatEffects(entry, { value: 12, weakened: false }, context()))
                .toEqual({ value: profile.heat, weakened: false });
        }
        expect(baseDamage).toEqual({ values: [12], maximum: 12 });
    });

    it('applies the selected damage across range profiles', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_8_MODE]
        ]));
        const rangedDamage: WeaponDamage = { values: [12, 10, 8], maximum: 12 };

        expect(handler.applyInventoryControlDamageEffects(entry, rangedDamage, damageContext, context())).toEqual({
            values: [8, 8, 8],
            maximum: 8
        });
        expect(rangedDamage.values).toEqual([12, 10, 8]);
    });

    it('applies +1 and +2 TN modifiers for uncharged 12 and 16 damage attacks', () => {
        const damage12 = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_12_MODE]
        ]));
        const damage16 = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_16_MODE]
        ]));

        expect(handler.getToHitAdjustments(bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_8_MODE]
        ])), {}, context())).toEqual([]);
        expect(handler.getToHitAdjustments(damage12, {}, context())).toEqual([{
            kind: 'replace-base', value: 1, label: 'Bombast (Damage 12)'
        }]);
        expect(handler.getToHitAdjustments(damage16, {}, context())).toEqual([{
            kind: 'replace-base', value: 2, label: 'Bombast (Damage 16)'
        }]);
    });

    it('treats the selected TN as a mode base rather than a weakened modifier', () => {
        for (const [mode, expected] of [
            [BOMBAST_LASER_DAMAGE_12_MODE, 1],
            [BOMBAST_LASER_DAMAGE_16_MODE, 2]
        ] as const) {
            const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([[INVENTORY_CONTROL_MODE_STATE, mode]]));
            const resolution = CORE_2026_GAME_RULES.resolveToHit({
                subject: entry,
                adjustments: handler.getToHitAdjustments(entry, {}, context())
            });

            expect(resolution.value).toBe(expected);
            expect(resolution.weakened).toBeFalse();
            expect(resolution.modifierBreakdown).toEqual([{
                label: `Bombast (${mode})`,
                modifier: expected
            }]);
        }
    });

    it('suppresses every additional TN modifier while charged', () => {
        for (const mode of [BOMBAST_LASER_DAMAGE_8_MODE, BOMBAST_LASER_DAMAGE_12_MODE, BOMBAST_LASER_DAMAGE_16_MODE]) {
            const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
                [INVENTORY_CONTROL_MODE_STATE, mode],
                [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
            ]));

            expect(handler.getToHitAdjustments(entry, {}, context())).toEqual([]);
        }
    });

    it('charges for one turn, blocks firing, and becomes charged at end turn', () => {
        const entry = bombastLaser();
        const handlerContext = context();

        select(handler, entry, BOMBAST_LASER_CHARGING_STATE, handlerContext);

        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGING_STATE);
        expect(handler.isInventoryControlSelectable(entry, handlerContext)).toBeFalse();
        expect(handlerContext.toastService.showToast).toHaveBeenCalledWith('Bombast Laser charging', 'info');

        handler.onEndTurn(entry, handlerContext);

        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGED_STATE);
        expect(handler.isInventoryControlSelectable(entry, handlerContext)).toBeNull();
        expect(handler.getChoices(entry, handlerContext)[1]).toEqual(jasmine.objectContaining({
            label: 'Laser Charged!',
            shortLabel: 'Charged!',
            value: 'discharged',
            active: true,
            colors: {
                selected: BOMBAST_LASER_CHARGED_COLOR,
                selectedText: BOMBAST_LASER_CHARGED_TEXT_COLOR
            }
        }));
    });

    it('can begin charged, gains X, and discharges after firing', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
        ]));
        const types = new Set<WeaponType>(['DE', 'V']);

        expect(handler.applyInventoryControlWeaponTypes(entry, types, context()))
            .toEqual(new Set<WeaponType>(['DE', 'V', 'X']));
        expect(types).toEqual(new Set<WeaponType>(['DE', 'V']));

        handler.afterInventoryControlFire(entry, context());

        expect(entry.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
        expect(entry.states.get(BOMBAST_LASER_FIRED_STATE_KEY)).toBe('1');
        expect(handler.applyInventoryControlWeaponTypes(entry, types, context())).toBe(types);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledWith(entry);
    });

    it('rejects charging after firing until the turn ends', () => {
        const entry = bombastLaser();
        const handlerContext = context();
        handler.afterInventoryControlFire(entry, handlerContext);

        select(handler, entry, BOMBAST_LASER_CHARGING_STATE, handlerContext);

        expect(entry.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
        expect(handlerContext.toastService.showToast).toHaveBeenCalledWith(
            'A fired Bombast Laser cannot charge this turn.',
            'error'
        );

        handler.onEndTurn(entry, handlerContext);
        expect(entry.states.has(BOMBAST_LASER_FIRED_STATE_KEY)).toBeFalse();

        select(handler, entry, BOMBAST_LASER_CHARGING_STATE, handlerContext);
        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGING_STATE);
    });

    it('allows a charge to be manually dissipated', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
        ]));
        const handlerContext = context();

        select(handler, entry, 'discharged', handlerContext);

        expect(entry.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
        expect(handlerContext.toastService.showToast).toHaveBeenCalledWith('Bombast Laser discharged', 'info');
    });

    it('does not finish charging while unavailable', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGING_STATE]
        ]), true);

        handler.onEndTurn(entry, context());

        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGING_STATE);
        expect(handler.getChoices(entry, context()).every(choice => choice.disabled)).toBeTrue();
    });

    it('does not register any Bombast interaction under Total Warfare', () => {
        const entry = bombastLaser(TW_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_16_MODE],
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
        ]));
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);
        const heat = { value: 12, weakened: false };
        const types = new Set<WeaponType>(['DE', 'V']);

        expect(handler.applicableTo(entry)).toBeFalse();
        expect(registry.getHandlers(entry)).toEqual([]);
        expect(registry.getChoices(entry, context())).toEqual([]);
        expect(registry.applyInventoryControlDamageEffects(entry, baseDamage, damageContext, context())).toBe(baseDamage);
        expect(registry.applyInventoryControlHeatEffects(entry, heat, context())).toBe(heat);
        expect(registry.applyWeaponTypes(entry, types, context())).toBe(types);
        expect(registry.getToHitAdjustments(entry, context())).toEqual([]);
        expect(registry.isInventoryControlSelectable(entry, context())).toBeTrue();

        registry.afterInventoryControlFire(entry, context());
        registry.onEndTurn(entry, context());
        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGED_STATE);
        expect(entry.owner.setInventoryEntry).not.toHaveBeenCalled();
    });

    it('requires weapon equipment in addition to the Bombast flag', () => {
        const misc = new MountedEquipment({
            owner: owner(),
            id: 'misc-bombast',
            name: 'Misc Bombast',
            equipment: new MiscEquipment({
                id: 'misc-bombast',
                name: 'Misc Bombast',
                type: 'misc',
                flags: ['F_BOMBAST_LASER']
            })
        });

        expect(handler.applicableTo(bombastLaser())).toBeTrue();
        expect(handler.applicableTo(bombastLaser(TW_GAME_RULES))).toBeFalse();
        expect(handler.applicableTo(misc)).toBeFalse();
        expect(handler.flags).toEqual(['F_BOMBAST_LASER']);
    });
});
