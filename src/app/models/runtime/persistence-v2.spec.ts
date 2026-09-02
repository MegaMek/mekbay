// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { asComponentId } from '../entity/entity-identifiers';
import {
    ForceEnvelopeValidationError,
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    CBT_UNIT_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
    asSavedTargetRef,
    createSavedTargetRef,
    emptyRuntimeHistory,
    validateSerializedCBTForceV2,
    type ForceEnvelopeValidationCode,
    type SerializedCBTUnitV2,
    type SerializedForceUnitEntryV2,
    type SerializedCBTForceV2,
} from './persistence-v2';
import { MAX_MEK_TURN_COLLECTION_ENTRIES } from './mek-turn-state-v2';
import { MAX_MEK_HEATSINKS_OFF_V2, MAX_MEK_HEAT_VALUE_V2 } from './mek-heat-state-v2';
import { prepareCBTForceRosterMutationPlan } from './cbt-force-roster-owner';
import { isSerializedNonMekUnit } from './non-mek-unit-persistence';

const UUID_A = asUnitUuid('01890e02-93bd-7b31-b5fa-4b56e92b1234');
const UUID_B = asUnitUuid('01890e02-93bd-7b31-b5fa-4b56e92b1235');
const UUID_C = asUnitUuid('01890e02-93bd-7b31-b5fa-4b56e92b1236');

describe('V2 force persistence', () => {
    it('uses compact target prefixes without length framing', () => {
        expect(createSavedTargetRef('location', 'lt', 'internal')).toBe('i:lt');
        expect(createSavedTargetRef('location', 'lt', 'front-armor')).toBe('f:lt');
        expect(createSavedTargetRef('location', 'lt', 'rear-armor')).toBe('r:lt');
        expect(createSavedTargetRef('slot', 'ra:3')).toBe('s:ra:3');
    });

    it('round-trips materialized units canonically', async () => {
        const sealed = await validateSerializedCBTForceV2(mixedForce());
        const restored = await validateSerializedCBTForceV2(JSON.parse(JSON.stringify(sealed)));

        expect(restored.units.map(entry => entry.instanceId)).toEqual([
            'unit:mek',
            'unit:vehicle',
            'unit:other',
        ]);
        const mek = restored.units[0];
        expect(!isSerializedNonMekUnit(mek.unit)
            ? mek.unit.pendingCombat?.locationDamage?.[0].damage
            : undefined).toBe(-1);
        expect(Object.isFrozen(restored.roster)).toBeTrue();
        expect(Object.isFrozen(restored.roster.groups[0].members)).toBeTrue();
        expect(restored.roster.groups[0]).toEqual({
            groupId: 'group:test',
            order: 0,
            name: 'Test Lance',
            color: '#123456',
            formationId: 'formation:line',
            formationLock: true,
            members: [
                { instanceId: 'unit:mek', order: 0 },
                {
                    instanceId: 'unit:vehicle',
                    order: 1,
                    commander: true,
                },
                { instanceId: 'unit:other', order: 2 },
            ],
        });
    });

    it('ignores transient scenario rules instead of loading them from a force', async () => {
        const source = clone(mixedForce()) as unknown as Record<string, unknown>;
        source['scenarioRules'] = {
            ruleset: 'total-warfare',
            options: { forcedWithdrawal: false },
        };

        const restored = await validateSerializedCBTForceV2(source);

        expect('scenarioRules' in restored).toBeFalse();
    });

    it('snapshots force validation before any async mutation window', async () => {
        const sealed = await validateSerializedCBTForceV2(mixedForce());
        const mutable = clone(sealed);
        const validationPending = validateSerializedCBTForceV2(mutable);
        const invalid = clone(sealed);
        invalid.units[0].unit.stateRevision = -1;
        for (const key of Object.keys(mutable)) delete mutable[key];
        Object.assign(mutable, invalid);

        const validated = await validationPending;
        expect(validated.units[0].unit.stateRevision).toBe(3);
        expect(mutable.units[0].unit.stateRevision).toBe(-1);
    });

    it('fails closed on duplicate, orphaned, missing, obsolete-kind, or misordered roster rows', async () => {
        const duplicateGroup = clone(mixedForce());
        duplicateGroup.roster.groups.push({
            ...duplicateGroup.roster.groups[0],
            members: [],
        });
        await expectCode(validateSerializedCBTForceV2(asForce(duplicateGroup)), 'DUPLICATE_ROSTER_GROUP_ID');

        const duplicateMember = clone(mixedForce());
        duplicateMember.roster.groups.push({
            groupId: 'group:duplicate-member',
            order: 1,
            members: [{ ...duplicateMember.roster.groups[0].members[0], order: 0 }],
        });
        await expectCode(validateSerializedCBTForceV2(asForce(duplicateMember)), 'DUPLICATE_ROSTER_MEMBER_ID');

        const orphan = clone(mixedForce());
        orphan.roster.groups[0].members[0].instanceId = 'unit:orphan';
        await expectCode(validateSerializedCBTForceV2(asForce(orphan)), 'DANGLING_ROSTER_MEMBER_ID');

        const missing = clone(mixedForce());
        missing.roster.groups[0].members.pop();
        await expectCode(validateSerializedCBTForceV2(asForce(missing)), 'MISSING_ROSTER_MEMBER_ID');

        const obsoleteUnitKind = clone(mixedForce());
        obsoleteUnitKind.units[0].kind = 'ready';
        await expectCode(validateSerializedCBTForceV2(asForce(obsoleteUnitKind)), 'INVALID_SHAPE');

        const obsoleteRosterKind = clone(mixedForce());
        obsoleteRosterKind.roster.groups[0].members[0].kind = 'ready';
        await expectCode(validateSerializedCBTForceV2(asForce(obsoleteRosterKind)), 'INVALID_SHAPE');

        const groupOrder = clone(mixedForce());
        groupOrder.roster.groups[0].order = 1;
        await expectCode(validateSerializedCBTForceV2(asForce(groupOrder)), 'ROSTER_ORDER_MISMATCH');

        const memberOrder = clone(mixedForce());
        memberOrder.roster.groups[0].members[1].order = 0;
        await expectCode(validateSerializedCBTForceV2(asForce(memberOrder)), 'ROSTER_ORDER_MISMATCH');

        const duplicateCommander = clone(mixedForce());
        duplicateCommander.roster.groups[0].members[0].commander = true;
        await expectCode(
            validateSerializedCBTForceV2(asForce(duplicateCommander)),
            'ROSTER_COMMANDER_CONFLICT',
            /may contain at most one commander/u,
        );

        const paddedName = clone(mixedForce());
        paddedName.roster.groups[0].name = ' Test Lance';
        await expectCode(validateSerializedCBTForceV2(asForce(paddedName)), 'INVALID_SHAPE');

        const oversizedColor = clone(mixedForce());
        oversizedColor.roster.groups[0].color = 'x'.repeat(513);
        await expectCode(validateSerializedCBTForceV2(asForce(oversizedColor)), 'INVALID_SHAPE');

        const falseLock = clone(mixedForce());
        falseLock.roster.groups[0].formationLock = false;
        await expectCode(validateSerializedCBTForceV2(asForce(falseLock)), 'INVALID_SHAPE');

        const falseCommander = clone(mixedForce());
        falseCommander.roster.groups[0].members[1].commander = false;
        await expectCode(validateSerializedCBTForceV2(asForce(falseCommander)), 'INVALID_SHAPE');

        const duplicateAliasAuthority = clone(mixedForce());
        duplicateAliasAuthority.roster.groups[0].members[1].alias = 'must-remain-unit-owned';
        await expectCode(validateSerializedCBTForceV2(asForce(duplicateAliasAuthority)), 'INVALID_SHAPE');

        const decoratedUnassigned = clone(mixedForce());
        decoratedUnassigned.roster.groups[0].groupId = 'cbt:unassigned';
        await expectCode(validateSerializedCBTForceV2(asForce(decoratedUnassigned)), 'INVALID_SHAPE');

        const missingFormationTarget = clone(mixedForce());
        missingFormationTarget.roster.groups[0].formationTargetGroupId = 'group:missing';
        await expectCode(validateSerializedCBTForceV2(asForce(missingFormationTarget)), 'INVALID_SHAPE');

        const selfFormationTarget = clone(mixedForce());
        selfFormationTarget.roster.groups[0].formationTargetGroupId = 'group:test';
        await expectCode(validateSerializedCBTForceV2(asForce(selfFormationTarget)), 'INVALID_SHAPE');
    });

    it('accepts canonical zero/one commander rosters and seals owner-planner output', async () => {
        const oneCommander = mixedForce();
        await expectAsync(validateSerializedCBTForceV2(oneCommander)).toBeResolved();

        const zeroCommanders = clone(mixedForce());
        delete zeroCommanders.roster.groups[0].members[1].commander;
        await expectAsync(validateSerializedCBTForceV2(asForce(zeroCommanders))).toBeResolved();

        const formationTarget = clone(mixedForce());
        formationTarget.roster.groups[0].formationTargetGroupId = 'group:target';
        formationTarget.roster.groups.push({ groupId: 'group:target', order: 1, members: [] });
        const sealedFormationTarget = await validateSerializedCBTForceV2(asForce(formationTarget));
        expect(sealedFormationTarget.roster.groups[0].formationTargetGroupId).toBe('group:target');

        const plannedForce = clone(mixedForce());
        const result = prepareCBTForceRosterMutationPlan({
            roster: plannedForce.roster,
            command: {
                kind: 'set-commander',
                instanceId: 'unit:mek',
                commander: true,
            },
        });
        expect(result.kind).toBe('ready');
        if (result.kind !== 'ready') return;
        plannedForce.roster = result.plan.nextRoster;
        const sealed = await validateSerializedCBTForceV2(asForce(plannedForce));
        expect(sealed.roster.groups[0].members.map(member => member.commander)).toEqual([
            true, undefined, undefined,
        ]);
    });

    it('fails closed on duplicate and mismatched unit identities and revisions', async () => {
        const duplicate = clone(mixedForce());
        duplicate.units = [duplicate.units[0], duplicate.units[0]];
        await expectCode(validateSerializedCBTForceV2(asForce(duplicate)), 'DUPLICATE_INSTANCE_ID');

        const wrongId = clone(mixedForce());
        wrongId.units[0].instanceId = 'unit:wrong';
        await expectCode(validateSerializedCBTForceV2(asForce(wrongId)), 'INSTANCE_ID_MISMATCH');

        const wrongUnitRevision = clone(mixedForce());
        wrongUnitRevision.units[0].stateRevision = 99;
        await expectCode(validateSerializedCBTForceV2(asForce(wrongUnitRevision)), 'REVISION_MISMATCH');

        const obsoleteEncounterRevision = clone(mixedForce());
        Reflect.set(obsoleteEncounterRevision.encounter, 'encounterRevision', 1);
        await expectCode(validateSerializedCBTForceV2(asForce(obsoleteEncounterRevision)), 'INVALID_SHAPE');

        const missingEncounter = clone(mixedForce());
        delete missingEncounter.encounter;
        await expectCode(validateSerializedCBTForceV2(asForce(missingEncounter)), 'INVALID_SHAPE');
    });

    it('accepts only canonical C3 layout positions owned by this force', async () => {
        const valid = clone(mixedForce());
        valid.encounter.c3Positions = [
            { unitId: 'unit:mek', x: 203, y: 392 },
            { unitId: 'unit:vehicle', x: 87.5, y: 144 },
        ];
        const sealed = await validateSerializedCBTForceV2(asForce(valid));
        expect(sealed.encounter.c3Positions).toEqual(valid.encounter.c3Positions);
        expect(Object.isFrozen(sealed.encounter.c3Positions)).toBeTrue();

        const duplicate = clone(valid);
        duplicate.encounter.c3Positions![1].unitId = 'unit:mek';
        await expectCode(validateSerializedCBTForceV2(asForce(duplicate)), 'INVALID_SHAPE');

        const dangling = clone(valid);
        dangling.encounter.c3Positions![1].unitId = 'unit:missing';
        await expectCode(validateSerializedCBTForceV2(asForce(dangling)), 'DANGLING_TARGET_REF');

        const unsorted = clone(valid);
        unsorted.encounter.c3Positions!.reverse();
        await expectCode(validateSerializedCBTForceV2(asForce(unsorted)), 'INVALID_SHAPE');

        for (const coordinate of [Number.POSITIVE_INFINITY, Number.NaN, -0]) {
            const nonCanonical = clone(valid);
            nonCanonical.encounter.c3Positions![0].x = coordinate;
            await expectCode(validateSerializedCBTForceV2(asForce(nonCanonical)), 'INVALID_SHAPE');
        }
    });

    it('validates compact retained-turn history groups and message tuples', async () => {
        const valid = clone(mixedForce());
        valid.history = { u: ['unit:test'], t: [{ n: 1, p: [[[2, 0, 'face:test', 1, 'pending']]] }] };
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        const badOrder = clone(valid);
        badOrder.history.t = [
            { n: 2, p: [[[1, 'later']]] },
            { n: 1, p: [[[1, 'earlier']]] },
        ];
        await expectCode(validateSerializedCBTForceV2(asForce(badOrder)), 'INVALID_SHAPE');

        const tooManyTurns = clone(valid);
        tooManyTurns.history.t = [1, 2, 3].map(n => ({
            n,
            p: [[[1, `turn-${n}`]]],
        }));
        await expectCode(validateSerializedCBTForceV2(asForce(tooManyTurns)), 'INVALID_SHAPE');

        const emptyPhase = clone(valid);
        emptyPhase.history.t[0].p = [[]];
        await expectCode(validateSerializedCBTForceV2(asForce(emptyPhase)), 'INVALID_SHAPE');

        const unknownMessage = clone(valid);
        unknownMessage.history.t[0].p[0][0][0] = 99;
        await expectCode(validateSerializedCBTForceV2(asForce(unknownMessage)), 'INVALID_SHAPE');
    });

    it('fails closed on the older crew-less deployment payload instead of inventing a profile', async () => {
        const oldDeployment = clone(mixedForce());
        oldDeployment.units[0].unit.deployment = {
            schemaVersion: 1,
            values: { id: 'default' },
        };
        await expectCode(validateSerializedCBTForceV2(asForce(oldDeployment)), 'INVALID_SHAPE');

        const missingAssignment = clone(mixedForce());
        delete missingAssignment.units[0].unit.deployment.values.crewAssignment;
        await expectCode(validateSerializedCBTForceV2(asForce(missingAssignment)), 'INVALID_SHAPE');
    });

    it('validates bounded canonical nonmovement turn payloads and rejects duplicate movement authority', async () => {
        const valid = clone(mixedForce());
        valid.units[0].unit.turn = {
            schemaVersion: 1,
            acknowledgedHeatSources: [
                { sourceId: 'movement', signature: '[2,null,null]' },
                { sourceId: 'weapons', signature: '[6,null,null]' },
            ],
            spotting: true,
        };
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        const unsorted = clone(valid);
        unsorted.units[0].unit.turn.acknowledgedHeatSources.reverse();
        await expectCode(validateSerializedCBTForceV2(asForce(unsorted)), 'INVALID_SHAPE');

        const duplicateMovement = clone(valid);
        duplicateMovement.units[0].unit.turn.moveMode = 'run';
        duplicateMovement.units[0].unit.turn.moveDistance = 5;
        await expectCode(validateSerializedCBTForceV2(asForce(duplicateMovement)), 'INVALID_SHAPE');

        const oversized = clone(valid);
        oversized.units[0].unit.turn.acknowledgedHeatSources = Array.from(
            { length: MAX_MEK_TURN_COLLECTION_ENTRIES + 1 },
            (_, index) => ({ sourceId: `source:${index.toString().padStart(3, '0')}`, signature: '[]' }),
        );
        await expectCode(validateSerializedCBTForceV2(asForce(oversized)), 'INVALID_SHAPE');

        const unknown = clone(valid);
        unknown.units[0].unit.turn.future = true;
        await expectCode(validateSerializedCBTForceV2(asForce(unknown)), 'INVALID_SHAPE');
    });

    it('validates the complete bounded Mek heat wire before sealing', async () => {
        const valid = clone(mixedForce());
        valid.units[0].unit.heat = {
            heat: 5,
            previous: 3,
            pendingOverride: 0,
            heatsinksOff: MAX_MEK_HEATSINKS_OFF_V2,
        };
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        for (const mutate of [
            (candidate: typeof valid) => { candidate.units[0].unit.heat.heat = MAX_MEK_HEAT_VALUE_V2 + 1; },
            (candidate: typeof valid) => { candidate.units[0].unit.heat.previous = 0; },
            (candidate: typeof valid) => { candidate.units[0].unit.heat.pendingOverride = -1; },
            (candidate: typeof valid) => {
                candidate.units[0].unit.heat.heatsinksOff = MAX_MEK_HEATSINKS_OFF_V2 + 1;
            },
        ]) {
            const hostile = clone(valid);
            mutate(hostile);
            await expectCode(validateSerializedCBTForceV2(asForce(hostile)), 'INVALID_SHAPE');
        }
    });

    it('validates the closed, canonical committed and pending Mek location-condition wire', async () => {
        const valid = clone(mixedForce());
        const unit = valid.units[0].unit;
        const target = unit.locationState[0].target;
        unit.locationConditions = [
            { target, condition: 'blown-off', value: 1 },
            { target, condition: 'flooded', value: 1 },
            { target, condition: 'narc', value: 2 },
        ];
        unit.pendingCombat.locationConditions = [
            { target, condition: 'flooded', value: 0 },
            { target, condition: 'narc', value: 3 },
        ];
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        for (const mutation of [
            (candidate: typeof valid) => { candidate.units[0].unit.locationConditions[0].condition = 'future'; },
            (candidate: typeof valid) => { candidate.units[0].unit.locationConditions[0].value = 2; },
            (candidate: typeof valid) => { candidate.units[0].unit.locationConditions[0].value = 0; },
            (candidate: typeof valid) => { candidate.units[0].unit.locationConditions[2].value = 1_000_001; },
            (candidate: typeof valid) => { candidate.units[0].unit.locationConditions.reverse(); },
            (candidate: typeof valid) => {
                candidate.units[0].unit.locationConditions.push(
                    clone(candidate.units[0].unit.locationConditions[2]),
                );
            },
            (candidate: typeof valid) => { candidate.units[0].unit.locationConditions[0].future = true; },
            (candidate: typeof valid) => {
                candidate.units[0].unit.pendingCombat.locationConditions[0].condition = 'future';
            },
        ]) {
            const hostile = clone(valid);
            mutation(hostile);
            await expectCode(validateSerializedCBTForceV2(asForce(hostile)), 'INVALID_SHAPE');
        }
    });

    it('accepts only sparse true unit-destroyed state', async () => {
        const valid = clone(mixedForce());
        valid.units[0].unit.destroyed = true;
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        const nonCanonical = clone(valid);
        nonCanonical.units[0].unit.destroyed = false;
        await expectCode(validateSerializedCBTForceV2(asForce(nonCanonical)), 'INVALID_SHAPE');
    });

    it('validates sparse PPC capacitor pair state as an exact nested persistence shape', async () => {
        const valid = clone(mixedForce());
        const unit = valid.units[0].unit;
        const capacitorTarget = asSavedTargetRef('component:ppc-capacitor');
        unit.blueprintReferences.targets = {
            [capacitorTarget]: {
                kind: 'component',
                savedComponentId: 'component:ppc-capacitor',
                equipmentName: 'PPC Capacitor',
                locations: ['RA'],
                criticalSlots: [],
            },
            ...unit.blueprintReferences.targets,
        };
        unit.componentState = [{
            target: capacitorTarget,
            ppcCapacitor: { weaponId: asComponentId('component:ppc'), chargeState: 'charged' },
        }];
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        for (const lifecycle of [
            {},
            { weaponId: 'component:ppc' },
            { weaponId: 'component:ppc', chargeState: 'charged', firedThisTurn: true },
            { weaponId: 'component:ppc', firedThisTurn: false },
            { weaponId: 'component:ppc', chargeState: 'charging', future: true },
        ]) {
            const hostile = clone(valid);
            hostile.units[0].unit.componentState[0].ppcCapacitor = lifecycle;
            await expectCode(validateSerializedCBTForceV2(asForce(hostile)), 'INVALID_SHAPE');
        }
    });

    it('validates sparse Bombast lifecycle state as an exact nested persistence shape', async () => {
        const valid = clone(mixedForce());
        const unit = valid.units[0].unit;
        const bombastTarget = asSavedTargetRef('component:bombast');
        unit.blueprintReferences.targets = {
            [bombastTarget]: {
                kind: 'component',
                savedComponentId: 'component:bombast',
                equipmentName: 'Bombast Laser',
                locations: ['RA'],
                criticalSlots: [],
            },
            ...unit.blueprintReferences.targets,
        };
        unit.componentState = [{
            target: bombastTarget,
            bombastLaser: { chargeState: 'charged' },
        }];
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        for (const lifecycle of [
            {},
            { chargeState: 'broken' },
            { chargeState: 'charged', firedThisTurn: true },
            { firedThisTurn: false },
            { chargeState: 'charging', future: true },
        ]) {
            const hostile = clone(valid);
            hostile.units[0].unit.componentState[0].bombastLaser = lifecycle;
            await expectCode(validateSerializedCBTForceV2(asForce(hostile)), 'INVALID_SHAPE');
        }
    });

    it('validates sparse C3 Emergency Master state as an exact nested persistence shape', async () => {
        const valid = clone(mixedForce());
        const unit = valid.units[0].unit;
        const c3emTarget = asSavedTargetRef('component:c3em');
        unit.blueprintReferences.targets = {
            [c3emTarget]: {
                kind: 'component',
                savedComponentId: 'component:c3em',
                equipmentName: 'C3 Emergency Master',
                locations: ['CT'],
                criticalSlots: [],
            },
            ...unit.blueprintReferences.targets,
        };
        unit.componentState = [{
            target: c3emTarget,
            c3EmergencyMaster: { mode: 'on', operatingTurns: 4 },
        }];
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        for (const lifecycle of [
            {},
            { mode: 'auto' },
            { mode: 'broken' },
            { operatingTurns: 0 },
            { operatingTurns: 8 },
            { operatingTurns: 1.5 },
            { mode: 'off', operatingTurns: 7, future: true },
        ]) {
            const hostile = clone(valid);
            hostile.units[0].unit.componentState[0].c3EmergencyMaster = lifecycle;
            await expectCode(validateSerializedCBTForceV2(asForce(hostile)), 'INVALID_SHAPE');
        }
    });

    it('accepts only non-default sparse Gauss power states', async () => {
        const valid = clone(mixedForce());
        const unit = valid.units[0].unit;
        const gaussTarget = asSavedTargetRef('component:gauss');
        unit.blueprintReferences.targets = {
            [gaussTarget]: {
                kind: 'component',
                savedComponentId: 'component:gauss',
                equipmentName: 'Gauss Rifle',
                locations: ['RA'],
                criticalSlots: [],
            },
            ...unit.blueprintReferences.targets,
        };
        unit.componentState = [{ target: gaussTarget, gaussPower: 'Powered Down' }];
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        for (const gaussPower of ['Powered Up', 'broken', '', false]) {
            const hostile = clone(valid);
            hostile.units[0].unit.componentState[0].gaussPower = gaussPower;
            await expectCode(validateSerializedCBTForceV2(asForce(hostile)), 'INVALID_SHAPE');
        }
    });

    it('validates C3 structure without requiring copied component topology', async () => {
        const valid = clone(mixedForce());
        const unit = valid.units[0].unit;
        valid.encounter.networks = [{
            id: 'network:alpha', networkType: 'c3', color: '#123456',
            endpoints: [
                { instanceId: unit.instanceId, componentId: asComponentId('component:c3-master'), role: 'master' },
                { instanceId: unit.instanceId, componentId: asComponentId('component:c3-slave'), role: 'member' },
            ],
        }];
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        const entityValidated = clone(valid);
        entityValidated.encounter.networks[0].endpoints[1].componentId = asComponentId('component:loaded-later');
        await expectAsync(validateSerializedCBTForceV2(asForce(entityValidated))).toBeResolved();
    });

    it('rejects C3 endpoints that name a unit outside the force', async () => {
        const valid = clone(mixedForce());
        const unit = valid.units[0];
        valid.encounter.networks = [{
            id: 'network:alpha', networkType: 'c3', color: '#123456',
            endpoints: [{
                instanceId: unit.instanceId,
                componentId: asComponentId('component:c3-master'),
                role: 'master',
            }],
        }];
        await expectAsync(validateSerializedCBTForceV2(asForce(valid))).toBeResolved();

        valid.encounter.networks[0].endpoints[0].instanceId = 'unit:missing';
        await expectCode(
            validateSerializedCBTForceV2(asForce(valid)),
            'ENCOUNTER_ENDPOINT_INVALID',
            /has no force unit/u,
        );
    });
});

function mixedForce(): SerializedCBTForceV2 {
    const mek = v2Entry('unit:mek', UUID_A);
    const vehicle = v2Entry('unit:vehicle', UUID_B);
    const other = v2Entry('unit:other', UUID_C);
    return {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        forceId: asForceId('force:test'),
        forceRevision: 4,
        history: emptyRuntimeHistory(),
        units: [mek, vehicle, other],
        roster: {
            schemaVersion: 1,
            groups: [{
                groupId: 'group:test',
                order: 0,
                name: 'Test Lance',
                color: '#123456',
                formationId: 'formation:line',
                formationLock: true,
                members: [
                    { instanceId: mek.instanceId, order: 0 },
                    { instanceId: vehicle.instanceId, order: 1, commander: true },
                    { instanceId: other.instanceId, order: 2 },
                ],
            }],
        },
        encounter: { networks: [] },
    };
}

function v2Entry(instance: string, uuid: typeof UUID_A): SerializedForceUnitEntryV2 {
    const instanceId = instance;
    return {
        instanceId,
        stateRevision: 3,
        unit: v2Unit(instanceId, uuid),
    };
}

function v2Unit(instanceId: string, uuid: typeof UUID_A): SerializedCBTUnitV2 {
    const target = asSavedTargetRef('location:ct:internal');
    const entity = uuid;
    return {
        schemaVersion: CBT_UNIT_PERSISTENCE_SCHEMA_VERSION,
        instanceId,
        entity,
        baselineRefAtSave: {
            entity,
            initialStateProfile: { schemaVersion: 1, initializerRevision: 1, profileId: 'pristine' },
        },
        blueprintReferences: {
            schemaVersion: 1,
            targets: { [target]: { kind: 'location-section', location: 'CT', section: 'internal' } },
        },
        deployment: {
            schemaVersion: 2,
            values: { id: 'default', crewAssignment: { schemaVersion: 1, positions: [] } },
        },
        stateRevision: 3,
        ruleChecks: { schemaVersion: 1, entries: [] },
        movementPsr: { schemaVersion: 2 },
        locationState: [{ target, damage: 2 }],
        crew: { schemaVersion: 1, positions: [] },
        family: { kind: 'mek' },
        conditions: { values: ['prone'] },
        turn: { schemaVersion: 1 },
        pendingCombat: { locationDamage: [{ target, damage: -1 }] },
    };
}

async function expectCode(
    promise: Promise<unknown>,
    code: ForceEnvelopeValidationCode,
    message?: RegExp,
    context?: string,
): Promise<void> {
    try {
        await promise;
        fail(`Expected rejection with ${code}${context ? ` (${context})` : ''}`);
    } catch (error) {
        expect(error instanceof ForceEnvelopeValidationError).toBeTrue();
        if (error instanceof ForceEnvelopeValidationError) {
            expect(error.code).toBe(code);
            if (message) expect(error.message).toMatch(message);
        }
    }
}

function clone<T>(value: T): any {
    return JSON.parse(JSON.stringify(value));
}

function asForce(value: unknown): SerializedCBTForceV2 {
    return value as SerializedCBTForceV2;
}
