// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnitSnapshot } from '../../models/cbt-unit-snapshot';
import type { BaseEntity } from '../../models/entity/base-entity';
import { TestBattleArmorEntity, TestSupportTankEntity, TestTankEntity } from '../../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { AmmoEquipment } from '../../models/equipment.model';
import { createNonMekUnit } from '../../models/runtime/cbt-non-mek-unit';
import type { CBTUnit } from '../../models/runtime/cbt-unit';
import { prepareConstructionRuntime, type ConstructionRuntimeCommand } from '../../models/runtime/construction-runtime';
import { createDirectBapRuntimeFixture, createDirectMekRuntimeFixture, createDirectModularArmorRuntimeFixture } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import {
    constructionArmorRepairCommands, constructionComponentRepairCommands, constructionHasRepairDamage, constructionInternalRepairCommands, constructionPendingRepairQuote,
    constructionReconfigurationSPCost, constructionRepairQuote, constructionCanUpdateDesign,
} from './construction-repairs';

const scenario = { id: 'repair-quote-test', ruleset: 'core-2026' as const };
const repairAll = [{ type: 'repair-all' }] as const;
function snapshot(unit: CBTUnit): CBTUnitSnapshot {
    const state = unit.snapshot();
    return { ...unit.captureRuntime(), state, entity: unit.getUnit(), uuid: unit.uuid, instanceId: unit.instanceId,
        ruleset: unit.ruleset(), crewAssignment: unit.getCrewAssignment(), editContext: { owner: unit, state } };
}
function nonMek(entity: BaseEntity) {
    return createNonMekUnit(entity, { uuid: entity.uuid(), instanceId: 'unit:repair', deployment: { id: 'repair-test' },
        scenario, initialStateProfileId: 'pristine' });
}
async function pending(unit: CBTUnit, commands: readonly ConstructionRuntimeCommand[]) {
    return constructionPendingRepairQuote(snapshot(unit), snapshot(await prepareConstructionRuntime(unit, commands, scenario)), commands);
}

describe('construction repair campaign quotes', () => {
    it('allows design updates only after committed damage, pending damage and crew wounds are repaired', async () => {
        const { instance: unit, index } = createDirectMekRuntimeFixture();
        expect(constructionCanUpdateDesign(snapshot(unit))).toBeTrue();
        const face = [...index.armorFaces.values()].find(face => face.maximumPoints > 0)!;
        unit.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'committed' });
        unit.dispatch({ type: 'repair-armor', faceId: face.id, amount: 1, target: 'pending' });
        expect(constructionCanUpdateDesign(snapshot(unit))).toBeFalse();
        const repaired = await prepareConstructionRuntime(unit, repairAll, scenario);
        expect(constructionCanUpdateDesign(snapshot(repaired))).toBeTrue();
        repaired.dispatch({ type: 'set-crew-state', positionId: [...index.crewPositions.keys()][0], wounds: 1, unconscious: false, ejected: false });
        expect(constructionCanUpdateDesign(snapshot(repaired))).toBeFalse();
        const tank = nonMek(new TestTankEntity());
        expect(constructionCanUpdateDesign(snapshot(tank))).toBeTrue();
    });
    it('stages one armor face and one structure location independently through the runtime owner', async () => {
        const { instance: unit, index } = createDirectMekRuntimeFixture();
        const location = [...index.locations.values()].find(location => location.code === 'LT')!;
        const front = [...index.armorFaces.values()].find(face => face.locationId === location.id && face.face === 'front')!;
        const otherFace = [...index.armorFaces.values()].find(face => face.locationId !== location.id && face.maximumPoints > 0)!;
        unit.dispatch({ type: 'damage-armor', faceId: front.id, amount: 2, target: 'committed' });
        unit.dispatch({ type: 'damage-armor', faceId: front.id, amount: 1, target: 'pending' });
        unit.dispatch({ type: 'damage-armor', faceId: otherFace.id, amount: 1, target: 'committed' });
        unit.dispatch({ type: 'damage-internal', locationId: location.id, amount: 3, target: 'committed' });
        unit.dispatch({ type: 'damage-internal', locationId: location.id, amount: 1, target: 'pending' });
        const armorCommands = constructionArmorRepairCommands(snapshot(unit), front.id);
        const armor = await prepareConstructionRuntime(unit, armorCommands, scenario);
        expect(armor.query().remainingArmor(front.id, 'preview')).toBe(front.maximumPoints);
        expect(armor.query().remainingArmor(otherFace.id, 'preview')).toBe(otherFace.maximumPoints - 1);
        expect(armor.query().remainingInternal(location.id, 'preview')).toBe(location.internalPoints - 4);
        expect(armor.snapshot().pendingCombat.armorDamage.get(front.id) ?? 0).toBe(0);
        const structure = await prepareConstructionRuntime(armor, constructionInternalRepairCommands(snapshot(armor), location.id), scenario);
        expect(structure.query().remainingInternal(location.id, 'preview')).toBe(location.internalPoints);
        expect(structure.query().remainingArmor(otherFace.id, 'preview')).toBe(otherFace.maximumPoints - 1);
        expect(structure.snapshot().pendingCombat.locationInternalDamage.get(location.id) ?? 0).toBe(0);
        expect(unit.query().remainingArmor(front.id, 'preview')).toBe(front.maximumPoints - 3);
        expect(unit.query().remainingInternal(location.id, 'preview')).toBe(location.internalPoints - 4);
    });

    it('respects existing pending repairs without redirecting damage into modular armor', async () => {
        const fixture = createDirectModularArmorRuntimeFixture();
        const panel = [...fixture.index.components.values()].find(component => component.mount?.equipment?.hasFlag('F_MODULAR_ARMOR'))!;
        const location = [...fixture.index.locations.values()].find(location => location.code === panel.mount!.location)!;
        const face = [...fixture.index.armorFaces.values()].find(face => face.locationId === location.id && face.face === 'front')!;
        expect(fixture.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 14, target: 'committed' }).changed).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'repair-armor', faceId: face.id, amount: 2, target: 'pending' }).changed).toBeTrue();
        fixture.instance.dispatch({ type: 'damage-internal', locationId: location.id, amount: 3, target: 'committed' });
        fixture.instance.dispatch({ type: 'repair-internal', locationId: location.id, amount: 1, target: 'pending' });
        const source = snapshot(fixture.instance);
        const repaired = await prepareConstructionRuntime(fixture.instance, [
            ...constructionArmorRepairCommands(source, face.id), ...constructionInternalRepairCommands(source, location.id),
        ], scenario);
        expect(repaired.query().remainingArmor(face.id, 'preview')).toBe(face.maximumPoints);
        expect(repaired.query().remainingInternal(location.id, 'preview')).toBe(location.internalPoints);
        expect(repaired.snapshot().components.get(panel.id)?.modularArmorDamage).toBe(source.state.components.get(panel.id)?.modularArmorDamage);
        expect(repaired.snapshot().pendingCombat.armorDamage.get(face.id)).toBe(-2);
        expect(repaired.snapshot().pendingCombat.locationInternalDamage.get(location.id)).toBe(-1);
        expect(constructionArmorRepairCommands(snapshot(repaired), face.id)).toEqual([]);
        expect(constructionInternalRepairCommands(snapshot(repaired), location.id)).toEqual([]);
    });

    it('uses the same independent armor and structure commands for vehicle locations', async () => {
        const entity = new TestTankEntity();
        entity.setTonnage(50);
        for (const location of entity.armorLocations) entity.setArmorValue(location, 'front', 10);
        const unit = nonMek(entity), index = unit.getIndex();
        const face = [...index.armorFaces.values()].find(face => face.maximumPoints > 0)!;
        const location = index.locations.get(face.locationId)!;
        unit.dispatch({ type: 'damage-armor', faceId: face.id, amount: 3, target: 'committed' });
        unit.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'pending' });
        unit.dispatch({ type: 'damage-internal', locationId: location.id, amount: 1, target: 'committed' });
        const source = snapshot(unit);
        const repaired = await prepareConstructionRuntime(unit, [
            ...constructionArmorRepairCommands(source, face.id), ...constructionInternalRepairCommands(source, location.id),
        ], scenario);
        expect(repaired.query().remainingArmor(face.id, 'preview')).toBe(face.maximumPoints);
        expect(repaired.query().remainingInternal(location.id, 'preview')).toBe(location.internalPoints);
        expect(unit.query().remainingArmor(face.id, 'preview')).toBe(face.maximumPoints - 4);
    });

    it('charges the highest repair level once and distinguishes armor, internal, crippled and destroyed', () => {
        const { instance: unit, index, entity } = createDirectMekRuntimeFixture();
        const armor = [...index.armorFaces.values()].find(face => face.maximumPoints > 0)!;
        unit.dispatch({ type: 'damage-armor', faceId: armor.id, amount: 1, target: 'pending' });
        expect(constructionRepairQuote(snapshot(unit)).spCost).toBe(entity.tonnage() / 2);
        const arm = [...index.locations.values()].find(location => location.code === 'LA')!;
        unit.dispatch({ type: 'damage-internal', locationId: arm.id, amount: 1, target: 'committed' });
        expect(constructionRepairQuote(snapshot(unit)).spCost).toBe(entity.tonnage() * 2);
        const engine = [...index.slots.values()].filter(slot => slot.componentIds.some(id => {
            const component = index.components.get(id);
            return component?.kind === 'system' && component.systemType === 'Engine';
        }));
        for (const slot of engine.slice(0, 2)) unit.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' });
        expect(unit.query().hasCondition('crippled')).toBeTrue();
        expect(constructionRepairQuote(snapshot(unit)).spCost).toBe(entity.tonnage() * 3);
        unit.dispatch({ type: 'hit-critical', slotId: engine[2].id, hits: 1, target: 'committed' });
        expect(unit.query().destroyed()).toBeTrue();
        expect(constructionRepairQuote(snapshot(unit)).spCost).toBe(entity.tonnage() * 5);
    });

    it('rounds Clan and mixed repairs before halving combat vehicle costs', () => {
        for (const mixed of [false, true]) {
            const entity = new TestTankEntity();
            entity.setTonnage(55);
            entity.techBase.set(mixed ? 'IS' : 'Clan');
            entity.mixedTech.set(mixed);
            const unit = nonMek(entity);
            const motive = [...unit.getIndex().damageTracks.values()].find(track => track.system === 'motive')!;
            unit.dispatch({ type: 'damage-track', damageTrackId: motive.id, amount: 1, target: 'pending', timestamp: 0 });
            expect(constructionRepairQuote(snapshot(unit)).spCost).toBe(21);
            expect(constructionHasRepairDamage(snapshot(unit))).toBeTrue();
        }
        const support = new TestSupportTankEntity();
        support.setTonnage(55);
        const unit = nonMek(support);
        const motive = [...unit.getIndex().damageTracks.values()].find(track => track.system === 'motive')!;
        unit.dispatch({ type: 'damage-track', damageTrackId: motive.id, amount: 1, target: 'committed', timestamp: 0 });
        expect(constructionRepairQuote(snapshot(unit)).spCost).toBe(27.5);
    });

    it('quotes pending lethal engine damage without settling runtime destruction', async () => {
        const { instance: unit, index, entity } = createDirectMekRuntimeFixture();
        const engine = [...index.slots.values()].filter(slot => slot.componentIds.some(id => {
            const component = index.components.get(id);
            return component?.kind === 'system' && component.systemType === 'Engine';
        }));
        for (const slot of engine.slice(0, 3)) unit.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'pending' });
        expect(unit.query().destroyed()).toBeFalse();
        const projection = unit.query().mekDestruction();
        expect(projection.kind === 'supported' && projection.facts.preview.destroyed).toBeTrue();
        expect(constructionRepairQuote(snapshot(unit)).spCost).toBe(entity.tonnage() * 5);
        expect((await pending(unit, repairAll))?.spCost).toBe(entity.tonnage() * 5);
        expect(unit.query().destroyed()).toBeFalse();
    });

    it('does not confuse equipment switched off with repair damage', () => {
        const fixture = createDirectBapRuntimeFixture();
        const probe = fixture.equipmentComponent('Test BAP');
        expect(fixture.instance.dispatch({ type: 'set-component-mode', componentId: probe.id, mode: 'disabling' }).changed).toBeTrue();
        fixture.instance.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(fixture.instance.query().componentMode(probe.id)).toBe('disabled');
        expect(constructionHasRepairDamage(snapshot(fixture.instance))).toBeFalse();
        expect(constructionRepairQuote(snapshot(fixture.instance)).spCost).toBe(0);
    });

    it('requires Repair All for damaged modular armor instead of returning ineffective component commands', async () => {
        const fixture = createDirectModularArmorRuntimeFixture();
        const panel = [...fixture.index.components.values()].find(component => component.mount?.equipment?.hasFlag('F_MODULAR_ARMOR'))!;
        const location = [...fixture.index.locations.values()].find(location => location.code === panel.mount!.location)!;
        const face = [...fixture.index.armorFaces.values()].find(face => face.locationId === location.id && face.face === 'front')!;
        fixture.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'pending' });
        expect(constructionHasRepairDamage(snapshot(fixture.instance))).toBeTrue();
        expect(constructionRepairQuote(snapshot(fixture.instance)).spCost).toBe(fixture.entity.tonnage() / 2);
        expect(constructionRepairQuote(snapshot(fixture.instance)).cost).toBe(0);
        expect(() => constructionComponentRepairCommands(snapshot(fixture.instance), panel.id)).toThrowError('Use Repair All to restore modular armor.');
        const repaired = await prepareConstructionRuntime(fixture.instance, repairAll, scenario);
        expect(constructionHasRepairDamage(snapshot(repaired))).toBeFalse();
    });

    it('keeps crew ejection restoration visible without inventing a physical SP repair charge', async () => {
        const { instance: unit, index, entity } = createDirectMekRuntimeFixture();
        unit.dispatch({ type: 'set-crew-state', positionId: [...index.crewPositions.keys()][0], wounds: 0, unconscious: false, ejected: true });
        const quote = await pending(unit, repairAll);
        expect(quote?.cost).toBe(Math.round(entity.cost() * .05));
        expect(quote?.spCost).toBe(0);
    });

    it('still quotes Support Points when the design has no computable C-Bill price', () => {
        const { instance: unit, index, entity } = createDirectMekRuntimeFixture();
        const face = [...index.armorFaces.values()].find(face => face.maximumPoints > 0)!;
        unit.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'committed' });
        spyOn(entity, 'cost').and.throwError('No cost available');
        const quote = constructionRepairQuote(snapshot(unit));
        expect(quote.cost).toBeNull();
        expect(quote.spCost).toBe(entity.tonnage() / 2);
    });

    it('uses lost troopers for battle armor structure, crippled and destroyed repair levels', () => {
        const entity = new TestBattleArmorEntity();
        const unit = nonMek(entity);
        const troopers = [...unit.getIndex().locations.values()].filter(location => location.internalPoints > 0);
        expect(troopers.length).toBe(5);
        for (let count = 0; count < troopers.length; count++) {
            const location = troopers[count];
            unit.dispatch({ type: 'damage-internal', locationId: location.id, amount: location.internalPoints, target: 'committed' });
            const multiplier = count === 4 ? 5 : count >= 2 ? 3 : 2;
            expect(constructionRepairQuote(snapshot(unit)).spCost).toBe(Math.ceil(entity.tonnage() * multiplier / 2));
        }
    });

    it('does not price truly destroyed center torsos or vehicle hulls as repairable salvage', () => {
        const { instance: unit, index } = createDirectMekRuntimeFixture();
        const ct = [...index.locations.values()].find(location => location.code === 'CT')!;
        unit.dispatch({ type: 'damage-internal', locationId: ct.id, amount: ct.internalPoints, target: 'committed' });
        expect(constructionRepairQuote(snapshot(unit)).spCost).toBeNull();
        expect(constructionRepairQuote(snapshot(unit)).spBasis).toContain('truly destroyed');
        const tankEntity = new TestTankEntity();
        tankEntity.setTonnage(55);
        const tank = nonMek(tankEntity);
        const hull = [...tank.getIndex().locations.values()].find(location => location.code === 'Front')!;
        expect(tank.dispatch({ type: 'damage-internal', locationId: hull.id, amount: hull.internalPoints, target: 'pending' }).changed).toBeTrue();
        expect(constructionRepairQuote(snapshot(tank)).spCost).toBeNull();
    });

    it('deduplicates component repairs and repair-all without charging SP for each critical slot', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const component = fixture.equipmentComponent('Test AC');
        const slot = [...fixture.index.slots.values()].find(slot => slot.componentIds.includes(component.id))!;
        fixture.instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' });
        const commands = constructionComponentRepairCommands(snapshot(fixture.instance), component.id);
        const once = await pending(fixture.instance, commands);
        expect(once?.cost).toBe(20_000);
        expect(once?.spCost).toBe(fixture.entity.tonnage() * 2);
        expect(await pending(fixture.instance, [...commands, ...commands])).toEqual(once);
        expect(await pending(fixture.instance, [...commands, ...repairAll])).toEqual(await pending(fixture.instance, repairAll));
    });

    it('suppresses pristine and undone repairs using final runtime facts', async () => {
        const { instance: unit, index } = createDirectMekRuntimeFixture();
        expect(await pending(unit, repairAll)).toBeNull();
        const face = [...index.armorFaces.values()].find(face => face.maximumPoints > 0)!;
        unit.dispatch({ type: 'damage-armor', faceId: face.id, amount: 2, target: 'committed' });
        const commands: readonly ConstructionRuntimeCommand[] = [
            { type: 'repair-armor', faceId: face.id, amount: 1, target: 'committed' },
            { type: 'damage-armor', faceId: face.id, amount: 1, target: 'committed' },
        ];
        expect(await pending(unit, commands)).toBeNull();
        expect((await pending(unit, [commands[0]]))?.spCost).toBe(unit.getUnit().tonnage() / 2);
        expect((await pending(unit, [commands[0]]))?.cost).toBe(0);
    });

    it('charges full ammunition bins for a refill and keeps rearming separate from repair multipliers', async () => {
        for (const level of ['Standard', 'Advanced', 'Experimental'] as const) {
            const ammo = new AmmoEquipment({ id: `Ammo_${level}`, name: 'AC/10 Ammo', type: 'ammo', tech: { base: 'Clan', level },
                ammo: { type: 'AC', rackSize: 10, shots: 10 } });
            const entity = new TestTankEntity(createTestEquipmentRegistry({ [ammo.id]: ammo }));
            entity.setTonnage(55);
            entity.techBase.set('Clan');
            entity.addEquipment({ equipment: ammo, equipmentId: ammo.id, allocation: { kind: 'location', location: 'Front' },
                rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
            const unit = nonMek(entity);
            const component = [...unit.getIndex().components.values()][0];
            expect(unit.dispatch({ type: 'set-ammo-spent', componentId: component.id, shotsSpent: 1 }).changed).toBeTrue();
            const quote = await pending(unit, repairAll);
            expect(quote?.spCost).toBe(level === 'Standard' ? 10 : 100);
            expect(constructionHasRepairDamage(snapshot(unit))).toBeFalse();
        }
    });

    it('adds crew healing and rearming to one repair charge and leaves Omni reconfiguration unmodified', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const face = [...fixture.index.armorFaces.values()].find(face => face.maximumPoints > 0)!;
        fixture.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'committed' });
        fixture.instance.dispatch({ type: 'spend-ammo', componentId: fixture.equipmentComponent('Test Ammo').id, amount: 1 });
        fixture.instance.dispatch({ type: 'set-crew-state', positionId: [...fixture.index.crewPositions.keys()][0],
            wounds: 2, unconscious: false, ejected: false });
        expect((await pending(fixture.instance, repairAll))?.spCost).toBe(fixture.entity.tonnage() / 2 + 10 + 60);
        fixture.entity.techBase.set('Clan');
        expect(constructionReconfigurationSPCost(fixture.entity)).toBe(fixture.entity.tonnage() / 2);
    });
});
