import { AmmoEquipment, MiscEquipment, WeaponEquipment, type Equipment } from '../equipment.model';
import { MountedEquipment } from '../mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from './game-rules';

let entryId = 0;

function owner() {
    return {
        rules: {
            computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate.committedDestroyed(), isDisabled: false, hitMod: 0 }),
            computeAllEntryStates: () => new Map(),
            heatDissipation: () => null
        }
    } as never;
}

function mountedEntry(flags: string[] = []): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: `entry-${entryId++}`,
        name: 'Entry',
        equipment: { flags: new Set(flags) } as Equipment
    });
}

function mountedWeapon(toHitModifier: number | number[], linkedWith: MountedEquipment[] = []): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: `weapon-${entryId++}`,
        name: 'Weapon',
        equipment: new WeaponEquipment({
            id: 'TestWeapon',
            name: 'Test weapon',
            type: 'weapon',
            stats: { toHitModifier },
            weapon: { ammoType: 'NA', ranges: [1, 2, 3, 4] }
        }),
        linkedWith
    });
}

function physicalAttack(name: string): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: name, name, physical: true });
}

describe('game rules', () => {
    it('reduces Core 2026 MRM hit modifiers without changing TW values', () => {
        const mrm = new WeaponEquipment({
            id: 'MRM10', name: 'MRM 10', type: 'weapon',
            stats: { toHitModifier: [-1, 0, 1] },
            flags: ['F_MRM'],
            weapon: { ammoType: 'MRM' }
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mrm }).profile).toEqual([-2, -1, 0]);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mrm, range: 'medium' }).value).toBe(-1);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm }).profile).toEqual([-1, 0, 1]);
    });

    it('resolves the catalog MRM +1 modifier as zero in Core 2026 and one in TW', () => {
        const mrm = new WeaponEquipment({
            id: 'MRM10', name: 'MRM 10', type: 'weapon',
            stats: { toHitModifier: 1 },
            flags: ['F_MRM'],
            weapon: { ammoType: 'MRM' }
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mrm }).value).toBe(0);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm }).value).toBe(1);
    });

    it('increases Core 2026 precision ammo shots without changing TW values', () => {
        const precisionAmmo = new AmmoEquipment({
            id: 'PrecisionAC5', name: 'Precision AC/5', type: 'ammo',
            ammo: { type: 'AC', shots: 10, munitionType: ['M_PRECISION'] }
        });

        expect(precisionAmmo.getShots(CORE_2026_GAME_RULES)).toBe(16);
        expect(precisionAmmo.getShots(TW_GAME_RULES)).toBe(10);
        expect(precisionAmmo.getEffectiveKgPerShot(CORE_2026_GAME_RULES)).toBe(62.5);
        expect(precisionAmmo.getEffectiveKgPerShot(TW_GAME_RULES)).toBe(100);
    });

    it('sets Core 2026 claw and lance hit modifiers to zero without changing TW values', () => {
        const claw = new WeaponEquipment({
            id: 'BattleClaw', name: 'Battle Claw', type: 'weapon',
            flags: ['S_CLAW'], stats: { toHitModifier: -2 }
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: claw }).profile).toEqual([0]);
        expect(TW_GAME_RULES.resolveToHit({ subject: claw }).profile).toEqual([-2]);
    });

    it('resolves scalar and range-specific mounted weapon hit modifiers', () => {
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mountedWeapon(-2) }).value).toBe(-2);

        const weapon = mountedWeapon([-3, -2, -1]);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon }).value).toBe('*');
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'short' }).value).toBe(-3);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'medium' }).value).toBe(-2);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'long' }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'extreme' }).value).toBe(-1);
    });

    it('replaces the base while preserving explicit zero', () => {
        const weapon = mountedWeapon(-2);

        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: weapon,
            adjustments: [{ kind: 'replace-base', value: 0 }]
        });

        expect(resolution.value).toBe(0);
        expect(resolution.changed).toBeTrue();
        expect(resolution.weakened).toBeFalse();
    });

    it('evaluates weakening against the effective replacement baseline', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            adjustments: [
                { kind: 'replace-base', value: 0 },
                { kind: 'add', value: 1 }
            ]
        });

        expect(resolution.value).toBe(1);
        expect(resolution.weakened).toBeTrue();
    });

    it('keeps the first and highest-priority base replacement', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            adjustments: [
                { kind: 'replace-base', value: 0 },
                { kind: 'replace-base', value: 4 },
                { kind: 'add', value: 1 }
            ]
        });

        expect(resolution.value).toBe(1);
        expect(resolution.profile).toEqual([1]);
    });

    it('resolves ruleset-specific physical attack modifiers', () => {
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('punch') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('Punch') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('kick') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('club') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('push') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('charge') }).value).toBe('Vs');
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('death from above') }).value).toBe('Vs');
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('frenzy') }).value).toBe(0);
        expect(TW_GAME_RULES.resolveToHit({ subject: physicalAttack('punch') }).value).toBe(0);
        expect(TW_GAME_RULES.resolveToHit({ subject: physicalAttack('kick') }).value).toBe(-2);
    });

    it('uses equipment data for mounted physical weapon modifiers', () => {
        const sword = new MountedEquipment({
            owner: owner(),
            id: 'sword',
            name: 'Sword',
            equipment: new MiscEquipment({
                id: 'Sword',
                name: 'Sword',
                type: 'misc',
                flags: ['F_HAND_WEAPON'],
                stats: { toHitModifier: -2 }
            })
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: sword }).value).toBe(-2);
    });

    it('includes resolved linked modifiers in final hit modifiers', () => {
        const launcher = mountedWeapon(-1, [mountedEntry(['F_WEAPON_ENHANCEMENT'])]);

        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: launcher,
            adjustments: [{ kind: 'add', value: 1 }]
        }).value).toBe(0);
    });

    it('reports changed and weakened metadata without a second resolution', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            stateModifier: 1,
            adjustments: [{ kind: 'add', value: 0, weakened: true }]
        });

        expect(resolution).toEqual({ profile: [-1], value: -1, changed: true, weakened: true });
    });

    it('supports explicit rejection and no-range boundary cases', () => {
        const weapon = mountedWeapon(-2);
        const noRange = weapon.equipment as WeaponEquipment;
        noRange.weapon.ranges.fill(0);

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon }).value).toBeNull();
        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: weapon,
            adjustments: [{ kind: 'replace-base', value: -2 }]
        }).value).toBe(-2);
        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            adjustments: [{ kind: 'unsupported' }]
        }).value).toBeNull();
    });
});