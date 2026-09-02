// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, MiscEquipment, WeaponEquipment, type Equipment } from '../equipment.model';
import { EquipmentRegistry } from '../equipment-lookup';
import type { AmmoMunitionFlag } from '../ammo-munition-flags.type';
import type { EquipmentFlag } from '../equipment-flags.type';
import { asComponentId } from '../entity/entity-identifiers';
import { asEncounterTargetId } from '../runtime/encounter-runtime';
import type { IntrinsicWeaponKind } from '../entity/types/weapon';
import type { ComponentToHitSubject } from './game-rules';
import {
    CORE_2026_GAME_RULES,
    ESCALATING_FAILURE_AUTO_FAIL_TARGET,
    ESCALATING_FAILURE_NO_CHECK_TARGET,
    TW_GAME_RULES,
    separateHeatFireModifier,
} from './game-rules';

describe('CBT game rules', () => {
    describe('escalating failure targets', () => {
        it('owns the numeric Core sequences', () => {
            const standard = [3, 5, 7, 10, 11] as const;

            expect(CORE_2026_GAME_RULES.escalatingFailureTargets).toEqual(standard);
            expect(CORE_2026_GAME_RULES.radicalHeatSinkFailureTargets).toEqual(standard);
            expect(CORE_2026_GAME_RULES.emergencyCoolantSystemFailureTargets).toEqual(standard);
            expect(CORE_2026_GAME_RULES.viralJammerFailureTargets).toEqual(standard);
            expect(CORE_2026_GAME_RULES.blueShieldFailureTargets).toEqual([
                0, 0, 0, 0, 0, ...standard,
            ] as const);
            expect(CORE_2026_GAME_RULES.escalatingFailureLabels).toEqual([
                '3+', '5+', '7+', '10+', '11+',
            ]);
        });

        it('owns the distinct Total Warfare sequences', () => {
            expect(TW_GAME_RULES.escalatingFailureTargets).toEqual([
                3, 5, 7, 11, ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
            expect(TW_GAME_RULES.radicalHeatSinkFailureTargets).toEqual([
                3, 5, 7, 10, 11, ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
            expect(TW_GAME_RULES.blueShieldFailureTargets).toEqual([
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
                ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
            expect(TW_GAME_RULES.emergencyCoolantSystemFailureTargets).toEqual([
                3, 5, 7, 10, ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
            expect(TW_GAME_RULES.viralJammerFailureTargets).toEqual([
                4, 5, 6, 7, 8, 9, 10, 11, 12,
                ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
            expect(TW_GAME_RULES.escalatingFailureLabels).toEqual(['3+', '5+', '7+', '11+', '!!']);
        });
    });

    describe('hull breach checks', () => {
        it('uses the Core low-roll range', () => {
            expect(CORE_2026_GAME_RULES.getHullBreachCheckRangeLabel()).toBe('2–4');
            expect([2, 3, 4].every(total => CORE_2026_GAME_RULES.hullBreachCheckSucceeds(total))).toBeTrue();
            expect(CORE_2026_GAME_RULES.hullBreachCheckSucceeds(5)).toBeFalse();
            expect(CORE_2026_GAME_RULES.hullBreachCheckSucceeds(12)).toBeFalse();
        });

        it('uses the Total Warfare high-roll range', () => {
            expect(TW_GAME_RULES.getHullBreachCheckRangeLabel()).toBe('10+');
            expect(TW_GAME_RULES.hullBreachCheckSucceeds(9)).toBeFalse();
            expect(TW_GAME_RULES.hullBreachCheckSucceeds(10)).toBeTrue();
            expect(TW_GAME_RULES.hullBreachCheckSucceeds(12)).toBeTrue();
        });
    });

    describe('C3 degradation', () => {
        const target = {
            id: asEncounterTargetId('A'), letter: 'A', name: 'Target', color: '#000',
            distance: 15, c3Distance: 12, useC3: true, tnModifier: 0,
        } as const;

        it('keeps degraded C3 in Core and applies the lost bracket benefit as ECM', () => {
            const resolution = CORE_2026_GAME_RULES.resolveC3Targeting(target, 'network-member');

            expect(CORE_2026_GAME_RULES.c3DegradationLabel).toBe('DEGRADED');
            expect(resolution.target).toBe(target);
            expect(CORE_2026_GAME_RULES.resolveC3TargetingModifier('network-member', 2)).toEqual({
                label: 'ECM', modifier: 2, weakened: true,
            });
            expect(CORE_2026_GAME_RULES.resolveC3TargetingModifier('none', 2)).toBeNull();
            expect(CORE_2026_GAME_RULES.resolveC3TargetingModifier('unit', 0)).toBeNull();
        });

        it('removes jammed C3 from Total Warfare without mutating the target', () => {
            const resolution = TW_GAME_RULES.resolveC3Targeting(target, 'unit');

            expect(TW_GAME_RULES.c3DegradationLabel).toBe('JAMMED');
            expect(resolution.target.c3Distance).toBeUndefined();
            expect(resolution.target.useC3).toBeTrue();
            expect(target.c3Distance).toBe(12);
            expect(TW_GAME_RULES.resolveC3TargetingModifier('unit', 2)).toBeNull();
            expect(TW_GAME_RULES.resolveC3Targeting(target, 'none').target).toBe(target);
        });
    });

    it('keeps the ruleset-specific MRM and physical-attack modifiers', () => {
        const mrm = new WeaponEquipment({
            id: 'MRM10', name: 'MRM 10', type: 'weapon',
            stats: { toHitModifier: [-1, 0, 1] },
            flags: ['F_MRM'], weapon: { ammoType: 'MRM' },
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mrm }).profile).toEqual([0]);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mrm, range: 'medium' }).value).toBe(0);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm }).profile).toEqual([1]);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('punch') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('kick') }).value).toBe(-1);
        expect(TW_GAME_RULES.resolveToHit({ subject: physicalAttack('punch') }).value).toBe(0);
        expect(TW_GAME_RULES.resolveToHit({ subject: physicalAttack('kick') }).value).toBe(-2);
        expect(TW_GAME_RULES.resolveToHit({ subject: physicalAttack('charge') }).value).toBe('Vs');
    });

    it('keeps Core and Total Warfare Immobile attack exceptions separate', () => {
        const direct = {
            areaEffect: false,
            artillery: false,
            artilleryCannon: false,
            bomb: false,
            mekMortarAirburst: false,
        } as const;

        expect(CORE_2026_GAME_RULES.attackBenefitsFromImmobile(direct)).toBeTrue();
        expect(CORE_2026_GAME_RULES.attackBenefitsFromImmobile({
            ...direct,
            areaEffect: true,
        })).toBeFalse();
        expect(TW_GAME_RULES.attackBenefitsFromImmobile({
            ...direct,
            artillery: true,
            areaEffect: true,
        })).toBeTrue();
        expect(TW_GAME_RULES.attackBenefitsFromImmobile({
            ...direct,
            artilleryCannon: true,
        })).toBeFalse();
        expect(TW_GAME_RULES.attackBenefitsFromImmobile({ ...direct, bomb: true })).toBeFalse();
        expect(TW_GAME_RULES.attackBenefitsFromImmobile({
            ...direct,
            mekMortarAirburst: true,
        })).toBeFalse();
    });

    it('keeps Core special-ammo capacity rules separate from Total Warfare', () => {
        const baseAmmo = new AmmoEquipment({
            id: 'AC5Ammo', name: 'AC/5 Ammo', type: 'ammo', ammo: { type: 'AC', shots: 10 },
        });
        const precisionAmmo = new AmmoEquipment({
            id: 'PrecisionAC5', name: 'Precision AC/5', type: 'ammo',
            ammo: { type: 'AC', shots: 20, baseAmmo: baseAmmo.id, munitionType: ['M_PRECISION'] },
        });
        const armorPiercingAmmo = new AmmoEquipment({
            id: 'ArmorPiercingAC5', name: 'Armor-Piercing AC/5', type: 'ammo',
            ammo: {
                type: 'AC', shots: 20, kgPerShot: 50, baseAmmo: baseAmmo.id,
                munitionType: ['M_ARMOR_PIERCING'],
            },
        });
        const registry = new EquipmentRegistry({
            [baseAmmo.id]: baseAmmo,
            [precisionAmmo.id]: precisionAmmo,
            [armorPiercingAmmo.id]: armorPiercingAmmo,
        });

        expect(precisionAmmo.getShots(CORE_2026_GAME_RULES, registry)).toBe(6);
        expect(armorPiercingAmmo.getShots(CORE_2026_GAME_RULES, registry)).toBe(8);
        expect(precisionAmmo.getShots(TW_GAME_RULES, registry)).toBe(5);
        expect(precisionAmmo.getEffectiveKgPerShot(CORE_2026_GAME_RULES, registry)).toBe(1000 / 6);
        expect(precisionAmmo.getEffectiveKgPerShot(TW_GAME_RULES, registry)).toBe(200);
    });

    it('keeps Core claw/lance modifiers separate from Total Warfare', () => {
        const claw = new WeaponEquipment({
            id: 'BattleClaw', name: 'Battle Claw', type: 'weapon',
            flags: ['S_CLAW'], stats: { toHitModifier: -2 },
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: claw }).profile).toEqual([0]);
        expect(TW_GAME_RULES.resolveToHit({ subject: claw }).profile).toEqual([1]);
    });

    it('resolves range profiles and composes state and equipment modifiers once', () => {
        const weapon = installedWeapon([-3, -2, -1]);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon }).value).toBe('*');
        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: weapon,
            stateModifiers: [{ label: 'Damaged system', modifier: 0, weakened: true }],
        }).modifierBreakdown).toEqual([
            { label: 'Damaged system', modifier: 0, weakened: true },
        ]);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'short' }).value).toBe(-3);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'medium' }).value).toBe(-2);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'extreme' }).value).toBe(-1);

        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: installedWeapon(-1),
            adjustments: [{ kind: 'add', label: 'Linked system', modifier: 1 }],
        }).value).toBe(0);
    });

    it('uses the first base replacement and preserves explicit zero', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: installedWeapon(-2),
            adjustments: [
                { kind: 'replace-base', value: 0, label: 'Vibroblade' },
                { kind: 'replace-base', value: 4, label: 'Ignored replacement' },
                { kind: 'add', label: 'Damage', modifier: 1 },
            ],
        });

        expect(resolution.value).toBe(1);
        expect(resolution.profile).toEqual([1]);
        expect(resolution.changed).toBeTrue();
    });

    it('retains named sparse-state provenance and weakened metadata', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: installedWeapon(-2),
            stateModifiers: [{ label: 'Heat', modifier: 1, weakened: true, kind: 'heat' }],
            adjustments: [{ kind: 'add', label: 'Lost bonus', modifier: 0, weakened: true }],
        });

        expect(resolution).toEqual({
            profile: [-1], value: -1, changed: true, weakened: true,
            modifierBreakdown: [
                { label: 'Base Hit Modifier', modifier: -2 },
                { label: 'Heat', modifier: 1, weakened: true, kind: 'heat' },
                { label: 'Lost bonus', modifier: 0, weakened: true },
            ],
        });
    });

    it('separates heat by typed provenance rather than display text', () => {
        expect(separateHeatFireModifier({
            profile: [2], value: 2, changed: true, weakened: true,
            modifierBreakdown: [
                { label: 'Targeting Computer', modifier: -1 },
                { label: 'Localized heat label', modifier: 3, weakened: true, kind: 'heat' },
            ],
        })).toEqual({
            hitModifier: -1,
            hitModifierBreakdown: [{ label: 'Targeting Computer', modifier: -1 }],
            heatFireModifier: 3,
        });
    });

    it('rejects unsupported and no-range installed components unless a rule replaces the base', () => {
        const noRange = new WeaponEquipment({
            id: 'NoRange', name: 'No Range', type: 'weapon',
            stats: { toHitModifier: -2 }, weapon: { ranges: [0, 0, 0, 0] },
        });
        const subject = installed(noRange);

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject }).value).toBeNull();
        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject,
            adjustments: [{ kind: 'replace-base', value: -2, label: 'Explicit rule' }],
        }).value).toBe(-2);
        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: installedWeapon(-2),
            adjustments: [{ kind: 'unsupported' }],
        }).value).toBeNull();
    });

    it('uses installed physical-equipment data without a mounted-equipment owner graph', () => {
        const sword = new MiscEquipment({
            id: 'Sword', name: 'Sword', type: 'misc',
            flags: ['F_HAND_WEAPON'], stats: { toHitModifier: -2 },
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: installed(sword) }).value).toBe(-2);
    });

    it('ports indirect-fire ammunition legality without a mounted owner graph', () => {
        const lrm = new WeaponEquipment({
            id: 'LRM10', name: 'LRM 10', type: 'weapon',
            flags: ['F_INDIRECT_FIRE'], weapon: { ammoType: 'LRM', rackSize: 10 },
        });
        const directOnly = new WeaponEquipment({
            id: 'DirectLRM10', name: 'Direct LRM 10', type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: 10 },
        });
        const mml = new WeaponEquipment({
            id: 'MML9', name: 'MML 9', type: 'weapon',
            flags: ['F_INDIRECT_FIRE'], weapon: { ammoType: 'MML', rackSize: 9 },
        });
        const standard = ammo('LRMAmmo', 'LRM');
        const torpedo = ammo('LRMTorpedo', 'LRM', ['M_TORPEDO']);
        const mmlLrm = ammo('MMLLRM', 'MML', [], ['F_MML_LRM']);
        const mmlSrm = ammo('MMLSRM', 'MML', [], ['F_MML_SRM']);
        const dry = { weaponUnderwater: false, targetHasUnderwaterLayer: false } as const;
        const underwater = { weaponUnderwater: true, targetHasUnderwaterLayer: true } as const;

        expect(CORE_2026_GAME_RULES.canFireIndirectly(directOnly, standard, dry)).toBeFalse();
        expect(CORE_2026_GAME_RULES.canFireIndirectly(lrm, standard, dry)).toBeTrue();
        expect(CORE_2026_GAME_RULES.canFireIndirectly(mml, mmlLrm, dry)).toBeTrue();
        expect(CORE_2026_GAME_RULES.canFireIndirectly(mml, mmlSrm, dry)).toBeFalse();
        expect(CORE_2026_GAME_RULES.canFireIndirectly(lrm, torpedo, underwater)).toBeFalse();
        expect(TW_GAME_RULES.canFireIndirectly(lrm, torpedo, dry)).toBeFalse();
        expect(TW_GAME_RULES.canFireIndirectly(lrm, torpedo, underwater)).toBeTrue();
    });

    it('ports NARC, semi-guided, TAG-designation, and flamer policy differences', () => {
        expect(CORE_2026_GAME_RULES.supportsFlamerModes).toBeFalse();
        expect(TW_GAME_RULES.supportsFlamerModes).toBeTrue();
        expect(CORE_2026_GAME_RULES.narcHomingTargetModifier).toBe(-1);
        expect(TW_GAME_RULES.narcHomingTargetModifier).toBe(0);
        expect(CORE_2026_GAME_RULES.getNarcBeaconAttackRestriction({
            targetInsideBuilding: true, targetIsInfantry: true,
        })).toBeNull();
        expect(TW_GAME_RULES.getNarcBeaconAttackRestriction({
            targetInsideBuilding: false, targetIsInfantry: true,
        })).toBe('infantry');
        expect(TW_GAME_RULES.getNarcBeaconAttackRestriction({
            targetInsideBuilding: true, targetIsInfantry: false,
        })).toBe('building');
        expect(CORE_2026_GAME_RULES.getSemiGuidedAdjustment(4, 'terrain')).toBe(2);
        expect(CORE_2026_GAME_RULES.getSemiGuidedAdjustment(4, 'movement')).toBe(0);
        expect(TW_GAME_RULES.getSemiGuidedAdjustment(4, 'terrain')).toBe(0);
        expect(TW_GAME_RULES.getSemiGuidedAdjustment(4, 'movement')).toBe(4);
        expect(CORE_2026_GAME_RULES.allowsTagDesignation('battle-armor')).toBeTrue();
        expect(TW_GAME_RULES.allowsTagDesignation('battle-armor')).toBeFalse();
        expect(TW_GAME_RULES.allowsTagDesignation('infantry')).toBeFalse();
        expect(TW_GAME_RULES.allowsTagDesignation('mek-biped')).toBeTrue();
    });

    it('calculates TAG BV from detached force-owned facts', () => {
        const facts = {
            operationalTagCount: 2,
            homingArtilleryLauncherCount: 3,
            guidedAmmoBv: 47.4,
        } as const;

        expect(CORE_2026_GAME_RULES.calculateTagBVCost(facts)).toBe(300);
        expect(TW_GAME_RULES.calculateTagBVCost(facts)).toBe(95);
    });

    it('ports ruleset-owned ammo BV and explosion resolution', () => {
        const baseAmmo = new AmmoEquipment({
            id: 'AC5Ammo', name: 'AC/5 Ammo', type: 'ammo',
            stats: { bv: 10 }, ammo: { type: 'AC', shots: 20 },
        });
        const axHead = new AmmoEquipment({
            id: 'AXHeadAC5', name: 'AX Head AC/5 Ammo', type: 'ammo',
            stats: { bv: 7 },
            ammo: {
                type: 'AC', shots: 20, baseAmmo: baseAmmo.id,
                munitionType: ['M_AX_HEAD'],
            },
        });
        const weapon = new WeaponEquipment({
            id: 'ExplosiveWeapon', name: 'Explosive weapon', type: 'weapon',
            weapon: { explosionDamage: 15 },
        });
        const registry = new EquipmentRegistry({ [baseAmmo.id]: baseAmmo, [axHead.id]: axHead });

        expect(CORE_2026_GAME_RULES.getAmmoBV(axHead, registry)).toBe(10);
        expect(TW_GAME_RULES.getAmmoBV(axHead, registry)).toBe(20);
        expect(CORE_2026_GAME_RULES.getExplosiveWeaponDamage(weapon, 4)).toBe(8);
        expect(TW_GAME_RULES.getExplosiveWeaponDamage(weapon, 4)).toBe(15);
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 100, protection: 'case-ii', remainingInternal: 12,
            remainingArmor: 20, originalArmor: 20, torso: false,
        })).toEqual({
            internalDamage: 1, armorDamage: 10, armorRear: false, stopsTransfer: true,
        });
        expect(TW_GAME_RULES.resolveMekExplosionDamage({
            damage: 100, protection: 'case-ii', remainingInternal: 10,
            remainingArmor: 20, originalArmor: 15, torso: false,
        })).toEqual({
            internalDamage: 1, armorDamage: 8, armorRear: false, stopsTransfer: true,
        });
        expect(CORE_2026_GAME_RULES.getMekInternalExplosionPilotHits()).toBe(1);
        expect(TW_GAME_RULES.getMekInternalExplosionPilotHits()).toBe(2);
    });
});

describe('Mek explosion damage rules', () => {
    it('applies the Core cap and carries an armor blowout across transfer', () => {
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 20, protection: 'none', remainingInternal: 25,
            remainingArmor: 8, originalArmor: 8, torso: true,
        })).toEqual({
            internalDamage: 20, armorDamage: 0, armorRear: true, stopsTransfer: false,
        });
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 21, protection: 'none', remainingInternal: 25,
            remainingArmor: 8, originalArmor: 8, torso: true,
        })).toEqual({
            internalDamage: 20, armorDamage: 8, armorRear: true, stopsTransfer: false,
        });
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 8, protection: 'none', remainingInternal: 31,
            remainingArmor: 12, originalArmor: 12, torso: true,
            armorBlowoutPending: true,
        })).toEqual({
            internalDamage: 8, armorDamage: 12, armorRear: true, stopsTransfer: false,
        });
    });

    it('applies Core CASE and CASE II caps and armor venting', () => {
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 100, protection: 'case', remainingInternal: 12,
            remainingArmor: 8, originalArmor: 8, torso: true,
        })).toEqual({
            internalDamage: 10, armorDamage: 8, armorRear: true, stopsTransfer: true,
        });
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 100, protection: 'case-ii', remainingInternal: 12,
            remainingArmor: 20, originalArmor: 20, torso: false,
        })).toEqual({
            internalDamage: 1, armorDamage: 10, armorRear: false, stopsTransfer: true,
        });
    });

    it('uses full Total Warfare damage for normal and CASE explosions', () => {
        for (const protection of ['none', 'case'] as const) {
            expect(TW_GAME_RULES.resolveMekExplosionDamage({
                damage: 100, protection, remainingInternal: 12,
                remainingArmor: 10, originalArmor: 10, torso: true,
            })).withContext(protection).toEqual({
                internalDamage: 100,
                armorDamage: 0,
                armorRear: true,
                stopsTransfer: protection === 'case',
            });
        }
    });

    it('uses Total Warfare CASE II limb and torso venting limits', () => {
        expect(TW_GAME_RULES.resolveMekExplosionDamage({
            damage: 100, protection: 'case-ii', remainingInternal: 10,
            remainingArmor: 20, originalArmor: 15, torso: false,
        })).toEqual({
            internalDamage: 1, armorDamage: 8, armorRear: false, stopsTransfer: true,
        });
        expect(TW_GAME_RULES.resolveMekExplosionDamage({
            damage: 100, protection: 'case-ii', remainingInternal: 10,
            remainingArmor: 120, originalArmor: 120, torso: true,
        })).toEqual({
            internalDamage: 1, armorDamage: 99, armorRear: true, stopsTransfer: true,
        });
    });

    it('describes CASE effects for the selected ruleset', () => {
        expect(CORE_2026_GAME_RULES.getMekExplosionProtectionNote('case'))
            .toContain('Caps internal damage at 10');
        expect(CORE_2026_GAME_RULES.getMekExplosionProtectionNote('case-ii'))
            .toContain('ignored on 8+');
        expect(TW_GAME_RULES.getMekExplosionProtectionNote('case'))
            .toContain('full explosion damage');
        expect(TW_GAME_RULES.getMekExplosionProtectionNote('case-ii'))
            .toContain('half the original armor');
        expect(TW_GAME_RULES.getMekExplosionProtectionNote('none')).toBeNull();
    });
});

function ammo(
    id: string,
    type: 'LRM' | 'MML',
    munitionType: AmmoMunitionFlag[] = [],
    flags: EquipmentFlag[] = [],
): AmmoEquipment {
    return new AmmoEquipment({
        id, name: id, shortName: id, type: 'ammo', flags,
        ammo: { type, rackSize: type === 'MML' ? 9 : 10, shots: 12, munitionType },
    });
}

function physicalAttack(actionKind: IntrinsicWeaponKind): ComponentToHitSubject {
    return Object.freeze({
        kind: 'component', componentId: asComponentId(`intrinsic:${actionKind}`),
        source: Object.freeze({ kind: 'intrinsic', actionKind }),
        locations: Object.freeze([]), targetingComputerWeapon: null, targetingComputer: null,
    });
}

function installedWeapon(toHitModifier: number | number[]): ComponentToHitSubject {
    return installed(new WeaponEquipment({
        id: 'TestWeapon', name: 'Test weapon', type: 'weapon',
        stats: { toHitModifier }, weapon: { ammoType: 'NA', ranges: [1, 2, 3, 4] },
    }));
}

function installed(equipment: Equipment): ComponentToHitSubject {
    return Object.freeze({
        kind: 'component', componentId: asComponentId(`component:${equipment.id}`),
        source: Object.freeze({
            kind: 'equipment', equipment,
            physical: equipment.flags.has('F_CLUB') || equipment.flags.has('F_HAND_WEAPON'),
            parentEquipment: null,
        }),
        locations: Object.freeze([]), targetingComputerWeapon: null, targetingComputer: null,
    });
}
