// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import type { CBTUnitCommand } from '../models/runtime/unit-command';

import { resolveAutomaticFallingDamage } from '../components/falling-damage-dialog/falling-damage-dialog.component';
import { projectRuntimeUnitNotifications } from '../components/unit-notification-badges/unit-notification-runtime.util';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTForceUnitCommandDispatch } from '../models/cbt-force.types';
import { hasMekRuntime, type CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { createMekUnit } from '../models/runtime/cbt-mek-unit';
import { type DamageSource } from '../models/rules/armor-damage-rules';
import { riscOverrideKitMalfunction } from '../models/runtime/mek-automation-rules';

import {
createDirectCommandConsoleRuntimeFixture,
createDirectExplosionRuntimeFixture,
createDirectHotLoadedAmmoRuntimeFixture,
createDirectMekRuntimeFixture,
createDirectShieldRuntimeFixture,
createDirectTorsoCockpitRuntimeFixture,
createDirectTripodRuntimeFixture,
type DirectMekRuntimeFixture,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import { CBTAutomationCheckService,resolveAutomationChecksAutomatically } from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { CBTAutomationService } from './cbt-automation.service';
import {
DirectMekAutomationService,
type PreparedDirectMekAutomationCommand,
} from './direct-mek-automation.service';
import { MekFallingAutomationService } from './mek-falling-automation.service';
import { OptionsService } from './options.service';
import { DialogsService } from './dialogs.service';
import { SwarmService } from './swarm.service';
import type { CBTForceMember } from '../models/force-member.model';
import { attackDamagePreview } from '../models/runtime/attack-hit-location';
import { MountedArmor } from '../models/entity/components/armor';
import { ArmorEquipment } from '../models/equipment.model';

describe('DirectMekAutomationService', () => {
    let resolveAutomation: jasmine.Spy;
    let resolveChecksAutomation: jasmine.Spy;
    let resolveFalling: jasmine.Spy;
    let showAutomationToast: jasmine.Spy;
    let shakeOff: jasmine.Spy;
    let removalModifier: jasmine.Spy;
    let choose: jasmine.Spy;
    let service: DirectMekAutomationService;
    let automationModes: Record<string, 'yes' | 'no' | 'ask'>;

    beforeEach(() => {
        shakeOff = jasmine.createSpy('shakeOff').and.returnValue(true);
        removalModifier = jasmine.createSpy('removalModifier').and.returnValue(0);
        choose = jasmine.createSpy('choose');
        automationModes = {
            heatAndDissipationResolution: 'yes',
            heatEffectsCheck: 'ask',
            pilotHitsAndConsciousnessCheck: 'ask',
        };
        resolveAutomation = jasmine.createSpy('resolve').and.callFake(
            async (_key: string, events: readonly { readonly id: string }[]) =>
                new Set(events.map(event => event.id)),
        );
        resolveChecksAutomation = jasmine.createSpy('resolveChecks').and.callFake(
            async (_key: string, checks: Parameters<typeof resolveAutomationChecksAutomatically>[0], options: {
                readonly initiallyFailedGroups?: ReadonlySet<string>;
            }) => resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups),
        );
        resolveFalling = jasmine.createSpy('resolveFalling').and.callFake(
            async data => resolveAutomaticFallingDamage(data),
        );
        showAutomationToast = jasmine.createSpy('show');
        TestBed.configureTestingModule({
            providers: [
                DirectMekAutomationService,
                { provide: CBTAutomationService, useValue: { resolve: resolveAutomation } },
                { provide: CBTAutomationCheckService, useValue: { resolve: resolveChecksAutomation } },
                { provide: MekFallingAutomationService, useValue: { resolve: resolveFalling } },
                { provide: CBTAutomationToastService, useValue: { show: showAutomationToast } },
                { provide: SwarmService, useValue: { shakeOff, removalModifier } },
                { provide: DialogsService, useValue: { choose } },
                {
                    provide: OptionsService,
                    useValue: {
                        options: () => ({ CBTOptionalRules: { floatingCriticals: false } }),
                        cbtAutomationMode: (key: string) => automationModes[key] ?? 'ask',
                    },
                },
            ],
        });
        service = TestBed.inject(DirectMekAutomationService);
    });

    for (const manual of [false, true]) {
    it(`reviews the hot-loaded launcher and secondary explosion for a ${manual ? 'manual' : 'rolled'} critical`, async () => {
        const fixture = createDirectHotLoadedAmmoRuntimeFixture(true, 'total-warfare');
        const harness = createHarnessForFixture(fixture, 'total-warfare', 'hot-load-automation');
        const launcher = fixture.equipmentComponent('Test Artemis Launcher').id;
        const ammoId = fixture.equipmentComponent('Test Artemis Ammo').id;
        fixture.instance.dispatch({ type: 'configure-ammo-source', componentId: ammoId,
            munitionKey: 'Test Artemis Ammo', remaining: 12, hotLoaded: true });
        const slot = [...fixture.index.slots.values()].find(slot => slot.componentIds.includes(launcher))!;
        spyOn(Math, 'random').and.returnValue(0);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, manual ? {
            type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed',
        } : {
            type: 'apply-mek-critical-roll', locationId: slot.locationId, target: 'committed',
            results: slot.slotIndex < 6 ? [1, slot.slotIndex + 1] : [4, slot.slotIndex - 5],
        });

        expect(prepared.command).toEqual(jasmine.objectContaining({
            hotLoadExplosion: { dice: [1, 1], ammoComponentId: ammoId }, applyExplosion: true,
        }));
        expect(prepared.criticalPlan?.kind).toBe('applied');
        if (prepared.criticalPlan?.kind === 'applied') expect(prepared.criticalPlan.explosion?.rawDamage).toBe(130);
        expect(resolveAutomation.calls.mostRecent().args[1][0].description)
            .toBe('Apply 130 points of internal explosion damage. Hot-load check: 1 + 1.');
        expect((await harness.dispatch(prepared.command)).changed).toBeTrue();
        expect(fixture.instance.query().componentStatus(launcher)).toBe('destroyed');
        expect(fixture.instance.query().componentStatus(ammoId)).toBe('destroyed');
    });
    }

    it('rolls the prototype CASE vent check into the reviewed explosion (IO:AE p. 65)', async () => {
        const instanceId = 'unit:automation:case-p';
        const fixture = createDirectExplosionRuntimeFixture('total-warfare', { protection: 'prototype' }, instanceId);
        const harness = createHarnessForFixture(fixture, 'total-warfare', instanceId);
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(fixture.equipmentComponent('Test Explosive Weapon').id))!;
        // 1D6 = 1: the CASE fails to vent the explosion.
        spyOn(Math, 'random').and.returnValue(0);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'apply-mek-critical-roll', locationId: slot.locationId, target: 'committed',
            results: slot.slotIndex < 6 ? [1, slot.slotIndex + 1] : [4, slot.slotIndex - 5],
        });

        expect(prepared.command).toEqual(jasmine.objectContaining({ prototypeCaseRoll: 1, applyExplosion: true }));
        expect(prepared.criticalPlan?.kind === 'applied' && prepared.criticalPlan.explosion?.locations[0]?.protection)
            .toBe('none');
        expect(resolveAutomation.calls.mostRecent().args[1][0].description)
            .toContain('CASE-P check: 1, it fails to vent the explosion.');
    });

    const laser = { kind: 'weapon' as const, types: ['DE' as const] };
    /** The outside heat the Heat Phase will apply. */
    const appliedOutsideHeat = (harness: ReturnType<typeof createHarness>) => {
        const result = harness.fixture.instance.query().heatProjection();
        return result.kind === 'supported'
            ? result.projection.committedSources.find(source => source.id === 'outside-heat')?.value ?? 0 : 0;
    };

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`reads heat-dissipating armor as each hit strikes, past the attack's transferred damage, under ${ruleset}`, async () => {
            const harness = createHarness(ruleset);
            harness.fixture.entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test HD armor', name: 'Heat-Dissipating', type: 'armor', armor: { type: 'HEAT_DISSIPATING' },
            }) }));
            const query = () => harness.fixture.instance.query();
            const location = (code: string) => [...harness.fixture.index.locations.values()].find(row => row.code === code)!;
            const front = (code: string) => location(code).armorFaceIds
                .find(faceId => harness.fixture.index.armorFaces.get(faceId)!.face === 'front')!;
            const plasma = { kind: 'weapon' as const, types: ['H' as const] };
            const heat = { location: 'LT', rear: false, damage: 0, arc: 'front' as const, throughArmorCritical: false, source: plasma, outsideHeat: 5 };
            // The arm is destroyed and its transferred damage strips the torso's front armor between the two heat hits.
            const transfer = query().remainingArmor(front('LA'), 'preview') + query().remainingInternal(location('LA').id, 'preview')
                + query().remainingArmor(front('LT'), 'preview');
            spyOn(Math, 'random').and.returnValue(0);

            expect(await service.applyWeaponHits(harness.force, harness.instanceId, [
                heat,
                { location: 'LA', rear: false, damage: transfer, arc: 'front', throughArmorCritical: false, source: laser },
                heat,
                { outsideHeat: 4 },
            ], 'pending', harness.dispatch)).toBeTrue();

            expect(query().remainingArmor(front('LT'), 'preview')).toBe(0);
            // The first hit meets the torso's armor (Core p. 201): Core p. 202 negates it, TW (IO:AE p. 81) halves it. The
            // second strikes the stripped torso whole. Heat without a location meets any heat-dissipating armor under
            // Core, and needs every location's under TW.
            expect(appliedOutsideHeat(harness)).toBe(ruleset === 'core-2026' ? 0 + 5 + 0 : 2 + 5 + 4);
        });

        it(`halves a flamer's heat on laser-reflective armor that still stands, under ${ruleset}`, async () => {
            const harness = createHarness(ruleset);
            harness.fixture.entity.setArmorAt('RT', new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test reflective armor', name: 'Laser Reflective', type: 'armor', armor: { type: 'REFLECTIVE' },
            }) }));
            const torso = [...harness.fixture.index.locations.values()].find(row => row.code === 'RT')!;
            const face = torso.armorFaceIds.find(faceId => harness.fixture.index.armorFaces.get(faceId)!.face === 'front')!;
            const flamer = { kind: 'weapon' as const, types: ['DE' as const, 'H' as const] };
            const inferno = { kind: 'weapon' as const, types: ['M' as const, 'H' as const] };
            const autocannon = { kind: 'weapon' as const, types: ['DB' as const] };
            const heat = (source: DamageSource, outsideHeat: number, damage = 0) => ({ location: 'RT', rear: false,
                damage, arc: 'front' as const, throughArmorCritical: false, source, outsideHeat });
            spyOn(Math, 'random').and.returnValue(0);
            // The flamer's 5 heat halves; an inferno is not a reflected weapon; once the armor is gone the flamer is whole.
            expect(await service.applyWeaponHits(harness.force, harness.instanceId, [heat(flamer, 5), heat(inferno, 2),
                heat(autocannon, 0, harness.fixture.instance.query().remainingArmor(face, 'preview')), heat(flamer, 3)],
            'pending', harness.dispatch)).toBeTrue();
            expect(appliedOutsideHeat(harness)).toBe(ruleset === 'core-2026' ? 5 + 2 + 3 : 2 + 2 + 3);
        });

        it(`reads heat without a location against the armor as it strikes, under ${ruleset}`, async () => {
            // Under Core any heat-dissipating armor negates it, so only the right arm carries it; under TW every location
            // must keep it. The armor counts as it is when the heat strikes (Core p. 201), so a laser stripping the right
            // arm afterwards leaves the heat reduced.
            const result = async (order: 'heat first' | 'laser first' | 'heat only') => {
                const harness = createHarness(ruleset);
                const heatDissipating = new MountedArmor({ armor: new ArmorEquipment({
                    id: 'Test HD armor', name: 'Heat-Dissipating', type: 'armor', armor: { type: 'HEAT_DISSIPATING' },
                }) });
                if (ruleset === 'core-2026') harness.fixture.entity.setArmorAt('RA', heatDissipating);
                else harness.fixture.entity.setUniformArmor(heatDissipating);
                const arm = [...harness.fixture.index.locations.values()].find(row => row.code === 'RA')!;
                const face = arm.armorFaceIds.find(faceId => harness.fixture.index.armorFaces.get(faceId)!.face === 'front')!;
                const strip = { location: 'RA', rear: false, damage: harness.fixture.instance.query().remainingArmor(face, 'preview'),
                    arc: 'front' as const, throughArmorCritical: false, source: laser };
                const inferno = { outsideHeat: 4 };
                expect(await service.applyWeaponHits(harness.force, harness.instanceId,
                    order === 'heat first' ? [inferno, strip] : order === 'laser first' ? [strip, inferno] : [inferno],
                    'pending', harness.dispatch)).toBeTrue();
                return appliedOutsideHeat(harness);
            };
            spyOn(Math, 'random').and.returnValue(0);
            expect(await result('heat only')).toBe(ruleset === 'core-2026' ? 0 : 2);
            expect(await result('heat first')).toBe(ruleset === 'core-2026' ? 0 : 2);
            expect(await result('laser first')).toBe(4);
        });
    }

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`reads heat-dissipating armor where a hit on a missing arm transfers, under ${ruleset}`, async () => {
            // Core: damage to a missing arm transfers to the torso on the same side, against its armor.
            const harness = createHarness(ruleset);
            harness.fixture.entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test HD armor', name: 'Heat-Dissipating', type: 'armor', armor: { type: 'HEAT_DISSIPATING' },
            }) }));
            const query = () => harness.fixture.instance.query();
            const location = (code: string) => [...harness.fixture.index.locations.values()].find(row => row.code === code)!;
            const front = location('RA').armorFaceIds.find(faceId => harness.fixture.index.armorFaces.get(faceId)!.face === 'front')!;
            const durability = query().remainingArmor(front, 'preview') + query().remainingInternal(location('RA').id, 'preview');
            spyOn(Math, 'random').and.returnValue(0);

            expect(await service.applyWeaponHits(harness.force, harness.instanceId, [
                { location: 'RA', rear: false, damage: durability, arc: 'front', throughArmorCritical: false, source: laser },
                { location: 'RA', rear: false, damage: 0, arc: 'front', throughArmorCritical: false, source: laser, outsideHeat: 5 },
            ], 'pending', harness.dispatch)).toBeTrue();

            expect(query().locationStatus(location('RA').id, 'preview')).toBe('destroyed');
            // The heat meets the right torso's front armor it transferred to.
            expect(harness.fixture.instance.snapshot().pendingCombat.outsideHeat).toBe(ruleset === 'core-2026' ? undefined : 2);
            expect(appliedOutsideHeat(harness)).toBe(ruleset === 'core-2026' ? 0 : 2);
        });
    }

    it('applies accepted weapon hits as pending damage, transferring inward and wounding on head hits', async () => {
        const harness = createHarness('total-warfare');
        const query = () => harness.fixture.instance.query();
        const location = (code: string) => [...harness.fixture.index.locations.values()].find(row => row.code === code)!;
        const front = (code: string) => location(code).armorFaceIds
            .find(faceId => harness.fixture.index.armorFaces.get(faceId)!.face === 'front')!;
        const arm = location('LA');
        const armDurability = query().remainingArmor(front('LA'), 'preview') + query().remainingInternal(arm.id, 'preview');
        const torsoArmor = query().remainingArmor(front('LT'), 'committed');
        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        spyOn(Math, 'random').and.returnValue(0);

        expect(await service.applyWeaponHits(harness.force, harness.instanceId, [
            { location: 'LA', rear: false, damage: armDurability + 2, arc: 'front', throughArmorCritical: false, source: laser },
            { location: 'HD', rear: false, damage: 1, arc: 'front', throughArmorCritical: false, source: laser },
        ], 'pending', harness.dispatch)).toBeTrue();

        expect(query().remainingInternal(arm.id, 'preview')).toBe(0);
        expect(query().remainingArmor(front('LT'), 'preview')).toBe(torsoArmor - 2);
        // Pending damage leaves the committed sheet as it was until the phase ends.
        expect(query().remainingArmor(front('LT'), 'committed')).toBe(torsoArmor);
        expect(query().crewState(pilotId).wounds).toBe(1);
    });

    it("takes 3 off a rifle hit while the struck armor lasts, as the attack's preview shows in order", async () => {
        const rifle = { kind: 'weapon' as const, types: ['DB' as const], rifle: true as const };
        const struck = { kind: 'mek' as const, label: 'Left Torso', location: 'LT', rear: false, throughArmorCritical: false };
        const hit = (damage: number, source: typeof laser | typeof rifle) =>
            ({ location: 'LT', rear: false, damage, arc: 'front' as const, throughArmorCritical: false, source });
        spyOn(Math, 'random').and.returnValue(0);
        const attack = async (ruleset: 'core-2026' | 'total-warfare', stripArmor: boolean) => {
            const harness = createHarness(ruleset);
            const query = () => harness.fixture.instance.query();
            const location = [...harness.fixture.index.locations.values()].find(row => row.code === 'LT')!;
            const face = location.armorFaceIds.find(faceId => harness.fixture.index.armorFaces.get(faceId)!.face === 'front')!;
            const armor = query().remainingArmor(face, 'preview');
            const internal = query().remainingInternal(location.id, 'preview');
            // A laser strips the torso's armor first; the rifle hit then strikes its bare structure.
            const hits = [...stripArmor ? [hit(armor, laser)] : [], hit(5, rifle)];
            const member = { id: harness.instanceId, force: harness.force, entity: harness.fixture.entity } as unknown as CBTForceMember;
            const deal = attackDamagePreview(member, ruleset);
            const previewed = hits.map(group => deal(struck, group.damage, group.source)).at(-1);
            expect(await service.applyWeaponHits(harness.force, harness.instanceId, hits, 'pending', harness.dispatch))
                .toBeTrue();
            const dealt = stripArmor ? internal - query().remainingInternal(location.id, 'preview')
                : armor - query().remainingArmor(face, 'preview');
            return [previewed, dealt];
        };
        // Against armor the 5-point hit deals 2; Total Warfare never reduces damage to internal structure (TO:AuE
        // p. 150), Core reduces every rifle hit on a 'Mech (p. 190).
        expect(await attack('total-warfare', false)).toEqual([2, 2]);
        expect(await attack('total-warfare', true)).toEqual([5, 5]);
        expect(await attack('core-2026', true)).toEqual([2, 2]);
    });

    describe('weapon head hits and consciousness', () => {
        const headHit = { location: 'HD', rear: false, damage: 1, arc: 'front' as const, throughArmorCritical: false, source: laser };
        const consciousnessTargets = () => resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck')
            .map(args => (args[1] as readonly { readonly targetNumber: number }[]).map(check => check.targetNumber))
            .filter(targets => targets.length > 0);

        it('rolls Total Warfare consciousness for every head hit at once', async () => {
            const harness = createHarness('total-warfare');
            const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
            spyOn(Math, 'random').and.returnValue(0.99);

            expect(await service.applyWeaponHits(
                harness.force, harness.instanceId, [headHit, headHit], 'pending', harness.dispatch)).toBeTrue();

            expect(harness.fixture.instance.query().crewState(pilotId).wounds).toBe(2);
            expect(consciousnessTargets()).toEqual([[3], [5]]);
            expect(harness.fixture.instance.snapshot().turn.consciousnessRollsDue).toBeUndefined();
        });

        it('holds Core consciousness for one roll at the end of the combat phase', async () => {
            const harness = createHarness('core-2026');
            const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
            spyOn(Math, 'random').and.returnValue(0.99);

            expect(await service.applyWeaponHits(
                harness.force, harness.instanceId, [headHit, headHit], 'pending', harness.dispatch)).toBeTrue();
            // Both hits are dealt now; the roll waits for the end of the phase.
            expect(harness.fixture.instance.query().crewState(pilotId).wounds).toBe(2);
            expect(consciousnessTargets()).toEqual([]);
            expect(harness.fixture.instance.snapshot().turn.consciousnessRollsDue).toEqual([pilotId]);

            const prepared = await service.prepareCommand(harness.force, harness.instanceId, { type: 'end-phase' });
            const settled = await service.settleBeforeCommand(harness.force, harness.instanceId, prepared, harness.dispatch);
            expect(settled).not.toBeNull();
            // Resolving the phase's checks (as the PSR badge does) does not roll yet.
            expect(consciousnessTargets()).toEqual([]);
            const before = harness.snapshot();
            const result = await harness.dispatch(settled!.command);
            expect(await service.afterCommand(
                harness.force, harness.instanceId, before, settled!, result, harness.dispatch)).toBeTrue();

            expect(consciousnessTargets()).toEqual([[5]]);
            expect(harness.fixture.instance.snapshot().turn.consciousnessRollsDue).toBeUndefined();
        });

        it('does not wound a warrior in a torso-mounted cockpit for head hits', async () => {
            const harness = createHarnessForFixture(
                createDirectTorsoCockpitRuntimeFixture('total-warfare'), 'total-warfare', 'unit:direct-torso-cockpit-fixture');
            const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;

            expect(await service.applyWeaponHits(
                harness.force, harness.instanceId, [headHit], 'committed', harness.dispatch)).toBeTrue();

            expect(harness.fixture.instance.query().crewState(pilotId).wounds).toBe(0);
        });
    });

    it('reports automatically resolved heat through the shared automation notifier', async () => {
        const harness = createHarness();
        // The player's arrow is the turn's heat, so the automation settles it and names the player's adjustment. Under
        // heat resolution Yes the force sets NEXT to follow the calculation.
        expect(harness.fixture.instance.dispatch({ type: 'set-pending-heat', heat: 10, follow: true }).accepted)
            .toBeTrue();
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',
            policy: 'manual',
        });

        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();
        expect(showAutomationToast).toHaveBeenCalledOnceWith(
            String(harness.instanceId),
            jasmine.any(String),
            'Heat and dissipation: Heat 0 → 10 (adjustment +10)',
            'info',
        );
    });

    it('selects automatic or manual heat settlement from the configured review result', async () => {
        const harness = createHarness();
        generateHeat(harness);
        const automatic = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'manual',
        });

        expect(automatic.command).toEqual(jasmine.objectContaining({
            type: 'end-turn',
            policy: 'automatic',
        }));
        expect(resolveAutomation).toHaveBeenCalledWith(
            'heatAndDissipationResolution',
            jasmine.any(Array),
            jasmine.any(Object),
        );

        resolveAutomation.and.callFake(async () => new Set<string>());
        const manual = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });
        expect(manual.command).toEqual(jasmine.objectContaining({
            type: 'end-turn',
            policy: 'manual',
        }));
    });

    it('applies NEXT at End Turn whether the heat review is skipped or heat automation is off', async () => {
        automationModes['heatAndDissipationResolution'] = 'ask';
        resolveAutomation.and.resolveTo(new Set<string>());
        const skippedHarness = createHarness();
        setPendingHeat(skippedHarness, 10);
        const skipped = await service.prepareCommand(skippedHarness.force, skippedHarness.instanceId, {
            type: 'end-turn',

            policy: 'manual',
        });

        expect(await service.settleBeforeCommand(
            skippedHarness.force,
            skippedHarness.instanceId,
            skipped,
            skippedHarness.dispatch,
        )).not.toBeNull();
        expect(skippedHarness.fixture.instance.query().heatState().current).toBe(10);
        expect(skippedHarness.fixture.instance.query().heatState().pendingOverride).toBeUndefined();

        automationModes['heatAndDissipationResolution'] = 'no';
        const manualHarness = createHarness();
        setPendingHeat(manualHarness, 10);
        const manual = await service.prepareCommand(manualHarness.force, manualHarness.instanceId, {
            type: 'end-turn',

            policy: 'manual',
        });

        expect(await service.settleBeforeCommand(
            manualHarness.force,
            manualHarness.instanceId,
            manual,
            manualHarness.dispatch,
        )).not.toBeNull();
        expect(manualHarness.fixture.instance.query().heatState().current).toBe(10);
        expect(manualHarness.fixture.instance.query().heatState().pendingOverride).toBeUndefined();
    });

    it('completes a heatless end turn when heat settlement is already a no-op', async () => {
        const harness = createHarness();
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });

        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(settled).not.toBeNull();
        const result = harness.fixture.instance.dispatch(settled!.command);

        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(1);
        const heatReview = resolveAutomation.calls.allArgs()
            .find(args => args[0] === 'heatAndDissipationResolution');
        expect(heatReview?.[1]).toEqual([]);
    });

    it('cancels end turn instead of silently converting a closed heat review to manual', async () => {
        const harness = createHarness();
        resolveAutomation.and.resolveTo(null);
        const command: CBTUnitCommand = {
            type: 'end-turn',

            policy: 'automatic',
        };

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(resolveAutomation).toHaveBeenCalledWith(
            'heatAndDissipationResolution',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('cancels during heat-effect preflight before the turn reducer runs', async () => {
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 40,
        }).accepted).toBeTrue();
        resolveAutomation.and.callFake(async (key: string, events: readonly { readonly id: string }[]) =>
            key === 'heatEffectsCheck' ? null : new Set(events.map(event => event.id)));
        const command: CBTUnitCommand = {
            type: 'end-turn',

            policy: 'automatic',
        };
        const revisionBefore = harness.fixture.instance.query().stateRevision;

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(resolveAutomation).toHaveBeenCalledWith(
            'heatEffectsCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('cancels the dedicated heat checks without mutating the turn', async () => {
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 40,
        }).accepted).toBeTrue();
        resolveChecksAutomation.and.callFake(async (key: string) =>
            key === 'heatEffectsCheck' ? null : []);
        const command: CBTUnitCommand = {
            type: 'end-turn',

            policy: 'automatic',
        };
        const revisionBefore = harness.fixture.instance.query().stateRevision;

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(resolveChecksAutomation).toHaveBeenCalledWith(
            'heatEffectsCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ title: 'Resolve Pending Checks' }),
        );
    });

    it('keeps badge-driven end-turn heat checks interactive through the inner rolls', async () => {
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',
            heat: 40,
        }).accepted).toBeTrue();

        const prepared = await service.prepareEndTurnCommands(
            harness.force,
            [{
                instanceId: harness.instanceId,
                command: { type: 'end-turn', policy: 'automatic' },
            }],
            { interactive: true },
        );

        expect(prepared).not.toBeNull();
        expect(resolveChecksAutomation).toHaveBeenCalledWith(
            'heatEffectsCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ interactive: true }),
        );
    });

    it('does not turn a manual shutdown toggle into a Piloting Skill Roll', async () => {
        const harness = createHarness('total-warfare');
        const command: CBTUnitCommand = {
            type: 'set-mek-shutdown-state',

            shutdown: true,
        };
        const before = harness.snapshot();

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);
        const result = harness.fixture.instance.dispatch(prepared.command);
        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            prepared,
            result,
            harness.dispatch,
        );

        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(resolveAutomation).not.toHaveBeenCalled();
    });

    it('does not invent a shutdown PSR at the next phase after a manual shutdown', async () => {
        const harness = createHarness('total-warfare');
        const shutdown: CBTUnitCommand = {
            type: 'set-mek-shutdown-state',

            shutdown: true,
        };
        expect(harness.fixture.instance.dispatch(shutdown).accepted).toBeTrue();

        await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });

        const pilotSkillEvents = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotSkillCheck')
            .flatMap(args => args[1] as readonly { readonly event: string }[]);
        expect(pilotSkillEvents).toEqual([]);
    });

    it('cancels a failed manual PSR before changing the check or applying a fall', async () => {
        const harness = createHarness('total-warfare');
        const foot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: foot.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        const check = harness.fixture.instance.query().mekPilotChecks()[0]!;
        const command: CBTUnitCommand = {
            type: 'resolve-mek-pilot-check',

            checkId: check.checkId,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        };
        const revisionBefore = harness.fixture.instance.query().stateRevision;
        resolveFalling.and.resolveTo(null);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared.cancelled).toBeTrue();
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(harness.fixture.instance.query().mekPilotChecks()[0]?.status).toBe('pending');
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeFalse();
    });

    it('applies fall consequences after a failed manual PSR is accepted', async () => {
        const harness = createHarness('total-warfare');
        const foot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: foot.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        const check = harness.fixture.instance.query().mekPilotChecks()[0]!;
        const durability = () => [...harness.fixture.index.locations.values()]
            .reduce((total, location) => total
                + harness.fixture.instance.query().remainingInternal(location.id)
                + location.armorFaceIds.reduce((armor, faceId) =>
                    armor + harness.fixture.instance.query().remainingArmor(faceId), 0), 0);
        const beforeDamage = durability();
        const command: CBTUnitCommand = {
            type: 'resolve-mek-pilot-check',

            checkId: check.checkId,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        };
        spyOn(Math, 'random').and.returnValue(0);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);
        const result = harness.fixture.instance.dispatch(prepared.command);
        expect(await service.afterCommand(
            harness.force,
            harness.instanceId,
            harness.snapshot(),
            prepared,
            result,
            harness.dispatch,
        )).toBeTrue();

        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()[0]?.status).toBe('failed');
        expect(durability()).toBeLessThan(beforeDamage);
    });

    it('deals falling damage to a prone Mek whose thrash roll fails, as for a failed attempt to stand', async () => {
        const harness = createHarness('total-warfare');
        expect(harness.fixture.instance.dispatch({ type: 'set-condition', condition: 'prone', active: true }).accepted)
            .toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'record-mek-physical-attack-checks', attackId: 'attack:thrash', checks: ['made-thrash'],
        }).accepted).toBeTrue();
        const check = harness.fixture.instance.query().mekPilotChecks()[0]!;
        const durability = () => [...harness.fixture.index.locations.values()]
            .reduce((total, location) => total
                + harness.fixture.instance.query().remainingInternal(location.id)
                + location.armorFaceIds.reduce((armor, faceId) =>
                    armor + harness.fixture.instance.query().remainingArmor(faceId), 0), 0);
        const beforeDamage = durability();
        spyOn(Math, 'random').and.returnValue(0);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'resolve-mek-pilot-check',
            checkId: check.checkId,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        });
        const result = harness.fixture.instance.dispatch(prepared.command);
        expect(await service.afterCommand(
            harness.force, harness.instanceId, harness.snapshot(), prepared, result, harness.dispatch,
        )).toBeTrue();

        expect(prepared.pilotCheckFall).toBeDefined();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
        expect(durability()).toBeLessThan(beforeDamage);
    });

    it('does run the Total Warfare shutdown PSR for an automatic heat shutdown', async () => {
        const harness = createHarness('total-warfare');
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });

        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeTrue();
        const pilotSkillChecks = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotSkillCheck')
            .flatMap(args => args[1] as readonly { readonly label: string; readonly description: string }[]);
        expect(pilotSkillChecks).toContain(jasmine.objectContaining({
            label: 'Piloting Skill Check',
            description: 'Involuntary shutdown.',
        }));
    });

    it('keeps a shutdown PSR interactive when end-turn work was opened from its badge', async () => {
        const harness = createHarness('total-warfare');
        automationModes['heatEffectsCheck'] = 'yes';
        automationModes['pilotSkillCheck'] = 'yes';
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',
            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const rows = await service.prepareEndTurnCommands(
            harness.force,
            [{
                instanceId: harness.instanceId,
                command: { type: 'end-turn', policy: 'automatic' },
            }],
            { interactive: true },
        );

        expect(rows).not.toBeNull();
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            rows![0]!.prepared,
            harness.dispatch,
        )).not.toBeNull();

        const shutdownPsr = resolveChecksAutomation.calls.allArgs().find(args =>
            args[0] === 'pilotSkillCheck'
            && (args[1] as readonly { readonly description: string }[])
                .some(check => check.description === 'Involuntary shutdown.'));
        expect(shutdownPsr?.[2]).toEqual(jasmine.objectContaining({
            interactive: true,
        }));
    });

    it('leaves automatic shutdown unapplied when its Total Warfare PSR chain is cancelled', async () => {
        const harness = createHarness('total-warfare');
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        resolveChecksAutomation.and.callFake(async (
            key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => key === 'pilotSkillCheck'
            ? null
            : resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups));
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });
        const turn = harness.fixture.instance.query().turnState().turnCounter;

        const cancelled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(cancelled).toBeNull();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeFalse();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn);

        resolveChecksAutomation.and.callFake(async (
            _key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups));
        const resumed = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(resumed).not.toBeNull();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeTrue();
    });

    it('uses the heat check as the only explosion gate and resumes a closed crew check', async () => {
        const instanceId = 'unit:automation:heat-ammo-cancel';
        const harness = createHarnessForFixture(
            createDirectExplosionRuntimeFixture('core-2026', {}, instanceId),
            'core-2026',
            instanceId,
        );
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        resolveAutomation.and.callFake(async (key: string, events: readonly { readonly id: string }[]) => {
            if (key === 'heatAndDissipationResolution') return new Set<string>();
            return new Set(events.map(event => event.id));
        });
        let consciousnessReviews = 0;
        resolveChecksAutomation.and.callFake(async (
            _key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => {
            if (checks.some(check => check.label === 'Consciousness check')
                && ++consciousnessReviews === 1) return null;
            return resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups);
        });
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });
        const turn = harness.fixture.instance.query().turnState().turnCounter;
        const ammoComponentId = prepared.heatEffects?.staged.ammo?.componentId;
        expect(ammoComponentId).toBeDefined();

        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).toBeNull();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn);
        expect(harness.fixture.instance.query().componentStatus(
            ammoComponentId!,
            'committed',
        )).toBe('available');

        const resumed = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(resumed).not.toBeNull();
        expect(consciousnessReviews).toBe(2);
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('internalExplosionsCheck');
        const result = harness.fixture.instance.dispatch(resumed!.command);
        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn + 1);
    });

    describe('RISC Heat Sink Override Kit', () => {
        const engineSlots = (fixture: DirectMekRuntimeFixture) => {
            const centerTorso = [...fixture.index.locations.values()].find(location => location.code === 'CT')!;
            return [...fixture.index.slots.values()]
                .filter(slot => slot.locationId === centerTorso.id && slot.componentIds.some(componentId => {
                    const component = fixture.index.components.get(componentId);
                    return component?.kind === 'system' && component.systemType === 'Engine';
                }))
                .sort((left, right) => left.slotIndex - right.slotIndex);
        };
        const mekSnapshot = (harness: ReturnType<typeof createHarness>) => {
            const snapshot = harness.snapshot();
            if (!hasMekRuntime(snapshot)) throw new Error('Expected a Mek snapshot');
            return snapshot;
        };

        it('malfunctions on an unmodified shutdown roll of 2 even when the kit avoids the shutdown', async () => {
            automationModes['heatEffectsCheck'] = 'yes';
            const harness = createHarness();
            harness.fixture.entity.hasRiscHeatSinkOverrideKit.set(true);
            expect(harness.fixture.instance.dispatch({ type: 'set-heat', heat: 24 }).accepted).toBeTrue();
            spyOn(Math, 'random').and.returnValue(0);

            const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
                type: 'end-turn',
                policy: 'automatic',
            });
            expect(prepared.heatEffects?.staged.checks.map(row => row.check))
                .toEqual([{ kind: 'shutdown', target: 2, overrideKit: true }]);
            expect(await service.settleBeforeCommand(
                harness.force,
                harness.instanceId,
                prepared,
                harness.dispatch,
            )).not.toBeNull();

            const slots = engineSlots(harness.fixture);
            const query = harness.fixture.instance.query();
            expect(query.hasCondition('shutdown')).toBeFalse();
            expect(slots.map(slot => query.criticalHits(slot.id, 'committed'))).toEqual([1, 0, 0, 0, 0, 0]);
            expect(resolveAutomation).toHaveBeenCalledWith(
                'criticalHitChanceCheck',
                [jasmine.objectContaining({
                    event: 'RISC Override Kit Malfunction',
                    description: 'Center torso critical check rolled 2 = 2: 1 engine critical hit.',
                })],
                jasmine.anything(),
            );
            expect(showAutomationToast).toHaveBeenCalledWith(
                harness.instanceId,
                jasmine.any(String),
                'Shutdown: PASSED (2 vs 2+) — shutdown avoided; RISC override kit malfunction: 1 engine critical hit',
                'error',
            );
        });

        it('does not apply the malfunction again when a later heat effect is cancelled and resumed', async () => {
            const instanceId = 'unit:automation:override-kit-resume';
            const harness = createHarnessForFixture(
                createDirectExplosionRuntimeFixture('core-2026', {}, instanceId),
                'core-2026',
                instanceId,
            );
            harness.fixture.entity.hasRiscHeatSinkOverrideKit.set(true);
            expect(harness.fixture.instance.dispatch({ type: 'set-heat', heat: 30 }).accepted).toBeTrue();
            spyOn(Math, 'random').and.returnValue(0);
            let consciousnessReviews = 0;
            resolveChecksAutomation.and.callFake(async (
                _key: string,
                checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
                options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
            ) => checks.some(check => check.label === 'Consciousness check') && ++consciousnessReviews === 1
                ? null
                : resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups));
            const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
                type: 'end-turn',
                policy: 'automatic',
            });
            expect(prepared.heatEffects?.staged.checks.map(row => row.check.kind))
                .toEqual(['shutdown', 'ammo-explosion']);
            expect(prepared.heatEffects?.staged.checks[0]!.check.overrideKit).toBeTrue();
            const engineHits = () => engineSlots(harness.fixture)
                .map(slot => harness.fixture.instance.query().criticalHits(slot.id, 'committed'));

            expect(await service.settleBeforeCommand(
                harness.force, harness.instanceId, prepared, harness.dispatch,
            )).toBeNull();
            expect(engineHits()).toEqual([1, 0, 0, 0, 0, 0]);
            expect(await service.settleBeforeCommand(
                harness.force, harness.instanceId, prepared, harness.dispatch,
            )).not.toBeNull();
            expect(consciousnessReviews).toBe(2);
            expect(engineHits()).toEqual([1, 0, 0, 0, 0, 0]);
            expect(resolveAutomation.calls.allArgs()
                .filter(args => args[0] === 'criticalHitChanceCheck'
                    && (args[1] as readonly { readonly event: string }[])
                        .some(event => event.event === 'RISC Override Kit Malfunction'))).toHaveSize(1);
        });

        it('hits the top-most undamaged center-torso engine slots, one more than the critical check', () => {
            const harness = createHarness();
            const slots = engineSlots(harness.fixture);
            expect(slots.map(slot => slot.slotIndex)).toEqual([0, 1, 2, 7, 8, 9]);
            expect(riscOverrideKitMalfunction(mekSnapshot(harness), [3, 4]).slotIds).toEqual([slots[0]!.id]);
            const twelve = riscOverrideKitMalfunction(mekSnapshot(harness), [6, 6]);
            expect(twelve.hits).toBe(4);
            expect(twelve.slotIds).toEqual(slots.slice(0, 4).map(slot => slot.id));

            // This turn's uncommitted hit has already damaged its slot.
            expect(harness.fixture.instance.dispatch({
                type: 'hit-critical', slotId: slots[0]!.id, hits: 1, target: 'pending',
            }).changed).toBeTrue();
            expect(riscOverrideKitMalfunction(mekSnapshot(harness), [3, 4]).slotIds).toEqual([slots[1]!.id]);
            for (const slot of slots.slice(1, 3)) {
                expect(harness.fixture.instance.dispatch({
                    type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed',
                }).accepted).toBeTrue();
            }
            // Hits past the last center-torso engine slot are not applied elsewhere.
            const excess = riscOverrideKitMalfunction(mekSnapshot(harness), [6, 6]);
            expect(excess.hits).toBe(4);
            expect(excess.slotIds).toEqual(slots.slice(3).map(slot => slot.id));
        });
    });

    it('uses one force-wide review when heat, effects, and pilot hits all ask', async () => {
        automationModes['heatAndDissipationResolution'] = 'ask';
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 40,
        }).accepted).toBeTrue();

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'manual',
        });

        expect(prepared.cancelled).toBeUndefined();
        expect(resolveAutomation).toHaveBeenCalledTimes(1);
        expect(resolveAutomation.calls.argsFor(0)[0]).toBe('heatAndDissipationResolution');
        const event = resolveAutomation.calls.argsFor(0)[1][0] as {
            readonly event: string;
            readonly effects: readonly string[];
            readonly breakdown: readonly { readonly label: string }[];
        };
        expect(event).toEqual(jasmine.objectContaining({
            event: 'Heat, dissipation, effects, and pilot hits',
            effects: jasmine.arrayContaining([jasmine.stringMatching(/^(Automatic shutdown!|Shutdown check \d+\+)$/)]),
        }));
        expect(event.breakdown.map(row => row.label)).toContain('Sink');
        expect(event.breakdown.map(row => row.label)).not.toContain('Dissipation');
    });

    it('ends the turn on a NEXT the player set without putting it up for review', async () => {
        automationModes['heatAndDissipationResolution'] = 'ask';
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({ type: 'set-pending-heat', heat: 8, follow: true }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' }).accepted)
            .toBeTrue();
        const next = harness.fixture.instance.query().heatState().pendingOverride!;

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, { type: 'end-turn', policy: 'manual' });
        // No heat calculation is offered for review: End Turn applies NEXT as APPLY HEAT does.
        const reviewed = resolveAutomation.calls.allArgs().flatMap(args => args[1] as readonly { readonly breakdown?: unknown }[]);
        expect(reviewed.every(event => event.breakdown === undefined)).toBeTrue();
        expect(await service.settleBeforeCommand(harness.force, harness.instanceId, prepared, harness.dispatch)).not.toBeNull();
        expect(harness.fixture.instance.query().heatState().current).toBe(next);
    });

    it('reviews every Mek in one end-turn heat batch before committing any turn', async () => {
        const leftId = 'unit:automation:batch:left';
        const rightId = 'unit:automation:batch:right';
        const left = createHarnessForFixture(
            createDirectMekRuntimeFixture('core-2026', leftId),
            'core-2026',
            leftId,
        );
        const right = createHarnessForFixture(
            createDirectMekRuntimeFixture('core-2026', rightId),
            'core-2026',
            rightId,
        );
        generateHeat(left);
        generateHeat(right);
        const force = {
            getUnitSnapshot: (instanceId: typeof leftId) => instanceId === leftId
                ? left.snapshot()
                : instanceId === rightId ? right.snapshot() : null,
        } as unknown as CBTForce;
        const requests = [left, right].map(harness => ({
            instanceId: harness.instanceId,
            command: {
                type: 'end-turn' as const,
                policy: 'manual' as const,
            },
        }));

        const prepared = await service.prepareEndTurnCommands(force, requests);

        expect(prepared).not.toBeNull();
        expect(prepared).toHaveSize(2);
        const calls = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatAndDissipationResolution');
        expect(calls).toHaveSize(1);
        expect(calls[0][1]).toHaveSize(2);
        expect(calls[0][2]).toEqual(jasmine.objectContaining({ allowCancel: true }));
    });

    it('groups End Phase consciousness recoveries for every Mek in one review', async () => {
        const leftId = 'unit:automation:phase:left';
        const rightId = 'unit:automation:phase:right';
        const psrId = 'unit:automation:phase:psr';
        const left = createHarnessForFixture(
            createDirectMekRuntimeFixture('core-2026', leftId),
            'core-2026',
            leftId,
        );
        const right = createHarnessForFixture(
            createDirectMekRuntimeFixture('core-2026', rightId),
            'core-2026',
            rightId,
        );
        const psr = createHarnessForFixture(
            createDirectMekRuntimeFixture('total-warfare', psrId),
            'total-warfare',
            psrId,
        );
        const actuator = [...psr.fixture.index.slots.values()].find(candidate =>
            psr.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = psr.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(psr.fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: actuator.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        for (const harness of [left, right]) {
            const positionId = [...harness.fixture.index.crewPositions.keys()][0]!;
            expect(harness.fixture.instance.dispatch({
                type: 'set-crew-state',

                positionId,
                wounds: 1,
                unconscious: true,
                ejected: false,
            }).accepted).toBeTrue();
        }
        const force = {
            getUnitSnapshot: (instanceId: typeof leftId) => instanceId === leftId
                ? left.snapshot()
                : instanceId === rightId ? right.snapshot()
                    : instanceId === psrId ? psr.snapshot() : null,
        } as unknown as CBTForce;
        const requests = [left, right, psr].map(harness => ({
            instanceId: harness.instanceId,
            command: {
                type: 'end-phase' as const,
            },
        }));

        const prepared = await service.prepareEndPhaseCommands(force, requests);

        expect(prepared).toHaveSize(3);
        const recoveryCalls = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck');
        expect(recoveryCalls).toHaveSize(1);
        expect(recoveryCalls[0][1]).toHaveSize(2);
        const reviewedStages = resolveChecksAutomation.calls.allArgs()
            .filter(([, checks]) => checks.length > 0)
            .map(([key]) => key);
        expect(reviewedStages.indexOf('pilotHitsAndConsciousnessCheck'))
            .toBeLessThan(reviewedStages.indexOf('pilotSkillCheck'));
    });

    it('applies a successful consciousness recovery before resolving phase PSRs', async () => {
        const harness = createHarness('total-warfare');
        const positionId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const actuator = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'set-crew-state',

            positionId,
            wounds: 1,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: actuator.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });
        const commands: string[] = [];
        const dispatch: CBTForceUnitCommandDispatch = async command => {
            commands.push(command.type);
            return harness.dispatch(command);
        };

        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            dispatch,
        )).not.toBeNull();

        expect(commands.indexOf('set-crew-state'))
            .toBeLessThan(commands.indexOf('resolve-mek-pilot-check'));
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeFalse();
    });

    it('does not offer a manually-created Mek recovery until the following turn', async () => {
        const harness = createHarness();
        const positionId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'set-crew-state',
            positionId,
            wounds: 1,
            unconscious: true,
            ejected: false,
        });
        expect(harness.fixture.instance.dispatch(prepared.command).accepted).toBeTrue();

        const sameTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            sameTurn,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeTrue();
        expect(resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck')
            .flatMap(args => args[1] as readonly unknown[])).toEqual([]);

        expect(harness.fixture.instance.dispatch({
            type: 'end-turn',

            policy: 'manual',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const nextTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            nextTurn,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeFalse();
    });

    it('defers a failed Mek consciousness recovery until the following turn', async () => {
        const harness = createHarness();
        const positionId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'set-crew-state',
            positionId,
            wounds: 1,
            unconscious: true,
            ejected: false,
        });
        expect(harness.fixture.instance.dispatch(prepared.command).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'end-turn',

            policy: 'manual',
        }).accepted).toBeTrue();
        const random = spyOn(Math, 'random').and.returnValue(0);

        const failed = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            failed,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeTrue();

        resolveChecksAutomation.calls.reset();
        const sameTurn = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            sameTurn,
            harness.dispatch,
        )).not.toBeNull();
        expect(resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck')
            .flatMap(args => args[1] as readonly unknown[])).toEqual([]);

        expect(harness.fixture.instance.dispatch({
            type: 'end-turn',

            policy: 'manual',
        }).accepted).toBeTrue();
        random.and.returnValue(0.99);
        const retried = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            retried,
            harness.dispatch,
        )).not.toBeNull();
        expect(harness.fixture.instance.query().crewState(positionId).unconscious).toBeFalse();
    });

    it('uses a healthy alternate Mek crew member for heat shutdown checks', async () => {
        const instanceId = 'unit:automation:alternate-pilot';
        const harness = createHarnessForFixture(
            createDirectTripodRuntimeFixture('total-warfare', instanceId),
            'total-warfare',
            instanceId,
        );
        const [primary] = [...harness.fixture.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        expect(harness.fixture.instance.dispatch({
            type: 'set-crew-state',

            positionId: primary.id,
            wounds: 1,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',
            heat: 24,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();

        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeFalse();
        const shutdown = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly label: string; readonly automaticOutcome?: string }[])
            .find(check => check.label === 'Shutdown');
        expect(shutdown).toBeDefined();
        expect(shutdown?.automaticOutcome).toBeUndefined();
    });

    it('does not count a vacant primary station as the pilot for heat shutdown checks', async () => {
        const instanceId = 'unit:automation:vacant-primary';
        const fixture = createDirectCommandConsoleRuntimeFixture('core-2026', instanceId);
        const occupied = fixture.initialized.deployment.crewAssignment.positions[1]!;
        const instance = await createMekUnit({ uuid: fixture.identity, instanceId },
            fixture.entity, fixture.identity, {
                profileId: 'pristine',
                deployment: { id: 'vacant-primary', crewAssignment: { positions: [occupied] } },
                scenario: { id: 'megamek', ruleset: 'core-2026' },
            });
        const harness = createHarnessForFixture(
            { ...fixture, index: instance.getIndex(), instance },
            'core-2026',
            instanceId,
        );
        expect(instance.dispatch({
            type: 'set-crew-state',
            positionId: occupied.positionId,
            wounds: 1,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',
            heat: 24,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',
            policy: 'automatic',
        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();

        expect(instance.query().hasCondition('shutdown')).toBeTrue();
        const shutdown = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly label: string; readonly automaticOutcome?: string }[])
            .find(check => check.label === 'Shutdown');
        expect(shutdown).toEqual(jasmine.objectContaining({ automaticOutcome: 'failed' }));
    });

    it('applies accepted explosion pilot hits even when consciousness automation is disabled', async () => {
        const harness = createHarness('total-warfare');
        automationModes['pilotHitsAndConsciousnessCheck'] = 'no';
        resolveChecksAutomation.and.callFake(async (
            key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => key === 'pilotHitsAndConsciousnessCheck'
            ? []
            : resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups));
        const critical = explosiveCriticalCommand(harness.fixture);
        const before = harness.snapshot();
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, critical);

        expect(prepared.command).toEqual(jasmine.objectContaining({
            type: 'apply-mek-critical-roll',
            applyExplosion: true,
            applyPilotHits: false,
            settlePendingExplosion: true,
        }));
        expect(prepared.deferredPilotHits).toBeGreaterThan(0);

        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const result = harness.fixture.instance.dispatch(prepared.command);
        expect(result.accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            prepared,
            result,
            harness.dispatch,
        );

        expect(harness.fixture.instance.query().crewState(pilotId).wounds)
            .toBe(prepared.deferredPilotHits);
        expect(resolveAutomation.calls.allArgs().map(args => args[0])).toContain('internalExplosionsCheck');
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('pilotHitsAndConsciousnessCheck');
        expect(resolveChecksAutomation.calls.allArgs().map(args => args[0]))
            .toContain('pilotHitsAndConsciousnessCheck');
    });

    it('cancels an ammunition explosion review before applying the critical roll', async () => {
        const harness = createHarness('total-warfare');
        const critical = explosiveCriticalCommand(harness.fixture);
        const revisionBefore = harness.fixture.instance.query().stateRevision;
        resolveAutomation.and.callFake(async (key: string, events: readonly { readonly id: string }[]) =>
            key === 'internalExplosionsCheck' ? null : new Set(events.map(event => event.id)));

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            critical,
        );

        expect(prepared.cancelled).toBeTrue();
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(resolveAutomation).toHaveBeenCalledWith(
            'internalExplosionsCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('groups a unit\'s end-turn heat checks into one review entry', async () => {
        const harness = createHarness('total-warfare');
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        const command: CBTUnitCommand = {
            type: 'end-turn',

            policy: 'manual',
        };
        const before = harness.snapshot();
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(settled).not.toBeNull();
        const result = harness.fixture.instance.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();

        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            settled!,
            result,
            harness.dispatch,
        );

        const heatEffectCalls = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck');
        expect(heatEffectCalls).toHaveSize(1);
        const events = heatEffectCalls[0][1] as readonly {
            readonly event: string;
            readonly effects?: readonly string[];
        }[];
        expect(events).toHaveSize(1);
        expect(events[0].event).toBe('Heat effects and pilot hits');
        expect(events[0].effects).toContain(
            jasmine.stringMatching(/^(Automatic shutdown!|Shutdown check \d+\+)$/),
        );
    });

    it('keeps heat and submerged Life Support damage as separate silent damage groups', async () => {
        const harness = createHarness();
        const lifeSupport = [...harness.fixture.index.slots.values()].find(slot =>
            slot.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Life Support';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: lifeSupport.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'replace-turn-state',

            turn: {
                ...harness.fixture.instance.query().turnState(),
                cover: 'underwater-depth-2',
            },
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'automatic',
        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        )).not.toBeNull();

        const reviewedEffects = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly effects?: readonly string[] }[])
            .flatMap(event => event.effects ?? []);
        expect(reviewedEffects).toContain('Damaged life support (2 pilot hits)');
        expect(reviewedEffects).toContain('Damaged life support (1 pilot hit)');
        const pendingRows = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly label: string }[]);
        expect(pendingRows.some(row => row.label.includes('Life Support'))).toBeFalse();
        const consciousnessCalls = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck');
        expect(consciousnessCalls).toHaveSize(2);
        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        expect(harness.fixture.instance.query().crewState(pilotId).wounds).toBe(3);
    });

    it('does not roll or flood when breach automation is disabled', async () => {
        const harness = createHarness();
        automationModes['breachAndFloodCheck'] = 'no';
        expect(harness.fixture.instance.dispatch({
            type: 'replace-turn-state',
            turn: {
                ...harness.fixture.instance.query().turnState(),
                cover: 'underwater-depth-1',
            },
        }).accepted).toBeTrue();
        const location = [...harness.fixture.index.locations.values()]
            .find(candidate => candidate.code === 'LL')!;
        const face = [...harness.fixture.index.armorFaces.values()]
            .find(candidate => candidate.locationId === location.id
                && candidate.maximumPoints > 1)!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'damage-armor',
            faceId: face.id,
            amount: 1,
            target: 'committed',
        };
        const random = spyOn(Math, 'random');
        const result = harness.fixture.instance.dispatch(command);
        expect(result.accepted).toBeTrue();

        expect(await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            { command, deferredPilotHits: 0 },
            result,
            harness.dispatch,
        )).toBeTrue();

        expect(random).not.toHaveBeenCalled();
        expect(harness.fixture.instance.query().locationCondition(
            location.id,
            'flooded',
            'committed',
        )).toBe(0);
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('breachAndFloodCheck');
    });

    it('settles reviewed heat consequences before resetting the turn', async () => {
        const harness = createHarness();
        expect(harness.fixture.instance.dispatch({
            type: 'set-heat',

            heat: 40,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        const turn = harness.fixture.instance.query().turnState().turnCounter;
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-turn',

            policy: 'manual',
        });

        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(harness.fixture.instance.query().hasCondition('shutdown')).toBeTrue();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn);
        const result = harness.fixture.instance.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();
        expect(harness.fixture.instance.query().turnState().turnCounter).toBe(turn + 1);
    });

    it('carries Total Warfare CASE II into each secondary explosion critical check', async () => {
        const instanceId = 'unit:automation:case-ii';
        const fixture = createDirectExplosionRuntimeFixture(
            'total-warfare',
            { protection: 'case-ii' },
            instanceId,
        );
        const harness = createHarnessForFixture(fixture, 'total-warfare', instanceId);
        const critical = explosiveCriticalCommand(fixture, 'case-ii');
        const before = harness.snapshot();
        const prepared = await service.prepareCommand(harness.force, instanceId, critical);
        const result = fixture.instance.dispatch(prepared.command);
        expect(result.accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);

        await service.afterCommand(
            harness.force,
            instanceId,
            before,
            prepared,
            result,
            harness.dispatch,
        );

        const chanceEvents = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'criticalHitChanceCheck')
            .flatMap(args => args[1] as readonly { readonly effects?: readonly string[] }[]);
        expect(chanceEvents.length).toBeGreaterThan(0);
        expect(chanceEvents.some(event => event.effects?.some(effect =>
            effect.includes('CASE II check') && effect.includes('critical discarded')))).toBeTrue();
    });

    it('dismisses disabled phase PSRs and completes the boundary', async () => {
        const harness = createHarness('total-warfare');
        automationModes['pilotSkillCheck'] = 'no';
        resolveChecksAutomation.and.resolveTo([]);
        const slot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: slot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const phaseCommand: CBTUnitCommand = {
            type: 'end-phase',

        };
        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            phaseCommand,
        );
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(settled).not.toBeNull();
        const phaseResult = harness.fixture.instance.dispatch(settled!.command);

        expect(phaseResult.accepted).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(resolveChecksAutomation.calls.allArgs().map(args => args[0])).toContain('pilotSkillCheck');
    });

    it('resolves disabled phase PSRs and their consequences when their badge is opened', async () => {
        const harness = createHarness('total-warfare');
        automationModes['pilotSkillCheck'] = 'no';
        spyOn(Math, 'random').and.returnValue(0);
        resolveFalling.and.resolveTo({ action: 'skip' });
        const slot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',
            slotId: slot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const revisionBefore = harness.fixture.instance.query().stateRevision;
        const previewBefore = harness.fixture.instance.query().previewEndPhase();
        expect(previewBefore.accepted).toBeTrue();
        if (!previewBefore.accepted) return;
        expect(previewBefore.state.movementPsr.checks.some(check =>
            check.status === 'pending')).toBeTrue();

        const rows = await service.prepareEndPhaseCommands(
            harness.force,
            [{ instanceId: harness.instanceId, command: { type: 'end-phase' } }],
            { interactive: true, phaseWork: 'pilot-checks' },
        );
        const settled = rows?.[0] && await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            rows[0].prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(harness.fixture.instance.query().stateRevision).toBeGreaterThan(revisionBefore);
        expect(harness.fixture.instance.query().hasPendingCombat()).toBeFalse();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([
            jasmine.objectContaining({ status: 'failed' }),
        ]);
        expect(resolveFalling).toHaveBeenCalled();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
        expect(harness.fixture.instance.query().turnState().endTurnCheckpoint).toBeUndefined();
        const review = resolveChecksAutomation.calls.allArgs()
            .find(args => args[0] === 'pilotSkillCheck');
        expect(review?.[1]).toHaveSize(1);
        expect(review?.[2]).toEqual(jasmine.objectContaining({
            interactive: true,
            manualResolution: true,
        }));
    });

    describe('an immediate Movement check at the phase boundary', () => {
        /** Under the full phase system, a run on a damaged gyro raises an immediate check (TW p.59; Core p.113). */
        function runOnDamagedGyro() {
            const harness = createHarness('total-warfare');
            const { instance, index } = harness.fixture;
            const gyro = [...index.slots.values()].find(slot => slot.componentIds.some(componentId => {
                const component = index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Gyro';
            }))!;
            expect(instance.dispatch({ type: 'hit-critical', slotId: gyro.id, hits: 1, target: 'committed' }).accepted)
                .toBeTrue();
            expect(instance.dispatch({ type: 'resolve-mek-pilot-check', checkId: instance.query().mekPilotChecks()[0]!.checkId,
                evidence: { dice: [6, 6] } }).accepted).toBeTrue();
            expect(instance.dispatch({ type: 'declare-mek-movement', realPhases: true,
                declaration: { mode: 'run', distance: 2, boosterComponentIds: [] } }).changed).toBeTrue();
            return harness;
        }

        it('asks for the roll even with PSR automation off, then ends the phase', async () => {
            const harness = runOnDamagedGyro();
            automationModes['pilotSkillCheck'] = 'no';
            spyOn(Math, 'random').and.returnValue(0.99);

            const prepared = await service.prepareCommand(harness.force, harness.instanceId, { type: 'end-phase' });
            const settled = await service.settleBeforeCommand(harness.force, harness.instanceId, prepared, harness.dispatch);

            const review = resolveChecksAutomation.calls.allArgs().find(args => args[0] === 'pilotSkillCheck');
            expect(review?.[1]).toEqual([jasmine.objectContaining({ description: 'Running with damaged gyro' })]);
            expect(review?.[2]).toEqual(jasmine.objectContaining({ manualResolution: true }));
            expect(harness.fixture.instance.query().mekPilotChecks().map(check => check.status))
                .toEqual(['success', 'success']);
            expect(harness.fixture.instance.dispatch(settled!.command).changed).toBeTrue();
            expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        });

        it('keeps the phase open while the roll is not made', async () => {
            const harness = runOnDamagedGyro();
            automationModes['pilotSkillCheck'] = 'no';
            resolveChecksAutomation.and.resolveTo(null);

            const prepared = await service.prepareCommand(harness.force, harness.instanceId, { type: 'end-phase' });

            expect(prepared.cancelled).toBeTrue();
            expect(harness.fixture.instance.dispatch({ type: 'end-phase' }).changed).toBeFalse();
            expect(harness.fixture.instance.query().mekPilotChecks()[1]).toEqual(jasmine.objectContaining({
                status: 'pending', immediate: true,
            }));
        });
    });

    it('keeps the Mek prone when falling automation skips damage after a failed PSR', async () => {
        const harness = createHarness('total-warfare');
        automationModes['pilotSkillCheck'] = 'yes';
        automationModes['fallingCheck'] = 'no';
        resolveFalling.and.resolveTo({ action: 'skip' });
        const foot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',
            slotId: foot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',
        });
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(resolveFalling).toHaveBeenCalled();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([
            jasmine.objectContaining({ status: 'failed' }),
        ]);
        expect(harness.fixture.instance.query().turnState().pendingFallConsequences)
            .toBeUndefined();
        expect(harness.fixture.instance.dispatch(settled!.command).accepted).toBeTrue();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
    });

    it('bypasses the PSR roll dialog when every pending check fails automatically', async () => {
        const harness = createHarness('total-warfare');
        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        expect(harness.fixture.instance.dispatch({
            type: 'set-crew-state',
            positionId: pilotId,
            wounds: 0,
            unconscious: false,
            ejected: true,
        }).accepted).toBeTrue();
        const foot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',
            slotId: foot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();

        const rows = await service.prepareEndPhaseCommands(
            harness.force,
            [{ instanceId: harness.instanceId, command: { type: 'end-phase' } }],
            { interactive: true, phaseWork: 'pilot-checks' },
        );
        const settled = rows?.[0] && await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            rows[0].prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        const psrReview = resolveChecksAutomation.calls.allArgs()
            .find(args => args[0] === 'pilotSkillCheck');
        expect(psrReview?.[1]).toEqual([]);
        expect(resolveFalling).toHaveBeenCalled();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
    });

    it('discards an automatic fall without applying it when PSR automation is disabled', async () => {
        const harness = createHarness('total-warfare');
        automationModes['pilotSkillCheck'] = 'no';
        resolveChecksAutomation.and.resolveTo([]);
        const leg = [...harness.fixture.index.locations.values()]
            .find(location => location.code === 'LL')!;
        expect(harness.fixture.instance.dispatch({
            type: 'damage-internal',
            locationId: leg.id,
            amount: leg.internalPoints,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(harness.fixture.instance.query().mekMovementPsrState().automaticFalls.length)
            .toBeGreaterThan(0);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',
        });
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(resolveFalling).not.toHaveBeenCalled();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeFalse();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(harness.fixture.instance.query().mekMovementPsrState().automaticFalls).toEqual([]);
        expect(harness.fixture.instance.dispatch(settled!.command).accepted).toBeTrue();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeFalse();
    });

    it('resolves a missed death from above as a 2-level fall onto the rear', async () => {
        const harness = createHarness('total-warfare');
        automationModes['criticalHitChanceCheck'] = 'no';
        // Orientation 1 lands an ordinary Total Warfare fall on its front; both groups then roll 6: right torso.
        const rolls = [1, 3, 3, 3, 3].map(d6Random);
        resolveFalling.and.callFake(async data => resolveAutomaticFallingDamage(data, () => rolls.shift()!));
        const location = (code: string) => [...harness.fixture.index.locations.values()]
            .find(candidate => candidate.code === code)!;
        const rightTorsoFront = location('RT').armorFaceIds
            .map(faceId => harness.fixture.index.armorFaces.get(faceId)!)
            .find(face => face.face === 'front')!;
        const query = () => harness.fixture.instance.query();
        expect(harness.fixture.instance.dispatch({
            type: 'record-mek-physical-attack-checks',
            attackId: 'attack:dfa',
            checks: [],
            missedDeathFromAbove: true,
        }).changed).toBeTrue();

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, { type: 'end-phase' });
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(resolveFalling).toHaveBeenCalledOnceWith(
            jasmine.objectContaining({ levelsFallen: 2, alwaysRear: true }),
            jasmine.anything(),
        );
        // 20 tons falling 2 levels deals 2 × 3 = 6: five through the empty rear armor into the
        // right torso, and the last point transfers to the center torso's rear.
        expect(query().remainingArmor(rightTorsoFront.id, 'committed')).toBe(rightTorsoFront.maximumPoints);
        expect(query().remainingInternal(location('RT').id, 'committed')).toBe(0);
        expect(query().remainingInternal(location('CT').id, 'committed'))
            .toBe(location('CT').internalPoints - 1);
        expect(query().hasCondition('prone')).toBeTrue();
        expect(query().mekMovementPsrState().automaticFalls).toEqual([]);
        expect(harness.fixture.instance.dispatch(settled!.command).accepted).toBeTrue();
    });

    it('deals falling damage when an attempt to stand fails', async () => {
        const harness = createHarness('core-2026');
        expect(harness.fixture.instance.dispatch({ type: 'set-condition', condition: 'prone', active: true }).accepted)
            .toBeTrue();
        expect(harness.fixture.instance.dispatch({ type: 'prepare-mek-stand' }).accepted).toBeTrue();
        const failed = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'resolve-mek-stand-attempt', carefulStand: false, evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        });
        expect(failed.pilotCheckFall).toBeDefined();
        expect(resolveFalling).toHaveBeenCalledOnceWith(jasmine.objectContaining({ levelsFallen: 0 }), jasmine.anything());

        const stood = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'resolve-mek-stand-attempt', carefulStand: false, evidence: { dice: [6, 6], claimedOutcome: 'success' },
        });
        expect(stood.pilotCheckFall).toBeUndefined();

        const durability = () => [...harness.fixture.index.locations.values()]
            .reduce((total, location) => total
                + harness.fixture.instance.query().remainingInternal(location.id)
                + location.armorFaceIds.reduce((armor, faceId) =>
                    armor + harness.fixture.instance.query().remainingArmor(faceId), 0), 0);
        const before = durability();
        const result = harness.fixture.instance.dispatch(failed.command);
        expect(await service.afterCommand(
            harness.force, harness.instanceId, harness.snapshot(), failed, result, harness.dispatch,
        )).toBeTrue();
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
        // 20 tons falling 0 levels deal 2 points, once.
        expect(before - durability()).toBe(2);
    });

    it('drops a Mek whose jump-into-water roll fails to the bottom, falling the water\'s depth', async () => {
        const fixture = createDirectShieldRuntimeFixture('total-warfare', 'small', 'unit:automation:jump-water');
        const harness = createHarnessForFixture(fixture, 'total-warfare', 'unit:automation:jump-water');
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement', declaration: { mode: 'jump', distance: 1, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'replace-turn-state', turn: { ...fixture.instance.query().turnState(), cover: 'underwater-depth-1' },
        }).accepted).toBeTrue();
        const check = fixture.instance.query().mekPilotChecks()[0]!;
        expect(check.source.triggerKind).toBe('jump-into-water');

        await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'resolve-mek-pilot-check',
            checkId: check.checkId,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        });
        expect(resolveFalling).toHaveBeenCalledOnceWith(
            jasmine.objectContaining({ levelsFallen: 1, waterDepth: 1 }),
            jasmine.anything(),
        );
    });

    describe('swarming infantry', () => {
        const jump = Object.freeze({
            type: 'declare-mek-movement', declaration: { mode: 'jump', distance: 1, boosterComponentIds: [] },
        } as const satisfies CBTUnitCommand);
        const swarmedHarness = (instanceId: string) => {
            const harness = createHarnessForFixture(
                createDirectShieldRuntimeFixture('total-warfare', 'small', instanceId), 'total-warfare', instanceId);
            expect(harness.fixture.instance.dispatch({ type: 'set-condition', condition: 'swarmed', active: true })
                .changed).toBeTrue();
            return harness;
        };
        const settle = async (harness: ReturnType<typeof swarmedHarness>, prepared: PreparedDirectMekAutomationCommand) => {
            const before = harness.snapshot();
            const result = harness.fixture.instance.dispatch(prepared.command);
            return service.afterCommand(harness.force, harness.instanceId, before, prepared, result, harness.dispatch);
        };
        const conditions = (harness: ReturnType<typeof swarmedHarness>) =>
            (['prone', 'swarmed'] as const).filter(condition => harness.fixture.instance.query().hasCondition(condition));
        const resolve = (checkId: string, passed: boolean) => Object.freeze({
            type: 'resolve-mek-pilot-check', checkId,
            evidence: passed ? { dice: [6, 6], claimedOutcome: 'success' } : { dice: [1, 1], claimedOutcome: 'failed' },
        } as const satisfies CBTUnitCommand);
        const pilotingTarget = (harness: ReturnType<typeof swarmedHarness>) => {
            const movement = harness.fixture.instance.query().mekMovementPsr();
            if (movement.kind !== 'supported') throw new Error('The fixture Mek has no PSR projection');
            return movement.pilotingTargetNumber;
        };

        it("throws the infantry off a 'Mech whose jump shakes it off; a failed roll leaves both standing", async () => {
            const harness = swarmedHarness('unit:automation:shake-off-jump');
            expect(harness.fixture.instance.dispatch(jump).accepted).toBeTrue();
            const check = harness.fixture.instance.query().mekPilotChecks()[0]!;

            const failed = await service.prepareCommand(harness.force, harness.instanceId, resolve(check.checkId, false));
            expect(failed.pilotCheckFall).toBeUndefined();
            expect(failed.shookOffSwarm).toBeUndefined();
            expect(resolveFalling).not.toHaveBeenCalled();

            const passed = await service.prepareCommand(harness.force, harness.instanceId, resolve(check.checkId, true));
            expect(await settle(harness, passed)).toBeTrue();
            expect(shakeOff).toHaveBeenCalledOnceWith(harness.member, { kind: 'jump', jumpMp: 1, waterDepth: 0 });
            expect(conditions(harness)).toEqual([]);
        });

        for (const passed of [true, false]) {
        it(`${passed ? 'throws the infantry off' : 'keeps the infantry on'} with the jump roll rolled at the end of the phase`,
            async () => {
            const harness = swarmedHarness(`unit:automation:shake-off-phase-${passed}`);
            expect(harness.fixture.instance.dispatch(jump).accepted).toBeTrue();
            spyOn(Math, 'random').and.returnValue(passed ? 0.99 : 0);
            const prepared = await service.prepareCommand(harness.force, harness.instanceId, { type: 'end-phase' });
            // Failing it is no fall, so it takes no other fall roll down with it.
            const [row] = resolveChecksAutomation.calls.mostRecent().args[1];
            expect(row).toEqual(jasmine.objectContaining({ failureOutcome: 'Infantry holds on' }));
            expect(row.failureGroup).toBeUndefined();
            expect(prepared.phaseBoundary?.fall).toBeNull();

            expect(await service.settleBeforeCommand(harness.force, harness.instanceId, prepared, harness.dispatch))
                .not.toBeNull();
            expect(shakeOff.calls.allArgs()).toEqual(passed
                ? [[harness.member, { kind: 'jump', jumpMp: 1, waterDepth: 0 }]] : []);
            expect(conditions(harness)).toEqual(passed ? [] : ['swarmed']);
        });
        }

        it("tells the 'Mech's jump of the swarming infantry's magnetic claws", async () => {
            const harness = swarmedHarness('unit:automation:shake-off-claws');
            removalModifier.and.returnValue(1);
            expect((await service.prepareCommand(harness.force, harness.instanceId, jump)).command)
                .toEqual({ ...jump, swarmerMagneticClaws: true });
            removalModifier.and.returnValue(0);
            expect((await service.prepareCommand(harness.force, harness.instanceId, jump)).command).toEqual(jump);
        });

        it("throws the infantry off a swarmed 'Mech that falls, into the water it fell in", async () => {
            const harness = swarmedHarness('unit:automation:swarm-fall');
            expect(harness.fixture.instance.dispatch(jump).accepted).toBeTrue();
            expect(harness.fixture.instance.dispatch({
                type: 'replace-turn-state',
                turn: { ...harness.fixture.instance.query().turnState(), cover: 'underwater-depth-1' },
            }).accepted).toBeTrue();
            const check = harness.fixture.instance.query().mekPilotChecks()
                .find(candidate => candidate.source.triggerKind === 'jump-into-water')!;

            const fell = await service.prepareCommand(harness.force, harness.instanceId, resolve(check.checkId, false));
            expect(fell.pilotCheckFall).toBeDefined();
            expect(await settle(harness, fell)).toBeTrue();
            expect(shakeOff).toHaveBeenCalledOnceWith(harness.member, { kind: 'fall', waterDepth: 1 });
            expect(conditions(harness)).toEqual(['prone']);
        });

        it("drops a swarmed 'Mech prone hard: a passed roll, magnetic claws +1, falls and throws the infantry off",
            async () => {
            const harness = swarmedHarness('unit:automation:drop-prone');
            const target = pilotingTarget(harness) + 1;
            choose.and.resolveTo('hard');
            removalModifier.and.returnValue(1);
            spyOn(Math, 'random').and.returnValue(0.99);

            const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
                type: 'set-condition', condition: 'prone', active: true,
            });
            expect(removalModifier).toHaveBeenCalledOnceWith(harness.member);
            expect(resolveChecksAutomation.calls.mostRecent().args[1])
                .toEqual([jasmine.objectContaining({ targetNumber: target, failureOutcome: 'Infantry holds on' })]);
            expect(prepared.pilotCheckFall).toBeDefined();
            expect(await settle(harness, prepared)).toBeTrue();
            expect(shakeOff).toHaveBeenCalledOnceWith(harness.member, { kind: 'fall', waterDepth: 0 });
            expect(conditions(harness)).toEqual(['prone']);
        });

        for (const choice of ['prone', 'failed'] as const) {
        it(`goes prone with the infantry still on when the ${choice === 'prone' ? 'player just goes prone' : 'roll fails'}`,
            async () => {
            const harness = swarmedHarness(`unit:automation:drop-prone-${choice}`);
            choose.and.resolveTo(choice === 'prone' ? 'prone' : 'hard');
            spyOn(Math, 'random').and.returnValue(0);

            const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
                type: 'set-condition', condition: 'prone', active: true,
            });
            expect(resolveChecksAutomation).toHaveBeenCalledTimes(choice === 'prone' ? 0 : 1);
            expect(prepared.pilotCheckFall).toBeUndefined();
            expect(await settle(harness, prepared)).toBeTrue();
            expect(shakeOff).not.toHaveBeenCalled();
            expect(conditions(harness)).toEqual(['prone', 'swarmed']);
        });
        }

        it("drowns the infantry when a swarmed 'Mech wades into Depth 2 water, unless it holds on with UMU MP",
            async () => {
            const harness = swarmedHarness('unit:automation:swarm-deep-water');
            const wade = (depth: 1 | 2 | 3): PreparedDirectMekAutomationCommand => Object.freeze({
                command: {
                    type: 'replace-turn-state' as const,
                    turn: { ...harness.fixture.instance.query().turnState(), cover: `underwater-depth-${depth}` as const },
                },
                deferredPilotHits: 0,
            });
            expect(await settle(harness, wade(1))).toBeTrue();
            expect(shakeOff).not.toHaveBeenCalled();
            shakeOff.and.returnValue(false);
            expect(await settle(harness, wade(2))).toBeTrue();
            expect(shakeOff).toHaveBeenCalledOnceWith(harness.member, { kind: 'deep-water', waterDepth: 2 });
            expect(conditions(harness)).toEqual(['swarmed']);
            // Going deeper is not entering deep water again.
            expect(await settle(harness, wade(3))).toBeTrue();
            expect(shakeOff).toHaveBeenCalledTimes(1);
            shakeOff.and.returnValue(true);
            expect(await settle(harness, wade(1))).toBeTrue();
            expect(await settle(harness, wade(3))).toBeTrue();
            expect(shakeOff.calls.mostRecent().args).toEqual([harness.member, { kind: 'deep-water', waterDepth: 3 }]);
            expect(conditions(harness)).toEqual([]);
        });
    });

    it('keeps pending combat uncommitted when the phase PSR review is cancelled', async () => {
        const harness = createHarness('total-warfare');
        const slot = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: slot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const phaseCommand: CBTUnitCommand = {
            type: 'end-phase',

        };
        const revisionBefore = harness.fixture.instance.query().stateRevision;
        const pendingBefore = harness.fixture.instance.query().hasPendingCombat();
        expect(pendingBefore).toBeTrue();
        resolveChecksAutomation.and.callFake(async (
            key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => key === 'pilotSkillCheck'
            ? null
            : resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups));

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            phaseCommand,
        );

        expect(prepared.cancelled).toBeTrue();
        expect(harness.fixture.instance.query().stateRevision).toBe(revisionBefore);
        expect(harness.fixture.instance.query().hasPendingCombat()).toBeTrue();
        expect(harness.fixture.instance.query().mekPilotChecks()).toEqual([]);
        expect(resolveChecksAutomation).toHaveBeenCalledWith(
            'pilotSkillCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ title: 'Piloting Skill Rolls' }),
        );
    });

    it('resolves a post-fall seatbelt check from the damaged runtime before ending the phase', async () => {
        const harness = createHarness('total-warfare');
        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        const actuator = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: actuator.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(resolveChecksAutomation.calls.allArgs()
            .flatMap(args => args[1] as readonly { readonly label: string }[]))
            .toContain(jasmine.objectContaining({
                label: 'Seatbelt check · Falling',
                description: 'Reason: Falling. Avoid pilot damage.',
                failedLabel: 'PILOT HIT',
            }));
        expect(harness.fixture.instance.query().crewState(pilotId).wounds).toBe(1);
        expect(harness.fixture.instance.query().hasCondition('prone')).toBeTrue();
        expect(harness.fixture.instance.dispatch(settled!.command).accepted).toBeTrue();
    });

    it('resumes a closed post-fall check without applying the fall damage twice', async () => {
        const harness = createHarness('total-warfare');
        const actuator = [...harness.fixture.index.slots.values()].find(candidate =>
            harness.fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = harness.fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(harness.fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: actuator.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const durability = () => [...harness.fixture.index.locations.values()]
            .reduce((total, location) => total
                + harness.fixture.instance.query().remainingInternal(location.id)
                + location.armorFaceIds.reduce((armor, faceId) =>
                    armor + harness.fixture.instance.query().remainingArmor(faceId), 0), 0);
        const beforeFall = durability();
        let seatbeltAttempts = 0;
        resolveChecksAutomation.and.callFake(async (
            key: string,
            checks: Parameters<typeof resolveAutomationChecksAutomatically>[0],
            options: { readonly initiallyFailedGroups?: ReadonlySet<string> },
        ) => {
            if (key === 'pilotHitsAndConsciousnessCheck'
                && checks.some(check => check.label === 'Seatbelt check · Falling')
                && seatbeltAttempts++ === 0) return null;
            return resolveAutomationChecksAutomatically(checks, options.initiallyFailedGroups);
        });
        spyOn(Math, 'random').and.returnValue(0);

        const first = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });
        expect(await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            first,
            harness.dispatch,
        )).toBeNull();
        const afterClosedCheck = durability();
        expect(afterClosedCheck).toBeLessThan(beforeFall);
        expect(harness.fixture.instance.query().turnState().pendingFallConsequences)
            .toEqual(jasmine.objectContaining({
                stage: 'seatbelts',
                totalDamage: jasmine.any(Number),
            }));

        const retry = await service.prepareCommand(harness.force, harness.instanceId, {
            type: 'end-phase',

        });
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            retry,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(seatbeltAttempts).toBe(2);
        expect(durability()).toBe(afterClosedCheck);
        expect(harness.fixture.instance.query().turnState().pendingFallConsequences)
            .toBeUndefined();
        expect(harness.fixture.instance.dispatch(settled!.command).accepted).toBeTrue();
    });

    it('adds pilot damage without rerolling consciousness for an already-unconscious crew member', async () => {
        const harness = createHarness('total-warfare');
        const pilotId = [...harness.fixture.index.crewPositions.keys()][0]!;
        expect(harness.fixture.instance.dispatch({
            type: 'set-crew-state',

            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        const command = explosiveCriticalCommand(harness.fixture);
        const before = harness.snapshot();
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);
        const result = harness.fixture.instance.dispatch(prepared.command);
        expect(result.accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);

        expect(await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            prepared,
            result,
            harness.dispatch,
        )).toBeTrue();
        expect(harness.fixture.instance.query().crewState(pilotId)).toEqual(jasmine.objectContaining({
            wounds: 1 + prepared.deferredPilotHits,
            unconscious: true,
        }));
    });

    it('reviews and resolves the durable Core torso check at the phase boundary', async () => {
        const harness = createHarness('core-2026');
        const torso = [...harness.fixture.index.locations.values()]
            .find(location => location.code === 'LT')!;
        expect(harness.fixture.instance.dispatch({
            type: 'damage-internal',

            locationId: torso.id,
            amount: torso.internalPoints,
            target: 'committed',
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        const command: CBTUnitCommand = {
            type: 'end-phase',

        };

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            command,
        );
        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );
        expect(settled).not.toBeNull();
        const result = harness.fixture.instance.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();

        expect(harness.fixture.instance.query().hasCondition('crippled')).toBeTrue();
        const events = resolveChecksAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotSkillCheck')
            .flatMap(args => args[1] as readonly { readonly label: string }[]);
        expect(events).toContain(jasmine.objectContaining({
            label: 'Crippling Destruction Check',
        }));
    });

    it('skips a destroyed-location critical chance when no explosive slot remains', async () => {
        const harness = createHarness();
        const location = [...harness.fixture.index.locations.values()]
            .find(candidate => candidate.code === 'LL')!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'damage-internal',

            locationId: location.id,
            amount: harness.fixture.instance.query().remainingInternal(location.id, 'committed'),
            target: 'committed',
        };
        const result = harness.fixture.instance.dispatch(command);
        expect(result.accepted).toBeTrue();

        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            { command, deferredPilotHits: 0 },
            result,
            harness.dispatch,
        );

        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('criticalHitChanceCheck');
    });

    it('does not queue rules-generated critical chances when automation is disabled', async () => {
        const harness = createHarness();
        automationModes['criticalHitChanceCheck'] = 'no';
        const location = [...harness.fixture.index.locations.values()]
            .find(candidate => harness.fixture.instance.query().mekCriticalRollProfile(
                candidate.id,
                'committed',
            ).validRolls.length > 0)!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'damage-internal',
            locationId: location.id,
            amount: 1,
            target: 'committed',
        };
        const result = harness.fixture.instance.dispatch(command);
        expect(result.accepted).toBeTrue();

        expect(await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            { command, deferredPilotHits: 0 },
            result,
            harness.dispatch,
        )).toBeTrue();

        expect(harness.fixture.instance.query().turnState().pendingCriticalEvents)
            .toBeUndefined();
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('criticalHitChanceCheck');
    });

    it('retains and resumes the exact critical chance when its review is closed', async () => {
        const harness = createHarness();
        automationModes['criticalHitChanceCheck'] = 'ask';
        const location = [...harness.fixture.index.locations.values()]
            .find(candidate => harness.fixture.instance.query().mekCriticalRollProfile(
                candidate.id,
                'committed',
            ).validRolls.length > 0)!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'damage-internal',
            locationId: location.id,
            amount: 1,
            target: 'committed',
        };
        spyOn(Math, 'random').and.returnValue(0);
        resolveAutomation.and.callFake(async (
            key: string,
            events: readonly { readonly id: string }[],
        ) => key === 'criticalHitChanceCheck'
            ? null
            : new Set(events.map(event => event.id)));
        const result = harness.fixture.instance.dispatch(command);
        expect(result.accepted).toBeTrue();

        await service.afterCommand(
            harness.force,
            harness.instanceId,
            before,
            { command, deferredPilotHits: 0 },
            result,
            harness.dispatch,
        );

        const pending = harness.fixture.instance.query().turnState().pendingCriticalEvents?.[0];
        expect(pending).toEqual(jasmine.objectContaining({
            type: 'critical-chance',
            locationId: location.id,
            roll: [1, 1],
            result: 'none',
        }));
        const notification = projectRuntimeUnitNotifications(harness.snapshot(), {
            pilotSkillCheck: 'ask',
            pilotHitsAndConsciousnessCheck: 'ask',
            heatAndDissipationResolution: 'yes',
            heatEffectsCheck: 'ask',
        });
        expect(notification?.pendingEvents).toContain(jasmine.objectContaining({
            kind: 'critical-chance',
            count: 1,
        }));
        const firstReview = resolveAutomation.calls.allArgs()
            .find(args => args[0] === 'criticalHitChanceCheck');
        expect(firstReview?.[2]).toEqual(jasmine.objectContaining({
            manualResolution: false,
        }));

        // Turning automation off later must not discard work that was already
        // serialized while ASK was active.
        automationModes['criticalHitChanceCheck'] = 'no';
        resolveAutomation.and.callFake(async (
            _key: string,
            events: readonly { readonly id: string }[],
        ) => new Set(events.map(event => event.id)));
        expect(await service.resumePendingAutomation(
            harness.force,
            harness.instanceId,
            harness.dispatch,
            true,
        )).toBeTrue();

        expect(harness.fixture.instance.query().turnState().pendingCriticalEvents).toBeUndefined();
        const reviews = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'criticalHitChanceCheck');
        expect(reviews).toHaveSize(2);
        expect(reviews[1]?.[1]).toEqual(firstReview?.[1]);
        expect(reviews[1]?.[2]).toEqual(jasmine.objectContaining({
            interactive: true,
            manualResolution: true,
        }));
    });

    it('retains the exact critical slot roll when manual review is closed', async () => {
        const harness = createHarness();
        automationModes['criticalHitChanceCheck'] = 'no';
        const location = [...harness.fixture.index.locations.values()]
            .find(candidate => harness.fixture.instance.query().mekCriticalRollProfile(
                candidate.id,
                'committed',
            ).validRolls.length > 0)!;
        const turn = harness.fixture.instance.query().turnState();
        expect(harness.fixture.instance.dispatch({
            type: 'replace-turn-state',
            turn: {
                ...turn,
                pendingCriticalEvents: [{
                    type: 'critical-hit',
                    eventId: 'critical:manual-slot-review',
                    locationId: location.id,
                    target: 'committed',
                    remainingHits: 1,
                    caseIIDiscards: [false],
                }],
            },
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0);
        resolveAutomation.and.resolveTo(null);
        const criticalHits = () => [...harness.fixture.index.slots.values()].reduce(
            (total, slot) => total
                + harness.fixture.instance.query().criticalHits(slot.id, 'committed'),
            0,
        );
        const hitsBefore = criticalHits();

        expect(await service.resumePendingAutomation(
            harness.force,
            harness.instanceId,
            harness.dispatch,
            false,
        )).toBeFalse();

        const pending = harness.fixture.instance.query().turnState().pendingCriticalEvents?.[0];
        expect(pending).toEqual(jasmine.objectContaining({
            type: 'critical-hit',
            eventId: 'critical:manual-slot-review',
            remainingHits: 1,
            roll: jasmine.any(Array),
        }));
        const firstReview = resolveAutomation.calls.allArgs()
            .find(args => (args[1] as readonly { readonly event: string }[])[0]?.event
                === 'Critical Hit');
        expect(firstReview?.[2]).toEqual(jasmine.objectContaining({
            manualResolution: true,
        }));

        resolveAutomation.and.callFake(async (
            _key: string,
            events: readonly { readonly id: string }[],
        ) => new Set(events.map(event => event.id)));
        expect(await service.resumePendingAutomation(
            harness.force,
            harness.instanceId,
            harness.dispatch,
            true,
        )).toBeTrue();

        expect(harness.fixture.instance.query().turnState().pendingCriticalEvents).toBeUndefined();
        expect(criticalHits()).toBeGreaterThan(hitsBefore);
        const reviews = resolveAutomation.calls.allArgs()
            .filter(args => (args[1] as readonly { readonly event: string }[])[0]?.event
                === 'Critical Hit');
        expect(reviews).toHaveSize(2);
        expect(reviews[1]?.[1]).toEqual(reviews[0]?.[1]);
    });

    it('keeps child criticals interactive without overriding nested explosion modes', async () => {
        const instanceId = 'unit:automation:interactive-critical-chain';
        const fixture = createDirectExplosionRuntimeFixture('core-2026', {}, instanceId);
        const harness = createHarnessForFixture(fixture, 'core-2026', instanceId);
        automationModes['criticalHitChanceCheck'] = 'yes';
        const critical = explosiveCriticalCommand(fixture);
        if (critical.type !== 'apply-mek-critical-roll') {
            throw new Error('Expected an explosive critical-roll command');
        }
        expect(fixture.instance.dispatch({
            type: 'replace-turn-state',
            turn: {
                ...fixture.instance.query().turnState(),
                pendingCriticalEvents: [{
                    type: 'critical-hit',
                    eventId: 'critical:interactive-chain',
                    locationId: critical.locationId,
                    target: critical.target,
                    remainingHits: 1,
                    caseIIDiscards: [false],
                    roll: critical.results,
                }],
            },
        }).accepted).toBeTrue();
        resolveAutomation.and.callFake(async (
            _key: string,
            events: readonly { readonly id: string; readonly event: string }[],
        ) => events[0]?.event === 'Critical Hit Chance'
            ? null
            : new Set(events.map(event => event.id)));
        let dispatch: CBTForceUnitCommandDispatch;
        dispatch = async (command, automate = true) => {
            const before = harness.snapshot();
            const prepared: PreparedDirectMekAutomationCommand = automate
                ? await service.prepareCommand(harness.force, instanceId, command)
                : { command, deferredPilotHits: 0 };
            if (prepared.cancelled) throw new Error('Unexpected nested automation cancellation');
            const result = fixture.instance.dispatch(prepared.command);
            if (automate) {
                await service.afterCommand(
                    harness.force,
                    instanceId,
                    before,
                    prepared,
                    result,
                    dispatch,
                );
            }
            return result;
        };

        expect(await service.resumePendingAutomation(
            harness.force,
            instanceId,
            dispatch,
            true,
        )).toBeFalse();

        expect(fixture.instance.query().turnState().pendingCriticalEvents?.[0])
            .toEqual(jasmine.objectContaining({ type: 'critical-chance' }));
        const childChance = resolveAutomation.calls.allArgs().find(args =>
            (args[1] as readonly { readonly event: string }[])[0]?.event
                === 'Critical Hit Chance');
        expect(childChance?.[2]).toEqual(jasmine.objectContaining({
            interactive: true,
        }));
        const internalExplosion = resolveAutomation.calls.allArgs().find(args =>
            args[0] === 'internalExplosionsCheck');
        expect((internalExplosion?.[2] as { readonly interactive?: boolean } | undefined)
            ?.interactive).toBeUndefined();
        const consciousness = resolveChecksAutomation.calls.allArgs().find(args =>
            args[0] === 'pilotHitsAndConsciousnessCheck');
        expect(consciousness?.[2]).toEqual(jasmine.objectContaining({
            interactive: false,
        }));
    });

    it('consumes a destroyed-location critical that rolls a non-explosive slot', async () => {
        const instanceId = 'unit:automation:destroyed-explosive-location';
        const fixture = createDirectExplosionRuntimeFixture('core-2026', {}, instanceId);
        const harness = createHarnessForFixture(fixture, 'core-2026', instanceId);
        const location = [...fixture.index.locations.values()]
            .find(candidate => candidate.code === 'RT')!;
        const before = harness.snapshot();
        const command: CBTUnitCommand = {
            type: 'damage-internal',

            locationId: location.id,
            amount: fixture.instance.query().remainingInternal(location.id, 'committed'),
            target: 'committed',
        };
        const result = fixture.instance.dispatch(command);
        expect(result.accepted).toBeTrue();

        const rolls = Array.from({ length: 6 }, (_unused, first) =>
            Array.from({ length: 6 }, (_ignored, second) => [first + 1, second + 1] as const))
            .flat();
        const explosive = rolls.filter(dice => {
            const plan = fixture.instance.query().mekCriticalRoll(location.id, dice, 'committed');
            return plan.kind === 'applied' && (plan.explosion !== undefined || plan.pendingExplosion !== undefined);
        });
        const inert = rolls.find(dice => {
            const plan = fixture.instance.query().mekCriticalRoll(location.id, dice, 'committed');
            return plan.kind !== 'applied' || (plan.explosion === undefined && plan.pendingExplosion === undefined);
        });
        expect(explosive.length).toBeGreaterThan(0);
        expect(inert).toBeDefined();
        const criticalHitsBefore = [...fixture.index.slots.values()].map(slot =>
            fixture.instance.query().criticalHits(slot.id, 'committed'));
        const random = [d6Random(4), d6Random(4), ...inert!.map(d6Random)];
        let randomIndex = 0;
        spyOn(Math, 'random').and.callFake(() => random[randomIndex++] ?? 0);

        await service.afterCommand(
            harness.force,
            instanceId,
            before,
            { command, deferredPilotHits: 0 },
            result,
            harness.dispatch,
        );

        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .toContain('criticalHitChanceCheck');
        expect([...fixture.index.slots.values()].map(slot =>
            fixture.instance.query().criticalHits(slot.id, 'committed')))
            .toEqual(criticalHitsBefore);
    });
});

function createHarness(ruleset: 'core-2026' | 'total-warfare' = 'core-2026') {
    const instanceId = `unit:automation:${ruleset}`;
    const fixture = createDirectMekRuntimeFixture(ruleset, instanceId);
    return createHarnessForFixture(fixture, ruleset, instanceId);
}

function createHarnessForFixture(
    fixture: DirectMekRuntimeFixture,
    ruleset: 'core-2026' | 'total-warfare',
    instanceId: string,
) {
    const snapshot = (): CBTUnitSnapshot => Object.freeze({
        instanceId,
        entity: fixture.entity,
        index: fixture.index,
        uuid: fixture.identity,
        ruleset,
        crewAssignment: fixture.instance.query().crewAssignment(),
        editContext: { owner: fixture.instance, state: fixture.instance.snapshot() },
        state: fixture.instance.snapshot(),
        query: fixture.instance.query(),
    });
    const member = { id: instanceId } as CBTForceMember;
    const force = { getUnitSnapshot: () => snapshot(), getCBTMembers: () => [member] } as unknown as CBTForce;
    const dispatch = async (command: CBTUnitCommand) => fixture.instance.dispatch(command);
    return { fixture, force, instanceId, snapshot, dispatch, member };
}

/** 15 outside heat against the fixture's 10 heat sinks: heat for End Turn to calculate. */
function generateHeat(harness: ReturnType<typeof createHarnessForFixture>): void {
    const result = harness.fixture.instance.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' });
    if (!result.accepted || !result.changed) throw new Error('Outside heat setup was rejected');
}

function setPendingHeat(
    harness: ReturnType<typeof createHarnessForFixture>,
    heat: number,
): void {
    const result = harness.fixture.instance.dispatch({
        type: 'set-pending-heat',

        heat,
    });
    if (!result.accepted) throw new Error('Failed to seed pending Mek heat');
}

function explosiveCriticalCommand(
    fixture: DirectMekRuntimeFixture,
    protection?: 'case' | 'case-ii',
): CBTUnitCommand {
    for (const location of fixture.index.locations.values()) {
        const profile = fixture.instance.query().mekCriticalRollProfile(location.id, 'committed');
        for (const results of profile.validRolls) {
            const plan = fixture.instance.query().mekCriticalRoll(location.id, results, 'committed');
            if (plan.kind === 'applied'
                && (plan.explosion || plan.pendingExplosion)
                && (protection === undefined
                    || plan.explosion?.locations.some(locationDamage =>
                        locationDamage.protection === protection))) {
                return {
                    type: 'apply-mek-critical-roll',

                    locationId: location.id,
                    results,
                    target: 'committed',
                };
            }
        }
    }
    throw new Error('The direct Mek fixture has no explosive critical slot');
}

function d6Random(result: number): number {
    return (result - 0.5) / 6;
}
