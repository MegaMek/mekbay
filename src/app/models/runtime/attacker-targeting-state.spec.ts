// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId, type ComponentId } from '../entity/entity-identifiers';
import { asEncounterTargetId, type EncounterTargetId } from './encounter-runtime';
import { asStateRevision } from './runtime-state';
import {
    MAX_ATTACKER_MANUAL_TN_MAGNITUDE,
    MAX_ATTACKER_TARGET_DISTANCE,
    createPristineAttackerTargetingState,
    deserializeAttackerTargetingState,
    freezeAttackerTargetingState,
    attackerActionSelection,
    planAttackerTargetingCommand,
    reconcileAttackerTargetingState,
    reduceAttackerTargetingCommand,
    serializeAttackerTargetingState,
    type AttackerTargetingCommand,
    type AttackerTargetingState,
    type AttackerTargetingValidationContext,
} from './attacker-targeting-state';

const WEAPON_ALPHA = asComponentId('component:weapon:alpha');
const WEAPON_BETA = asComponentId('component:weapon:beta');
const SOURCE_ALPHA_STANDARD = asComponentId('component:ammo:alpha-standard');
const SOURCE_ALPHA_PRECISION = asComponentId('component:ammo:alpha-precision');
const SOURCE_BETA = asComponentId('component:ammo:beta');
const PHYSICAL_COMPONENT = asComponentId('component:physical:club');
const TARGET_ALPHA = asEncounterTargetId('target:alpha');
const TARGET_BETA = asEncounterTargetId('target:beta');
const REGISTRY_REVISION = asStateRevision(7);

describe('attacker-local targeting state', () => {
    it('stores only sparse attacker-local facts and deeply freezes every queryable layer', () => {
        let state = createPristineAttackerTargetingState();
        state = apply(state, command({
            kind: 'set-component-selection',
            componentId: WEAPON_ALPHA,
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        }));
        state = apply(state, command({
            kind: 'set-component-ammo',
            componentId: WEAPON_ALPHA,
            ammo: { munitionKey: 'Precision', preferredSourceId: SOURCE_ALPHA_PRECISION },
        }));
        state = apply(state, command({
            kind: 'set-target-facts',
            targetId: TARGET_ALPHA,
            facts: {
                distance: 8,
                c3Distance: 4,
                useC3: true,
                calculator: { interveningWoods: 'light1', attackDirection: 'left' },
                manualTnOverride: { kind: 'user-manual', modifier: 3 },
            },
        }));

        const component = state.components.get(WEAPON_ALPHA)!;
        const target = state.targets.get(TARGET_ALPHA)!;
        expect(Object.isFrozen(state)).toBeTrue();
        expect(Object.isFrozen(state.components)).toBeTrue();
        expect(Object.isFrozen(state.targets)).toBeTrue();
        expect(Object.isFrozen(component)).toBeTrue();
        expect(Object.isFrozen(component.selection!)).toBeTrue();
        expect(Object.isFrozen(component.ammo!)).toBeTrue();
        expect(Object.isFrozen(target)).toBeTrue();
        expect(Object.isFrozen(target.calculator!)).toBeTrue();
        expect(Object.isFrozen(target.manualTnOverride!)).toBeTrue();
        expect(typeof (state.components as unknown as { set?: unknown }).set).toBe('undefined');
        expect(typeof (state.targets as unknown as { set?: unknown }).set).toBe('undefined');
    });

    it('updates a weapon bay selection and ammunition atomically', () => {
        let state = apply(createPristineAttackerTargetingState(), command({
            kind: 'set-component-ammos',
            updates: [
                {
                    componentId: WEAPON_ALPHA,
                    ammo: { munitionKey: 'Precision', preferredSourceId: SOURCE_ALPHA_PRECISION },
                },
                {
                    componentId: WEAPON_BETA,
                    ammo: { munitionKey: 'Standard', preferredSourceId: SOURCE_BETA },
                },
            ],
        }));
        state = apply(state, command({
            kind: 'set-component-selections',
            componentIds: [WEAPON_ALPHA, WEAPON_BETA],
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        }));

        expect(state.components.get(WEAPON_ALPHA)).toEqual({
            selection: { kind: 'target', targetId: TARGET_ALPHA },
            ammo: { munitionKey: 'Precision', preferredSourceId: SOURCE_ALPHA_PRECISION },
        });
        expect(state.components.get(WEAPON_BETA)).toEqual({
            selection: { kind: 'target', targetId: TARGET_ALPHA },
            ammo: { munitionKey: 'Standard', preferredSourceId: SOURCE_BETA },
        });
    });

    it('rejects an invalid member without partially updating the bay', () => {
        const state = createPristineAttackerTargetingState();
        const result = reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-component-selections',
            componentIds: [WEAPON_ALPHA, PHYSICAL_COMPONENT],
            selection: { kind: 'selected' },
        }));

        expect(result).toEqual(jasmine.objectContaining({
            accepted: false,
            changed: false,
            reason: 'INVALID_COMPONENT',
            state,
        }));
        expect(state.components.size).toBe(0);
    });

    it('round-trips the exact wire state and rejects malformed or duplicate entries', () => {
        const state = apply(createPristineAttackerTargetingState(), command({
            kind: 'set-component-selection',
            componentId: WEAPON_ALPHA,
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        }));
        const wire = serializeAttackerTargetingState(state);

        expect(serializeAttackerTargetingState(deserializeAttackerTargetingState(wire))).toEqual(wire);
        expect(() => deserializeAttackerTargetingState({})).toThrowError(/wire state/u);
        expect(() => deserializeAttackerTargetingState({
            ...wire,
            components: [wire.components[0], wire.components[0]],
        })).toThrowError(/Duplicate attacker-targeting entry/u);
    });

    it('cannot represent shared target identity/calculator facts or a cached derived TN', () => {
        let state = createPristineAttackerTargetingState();
        state = apply(state, command({
            kind: 'set-component-selection',
            componentId: WEAPON_ALPHA,
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        }));
        state = apply(state, command({
            kind: 'set-target-facts',
            targetId: TARGET_ALPHA,
            facts: {
                distance: 9,
                calculator: {
                    interveningWoods: 'light2',
                    partialCover: true,
                    secondaryTarget: true,
                },
                manualTnOverride: { kind: 'user-manual', modifier: -2 },
            },
        }));

        const json = JSON.stringify(serializeAttackerTargetingState(state));
        for (const forbidden of [
            'name', 'color', 'unitType', 'source', 'readOnly', 'tnModifier',
            'calculatedModifier', 'targetMovementBracket', 'targetHexCover',
            'largeTarget', 'isAirborne', 'prone', 'immobile', 'skidding',
        ]) {
            expect(json).not.toContain(`\"${forbidden}\"`);
        }
        expect(json).toContain('"manualTnOverride":{"kind":"user-manual","modifier":-2}');

        const injectedSharedFact = {
            distance: 2,
            calculator: { targetMovementBracket: '7-9' },
        } as never;
        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-target-facts', targetId: TARGET_ALPHA, facts: injectedSharedFact,
        }))).toEqual(jasmine.objectContaining({
            accepted: false,
            changed: false,
            reason: 'INVALID_TARGET_FACTS',
        }));
    });

    it('rejects a stale registry witness before applying an otherwise valid command', () => {
        const state = createPristineAttackerTargetingState();
        const result = reduceAttackerTargetingCommand(state, context(), {
            kind: 'set-component-selection',
            expectedRegistryRevision: asStateRevision(Number(REGISTRY_REVISION) - 1),
            componentId: WEAPON_ALPHA,
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        });
        expect(result).toEqual(jasmine.objectContaining({
            accepted: false,
            changed: false,
            reason: 'STALE_REGISTRY',
        }));
        expect(serializeAttackerTargetingState(result.state))
            .toEqual(serializeAttackerTargetingState(state));
    });

    it('rejects a target from another registry and a source outside the weapon compatibility set', () => {
        const state = createPristineAttackerTargetingState();
        const foreignTarget = asEncounterTargetId('other-force:target:alpha');
        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-component-selection',
            componentId: WEAPON_ALPHA,
            selection: { kind: 'target', targetId: foreignTarget },
        }))).toEqual(jasmine.objectContaining({ reason: 'INVALID_TARGET' }));

        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-component-ammo',
            componentId: WEAPON_ALPHA,
            ammo: { munitionKey: 'Standard', preferredSourceId: SOURCE_BETA },
        }))).toEqual(jasmine.objectContaining({ reason: 'SOURCE_NOT_COMPATIBLE' }));

        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-component-ammo',
            componentId: WEAPON_ALPHA,
            ammo: {
                munitionKey: 'Standard',
                preferredSourceId: asComponentId('Standard Ammo:Left Torso'),
            },
        }))).toEqual(jasmine.objectContaining({ reason: 'SOURCE_NOT_COMPATIBLE' }));
    });

    it('rejects an incompatible munition and a source carrying a different munition', () => {
        const state = createPristineAttackerTargetingState();
        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-component-ammo',
            componentId: WEAPON_ALPHA,
            ammo: { munitionKey: 'Inferno' },
        }))).toEqual(jasmine.objectContaining({ reason: 'INVALID_MUNITION' }));

        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-component-ammo',
            componentId: WEAPON_ALPHA,
            ammo: { munitionKey: 'Precision', preferredSourceId: SOURCE_ALPHA_STANDARD },
        }))).toEqual(jasmine.objectContaining({ reason: 'SOURCE_NOT_COMPATIBLE' }));
    });

    it('allows an OPFOR read-only target to be assigned and edited locally while enforcing exact origin policy', () => {
        const opforContext = context({
            targets: [{ id: TARGET_ALPHA, source: 'opfor', readOnly: true }],
        });
        let state = createPristineAttackerTargetingState();
        state = apply(state, command({
            kind: 'set-component-selection',
            componentId: WEAPON_ALPHA,
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        }), opforContext);
        state = apply(state, command({
            kind: 'set-target-facts',
            targetId: TARGET_ALPHA,
            facts: { distance: 6, calculator: { attackDirection: 'rear' } },
        }), opforContext);
        expect(state.targets.get(TARGET_ALPHA)?.distance).toBe(6);

        const malformedOpfor = context({
            targets: [{ id: TARGET_ALPHA, source: 'opfor', readOnly: false }],
        });
        expect(reduceAttackerTargetingCommand(state, malformedOpfor, command({
            kind: 'set-target-facts', targetId: TARGET_ALPHA, facts: { distance: 7 },
        }))).toEqual(jasmine.objectContaining({ reason: 'INVALID_TARGET_POLICY' }));

        const malformedManual = context({
            targets: [{ id: TARGET_ALPHA, source: 'manual', readOnly: true }],
        });
        expect(reduceAttackerTargetingCommand(state, malformedManual, command({
            kind: 'set-target-facts', targetId: TARGET_ALPHA, facts: { distance: 7 },
        }))).toEqual(jasmine.objectContaining({ reason: 'INVALID_TARGET_POLICY' }));
    });

    it('rejects every mutation in a read-only force context', () => {
        const state = createPristineAttackerTargetingState();
        const result = reduceAttackerTargetingCommand(
            state,
            context({ forceReadOnly: true }),
            command({
                kind: 'set-component-selection',
                componentId: WEAPON_ALPHA,
                selection: { kind: 'selected' },
            }),
        );
        expect(result).toEqual(jasmine.objectContaining({ reason: 'READ_ONLY', changed: false }));
    });

    it('reconciles registry deletion and source removal without losing a still-compatible munition', () => {
        let state = createPristineAttackerTargetingState();
        state = apply(state, command({
            kind: 'set-component-selection',
            componentId: WEAPON_ALPHA,
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        }));
        state = apply(state, command({
            kind: 'set-component-ammo',
            componentId: WEAPON_ALPHA,
            ammo: { munitionKey: 'Precision', preferredSourceId: SOURCE_ALPHA_PRECISION },
        }));
        state = apply(state, command({
            kind: 'set-target-facts',
            targetId: TARGET_ALPHA,
            facts: { distance: 5 },
        }));
        state = apply(state, command({
            kind: 'set-target-facts',
            targetId: TARGET_BETA,
            facts: { distance: 10 },
        }));

        const reconciled = reconcileAttackerTargetingState(state, context({
            targets: [{ id: TARGET_BETA, source: 'manual', readOnly: false }],
            weapons: [{
                componentId: WEAPON_ALPHA,
                compatibleMunitionKeys: ['Standard', 'Precision'],
                sources: [{ componentId: SOURCE_ALPHA_STANDARD, munitionKeys: ['Standard'] }],
            }],
        }));
        expect(reconciled).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(reconciled.state.targets.has(TARGET_ALPHA)).toBeFalse();
        expect(reconciled.state.targets.has(TARGET_BETA)).toBeTrue();
        expect(reconciled.state.components.get(WEAPON_ALPHA)).toEqual({
            ammo: { munitionKey: 'Precision' },
        });
    });

    it('removes a selection for a component no longer admitted and a munition no longer compatible', () => {
        let state = createPristineAttackerTargetingState();
        state = apply(state, command({
            kind: 'set-component-selection', componentId: WEAPON_BETA, selection: { kind: 'selected' },
        }));
        state = apply(state, command({
            kind: 'set-component-ammo',
            componentId: WEAPON_ALPHA,
            ammo: { munitionKey: 'Precision', preferredSourceId: SOURCE_ALPHA_PRECISION },
        }));

        const reconciled = reconcileAttackerTargetingState(state, context({
            weapons: [{
                componentId: WEAPON_ALPHA,
                compatibleMunitionKeys: ['Standard'],
                sources: [{ componentId: SOURCE_ALPHA_STANDARD, munitionKeys: ['Standard'] }],
            }],
        }));
        expect(reconciled.accepted).toBeTrue();
        expect(reconciled.state.components.size).toBe(0);
    });

    it('uses the production finite-number bounds and the closed manual range vocabulary', () => {
        let state = createPristineAttackerTargetingState();
        state = apply(state, command({
            kind: 'set-component-selection',
            componentId: WEAPON_ALPHA,
            selection: { kind: 'manual-range', range: 'extreme' },
        }));
        state = apply(state, command({
            kind: 'set-target-facts',
            targetId: TARGET_ALPHA,
            facts: {
                distance: 2.5,
                c3Distance: MAX_ATTACKER_TARGET_DISTANCE,
                manualTnOverride: {
                    kind: 'user-manual',
                    modifier: -MAX_ATTACKER_MANUAL_TN_MAGNITUDE,
                },
            },
        }));
        expect(state.targets.get(TARGET_ALPHA)).toEqual(jasmine.objectContaining({
            distance: 2.5,
            c3Distance: Number.MAX_VALUE,
        }));

        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-target-facts', targetId: TARGET_ALPHA, facts: { distance: Number.POSITIVE_INFINITY },
        }))).toEqual(jasmine.objectContaining({ reason: 'INVALID_TARGET_FACTS' }));
        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-component-selection',
            componentId: WEAPON_ALPHA,
            selection: { kind: 'manual-range', range: 'visual' as never },
        }))).toEqual(jasmine.objectContaining({ reason: 'INVALID_RANGE' }));
    });

    it('enforces closed calculator invariants and explicit C3 evidence', () => {
        const state = createPristineAttackerTargetingState();
        for (const facts of [
            { useC3: true },
            { c3Distance: 3, useC3: true, calculator: { indirectFire: true } },
            { calculator: { spotterMoveMode: 'walk' } },
            { calculator: { secondaryTarget: true, secondaryTargetSideBack: true } },
            { calculator: { partialCover: false } },
        ]) {
            expect(reduceAttackerTargetingCommand(state, context(), command({
                kind: 'set-target-facts', targetId: TARGET_ALPHA, facts: facts as never,
            }))).toEqual(jasmine.objectContaining({ reason: 'INVALID_TARGET_FACTS' }));
        }
    });

    it('returns an accepted immutable no-op for an idempotent replacement', () => {
        let state = createPristineAttackerTargetingState();
        const selection = command({
            kind: 'set-component-selection',
            componentId: WEAPON_ALPHA,
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        });
        state = apply(state, selection);
        const planned = planAttackerTargetingCommand(state, context(), selection);
        expect(planned).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(Object.isFrozen(planned)).toBeTrue();
        if (planned.accepted) {
            expect(serializeAttackerTargetingState(planned.nextState))
                .toEqual(serializeAttackerTargetingState(state));
        } else {
            fail('expected an accepted no-op');
        }
    });

    it('sorts both indexes and produces byte-stable canonical serialization', () => {
        const left = freezeAttackerTargetingState({
            schemaVersion: 1,
            components: new Map([
                [WEAPON_BETA, { selection: { kind: 'selected' as const } }],
                [WEAPON_ALPHA, { ammo: { munitionKey: 'Standard' } }],
            ]),
            actions: new Map(),
            targets: new Map([
                [TARGET_BETA, { distance: 4 }],
                [TARGET_ALPHA, { manualTnOverride: { kind: 'user-manual' as const, modifier: 1 } }],
            ]),
        });
        const right = freezeAttackerTargetingState({
            schemaVersion: 1,
            components: new Map([...left.components].reverse()),
            actions: new Map([...left.actions].reverse()),
            targets: new Map([...left.targets].reverse()),
        });

        expect([...left.components.keys()]).toEqual([WEAPON_ALPHA, WEAPON_BETA]);
        expect([...left.targets.keys()]).toEqual([TARGET_ALPHA, TARGET_BETA]);
        expect(JSON.stringify(serializeAttackerTargetingState(left)))
            .toBe(JSON.stringify(serializeAttackerTargetingState(right)));
    });

    it('owns intrinsic and component physical-action selections without treating them as weapon components', () => {
        let state = createPristineAttackerTargetingState();
        state = apply(state, command({
            kind: 'set-action-selection',
            target: { kind: 'intrinsic', actionId: 'Kick' },
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        }));
        state = apply(state, command({
            kind: 'set-action-selection',
            target: { kind: 'component', componentId: PHYSICAL_COMPONENT },
            selection: { kind: 'selected' },
        }));

        expect(attackerActionSelection(state, { kind: 'intrinsic', actionId: 'Kick' }))
            .toEqual({ kind: 'target', targetId: TARGET_ALPHA });
        expect(attackerActionSelection(state, { kind: 'component', componentId: PHYSICAL_COMPONENT }))
            .toEqual({ kind: 'selected' });
        expect(Object.isFrozen(state.actions)).toBeTrue();
        expect(Object.isFrozen(state.actions.values().next().value)).toBeTrue();

        const intrinsicAsComponent = asComponentId('intrinsic:kick');
        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-component-selection',
            componentId: intrinsicAsComponent,
            selection: { kind: 'target', targetId: TARGET_ALPHA },
        }))).toEqual(jasmine.objectContaining({ reason: 'INVALID_COMPONENT' }));

        expect(reduceAttackerTargetingCommand(state, context(), command({
            kind: 'set-action-selection',
            target: { kind: 'intrinsic', actionId: 'Kick' },
            selection: { kind: 'manual-range', range: 'short' },
        } as never))).toEqual(jasmine.objectContaining({ reason: 'INVALID_RANGE' }));
    });
});

function context(
    overrides: Partial<AttackerTargetingValidationContext> = {},
): AttackerTargetingValidationContext {
    return {
        registryRevision: REGISTRY_REVISION,
        forceReadOnly: false,
        targets: [
            { id: TARGET_ALPHA, source: 'manual', readOnly: false },
            { id: TARGET_BETA, source: 'manual', readOnly: false },
        ],
        weapons: [
            {
                componentId: WEAPON_ALPHA,
                compatibleMunitionKeys: ['Standard', 'Precision'],
                sources: [
                    { componentId: SOURCE_ALPHA_STANDARD, munitionKeys: ['Standard'] },
                    { componentId: SOURCE_ALPHA_PRECISION, munitionKeys: ['Precision'] },
                ],
            },
            {
                componentId: WEAPON_BETA,
                compatibleMunitionKeys: ['Standard'],
                sources: [{ componentId: SOURCE_BETA, munitionKeys: ['Standard'] }],
            },
        ],
        actions: [
            { kind: 'intrinsic', actionId: 'Kick' },
            { kind: 'component', componentId: PHYSICAL_COMPONENT },
        ],
        ...overrides,
    };
}

function command(
    body: AttackerTargetingCommandBody,
): AttackerTargetingCommand {
    return { ...body, expectedRegistryRevision: REGISTRY_REVISION } as AttackerTargetingCommand;
}

type AttackerTargetingCommandBody = AttackerTargetingCommand extends infer Command
    ? Command extends AttackerTargetingCommand
        ? Omit<Command, 'expectedRegistryRevision'>
        : never
    : never;

function apply(
    state: AttackerTargetingState,
    next: AttackerTargetingCommand,
    validation = context(),
): AttackerTargetingState {
    const result = reduceAttackerTargetingCommand(state, validation, next);
    if (!result.accepted) fail(`targeting command rejected: ${result.reason}`);
    return result.state;
}

// Compile-time witnesses: registry labels/colors and grouped legacy strings are
// not accepted by either persisted state shape or source identity APIs.
const _componentIdentityWitness: ComponentId = WEAPON_ALPHA;
const _targetIdentityWitness: EncounterTargetId = TARGET_ALPHA;
void _componentIdentityWitness;
void _targetIdentityWitness;
