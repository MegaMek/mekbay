// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import type { CBTForce } from '../models/cbt-force.model';
import type { CBTNonMekUnitCommandResult } from '../models/cbt-force-api';
import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import type { UnitConditionKey } from '../models/unit-condition.model';
import { CORE_2026_RULESET } from '../models/cbt-ruleset.model';
import { AmmoEquipment } from '../models/equipment.model';
import { TestAeroSpaceFighterEntity } from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import {
    addTestEquipment,
    addTestEquipmentWithFlags,
} from '../models/entity/testing/test-mounted-equipment';
import { createDefaultCrewAssignment } from '../models/runtime/crew-assignment';
import {
    NonMekUnitInstance,
    type NonMekUnitCommand,
} from '../models/runtime/non-mek-unit-instance';
import { componentIdForMount } from '../models/runtime/non-mek-runtime-index';
import {
    asUnitInstanceId,
    type InstanceBaselineRef,
} from '../models/runtime/runtime-state';
import {
    asUnitUuid,
    MM_DATA_UNIT_PROVIDER_ID,
} from './unit-catalog/unit-catalog.types';
import { CBTAutomationService } from './cbt-automation.service';
import { DirectNonMekAutomationService } from './direct-non-mek-automation.service';
import { OptionsService } from './options.service';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5f1');

describe('DirectNonMekAutomationService', () => {
    let resolveAutomation: jasmine.Spy;
    let service: DirectNonMekAutomationService;
    let automationModes: Record<string, 'yes' | 'no' | 'ask'>;

    beforeEach(() => {
        automationModes = {
            heatAndDissipationResolution: 'yes',
            heatEffectsCheck: 'ask',
            pilotHitsAndConsciousnessCheck: 'ask',
        };
        resolveAutomation = jasmine.createSpy('resolve').and.callFake(
            async (_key: string, events: readonly { readonly id: string }[]) =>
                new Set(events.map(event => event.id)),
        );
        TestBed.configureTestingModule({
            providers: [
                DirectNonMekAutomationService,
                { provide: CBTAutomationService, useValue: { resolve: resolveAutomation } },
                {
                    provide: OptionsService,
                    useValue: { cbtAutomationMode: (key: string) => automationModes[key] ?? 'ask' },
                },
            ],
        });
        service = TestBed.inject(DirectNonMekAutomationService);
    });

    it('selects automatic or manual aerospace heat settlement from review', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 10, 'pending');
        const automatic = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',
            expectedRevision: harness.runtime.revision(),
            heatPolicy: 'manual',
        });
        expect(automatic.command).toEqual(jasmine.objectContaining({
            kind: 'end-turn',
            heatPolicy: 'automatic',
        }));

        resolveAutomation.and.callFake(async () => new Set<string>());
        const manual = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',
            expectedRevision: harness.runtime.revision(),
            heatPolicy: 'automatic',
        });
        expect(manual.command).toEqual(jasmine.objectContaining({
            kind: 'end-turn',
            heatPolicy: 'manual',
        }));
    });

    it('does not create a heat review event for a pristine heatless aerospace unit', async () => {
        const harness = createHarness();

        await executeEndTurn(service, harness);

        const heatReview = resolveAutomation.calls.allArgs()
            .find(args => args[0] === 'heatAndDissipationResolution');
        expect(heatReview?.[1]).toEqual([]);
        expect(harness.runtime.turnState().turnCounter).toBe(1);
    });

    it('cancels end turn when the heat review is closed', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 10);
        resolveAutomation.and.resolveTo(null);
        const command: NonMekUnitCommand = {
            kind: 'end-turn',
            expectedRevision: harness.runtime.revision(),
            heatPolicy: 'automatic',
        };

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(resolveAutomation).toHaveBeenCalledWith(
            'heatAndDissipationResolution',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('cancels an aerospace heat-effect review before mutating the turn', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 30);
        resolveAutomation.and.callFake(async (key: string, events: readonly { readonly id: string }[]) =>
            key === 'heatEffectsCheck' ? null : new Set(events.map(event => event.id)));
        const command: NonMekUnitCommand = {
            kind: 'end-turn',
            expectedRevision: harness.runtime.revision(),
            heatPolicy: 'automatic',
        };
        const revisionBefore = harness.runtime.revision();

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, command);

        expect(prepared).toEqual(jasmine.objectContaining({ command, cancelled: true }));
        expect(harness.runtime.revision()).toBe(revisionBefore);
        expect(harness.runtime.hasCondition('shutdown')).toBeFalse();
    });

    it('reviews non-Mek consciousness recovery before committing End Phase', async () => {
        const harness = createHarness();
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.dispatch({
            kind: 'set-crew-state',
            expectedRevision: harness.runtime.revision(),
            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        spyOn(Math, 'random').and.returnValue(0.99);
        const command: NonMekUnitCommand = {
            kind: 'end-phase',
            expectedRevision: harness.runtime.revision(),
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
        const result = await harness.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();

        expect(harness.runtime.query().crewState(pilotId).unconscious).toBeFalse();
        expect(resolveAutomation).toHaveBeenCalledWith(
            'pilotHitsAndConsciousnessCheck',
            jasmine.any(Array),
            jasmine.objectContaining({ allowCancel: true }),
        );
    });

    it('keeps a non-Mek phase uncommitted when recovery review closes', async () => {
        const harness = createHarness();
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.dispatch({
            kind: 'set-crew-state',
            expectedRevision: harness.runtime.revision(),
            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        const revision = harness.runtime.revision();
        resolveAutomation.and.resolveTo(null);
        const command: NonMekUnitCommand = {
            kind: 'end-phase',
            expectedRevision: revision,
        };

        const prepared = await service.prepareCommand(
            harness.force,
            harness.instanceId,
            command,
        );

        expect(prepared.cancelled).toBeTrue();
        expect(harness.runtime.revision()).toBe(revision);
        expect(harness.runtime.query().crewState(pilotId).unconscious).toBeTrue();
    });

    it('groups End Phase consciousness recoveries across non-Mek units', async () => {
        const first = createHarness(false, 'phase-first');
        const second = createHarness(false, 'phase-second');
        for (const harness of [first, second]) {
            const positionId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
            expect(harness.runtime.dispatch({
                kind: 'set-crew-state',
                expectedRevision: harness.runtime.revision(),
                positionId,
                wounds: 1,
                unconscious: true,
                ejected: false,
            }).accepted).toBeTrue();
        }
        const force = {
            getUnitSnapshot: (instanceId: typeof first.instanceId) => instanceId === first.instanceId
                ? first.snapshot()
                : instanceId === second.instanceId ? second.snapshot() : null,
        } as unknown as CBTForce;

        const prepared = await service.prepareEndPhaseCommands(force, [first, second].map(harness => ({
            instanceId: harness.instanceId,
            command: {
                kind: 'end-phase' as const,
                expectedRevision: harness.runtime.revision(),
            },
        })));

        expect(prepared).toHaveSize(2);
        const recoveryCalls = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'pilotHitsAndConsciousnessCheck');
        expect(recoveryCalls).toHaveSize(1);
        expect(recoveryCalls[0][1]).toHaveSize(2);
    });

    it('uses one aerospace review when heat, effects, and pilot hits all ask', async () => {
        automationModes['heatAndDissipationResolution'] = 'ask';
        const harness = createHarness();
        setHeat(harness.runtime, 30);

        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',
            expectedRevision: harness.runtime.revision(),
            heatPolicy: 'manual',
        });

        expect(prepared.cancelled).toBeUndefined();
        expect(resolveAutomation).toHaveBeenCalledTimes(1);
        expect(resolveAutomation.calls.argsFor(0)[1][0]).toEqual(jasmine.objectContaining({
            event: 'Heat, dissipation, effects, and pilot hits',
            effects: jasmine.arrayContaining([jasmine.stringMatching(/^Heat Shutdown Check:/)]),
        }));
    });

    it('applies aerospace shutdown, random movement, and pilot damage as typed commands', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 30);
        spyOn(Math, 'random').and.returnValue(0);

        await executeEndTurn(service, harness);

        expect(harness.runtime.hasCondition('shutdown')).toBeTrue();
        expect(harness.runtime.hasCondition('random-movement')).toBeTrue();
        expect(harness.runtime.hasCondition('out-of-control')).toBeTrue();
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.query().crewState(pilotId)).toEqual(jasmine.objectContaining({
            wounds: 1,
            unconscious: true,
        }));
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .toContain('heatEffectsCheck');
        expect(resolveAutomation.calls.allArgs().map(args => args[0]))
            .not.toContain('pilotHitsAndConsciousnessCheck');
        const heatEffectEvents = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly event: string }[]);
        expect(heatEffectEvents).toHaveSize(1);
        expect(heatEffectEvents[0].event).toBe('Aerospace Heat Effects and Pilot Hits');
    });

    it('settles aerospace heat consequences before resetting the turn', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 30);
        spyOn(Math, 'random').and.returnValue(0);
        const turn = harness.runtime.snapshot().turn.turnCounter;
        const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
            kind: 'end-turn',
            expectedRevision: harness.runtime.revision(),
        });

        const settled = await service.settleBeforeCommand(
            harness.force,
            harness.instanceId,
            prepared,
            harness.dispatch,
        );

        expect(settled).not.toBeNull();
        expect(harness.runtime.hasCondition('shutdown')).toBeTrue();
        expect(harness.runtime.snapshot().turn.turnCounter).toBe(turn);
        const result = await harness.dispatch(settled!.command);
        expect(result.accepted).toBeTrue();
        expect(harness.runtime.snapshot().turn.turnCounter).toBe(turn + 1);
    });

    it('resolves a later aerospace Control Roll after heat-induced random movement', async () => {
        const harness = createHarness();
        setHeat(harness.runtime, 10);
        setCondition(harness.runtime, 'random-movement', true);
        setCondition(harness.runtime, 'out-of-control', true);
        spyOn(Math, 'random').and.returnValue(0.99);

        await executeEndTurn(service, harness);

        expect(harness.runtime.hasCondition('random-movement')).toBeFalse();
        expect(harness.runtime.hasCondition('out-of-control')).toBeFalse();
        const heatEvents = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly effects?: readonly string[] }[]);
        expect(heatEvents.flatMap(event => event.effects ?? []))
            .toContain(jasmine.stringMatching(/^Aerospace Control Roll:/));
    });

    it('uses operational CASE to reduce aerospace ammunition explosions to one SI per 20 damage', async () => {
        const harness = createHarness(true);
        expect(harness.ammoId).toBeDefined();
        expect(harness.runtime.query().remainingAmmo(harness.ammoId!)).toBe(10);
        setHeat(harness.runtime, 19);
        spyOn(Math, 'random').and.returnValue(0);

        await executeEndTurn(service, harness);

        const heatEvents = resolveAutomation.calls.allArgs()
            .filter(args => args[0] === 'heatEffectsCheck')
            .flatMap(args => args[1] as readonly { readonly effects?: readonly string[] }[]);
        expect(heatEvents).toHaveSize(1);
        expect(heatEvents.flatMap(event => event.effects ?? []))
            .toContain(jasmine.stringMatching(/^Heat Ammunition Explosion Check:.*\(failed\)/));
        expect(harness.runtime.query().componentStatus(harness.ammoId!, 'committed'))
            .toBe('destroyed');
        const si = [...harness.runtime.getIndex().locations.values()]
            .find(location => location.code === 'SI')!;
        expect(si.internalPoints - harness.runtime.query().remainingInternal(si.id, 'committed'))
            .toBe(5);
        const pilotId = [...harness.runtime.getIndex().crewPositions.keys()][0]!;
        expect(harness.runtime.query().crewState(pilotId).wounds).toBe(1);
    });
});

function createHarness(withAmmo = false, suffix = '') {
    const ammo = new AmmoEquipment({
        id: 'Ammo_AC_10_Aero_Automation_Test',
        name: 'AC/10 Ammo',
        type: 'ammo',
        stats: { explosive: true },
        ammo: { type: 'AC', rackSize: 10, shots: 10, damagePerShot: 1 },
    });
    const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry(
        withAmmo ? { [ammo.id]: ammo } : {},
    ));
    entity.uuid.set(UUID);
    entity.structuralIntegrity.set(10);
    entity.heatSinkCount.set(0);
    let ammoId: ReturnType<typeof componentIdForMount> | undefined;
    if (withAmmo) {
        ammoId = componentIdForMount(addTestEquipment(entity, ammo, {
            location: 'Nose',
            shotsCount: 10,
        }));
        addTestEquipmentWithFlags(entity, 'F_CASE', { location: 'Nose' });
    }
    const instanceId = asUnitInstanceId(`${withAmmo
        ? 'unit:aero-automation-ammo'
        : 'unit:aero-automation'}${suffix ? `:${suffix}` : ''}`);
    const runtime = new NonMekUnitInstance(
        instanceId,
        baseline(),
        entity,
        CORE_2026_RULESET,
    );
    const crew = createDefaultCrewAssignment(runtime.getIndex().crewPositions);
    const snapshot = (): CBTUnitSnapshot => Object.freeze({
        instanceId,
        entity,
        index: runtime.getIndex(),
        sourceRef: baseline().entity,
        ruleset: CORE_2026_RULESET,
        state: runtime.snapshot(),
        query: runtime.query(),
    });
    const force = {
        getUnitSnapshot: () => snapshot(),
        getUnitCrewProfile: () => Object.freeze({ revision: 0, positions: crew.positions }),
    } as unknown as CBTForce;
    const dispatch = async (command: NonMekUnitCommand): Promise<CBTNonMekUnitCommandResult> => {
        const result = runtime.dispatch(command);
        return result.accepted
            ? Object.freeze({ accepted: true, changed: result.changed, state: result.state })
            : Object.freeze({
                accepted: false,
                changed: false,
                reason: result.reason!,
                currentRevision: result.state.stateRevision,
            });
    };
    return { entity, runtime, instanceId, ammoId, force, snapshot, dispatch };
}

async function executeEndTurn(
    service: DirectNonMekAutomationService,
    harness: ReturnType<typeof createHarness>,
): Promise<void> {
    const prepared = await service.prepareCommand(harness.force, harness.instanceId, {
        kind: 'end-turn',
        expectedRevision: harness.runtime.revision(),
    });
    const settled = await service.settleBeforeCommand(
        harness.force,
        harness.instanceId,
        prepared,
        harness.dispatch,
    );
    if (settled === null) throw new Error('Failed to settle reviewed end-turn effects');
    const result = await harness.dispatch(settled.command);
    await service.afterCommand(
        harness.force,
        harness.instanceId,
        settled,
        result,
        harness.dispatch,
    );
}

function setHeat(
    runtime: NonMekUnitInstance,
    heat: number,
    target: 'committed' | 'pending' = 'committed',
): void {
    const result = runtime.dispatch({
        kind: 'set-heat',
        expectedRevision: runtime.revision(),
        heat,
        target,
    });
    if (!result.accepted) throw new Error('Failed to seed test heat');
}

function setCondition(runtime: NonMekUnitInstance, condition: UnitConditionKey, active: boolean): void {
    const result = runtime.dispatch({
        kind: 'set-condition',
        expectedRevision: runtime.revision(),
        condition,
        active,
    });
    if (!result.accepted) throw new Error('Failed to seed test condition');
}

function baseline(): InstanceBaselineRef {
    return Object.freeze({
        entity: Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid: UUID,
            sourceFormat: 'blk' as const,
        }),
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}
