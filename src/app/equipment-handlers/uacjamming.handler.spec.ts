// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../models/cbt-ruleset.model';
import { TestTankEntity } from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../models/equipment.model';
import {
    projectNonMekEquipmentInteractions,
    selectNonMekEquipmentChoice,
} from '../models/runtime/cbt-equipment-interactions';
import { createNonMekUnit } from '../models/runtime/cbt-non-mek-unit';
import {
    UACJammingHandler,
    UAC_JAMMED_CHOICE_VALUE,
    UAC_JAMMING_HANDLER_ID,
} from '../models/runtime/component-rapid-fire-autocannon';
import type {
    EquipmentInteractionDialogsService,
    EquipmentInteractionInput,
} from '../models/runtime/equipment-interaction';
import {
    createDirectMekRuntimeFixture,
    emptyCBTEncounterSnapshot,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import { componentIdForMount } from '../models/runtime/unit-runtime-index';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';

function commandContext() {
    return {
        toastService: { showToast: jasmine.createSpy('showToast') },
        dialogsService: { showNoticeHtml: jasmine.createSpy('showNoticeHtml') } as EquipmentInteractionDialogsService,
    };
}

function mekJamInput(ruleset: typeof CORE_2026_RULESET | typeof TOTAL_WARFARE_RULESET) {
    const fixture = createDirectMekRuntimeFixture(ruleset);
    const component = fixture.equipmentComponent('Test AC');
    const input: EquipmentInteractionInput = {
        runtime: fixture.instance,
        entity: fixture.entity,
        index: fixture.index,
        ruleset,
        owner: { instanceId: fixture.instance.instanceId, encounter: emptyCBTEncounterSnapshot },
        componentId: component.id,
        context: {},
    };
    return { fixture, component, input };
}

describe('direct UAC jamming handler', () => {
    it('jams and unjams an Ultra AC under Total Warfare', () => {
        const { fixture, component, input } = mekJamInput(TOTAL_WARFARE_RULESET);
        const handler = new UACJammingHandler();
        const context = commandContext();

        const jam = handler.choices(input)[0]!;
        expect(jam).toEqual(jasmine.objectContaining({
            label: 'Jam',
            shortLabel: 'Jam',
            value: UAC_JAMMED_CHOICE_VALUE,
            active: false,
        }));
        expect(handler.select(input, jam, context)).toBeTrue();
        expect(fixture.instance.query().componentJammed(component.id)).toBeTrue();
        expect(context.toastService.showToast).toHaveBeenCalledWith('Test AC is jammed', 'error');

        const unjam = handler.choices(input)[0]!;
        expect(unjam).toEqual(jasmine.objectContaining({
            label: 'Jammed',
            shortLabel: 'Unjam',
            value: 'false',
            active: true,
        }));
        expect(handler.select(input, unjam, context)).toBeTrue();
        expect(fixture.instance.query().componentJammed(component.id)).toBeFalse();
        expect(context.toastService.showToast).toHaveBeenCalledWith('Test AC is unjammed', 'info');
    });

    it('ignores Ultra AC jamming under Core rules', () => {
        const { fixture, component, input } = mekJamInput(CORE_2026_RULESET);

        expect(new UACJammingHandler().choices(input)).toEqual([]);
        expect(fixture.instance.dispatch({
            type: 'set-component-jammed',
            componentId: component.id,
            jammed: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
    });

    it('offers the same jam control for a non-Mek Rotary AC and only for weapons that can jam', () => {
        const rotary = new WeaponEquipment({
            id: 'TestRotaryAC5',
            name: 'Test Rotary AC/5',
            type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            weapon: { ammoType: 'AC_ROTARY', rackSize: 5, damage: 5, heat: 1, ranges: [5, 10, 15, 20] },
        });
        const autocannon = new WeaponEquipment({
            id: 'TestAC10',
            name: 'Test AC/10',
            type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            weapon: { ammoType: 'AC', rackSize: 10, damage: 10, heat: 3, ranges: [5, 10, 15, 20] },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({
            [rotary.id]: rotary,
            [autocannon.id]: autocannon,
        }));
        entity.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1'));
        const rotaryId = componentIdForMount(addTestEquipment(entity, rotary, { location: entity.locationOrder[0] }));
        const autocannonId = componentIdForMount(addTestEquipment(entity, autocannon, { location: entity.locationOrder[0] }));
        const unit = createNonMekUnit(entity, {
            uuid: entity.uuid(),
            instanceId: 'unit:tank-rac-jam',
            deployment: { id: 'jam-test' },
            scenario: { id: 'jam-test', ruleset: CORE_2026_RULESET },
            initialStateProfileId: 'pristine',
        });
        const context = commandContext();
        const jamChoice = () => {
            const rows = projectNonMekEquipmentInteractions(unit, {}, false);
            expect(rows.map(row => row.componentId)).toEqual([rotaryId]);
            return rows[0]!.choices[0]!;
        };

        const jam = jamChoice();
        expect(jam).toEqual(jasmine.objectContaining({ interactionKind: 'jam', label: 'Jam', active: false }));
        expect(jam.command.handlerId).toBe(UAC_JAMMING_HANDLER_ID);
        expect(selectNonMekEquipmentChoice(unit, jam.command, {}, context)).toBeTrue();
        expect(unit.query().componentJammed(rotaryId)).toBeTrue();
        expect(context.toastService.showToast).toHaveBeenCalledWith('Test Rotary AC/5 is jammed', 'error');

        const unjam = jamChoice();
        expect(unjam).toEqual(jasmine.objectContaining({ label: 'Jammed', shortLabel: 'Unjam', active: true }));
        expect(selectNonMekEquipmentChoice(unit, unjam.command, {}, context)).toBeTrue();
        expect(unit.query().componentJammed(rotaryId)).toBeFalse();

        expect(selectNonMekEquipmentChoice(unit, { ...jam.command, componentId: autocannonId }, {}, context))
            .toBeNull();
        expect(unit.query().componentJammed(autocannonId)).toBeFalse();
    });
});
