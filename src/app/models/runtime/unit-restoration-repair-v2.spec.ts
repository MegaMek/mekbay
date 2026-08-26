// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { SavedEntityIdentity } from '../persisted-unit-state';
import { asSourceHash, asUnitProviderId, asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import {
    asSavedTargetRef,
    type SavedBlueprintReferenceTableV2,
    type SavedStateTargetV2,
    type SerializedUnitRestorationMetadataV2,
} from './persistence-v2';
import {
    STATE_RESTORATION_ALGORITHM_VERSION_V2,
    UnitRestorationRepairError,
    applyUnitRestorationRepairV2,
} from './unit-restoration-repair-v2';

const SOURCE_COMPONENT: Extract<SavedStateTargetV2, { kind: 'component' }> = {
    kind: 'component',
    savedComponentId: 'old:laser',
    equipmentName: 'ISMediumLaser',
    locations: ['LT'],
    criticalSlots: [],
};
const CURRENT_COMPONENT: Extract<SavedStateTargetV2, { kind: 'component' }> = {
    kind: 'component',
    savedComponentId: 'current:laser',
    equipmentName: 'ISMediumLaser',
    locations: ['LT'],
    criticalSlots: [],
};
const OTHER_COMPONENT: Extract<SavedStateTargetV2, { kind: 'component' }> = {
    ...CURRENT_COMPONENT,
    savedComponentId: 'current:other',
};
const LOCATION: Extract<SavedStateTargetV2, { kind: 'location-section' }> = {
    kind: 'location-section', location: 'LT', section: 'internal',
};
const CURRENT_REF = asSavedTargetRef('component:current:laser');
const OTHER_REF = asSavedTargetRef('component:current:other');
const LOCATION_REF = asSavedTargetRef('location:LT:internal');
const SOURCE_REF = asSavedTargetRef('component:source:laser');

describe('V2 unit-restoration repair commands', () => {
    it('creates one exact-scope accepted alias without applying runtime state', async () => {
        const input = metadata();
        const entity = entityIdentity('revision-a');

        const result = await applyUnitRestorationRepairV2(input, context(entity), {
            kind: 'remap-unresolved',
            recoveryId: 'recovery:component',
            target: CURRENT_REF,
            expectedTargetEntity: entity,
        });

        expect(result).not.toBe(input);
        expect(input.acceptedAliases).toEqual([]);
        expect(result.unresolved).toEqual(input.unresolved);
        expect(result.acceptedAliases).toEqual([{
            sourceTargetRef: SOURCE_REF,
            targetEntity: entity,
            target: CURRENT_REF,
            algorithmVersion: STATE_RESTORATION_ALGORITHM_VERSION_V2,
        }]);
        expect(result.heatRecovery?.targetTranslation).toEqual({ [SOURCE_REF]: CURRENT_REF });
        expect(Object.isFrozen(result)).toBeTrue();
        expect(Object.isFrozen(result.acceptedAliases)).toBeTrue();
        expect(Object.isFrozen(result.acceptedAliases[0].targetEntity)).toBeTrue();
    });

    it('persists an exact ignore tombstone and removes only the selected occurrence', async () => {
        const input = metadata({
            extraRecovery: {
                recoveryId: 'recovery:other',
                sourceTargetRef: SOURCE_REF,
                sourceTarget: SOURCE_COMPONENT,
                fact: { kind: 'component-state', statusOverride: 'destroyed' },
                reason: 'ALSO_AMBIGUOUS',
            },
        });

        const entity = entityIdentity('revision-a');
        const remapped = await applyUnitRestorationRepairV2(input, context(entity), {
            kind: 'remap-unresolved',
            recoveryId: 'recovery:component',
            target: CURRENT_REF,
            expectedTargetEntity: entity,
        });
        const result = await applyUnitRestorationRepairV2(remapped, context(entity), {
            kind: 'ignore-unresolved', recoveryId: 'recovery:component',
        });

        expect(result.unresolved.map(entry => entry.recoveryId)).toEqual(['recovery:other']);
        expect(result.acceptedAliases).toEqual(remapped.acceptedAliases);
        expect(result.heatRecovery).toEqual(remapped.heatRecovery);
        expect(result.ignoredRecovery).toEqual([{
            recoveryId: 'recovery:component',
            algorithmVersion: STATE_RESTORATION_ALGORITHM_VERSION_V2,
        }]);
        expect(input.ignoredRecovery).toBeUndefined();
        expect(Object.isFrozen(result.ignoredRecovery)).toBeTrue();
    });

    it('snapshots all repair inputs before applying ignore and remap commands', async () => {
        const secondSourceRef = asSavedTargetRef('component:source:second-race');
        const secondSourceTarget = { ...SOURCE_COMPONENT, savedComponentId: 'old:second-race' };
        const ignoreInput = metadata({
            extraRecovery: {
                recoveryId: 'recovery:other-race',
                sourceTargetRef: secondSourceRef,
                sourceTarget: secondSourceTarget,
                fact: { kind: 'component-state', statusOverride: 'destroyed' },
                reason: 'RETAIN_ACROSS_AWAIT',
            },
        });
        const entity = entityIdentity('revision-a');
        const ignorePending = applyUnitRestorationRepairV2(
            ignoreInput,
            context(entity),
            { kind: 'ignore-unresolved', recoveryId: 'recovery:component' },
        );
        (ignoreInput.unresolved as any[]).splice(1, 1);
        delete (ignoreInput.heatRecovery!.sourceReferences.targets as Record<string, unknown>)[secondSourceRef];
        const ignored = await ignorePending;
        expect(ignored.unresolved.map(entry => entry.recoveryId)).toEqual(['recovery:other-race']);
        expect(ignored.heatRecovery?.sourceReferences.targets[secondSourceRef]).toEqual(secondSourceTarget);

        const remapInput = metadata();
        const remapContext = context(entity) as any;
        const remapCommand: any = {
            kind: 'remap-unresolved',
            recoveryId: 'recovery:component',
            target: CURRENT_REF,
            expectedTargetEntity: entity,
        };
        const remapPending = applyUnitRestorationRepairV2(remapInput, remapContext, remapCommand);
        remapCommand.target = OTHER_REF;
        remapContext.currentEntity = entityIdentity('revision-b');
        remapContext.currentReferences.targets[CURRENT_REF] = OTHER_COMPONENT;
        (remapInput.acceptedAliases as any[]).push({ forged: true });
        const remapped = await remapPending;
        expect(remapped.acceptedAliases).toEqual([jasmine.objectContaining({
            sourceTargetRef: SOURCE_REF,
            target: CURRENT_REF,
            targetEntity: entity,
        })]);
        expect(remapped.heatRecovery?.targetTranslation[SOURCE_REF]).toBe(CURRENT_REF);
    });

    it('omits durable heat authority when ignoring the last typed recovery row', async () => {
        const input = metadata();
        const entity = entityIdentity('revision-a');
        const remapped = await applyUnitRestorationRepairV2(
            input,
            context(entity),
            {
                kind: 'remap-unresolved',
                recoveryId: 'recovery:component',
                target: CURRENT_REF,
                expectedTargetEntity: entity,
            },
        );
        const result = await applyUnitRestorationRepairV2(
            remapped,
            context(entity),
            { kind: 'ignore-unresolved', recoveryId: 'recovery:component' },
        );

        expect(result.unresolved).toEqual([]);
        expect(result.acceptedAliases).toEqual([]);
        expect(result.heatRecovery).toBeUndefined();
        expect(input.heatRecovery).toBeDefined();
    });

    it('prunes distinct ignored source refs from durable aliases and translations', async () => {
        const secondSourceRef = asSavedTargetRef('component:source:second-laser');
        const secondSourceTarget = { ...SOURCE_COMPONENT, savedComponentId: 'old:second-laser' };
        const input = metadata({
            extraRecovery: {
                recoveryId: 'recovery:other',
                sourceTargetRef: secondSourceRef,
                sourceTarget: secondSourceTarget,
                fact: { kind: 'component-state', statusOverride: 'destroyed' },
                reason: 'ALSO_AMBIGUOUS',
            },
        });
        const entity = entityIdentity('revision-a');
        const remapped = await applyUnitRestorationRepairV2(input, context(entity), {
            kind: 'remap-unresolved',
            recoveryId: 'recovery:component',
            target: CURRENT_REF,
            expectedTargetEntity: entity,
        });
        const ignored = await applyUnitRestorationRepairV2(remapped, context(entity), {
            kind: 'ignore-unresolved', recoveryId: 'recovery:component',
        });

        expect(ignored.unresolved.map(entry => entry.sourceTargetRef)).toEqual([secondSourceRef]);
        expect(ignored.acceptedAliases).toEqual([]);
        expect(ignored.heatRecovery?.targetTranslation).toEqual({});
        expect(Object.keys(ignored.heatRecovery?.sourceReferences.targets ?? {}))
            .toEqual([secondSourceRef]);
    });

    it('rejects a stale exact-entity target and keeps historical aliases scoped', async () => {
        const revisionA = entityIdentity('revision-a');
        const revisionB = entityIdentity('revision-b');
        await expectRepairCode(applyUnitRestorationRepairV2(metadata(), context(revisionB), {
            kind: 'remap-unresolved',
            recoveryId: 'recovery:component',
            target: CURRENT_REF,
            expectedTargetEntity: revisionA,
        }), 'TARGET_ENTITY_MISMATCH');

        const againstA = await applyUnitRestorationRepairV2(metadata(), context(revisionA), {
            kind: 'remap-unresolved',
            recoveryId: 'recovery:component',
            target: CURRENT_REF,
            expectedTargetEntity: revisionA,
        });
        const againstB = await applyUnitRestorationRepairV2(againstA, context(revisionB), {
            kind: 'remap-unresolved',
            recoveryId: 'recovery:component',
            target: OTHER_REF,
            expectedTargetEntity: revisionB,
        });
        expect(againstB.acceptedAliases.length).toBe(2);
        expect(againstB.acceptedAliases.map(alias => alias.targetEntity.sourceHashAtSave).sort())
            .toEqual([revisionA.sourceHashAtSave, revisionB.sourceHashAtSave].sort());
    });

    it('is naturally idempotent and rejects conflicting or wrong-kind remaps', async () => {
        const entity = entityIdentity('revision-a');
        const remap = {
            kind: 'remap-unresolved' as const,
            recoveryId: 'recovery:component',
            target: CURRENT_REF,
            expectedTargetEntity: entity,
        };
        const once = await applyUnitRestorationRepairV2(metadata(), context(entity), remap);
        const twice = await applyUnitRestorationRepairV2(once, context(entity), remap);
        expect(twice).toEqual(once);

        await expectRepairCode(applyUnitRestorationRepairV2(once, context(entity), {
            ...remap, target: OTHER_REF,
        }), 'CONFLICTING_REMAP');
        await expectRepairCode(applyUnitRestorationRepairV2(metadata(), context(entity), {
            ...remap, target: LOCATION_REF,
        }), 'TARGET_KIND_MISMATCH');

        const ignoredOnce = await applyUnitRestorationRepairV2(metadata(), context(entity), {
            kind: 'ignore-unresolved', recoveryId: 'recovery:component',
        });
        const ignoredTwice = await applyUnitRestorationRepairV2(ignoredOnce, context(entity), {
            kind: 'ignore-unresolved', recoveryId: 'recovery:component',
        });
        expect(ignoredTwice).toEqual(ignoredOnce);
    });

    it('rejects unknown recovery IDs and uncompiled munitions while allowing capability-checked mode retries', async () => {
        const entity = entityIdentity('revision-a');
        await expectRepairCode(applyUnitRestorationRepairV2(metadata(), context(entity), {
            kind: 'ignore-unresolved', recoveryId: 'recovery:missing',
        }), 'RECOVERY_NOT_FOUND');

        const unsupported = metadata({
            fact: { kind: 'component-state', mode: 'pulse' },
        });
        const modeRetry = await applyUnitRestorationRepairV2(unsupported, context(entity), {
            kind: 'remap-unresolved',
            recoveryId: 'recovery:component',
            target: CURRENT_REF,
            expectedTargetEntity: entity,
        });
        expect(modeRetry.acceptedAliases).toHaveSize(1);

        const munition = metadata({
            sourceTarget: {
                kind: 'ammo-source',
                savedAmmoSourceId: 'old:ammo',
                source: { kind: 'installed-bin', equipmentName: 'ISAC5 Ammo' },
                criticalSlots: [],
            },
            fact: { kind: 'ammo-state', shotsSpent: 0, munitionOverride: 'precision' },
        });
        await expectRepairCode(applyUnitRestorationRepairV2(munition, context(entity), {
            kind: 'remap-unresolved',
            recoveryId: 'recovery:component',
            target: CURRENT_REF,
            expectedTargetEntity: entity,
        }), 'UNSUPPORTED_FACT_CAPABILITY');
    });
});

function metadata(overrides: {
    sourceTarget?: SavedStateTargetV2;
    fact?: SerializedUnitRestorationMetadataV2['unresolved'][number]['fact'];
    extraRecovery?: SerializedUnitRestorationMetadataV2['unresolved'][number];
} = {}): SerializedUnitRestorationMetadataV2 {
    const sourceTarget = overrides.sourceTarget ?? SOURCE_COMPONENT;
    const sourceReferences: SavedBlueprintReferenceTableV2 = {
        schemaVersion: 1,
        targets: {
            [SOURCE_REF]: sourceTarget,
            ...(overrides.extraRecovery === undefined ? {} : {
                [overrides.extraRecovery.sourceTargetRef]: overrides.extraRecovery.sourceTarget,
            }),
        },
    };
    return {
        schemaVersion: 1,
        algorithmVersion: STATE_RESTORATION_ALGORITHM_VERSION_V2,
        fromBaseline: {
            kind: 'legacy-v1',
            coordinateProfileVersion: 1,
        },
        sourceChanged: true,
        warnings: [],
        unresolved: [{
            recoveryId: 'recovery:component',
            sourceTargetRef: SOURCE_REF,
            sourceTarget,
            fact: overrides.fact ?? { kind: 'component-state', statusOverride: 'disabled' },
            reason: 'AMBIGUOUS_COMPONENT',
        }, ...(overrides.extraRecovery === undefined ? [] : [overrides.extraRecovery])],
        acceptedAliases: [],
        heatRecovery: {
            schemaVersion: 1,
            sourceReferences,
            targetTranslation: {},
            currentReferences: {
                schemaVersion: 1,
                targets: {
                    [CURRENT_REF]: CURRENT_COMPONENT,
                    [OTHER_REF]: OTHER_COMPONENT,
                    [LOCATION_REF]: LOCATION,
                },
            },
        },
    };
}

function context(currentEntity: SavedEntityIdentity): {
    currentEntity: SavedEntityIdentity;
    currentReferences: SavedBlueprintReferenceTableV2;
} {
    return {
        currentEntity,
        currentReferences: {
            schemaVersion: 1,
            targets: {
                [CURRENT_REF]: CURRENT_COMPONENT,
                [OTHER_REF]: OTHER_COMPONENT,
                [LOCATION_REF]: LOCATION,
            },
        },
    };
}

function entityIdentity(revision: 'revision-a' | 'revision-b'): SavedEntityIdentity {
    return {
        origin: 'megamek',
        provider: asUnitProviderId('mm-data'),
        uuid: asUnitUuid('01890e02-93bd-7b31-b5fa-4b56e92b1234'),
        sourceHashAtSave: asSourceHash(revision === 'revision-a' ? 'A'.repeat(27) : `${'B'.repeat(26)}A`),
        sourceFormat: 'mtf',
    };
}

async function expectRepairCode(
    promise: Promise<unknown>,
    code: UnitRestorationRepairError['code'],
): Promise<void> {
    try {
        await promise;
        throw new Error(`Expected repair error ${code}`);
    } catch (error) {
        expect(error instanceof UnitRestorationRepairError).toBeTrue();
        if (error instanceof UnitRestorationRepairError) expect(error.code).toBe(code);
    }
}
