// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { constructionEquipmentConflictMessages } from '../../construction/domain/construction-equipment-conflicts';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { parseMtf } from '../entity/parsers/mtf-parser';
import { ParseContext } from '../entity/parsers/parse-context';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { calculateEntityCostDetails } from '../entity/utils/cost/entity-cost';
import { MiscEquipment, StructureEquipment } from '../equipment.model';
import { createMekUnit, restoreMekUnit } from './cbt-mek-unit';
import type { CBTMekUnit } from './cbt-unit';
import { buildMekRuntimeIndex } from './mek-runtime-index';

const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
function testJet(id: string, subtype: 'S_STANDARD' | 'S_PROTOTYPE'): MiscEquipment {
    return new MiscEquipment({
        id, name: id, type: 'misc', flags: ['F_JUMP_JET', subtype], stats: { criticalSlots: 1, tonnage: 'variable' },
    });
}
const standardJet = testJet('Jump Jet', 'S_STANDARD');
const primitiveJet = testJet('Primitive Prototype Jump Jet', 'S_PROTOTYPE');
const standard = new StructureEquipment({
    id: 'Standard', name: 'Standard', type: 'structure', tech: { base: 'All' }, structure: { typeId: 0 },
});
const registry = createTestEquipmentRegistry({ [standardJet.id]: standardJet, [primitiveJet.id]: primitiveJet, [standard.id]: standard });

async function admit(ruleset: CBTRuleset, halfTonJets: number, oneTonJets = 0, jet = standardJet, legJets = 0) {
    const entity = parseMtf(`uuid:${uuid}
chassis:FrankenMech
model:Donor jets
Config:Biped FrankenMek
techbase:Inner Sphere
mass:60
engine:240 Fusion Engine
gyro:Standard
structure:Standard
LT structure:50
heat sinks:10 Single
walk mp:4
armor:Standard(Inner Sphere)
Left Torso:
${Array(halfTonJets).fill(jet.id).join('\n')}
Right Torso:
${Array(oneTonJets).fill(jet.id).join('\n')}
Left Leg:
Hip
Upper Leg Actuator
Lower Leg Actuator
Foot Actuator
${Array(legJets).fill(jet.id).join('\n')}
`, new ParseContext('frankenmek-jump.mtf', registry));
    const unit = await createMekUnit({ uuid, instanceId: 'frankenmek-jump', crewSkills: { gunnery: 4, piloting: 5 } },
        entity, uuid, { profileId: 'pristine', deployment: { id: 'default' }, scenario: { id: 'megamek', ruleset } });
    const index = buildMekRuntimeIndex(entity);
    const jetSlots = (location: string) => [...index.slots.values()].filter(slot => slot.componentIds.some(id => {
        const component = index.components.get(id);
        return component?.kind === 'equipment' && component.mount.equipmentId === jet.id && component.mount.location === location;
    }));
    return { unit, entity, jetSlots };
}

function expectJumpMp(unit: CBTMekUnit, jumpMp: number): void {
    expect(unit.query().mekMovementPsr()).toEqual(jasmine.objectContaining({ kind: 'supported', jumpMp }));
}

function expectJumpHeat(unit: CBTMekUnit, distance: number, heat: number): void {
    expect(unit.dispatch({
        type: 'declare-mek-movement', declaration: { mode: 'jump', distance, boosterComponentIds: [] },
    }).accepted).toBeTrue();
    const projection = unit.query().heatProjection();
    expect(projection.kind).toBe('supported');
    if (projection.kind === 'supported') {
        expect(projection.projection.committedSources.find(source => source.id === 'movement')?.value).toBe(heat);
    }
}

describe('FrankenMech jump jets (Campaign Operations p. 213)', () => {
    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`rounds surviving thrust down and charges heat per jet fired under ${ruleset}`, async () => {
            const { unit, entity, jetSlots } = await admit(ruleset, 6);
            expectJumpMp(unit, 3);
            expectJumpHeat(unit, 3, 6);
            expect(calculateEntityCostDetails(entity).steps.find(step => step.type === 'Jump Jets')?.amount).toBe(432000);
            expect(unit.query().mekPilotChecks()).toEqual([]);
            const slots = jetSlots('LT');
            expect(slots.length).toBe(6);
            for (const [i, slot] of slots.entries()) {
                expect(unit.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' }).accepted).toBeTrue();
                const jumpMp = Math.floor((5 - i) / 2);
                expectJumpMp(unit, jumpMp);
                if (jumpMp === 2) expectJumpHeat(unit, 2, 4);
            }
        });

        it(`uses only jets above water at takeoff and retains a spare jet fired for heat under ${ruleset}`, async () => {
            const { unit, entity, jetSlots } = await admit(ruleset, 6, 0, standardJet, 1);
            const water = (depth: 1 | 2) => unit.dispatch({ type: 'replace-turn-state',
                turn: { ...unit.query().turnState(), cover: `underwater-depth-${depth}` } });
            const jump = (distance: number, fired?: number) => unit.dispatch({ type: 'declare-mek-movement',
                declaration: { mode: 'jump', distance, boosterComponentIds: [], ...(fired === undefined ? {} : { jumpJetsFired: fired }) } });
            expectJumpMp(unit, 4);
            water(1);
            expectJumpMp(unit, 3);
            unit.dispatch({ type: 'hit-critical', slotId: jetSlots('LT')[0].id, hits: 1, target: 'committed' });
            expectJumpMp(unit, 2);
            expect(jump(2, 6).changed).toBeFalse();
            expect(jump(2, 3).changed).toBeFalse();
            expect(unit.snapshot().movementPsr.movement).toBeNull();
            expect(jump(2, 5).changed).toBeTrue();
            water(2);
            const restored = await restoreMekUnit(unit.serialize(), entity, uuid,
                { profileId: 'pristine', deployment: { id: 'default' }, scenario: { id: 'megamek', ruleset } });
            expect(restored.snapshot().movementPsr.movement).toEqual(jasmine.objectContaining({ jumpFromDepth: 1, jumpJetsFired: 5 }));
            const heat = restored.query().heatProjection();
            if (heat.kind !== 'supported') throw new Error('Missing heat projection');
            expect(heat.projection.committedSources.find(source => source.id === 'movement')?.value).toBe(5);
            restored.dispatch({ type: 'clear-mek-movement' });
            expectJumpMp(restored, 0);
        });

        it(`uses the fewest working jets for a mixed-size jump under ${ruleset}`, async () => {
            const { unit, jetSlots } = await admit(ruleset, 4, 2);
            expectJumpMp(unit, 4);
            expectJumpHeat(unit, 3, 4);
            expectJumpHeat(unit, 4, 6);
            const [fullSizeJet] = jetSlots('RT');
            expect(unit.dispatch({ type: 'hit-critical', slotId: fullSizeJet!.id, hits: 1, target: 'committed' }).accepted).toBeTrue();
            expectJumpMp(unit, 3);
            expectJumpHeat(unit, 3, 5);
        });

        it(`admits a retained half-ton jet worth less than one MP under ${ruleset}`, async () => {
            const { unit, jetSlots } = await admit(ruleset, 1);
            expectJumpMp(unit, 0);
            expect(jetSlots('LT').length).toBe(1);
        });

        it(`makes one landing roll however a primitive-jet jump is corrected under ${ruleset}`, async () => {
            // IO:AE p. 114: one Piloting Skill Roll when the Mek lands.
            const { unit } = await admit(ruleset, 6, 0, primitiveJet);
            const jump = (jumpJetsFired: number) => unit.dispatch({ type: 'declare-mek-movement',
                declaration: { mode: 'jump', distance: 2, boosterComponentIds: [], jumpJetsFired } }).accepted;
            expect(jump(4)).toBeTrue();
            const [landing] = unit.query().mekPilotChecks();
            expect(unit.dispatch({ type: 'resolve-mek-pilot-check', checkId: landing!.checkId,
                evidence: { dice: [6, 6], claimedOutcome: 'success' } }).accepted).toBeTrue();
            expect(jump(5)).toBeTrue();
            expect(unit.query().mekPilotChecks().map(check => check.status)).toEqual(['success']);
        });

        it(`distinguishes primitive prototype jets at construction and on landing under ${ruleset}`, async () => {
            const { unit, entity } = await admit(ruleset, 6, 0, primitiveJet);
            expect(constructionEquipmentConflictMessages(entity, standardJet).map(message => message.code)).toContain('MEK_MIXED_JUMP_JETS');
            expect(constructionEquipmentConflictMessages(entity, primitiveJet).map(message => message.code)).not.toContain('MEK_MIXED_JUMP_JETS');
            expectJumpHeat(unit, 3, 6);
            expect(unit.query().mekPilotChecks()).toEqual([jasmine.objectContaining({
                source: jasmine.objectContaining({ triggerKind: 'primitive-prototype-jump' }), targetNumber: 8,
            })]);
        });
    }
});
