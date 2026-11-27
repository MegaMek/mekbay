// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import type { CBTRuleset } from '../../models/cbt-ruleset.model';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import { TestInfantryEntity } from '../../models/entity/testing/test-entities';
import type { CBTForceMember } from '../../models/force-member.model';
import type { WeaponAttackProfile } from '../../models/rules/weapon-attack-resolution';
import { createDirectMekRuntimeFixture } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import { interceptedReport } from '../../models/runtime/anti-missile-defense';
import { buildingChargeHexes } from '../../models/runtime/building-cf';
import { parseGameEvent } from '../../services/game-events.service';
import { attackReportGroup } from '../attack-report/attack-report.component';
import {
    AttackResolutionDialogComponent,
    type AttackResolution,
    type AttackResolutionDialogData,
    type AttackResolutionTarget,
} from './attack-resolution-dialog.component';

const LASER = 'mount:medium-laser' as ComponentId;

const INSULATED_LASER: WeaponAttackProfile = Object.freeze({
    componentId: LASER,
    name: 'Medium Laser',
    targetNumber: 8,
    damagePerHit: 5,
    projectiles: 1,
    allHit: false,
    groupSize: 5,
    types: Object.freeze([]),
    partialCover: false,
    jamRoll: null,
    table: 'standard',
    insulated: true,
});

function createAttackDialog(profiles: readonly WeaponAttackProfile[], ruleset: CBTRuleset, infantry = false, defender: CBTForceMember | null = null,
    targetOptions: Pick<AttackResolutionTarget, 'buildingChargeHexes' | 'unitType'> = {}) {
    const close = jasmine.createSpy('close');
    const data: AttackResolutionDialogData = {
        attacker: 'Attacker',
        targets: [{
            ...targetOptions, targetId: 'target', name: 'Target', letter: 'A', color: '#fff', arc: 'front',
            defender, ...(infantry ? { unitType: 'infantry' as const } : {}), delivery: { toForce: 'force', toUnit: 'target' }, ruleset, profiles,
        }],
    };
    TestBed.configureTestingModule({
        imports: [AttackResolutionDialogComponent],
        providers: [{ provide: DialogRef, useValue: { close } }, { provide: DIALOG_DATA, useValue: data }],
    });
    const fixture = TestBed.createComponent(AttackResolutionDialogComponent);
    return {
        fixture, dialog: fixture.componentInstance,
        result: () => close.calls.mostRecent().args[0] as AttackResolution,
    };
}

describe('AttackResolutionDialogComponent floating criticals', () => {
    for (const count of [0, 1, 2]) {
        it(`uses the struck hex’s shared current CF for a charge with ${count} known hexes`, () => {
            const floors = [{ code: 'Level 0 0.0,0.0,0.0', previewRemainingInternal: 39 },
                { code: 'Level 1 0.0,0.0,0.0', previewRemainingInternal: 32 },
                { code: 'Level 0 1.0,0.0,-1.0', previewRemainingInternal: 21 }];
            const hexes = buildingChargeHexes(floors.slice(0, count === 2 ? 3 : 2 * count), hex => `${hex.q + 1}`.padStart(2, '0') + '01');
            expect(hexes.map(hex => hex.label)).toEqual(['0101', '0201'].slice(0, count));
            const { dialog, result } = createAttackDialog([{ ...INSULATED_LASER, physical: 'charge', automaticBuildingHit: true,
                targetNumber: 2, groupSize: 5, damagePerHit: 10 }], 'total-warfare', false, null, { buildingChargeHexes: hexes });
            expect(dialog['awaitingHex']()).toBe(count === 2);
            if (count === 2) dialog['selectChargeHex'](0, floors[2].code);
            expect(dialog['awaitingHex']()).toBeFalse();
            dialog['send']();
            expect(result().physical[0].buildingChargeCf).toBe(count === 2 ? 21 : count ? 32 : null);
            expect(result().deliveries[0].weapons[0].groups.map(group => group.buildingLocation)).toEqual(
                Array(2).fill(count === 2 ? floors[2].code : count ? floors[0].code : undefined));
        });
    }

    it('withholds missile outcomes until the defender commits, locks that roll, and excludes manually resolved hits from delivery', () => {
        const lrm: WeaponAttackProfile = { ...INSULATED_LASER, name: 'LRM 15', targetNumber: 2, projectiles: 15,
            damagePerHit: 1, groupSize: 5, types: ['M'], insulated: undefined, missileDefense: 'total-warfare' };
        const { dialog, result } = createAttackDialog([lrm], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'cluster', total: 4 });
        expect(dialog['targets']()[0].awaiting).toEqual([true]);
        dialog['send']();
        const delivered = result().deliveries[0].weapons[0];
        const packet = parseGameEvent({ kind: 'attack', id: 'p', fromForce: 'a', fromUnit: 'b', attacker: 'c',
            toUnit: 'd', turn: 0, arc: 'front', weapons: [delivered] });
        expect(packet?.kind === 'attack' && interceptedReport(packet.weapons[0], false).cluster?.hits).toBe(5);
        expect(packet?.kind === 'attack' && interceptedReport(packet.weapons[0], true).groups.length).toBe(0);

        dialog['recordOnTable'](0);
        dialog['confirmManualDefense'](0, 0, 1, true);
        expect(dialog['targets']()[0].awaiting).toEqual([false]);
        expect(dialog['targets']()[0].weapons[0].groups).toEqual([]);
        dialog['confirmManualDefense'](0, 0, 0);
        dialog['setRoll'](0, { weapon: 0, roll: 'cluster', total: 12 });
        dialog['reroll'](0, 0);
        expect(dialog['targets']()[0].weapons[0].groups).toEqual([]);
        dialog['send']();
        expect(result().deliveries).toEqual([]);
    });

    it('edits known cluster modifiers and other weapons in the displayed volley before committing AMS', () => {
        const lrm: WeaponAttackProfile = { ...INSULATED_LASER, name: 'LRM 15', targetNumber: 2, projectiles: 15,
            damagePerHit: 1, groupSize: 5, types: ['M'], insulated: undefined, missileDefense: 'total-warfare' };
        const { fixture, dialog, result } = createAttackDialog([lrm, INSULATED_LASER], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'cluster', total: 6 });
        dialog['setRoll'](0, { weapon: 1, roll: 'to-hit', total: 10 });
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        const [missile, laser] = Array.from(host.querySelectorAll<HTMLElement>('li.attack-weapon'));
        const modifier = () => missile.querySelector<HTMLSelectElement>('select.modifier');
        const change = (select: HTMLSelectElement, value: string) => {
            select.value = value;
            select.dispatchEvent(new Event('change'));
            fixture.detectChanges();
        };
        const click = (label: string) => {
            Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === label)!.click();
            fixture.detectChanges();
        };
        expect(missile.querySelector('.cluster-hits, .hit-groups, [aria-label="Set LRM 15 cluster roll"]')).toBeNull();
        expect(host.querySelector('.target-totals')).toBeNull();
        change(laser.querySelector<HTMLSelectElement>('[aria-label="Set hit location roll 1"]')!, '9');
        change(modifier()!, '2');
        click('SEND HITS');
        const [sentMissile, sentLaser] = result().deliveries[0].weapons;
        expect(sentMissile.cluster?.modifier).toBe(2);
        expect(interceptedReport(sentMissile).cluster?.hits).toBe(6); // 6 + 2 - 4 on the 15 column
        expect(sentLaser.groups[0].location).toEqual([5, 4]);

        click('Resolve on tabletop instead');
        change(modifier()!, '3');
        click('Ballistic AMS');
        expect(modifier()).toBeNull();
        expect(missile.querySelector('.cluster-hits strong')?.textContent).toBe('9'); // 6 + 3 - 4
        expect(missile.querySelector('.hit-groups')).not.toBeNull();
        expect(missile.querySelector('select')).toBeNull();
        expect(laser.querySelector('[aria-label="Set hit location roll 1"]')).not.toBeNull();
    });

    it('keeps hidden missile casualties out of a later weapon’s visible infantry preview', () => {
        const defender = { entity: new TestInfantryEntity(), force: { getUnitSnapshot: () => null },
            nonMekRecordSheetSnapshot: () => ({ locations: [{ code: 'Infantry', previewRemainingInternal: 1 }] }) } as unknown as CBTForceMember;
        const missile: WeaponAttackProfile = { ...INSULATED_LASER, name: 'LRM', targetNumber: 2, projectiles: 10,
            damagePerHit: 1, groupSize: 5, types: ['M'], infantryClass: 'ordinary', missileDefense: 'total-warfare' };
        const { fixture, dialog } = createAttackDialog([missile, { ...INSULATED_LASER, targetNumber: 2, infantryClass: 'ordinary' }],
            'total-warfare', true, defender);
        fixture.detectChanges();
        const [first, second] = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('li.attack-weapon'));
        expect(first.querySelector('.damage')).toBeNull();
        expect(second.querySelector('.damage')?.textContent?.trim()).toBe('1');
        dialog['recordOnTable'](0);
        dialog['confirmManualDefense'](0, 0, 0);
        fixture.detectChanges();
        expect(first.querySelector('.damage')?.textContent?.trim()).toBe('1');
        expect(second.querySelector('.damage')?.textContent?.trim()).toBe('0');
    });

    it('applies the bay roll to each rapid-fire mount at its own jam threshold', () => {
        const ultra = 'mount:ultra' as ComponentId;
        const rotary = 'mount:rotary' as ComponentId;
        const { dialog, result } = createAttackDialog([{ ...INSULATED_LASER, jamRoll: 4,
            aerospace: { attackValue: 20, grouping: 'single', scale: 1, heatWeapons: [],
                jamChecks: [{ id: ultra, threshold: 2 }, { id: rotary, threshold: 4 }] } }], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 3 });
        dialog['close']();
        expect(result().jammed).toEqual([rotary]);
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 2 });
        dialog['close']();
        expect(result().jammed).toEqual([ultra, rotary]);
    });

    it('previews and delivers the same rear torso hit after rerolling a covered leg (Core p. 95, TO:AR p. 75)', () => {
        const close = jasmine.createSpy('close');
        const defender = { entity: createDirectMekRuntimeFixture().entity,
            force: { getUnitSnapshot: () => null } } as unknown as CBTForceMember;
        const data: AttackResolutionDialogData = { attacker: 'Attacker', floatingCriticals: true, targets: [{
            targetId: 'target', name: 'Target', letter: 'A', color: '#fff', arc: 'rear', defender,
            delivery: { toForce: 'force', toUnit: 'target' }, ruleset: 'core-2026',
            profiles: [{ ...INSULATED_LASER, partialCover: true }],
        }] };
        TestBed.configureTestingModule({ imports: [AttackResolutionDialogComponent],
            providers: [{ provide: DialogRef, useValue: { close } }, { provide: DIALOG_DATA, useValue: data }] });
        const random = spyOn(Math, 'random').and.returnValue(0.5);
        const dialog = TestBed.createComponent(AttackResolutionDialogComponent).componentInstance;
        random.and.returnValues(0.2, 0.4, 0.4, 0.4); // 2 + 3 hits a covered leg, 3 + 3 hits the right torso.
        dialog['setRoll'](0, { weapon: 0, roll: 0, total: 2 });
        random.and.throwError('The location was already rolled');
        const preview = dialog['targets']()[0].weapons[0].groups[0];
        expect(preview).toEqual(jasmine.objectContaining({ label: 'Right Torso (rear)', damage: 5,
            location: [1, 1], floating: [3, 3], criticalCheck: 'TAC check' }));
        dialog['send']();
        const { deliveries } = close.calls.mostRecent().args[0] as AttackResolution;
        const event = parseGameEvent({ kind: 'attack', id: 'attack', fromForce: 'sender', fromUnit: 'attacker',
            attacker: 'Attacker', turn: 1, ...deliveries[0] });
        expect(event?.kind).toBe('attack');
        if (event?.kind !== 'attack') return;
        const weapon = event.weapons[0];
        expect(attackReportGroup(defender, event.arc, weapon, weapon.groups[0])).toEqual(preview);
    });
});

describe('Building protection in the resolution dialog', () => {
    it('credits misses against an adjacent sheltered Mek under the BMM, excluding missiles destroyed by AMS', () => {
        const lrm: WeaponAttackProfile = { ...INSULATED_LASER, name: 'LRM 15', projectiles: 15, damagePerHit: 1, groupSize: 5,
            buildingAbsorption: 4, buildingCover: true, adjacentShelter: 'all-misses', missileDefense: 'total-warfare' };
        const { dialog, result } = createAttackDialog([lrm, { ...lrm, adjacentShelter: undefined }, { ...lrm, lockRequired: true }],
            'total-warfare', false, null, { unitType: 'mek-biped' });
        for (const weapon of [0, 1, 2]) {
            dialog['setRoll'](0, { weapon, roll: 'to-hit', total: 10 });
            dialog['setRoll'](0, { weapon, roll: 'cluster', total: 7 });
        }
        expect(dialog['targets']()[0].awaiting).toEqual([true, true, true]);
        dialog['send']();
        const event = parseGameEvent({ kind: 'attack', id: 'cluster', fromForce: 'attacker', fromUnit: 'a',
            attacker: 'Attacker', turn: 1, ...result().deliveries[0] });
        if (event?.kind !== 'attack') return fail('Expected a valid attack packet');
        expect(event.weapons.slice(0, 2).map(weapon => weapon.groups.reduce((sum, group) => sum + (group.buildingDamage ?? 0),
            weapon.strayBuildingDamage ?? 0))).toEqual([14, 8]);
        expect(event.weapons[0].strayBuildingDamage).toBe(6);
        const defended = interceptedReport(event.weapons[0], true);
        expect(defended.strayBuildingDamage).toBe(6);
        expect(defended.groups.reduce((sum, group) => sum + (group.buildingDamage ?? 0), 0)).toBeLessThan(8);
        for (const weapon of [0, 1, 2]) dialog['setRoll'](0, { weapon, roll: 'to-hit', total: 3 });
        expect(dialog['targets']()[0].weapons.map(weapon => weapon.buildingDamage)).toEqual([15, 0, 0]);
    });

    it('reports and delivers only whole misses and per-group absorption to a tank’s shelter under Total Warfare', () => {
        const shelter = { forceId: 'owner', unitId: 'warehouse', location: 'Level 0 0.0,0.0,0.0' };
        const cannon: WeaponAttackProfile = { ...INSULATED_LASER, name: 'AC/10', types: ['DB'], damagePerHit: 10,
            groupSize: 10, insulated: undefined, adjacentShelter: 'missed-attack', buildingAbsorption: 4,
            buildingCover: true, shelteringBuilding: shelter };
        const lrm: WeaponAttackProfile = { ...cannon, name: 'LRM 15', types: ['M'], projectiles: 15,
            damagePerHit: 1, groupSize: 5, missileDefense: 'total-warfare' };
        const streak: WeaponAttackProfile = { ...lrm, name: 'Streak SRM 6', componentId: 'mount:streak' as ComponentId,
            projectiles: 6, damagePerHit: 2, groupSize: 2, streak: true, allHit: true, lockRequired: true };
        const { dialog, result } = createAttackDialog([cannon, lrm, lrm, { ...cannon, adjacentShelter: undefined }, streak],
            'total-warfare', false, null, { unitType: 'vehicle' });
        for (const [weapon, total] of [3, 10, 3, 3, 3].entries()) {
            dialog['setRoll'](0, { weapon, roll: 'to-hit', total });
        }
        for (const weapon of [1, 2]) dialog['setRoll'](0, { weapon, roll: 'cluster', total: 7 });
        dialog['send']();
        const event = parseGameEvent({ kind: 'attack', id: 'tank', fromForce: 'sender', fromUnit: 'gunner',
            attacker: 'Gunner', turn: 1, ...result().deliveries[0] });
        if (event?.kind !== 'attack') return fail('Expected a valid attack packet');
        expect(event.weapons.map(weapon => weapon.strayBuildingDamage ?? 0)).toEqual([10, 0, 9, 0, 0]);
        expect(event.weapons.map(weapon => weapon.groups.map(group => group.damage))).toEqual([[], [1, 0], [], [], []]);
        expect(event.weapons[1].groups.map(group => group.buildingDamage)).toEqual([4, 4]);
        expect(event.weapons[1].cluster?.hits).toBe(9);
        expect(result().noLock).toEqual([streak.componentId!]);

        dialog['recordOnTable'](0);
        dialog['confirmManualDefense'](0, 1, 0);
        const report = dialog['targets']()[0];
        expect(report.weapons.map(weapon => weapon.buildingDamage)).toEqual([10, 8, 9, 0, 0]);
        expect(report.damage).toBe(1);
        dialog['send']();
        const buildingHits = result().deliveries;
        expect(buildingHits.map(hit => hit.toUnit)).toEqual([shelter.unitId, shelter.unitId, shelter.unitId]);
        expect(buildingHits.map(hit => hit.weapons[0].groups[0].damage)).toEqual([10, 8, 9]);
    });

    it('edits the three plasma cannon damage dice for the building when the shot misses a heat-tracking occupant', () => {
        const plasma: WeaponAttackProfile = { ...INSULATED_LASER, name: 'Plasma Cannon', insulated: undefined,
            damagePerHit: 0, types: ['H'], adjacentShelter: 'missed-attack', buildingCover: true, buildingAbsorption: 4,
            heatWeapon: { weapon: { kind: 'plasma-cannon' }, mode: 'both', ruleset: 'total-warfare',
                target: { tracksHeat: true, fireResistant: false } } };
        const { fixture, dialog, result } = createAttackDialog([plasma], 'total-warfare', false, null, { unitType: 'aero' });
        const host = fixture.nativeElement as HTMLElement;
        const select = (label: string) => host.querySelector<HTMLSelectElement>(`select[aria-label="Set Plasma Cannon ${label} roll"]`);
        const choose = (control: HTMLSelectElement, total: number) => {
            control.value = String(total);
            control.dispatchEvent(new Event('change'));
            fixture.detectChanges();
        };
        fixture.detectChanges();
        choose(select('to-hit')!, 3);
        const wallDice = select('building damage');
        if (!wallDice) return fail('Expected editable building damage dice for the missed plasma cannon');
        expect(Array.from(wallDice.options, option => Number(option.value))).toEqual(Array.from({ length: 16 }, (_, i) => i + 3));
        choose(wallDice, 17);
        expect(dialog['targets']()[0].weapons[0].buildingDamage).toBe(17);
        dialog['send']();
        const miss = result().deliveries[0].weapons[0];
        expect(miss.strayBuildingDamage).toBe(17);
        expect(miss.heat).toBeUndefined();
        expect(miss.groups).toEqual([]);

        choose(select('to-hit')!, 10);
        expect(select('building damage')).toBeNull();
        const heatDice = select('heat')!;
        expect(heatDice.options[heatDice.options.length - 1].value).toBe('12');
        choose(heatDice, 8);
        dialog['send']();
        const hit = result().deliveries[0].weapons[0];
        expect(hit.heat).toBe(8);
        expect(hit.strayBuildingDamage).toBeUndefined();
    });

    it('shows and delivers the split between CF and occupant, including a covered leg', () => {
        const shelter = { forceId: 'force', unitId: 'building', location: 'Level 0 0.0,0.0,0.0' };
        const profile = { ...INSULATED_LASER, name: 'AC/10', targetNumber: 2, damagePerHit: 10, groupSize: 10,
            buildingAbsorption: 4, buildingCover: true as const, shelteringBuilding: shelter, partialCover: true };
        const { dialog, result } = createAttackDialog([profile], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 0, total: 7 });
        expect(dialog['targets']()[0].weapons[0].buildingDamage).toBe(4);
        dialog['setRoll'](0, { weapon: 0, roll: 0, total: 5 });
        expect(dialog['targets']()[0].weapons[0].buildingDamage).toBe(10);
        expect(dialog['targets']()[0].weapons[0].groups[0].damage).toBe(0);
        dialog['send']();
        const event = parseGameEvent({ kind: 'attack', id: 'occupied', fromForce: 'other', fromUnit: 'gunner',
            attacker: 'Gunner', turn: 1, ...result().deliveries[0] });
        expect(event?.kind === 'attack' && event.weapons[0]).toEqual(jasmine.objectContaining({
            shelteringBuilding: shelter, groups: [jasmine.objectContaining({ damage: 6, buildingDamage: 4 })],
        }));
    });
});

describe('Battle Armor attacks in the resolution dialog', () => {
    it('preserves independent cluster rolls in the edited, delivered and decoded report', () => {
        const { dialog, result } = createAttackDialog([{ ...INSULATED_LASER, name: '54 missiles',
            projectiles: 54, damagePerHit: 2, groupSize: 2, clusterColumns: [27, 27] }], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 10 });
        dialog['setRoll'](0, { weapon: 0, roll: 'cluster', total: 2 });
        dialog['setRoll'](0, { weapon: 0, roll: { additionalCluster: 0 }, total: 12 });
        expect(dialog['targets']()[0].weapons[0].cluster?.hits).toBe(36);
        dialog['send']();
        const event = parseGameEvent({ kind: 'attack', id: 'attack', fromForce: 'sender', fromUnit: 'attacker',
            attacker: 'Attacker', turn: 1, ...result().deliveries[0] });
        expect(event?.kind === 'attack' && event.weapons[0].cluster).toEqual({
            dice: [1, 1], additionalDice: [[6, 6]], modifier: 0, projectiles: 54, hits: 36,
        });
    });

    it('sends a successful multi-suit vibro-claw attack and retains the originating physical hit', () => {
        const { dialog, result } = createAttackDialog([{ ...INSULATED_LASER, componentId: null, physical: 'vibro-claw',
            name: 'Claws', projectiles: 5, damagePerHit: 2, groupSize: 2 }], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 10 });
        dialog['setRoll'](0, { weapon: 0, roll: 'cluster', total: 9 });
        dialog['send']();
        expect(result().physical[0].hit).toBeTrue();
        expect(result().deliveries[0].weapons[0].groups.map(group => group.damage)).toEqual([2, 2, 2, 2]);
    });

    it('caps successive attacks on a linked one-soldier platoon at one loss then zero', () => {
        spyOn(Math, 'random').and.returnValue(0.5);
        const defender = { entity: new TestInfantryEntity(), force: { getUnitSnapshot: () => null },
            nonMekRecordSheetSnapshot: () => ({ locations: [{ code: 'Infantry', previewRemainingInternal: 1 }] }) } as unknown as CBTForceMember;
        const gun: WeaponAttackProfile = { ...INSULATED_LASER, types: ['DB'], infantryClass: 'burst-2', damagePerHit: 2, groupSize: 2 };
        const { dialog } = createAttackDialog([gun, gun], 'total-warfare', true, defender);
        for (const weapon of [0, 1]) dialog['setRoll'](0, { weapon, roll: 'to-hit', total: 10 });
        expect(dialog['targets']()[0].weapons.map(row => row.groups[0].damage)).toEqual([1, 0]);
    });

    it('shows Gauss and machine-gun casualties on a manual infantry target and sends the same burst dice', () => {
        spyOn(Math, 'random').and.returnValue(0.5);
        const { dialog, result } = createAttackDialog([
            { ...INSULATED_LASER, name: 'Gauss', types: ['DB'], infantryClass: 'ordinary', damagePerHit: 15, groupSize: 15 },
            { ...INSULATED_LASER, name: 'Machine Gun', types: ['DB'], infantryClass: 'burst-2', damagePerHit: 2, groupSize: 2 },
        ], 'total-warfare', true);
        for (const weapon of [0, 1]) dialog['setRoll'](0, { weapon, roll: 'to-hit', total: 10 });
        const report = dialog['targets']()[0].weapons;
        expect(report.map(weapon => weapon.groups[0].damage)).toEqual([2, 8]);
        expect(report.map(weapon => weapon.manualInfantry?.mechanized)).toEqual([4, 4]);
        dialog['send']();
        const message = parseGameEvent({ kind: 'attack', id: 'a', fromForce: 'f', fromUnit: 'x', toUnit: 'i',
            attacker: 'Attacker', turn: 1, arc: 'front', weapons: result().deliveries[0].weapons });
        expect(message?.kind === 'attack' && message.weapons[1].infantryDice).toEqual([4, 4]);
    });

    it('spends ammunition for a missed conventional missile attack resolved at full cluster potential', () => {
        const { dialog, result } = createAttackDialog([{ ...INSULATED_LASER, name: 'LRM 20', projectiles: 20,
            damagePerHit: 1, groupSize: 5, allHit: true }], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 3 });
        dialog['send']();
        expect(result().noLock).toEqual([]);
    });
});

/** TO:AUE p. 134: an insulated laser's to-hit roll of 2 calls for a 2D6 roll, a critical hit on 8 or more. */
describe('AttackResolutionDialogComponent laser insulator', () => {
    /** Sets the to-hit roll, notes whether the report then offers the insulator roll, sets that and closes */
    function resolve(toHit: number, insulator: number): Readonly<{ offered: boolean; resolution: AttackResolution }> {
        const { dialog, result } = createAttackDialog([INSULATED_LASER], 'core-2026');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: toHit });
        const offered = dialog['targets']()[0].weapons[0].insulator !== undefined;
        dialog['setRoll'](0, { weapon: 0, roll: 'insulator', total: insulator });
        dialog['close']();
        return { offered, resolution: result() };
    }

    it('damages the laser on 8 or more after a to-hit roll of 2', () => {
        const { offered, resolution } = resolve(2, 8);
        expect(offered).toBeTrue();
        expect(resolution.insulatorFailed).toEqual([LASER]);
    });

    it('spares the laser below 8', () => {
        expect(resolve(2, 7).resolution.insulatorFailed).toEqual([]);
    });

    it('rolls nothing after any other to-hit roll', () => {
        const { offered, resolution } = resolve(3, 12);
        expect(offered).toBeFalse();
        expect(resolution.insulatorFailed).toEqual([]);
    });
});

describe('AttackResolutionDialogComponent PPC capacitor burnout', () => {
    const ppc: WeaponAttackProfile = {
        componentId: 'mount:ppc' as ComponentId, name: 'PPC', targetNumber: 2, damagePerHit: 15, projectiles: 1,
        allHit: false, groupSize: 15, types: ['DE'], partialCover: false, jamRoll: null, table: 'standard',
        capacitorBurnoutOnTwo: true,
    };

    it('records a burnout on closing and leaves the target without a hit to receive', () => {
        const { dialog, result } = createAttackDialog([ppc], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 2 });
        expect(dialog['targets']()[0].weapons[0]).toEqual(jasmine.objectContaining({
            hit: false, capacitorBurnout: true, groups: [],
        }));
        expect(dialog['deliverable']()).toEqual([]);
        dialog['close']();
        expect(result().burnedOutPpcs).toEqual([ppc.componentId!]);
        expect(result().deliveries).toEqual([]);
    });

    it('sends only the other shot when the PPC burns out', () => {
        const { dialog, result } = createAttackDialog([ppc, INSULATED_LASER], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 2 });
        dialog['setRoll'](0, { weapon: 1, roll: 'to-hit', total: 8 });
        dialog['send']();
        expect(result().burnedOutPpcs).toEqual([ppc.componentId!]);
        expect(result().deliveries[0].weapons.map(weapon => weapon.name)).toEqual(['Medium Laser']);
    });

    it('settles the final PPC roll after the player corrects the dice', () => {
        const { dialog, result } = createAttackDialog([ppc], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 2 });
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 3 });
        dialog['send']();
        expect(result().burnedOutPpcs).toEqual([]);
        expect(result().deliveries[0].weapons.map(weapon => weapon.name)).toEqual(['PPC']);
    });
});
