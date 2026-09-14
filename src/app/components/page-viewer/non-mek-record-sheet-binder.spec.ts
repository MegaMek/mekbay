// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
asArmorFaceId,
asComponentId,
asCrewPositionId,
asLocationId,
asSystemDamageTrackId,
} from '../../models/entity/entity-identifiers';
import type { EquipmentPanelSnapshot } from '../../models/runtime/equipment-panel';
import { MountedArmor } from '../../models/entity/components/armor';
import { MountedStructure } from '../../models/entity/components/structure';
import { TestTankEntity } from '../../models/entity/testing/test-entities';
import * as testEntities from '../../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment,ArmorEquipment,MiscEquipment,StructureEquipment,WeaponEquipment } from '../../models/equipment.model';
import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../../models/cbt-ruleset.model';
import { createNonMekRuntimeForTest } from '../../models/runtime/testing/unit-runtime-owner-fixture';
import { createNonMekUnit } from '../../models/runtime/cbt-non-mek-unit';
import { projectNonMekEquipmentPanel } from '../../models/runtime/non-mek-equipment-panel';
import { projectNonMekRecordSheet } from '../../models/runtime/non-mek-record-sheet';
import { componentIdForMount } from '../../models/runtime/unit-runtime-index';
import { emptyCBTEncounterSnapshot } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import { applyRecordSheetPipMaterials } from '../../utils/sheets/record-sheet-pip-materials';
import type { NonMekRecordSheetSnapshot } from '../../models/runtime/non-mek-record-sheet';
import { createUnitEditContextFixture } from '../../models/runtime/testing/unit-edit-context-fixture';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { CapitalShipPipRenderer } from '../../utils/sheets/capital-ship-pip-renderer';
import { INFANTRY_STRENGTH_CELL_COUNT } from '../../utils/sheets/infantry-strength-projection';
import { appendRecordSheetAmmoProfile } from '../../utils/sheets/record-sheet-ammo-rendering';
import { optimizeGeneratedSvg } from '../../utils/sheets/record-sheet-svg-rendering';
import { RecordSheetSvgGenerator } from '../../utils/sheets/record-sheet-svg-generator';
import {
bindNonMekRecordSheet,
} from './non-mek-record-sheet-binder';
import { RECORD_SHEET_FRESH_DAMAGE_DURATION_MS } from '../../utils/sheets/record-sheet-damage-highlights';
import type { RecordSheetInteraction } from './record-sheet-interaction';

const editContext = createUnitEditContextFixture();

describe('bindNonMekRecordSheet', () => {
    for (const Family of [testEntities.TestBattleArmorEntity, testEntities.TestInfantryEntity,
        testEntities.TestProtoMekEntity, testEntities.TestTankEntity, testEntities.TestVtolEntity,
        testEntities.TestSupportTankEntity, testEntities.TestSupportVtolEntity,
        testEntities.TestLargeSupportTankEntity, testEntities.TestSupportNavalEntity,
        testEntities.TestHandheldWeaponEntity]) {
        it(`${Family.name}: opens the cluster reference from its header, cells and frame, including read-only sheets`, async () => {
            const entity = new Family();
            if (entity instanceof testEntities.TestInfantryEntity) {
                entity.squadSize.set(5);
                entity.squadCount.set(1);
            }
            addTestEquipment(entity, new WeaponEquipment({ id: 'SRM 2', name: 'SRM 2', type: 'weapon',
                flags: ['F_MISSILE'], weapon: { damage: '2/Msl', rackSize: 2, ammoType: 'SRM', ranges: [3, 6, 9] },
            }));
            const svg = await RecordSheetSvgGenerator.generate(entity);
            const table = svg.querySelector<SVGElement>('[data-mekbay-reference="cluster-hits"]')!;
            expect(table).not.toBeNull();
            const onInteraction = jasmine.createSpy('onInteraction');
            const initial = snapshot(3);
            const binding = bindNonMekRecordSheet(svg, initial, onInteraction);
            const targets = [table.querySelector('text')!, table.querySelector('[data-cluster-rack]')!,
                table.querySelector('path')!];
            svg.classList.add('interactive-sheet');
            svg.style.cssText = 'position:fixed;top:0;left:0;width:400px;height:auto;z-index:9999';
            document.body.append(svg);
            try {
                for (const target of targets) {
                    const box = target.getBoundingClientRect();
                    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)!;
                    expect(table.contains(hit)).toBeTrue();
                    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }
            } finally {
                svg.remove();
            }
            expect(onInteraction).toHaveBeenCalledTimes(3);
            expect(onInteraction).toHaveBeenCalledWith({ kind: 'reference-table', context: initial.editContext }, jasmine.any(MouseEvent));

            const next = { ...initial, stateRevision: 8, editContext: editContext(8) };
            binding.render(next);
            table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            expect(onInteraction.calls.mostRecent().args[0]).toEqual({ kind: 'reference-table', context: next.editContext });
            table.dispatchEvent(new MouseEvent('click', { button: 2, bubbles: true }));
            table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(onInteraction).toHaveBeenCalledTimes(4);
            binding.destroy();
            expect(table.classList.contains('interactive')).toBeFalse();
            expect(table.hasAttribute('tabindex')).toBeFalse();

            const onPresentation = jasmine.createSpy('onPresentation');
            const readOnly = bindNonMekRecordSheet(svg, next, undefined, undefined, onPresentation);
            targets[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            table.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
            expect(onPresentation).toHaveBeenCalledTimes(2);
            expect(onInteraction).toHaveBeenCalledTimes(4);
            readOnly.destroy();
            targets[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(onPresentation).toHaveBeenCalledTimes(2);
        });
    }

    it('shows the mapped name blank only when the crew name is empty', () => {
        const svg = stateSheet();
        svg.insertAdjacentHTML('beforeend', '<path id="blankCrewName0"></path>');
        svg.querySelector('.crewNameButton')!.setAttribute('textElement', 'crewName0');
        svg.querySelector('.crewNameButton')!.setAttribute('blankElement', 'blankCrewName0');
        const original = stateSnapshot(0);
        const binding = bindNonMekRecordSheet(svg, original);
        const blank = svg.querySelector<SVGElement>('#blankCrewName0')!;
        const name = svg.querySelector<SVGElement>('#crewName0')!;
        expect(blank.style.visibility).toBe('hidden');
        expect(name.style.visibility).toBe('visible');
        for (const emptyName of ['', '   ']) {
            binding.render({ ...original, crew: original.crew.map(position => ({ ...position, name: emptyName })) });
            expect(blank.style.visibility).toBe('visible');
            expect(name.style.visibility).toBe('hidden');
        }
        binding.render(original);
        expect(blank.style.visibility).toBe('hidden');
        expect(name.style.visibility).toBe('visible');
        binding.destroy();
    });

    for (const Family of [testEntities.TestTankEntity, testEntities.TestVtolEntity, testEntities.TestSupportNavalEntity,
        testEntities.TestAeroSpaceFighterEntity, testEntities.TestFixedWingSupportEntity, testEntities.TestDropShipEntity,
        testEntities.TestWarShipEntity, testEntities.TestHandheldWeaponEntity]) {
        it(Family.name + ': binds generated armor counters and preserves their prefixes', async () => {
            const entity = new Family();
            for (const code of entity.locationOrder) entity.setArmorValue(code, 'front', 28);
            const svg = await RecordSheetSvgGenerator.generate(entity);
            const counters = [...svg.querySelectorAll<SVGElement>('[id^="textArmor_"]')];
            expect(counters.length).toBeGreaterThan(0);
            const base = snapshot(3);
            const locations = entity.damageLocations().map(location => ({
                locationId: LOCATION_ID, code: location.code, sheetCode: location.sheetCode ?? location.code,
                maximumInternal: location.internalPoints, remainingInternal: location.internalPoints,
                previewRemainingInternal: location.internalPoints,
                armor: [{ faceId: FACE_ID, locationId: LOCATION_ID, face: 'front' as const,
                    maximum: location.armor.front, remaining: location.armor.front, previewRemaining: location.armor.front }],
            }));
            const prefixes = counters.map(counter => counter.getAttribute('data-mekbay-counter-prefix'));
            const binding = bindNonMekRecordSheet(svg, { ...base, locations });
            const damaged = locations.map(location => ({ ...location,
                armor: location.armor.map(face => ({ ...face, previewRemaining: Math.max(0, face.maximum - 3) })),
            }));
            binding.render({ ...base, locations: damaged });
            counters.forEach((counter, index) => {
                const code = counter.id.slice('textArmor_'.length);
                const face = damaged.find(location => location.sheetCode === code)?.armor[0];
                expect(face).withContext(counter.id).toBeDefined();
                if (!face) return;
                const count = face.maximum === face.previewRemaining ? String(face.maximum) : face.previewRemaining + '/' + face.maximum;
                expect(counter.textContent).withContext(counter.id).toBe((prefixes[index] ? prefixes[index] + ' ' : '') + '( ' + count + ' )');
            });
            binding.render({ ...base, locations });
            counters.forEach(counter => expect(counter.textContent).not.toContain('/'));
            binding.destroy();
        });
    }

    it('updates armor and structure counters through preview, commit, depletion and repair without losing thresholds', () => {
        const svg = sheet();
        svg.insertAdjacentHTML('beforeend', '<text id="textArmor_FR" data-mekbay-counter-prefix="1">1 ( 3 )</text><text id="textIS_FR">( 2 )</text><g><text id="textArmor_FR" data-mekbay-counter-prefix="1">1 ( 3 )</text></g>');
        const binding = bindNonMekRecordSheet(svg, snapshot(3));
        const expectArmor = (value: string) => svg.querySelectorAll('[id="textArmor_FR"]').forEach(node => expect(node.textContent).toBe(value));
        expectArmor('1 ( 3 )');
        const base = snapshot(3);
        const preview = { ...base, locations: base.locations.map(location => ({ ...location,
            previewRemainingInternal: 1,
            armor: location.armor.map(face => ({ ...face, previewRemaining: 2 })),
        })) };
        binding.render(preview);
        expectArmor('1 ( 2/3 )');
        expect(svg.getElementById('textIS_FR')?.textContent).toBe('( 1/2 )');
        binding.render(snapshot(2));
        expectArmor('1 ( 2/3 )');
        binding.render(snapshot(0));
        expectArmor('1 ( 0/3 )');
        binding.render(snapshot(3));
        expectArmor('1 ( 3 )');
        expect(svg.getElementById('textIS_FR')?.textContent).toBe('( 2 )');
        binding.destroy();
    });

    for (const ruleset of [CORE_2026_RULESET, TOTAL_WARFARE_RULESET]) {
        it(`retains normal and boosted vehicle MP through generation, binding and damage in ${ruleset}`, async () => {
            const entity = new TestTankEntity();
            const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
            entity.uuid.set(uuid);
            entity.originalWalkMP.set(5);
            const booster = addTestEquipment(entity, new MiscEquipment({
                id: 'Supercharger', name: 'Supercharger', type: 'misc', flags: ['F_MASC', 'S_SUPERCHARGER'],
            }));
            const unit = createNonMekRuntimeForTest('boosted-vehicle-sheet', {
                entity: uuid, ruleset,
                initialStateProfile: { schemaVersion: 1, initializerRevision: 1, profileId: 'pristine-non-mek-v1' },
            }, entity, ruleset);
            const recordSheet = () => ({ ...projectNonMekRecordSheet(entity, unit.getIndex(), unit.snapshot(), ruleset,
                0, 0, unit.getCrewAssignment()), editContext: { owner: unit, state: unit.snapshot() } });
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
            expect(svg.querySelector('#mpRun')?.textContent).toBe('8 [10]');
            const binding = bindNonMekRecordSheet(svg, recordSheet());
            expect(recordSheet().movement).toEqual({ walk: 5, run: 8, maxRun: 10, jump: 0, umu: 0 });
            expect(svg.querySelector('#mpRun')?.textContent).toBe('8 [10]');

            expect(unit.dispatch({ type: 'set-component-status', componentId: componentIdForMount(booster),
                status: 'destroyed', target: 'committed' }).accepted).toBeTrue();
            binding.render(recordSheet());
            expect(svg.querySelector('#mpRun')?.textContent).toBe('8');
            expect(entity.runMP()).toBe(8);
            expect(entity.maxRunMP()).toBe(10);
            binding.destroy();
        });
    }

    it('preserves generated kilogram units during initial and subsequent identity rendering', () => {
        const svg = sheet();
        const weight = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        weight.id = 'tonnage';
        weight.setAttribute('data-mekbay-field', 'tonnage');
        weight.setAttribute('data-mekbay-weight-unit', 'kg');
        svg.appendChild(weight);
        const initial = { ...snapshot(3), tonnage: 2.5 };
        const binding = bindNonMekRecordSheet(svg, initial);

        expect(weight.textContent).toBe('2,500 kg');
        binding.render({ ...initial, tonnage: 3.25 });
        expect(weight.textContent).toBe('3,250 kg');
        expect(initial.tonnage).toBe(2.5);
        binding.destroy();
    });

    it('opens ammo loadout through the whole profile after rows change and leaves printed profiles inert', () => {
        const svg = sheet();
        const profile = appendRecordSheetAmmoProfile(svg, [], {
            x: 0, y: 60, width: 110, fontSize: 8, lineHeight: 10,
        });
        const interactions: RecordSheetInteraction[] = [];
        const base = ammoSnapshot([['AC/10 Ammo', 20]]);
        const binding = bindNonMekRecordSheet(svg, ammoSnapshot([]), interaction => interactions.push(interaction));
        binding.render(base);
        profile.querySelector('rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions).toEqual([{ kind: 'open-equipment', tab: 'ammo', context: editContext(base.stateRevision)}]);

        const next = { ...ammoSnapshot([['Arrow IV ADA Ammo', 5], ['Arrow IV Fuel-Air Ammo', 5]]), stateRevision: 8, editContext: editContext(8) };
        binding.render(next);
        expect(profile.querySelectorAll('text').length).toBe(2);
        expect(profile.querySelector('rect')!.getAttribute('height')).toBe('20');
        profile.querySelectorAll('text')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        profile.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(interactions.slice(1)).toEqual([
            { kind: 'open-equipment', tab: 'ammo', context: editContext(8)},
            { kind: 'open-equipment', tab: 'ammo', context: editContext(8)},
        ]);

        binding.render(ammoSnapshot([]));
        expect(profile.childElementCount).toBe(0);
        binding.render(base);
        profile.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(interactions.at(-1)).toEqual({ kind: 'open-equipment', tab: 'ammo', context: editContext(base.stateRevision)});
        binding.destroy();
        profile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions.length).toBe(4);
        const printBinding = bindNonMekRecordSheet(svg, base);
        expect(profile.querySelector('rect')).toBeNull();
        expect(profile.hasAttribute('tabindex')).toBeFalse();
        expect(profile.classList.contains('interactive')).toBeFalse();
        printBinding.destroy();
    });

    it('reflows current ammo names and totals without an equipment panel, retaining CASE and empty bins', () => {
        const svg = sheet();
        appendRecordSheetAmmoProfile(svg, [], {
            x: 0, y: 60, width: 200, fontSize: 10, lineHeight: 12, prefix: 'Ammo (CASE):',
        });
        const profile = svg.querySelector<SVGElement>('#ammoProfile')!;
        const binding = bindNonMekRecordSheet(svg, ammoSnapshot([
            ['LRM 15 Ammo', 0],
            ['Arrow IV Fuel-Air Ammo', 5],
            ['AC/10 Precision Ammo', 3],
            ['AC/10 Precision Ammo', 7],
        ]));
        const lines = [...profile.querySelectorAll<SVGTextElement>('text')];
        const text = lines.map(line => line.textContent).join(' ');

        expect(lines.length).toBeGreaterThan(1);
        expect(text).toContain('Ammo (CASE):');
        expect(text).toContain('(AC/10 Precision) 10');
        expect(text).toContain('(Arrow IV Fuel-Air) 5');
        expect(text).toContain('(LRM 15) 0');
        expect(text.match(/\(AC\/10 Precision\)/gu)?.length).toBe(1);
        expect(text.indexOf('(AC/10 Precision)')).toBeLessThan(text.indexOf('(Arrow IV Fuel-Air)'));
        expect(text.indexOf('(Arrow IV Fuel-Air)')).toBeLessThan(text.indexOf('(LRM 15)'));

        binding.render(ammoSnapshot([['AC/10 Ammo', 2]]));
        expect(profile.querySelectorAll('text').length).toBe(1);
        expect(profile.textContent).toBe('Ammo (CASE): (AC/10) 2');

        binding.render(ammoSnapshot([]));
        expect(profile.querySelectorAll('text').length).toBe(0);
        expect(profile.textContent).toBe('');

        binding.render(ammoSnapshot([['AC/10 Precision Ammo', 0]]));
        expect(profile.querySelectorAll('text').length).toBe(1);
        expect(profile.textContent).toBe('Ammo (CASE): (AC/10 Precision) 0');
        binding.destroy();
    });

    it('renders an empty station without stale names, ratings or injury controls', () => {
        const svg = stateSheet();
        svg.insertAdjacentHTML('beforeend', '<g data-mekbay-crew-stations="0"><g class="crew-vacancy crewNameButton" crewId="0"><text>VACANT</text></g></g>');
        const frame = svg.querySelector('[data-mekbay-crew-stations]')!;
        const original = stateSnapshot(1);
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, {
            ...original,
            crew: original.crew.map(position => ({ ...position, name: '', effectiveState: 'vacant' })),
        }, interaction => interactions.push(interaction));
        expect(svg.querySelector('#crewName0')?.textContent).toBe('');
        expect(frame.classList.contains('crew-frame-vacant')).toBeTrue();
        expect(svg.querySelector('#gunnerySkill0')?.textContent).toBe('—');
        expect(svg.querySelector('#pilotingSkill0')?.textContent).toBe('—');
        const marker = svg.querySelector<SVGElement>('.crewHit[hit="2"]')!;
        expect(marker.style.display).toBe('none');
        marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions).toEqual([]);
        frame.querySelector('.crew-vacancy')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions.at(-1)?.kind).toBe('crew-profile');
        binding.render(original);
        expect(frame.classList.contains('crew-frame-vacant')).toBeFalse();
        expect(marker.style.display).toBe('');
        expect(svg.querySelector('#gunnerySkill0')?.textContent).toBe('4');
        binding.destroy();
    });

    it('renders entity damage and emits stable runtime identifiers', () => {
        const svg = sheet();
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, snapshot(2), interaction => interactions.push(interaction));

        expect(svg.querySelectorAll('.armor.pip.damaged').length).toBe(1);
        expect(svg.querySelectorAll('.structure.pip.damaged').length).toBe(0);
        expect(svg.querySelector('#bv')?.textContent).toBe('95 (100)');

        svg.querySelector('.unitLocation.armor')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        svg.querySelector('.unitLocation.structure')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'armor', faceId: FACE_ID, locationId: LOCATION_ID }),
            jasmine.objectContaining({ kind: 'internal', locationId: LOCATION_ID }),
        ]);

        binding.render(snapshot(1));
        expect(svg.querySelectorAll('.armor.pip.damaged').length).toBe(2);
        binding.destroy();
        svg.querySelector('.unitLocation.armor')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions.length).toBe(2);
    });

    it('updates numeric CF and armor cells, retains damage interactions, and accepts their pip-free contract', () => {
        const svg = sheet();
        svg.querySelectorAll('.pip').forEach(pip => pip.remove());
        for (const kind of ['structure', 'armor']) {
            const value = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            value.setAttribute('data-mekbay-protection-value', kind);
            value.setAttribute('data-loc', 'FR');
            svg.appendChild(value);
        }
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, snapshot(2), interaction => interactions.push(interaction));
        const armor = svg.querySelector('[data-mekbay-protection-value="armor"]')!;
        const cf = svg.querySelector('[data-mekbay-protection-value="structure"]')!;
        expect(binding.initialIssues).toEqual([]);
        expect(armor.textContent).toBe('( 2/3 )');
        expect(armor.classList.contains('damaged')).toBeTrue();
        expect(cf.textContent).toBe('( 2 )');
        const damaged = snapshot(0);
        expect(binding.render({ ...damaged, locations: damaged.locations.map(location => ({ ...location,
            remainingInternal: 1, previewRemainingInternal: 1 })) })).toEqual([]);
        expect(armor.textContent).toBe('( 0/3 )');
        expect(cf.textContent).toBe('( 1/2 )');
        svg.querySelector('.unitLocation.armor')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        svg.querySelector('.unitLocation.structure')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'armor', faceId: FACE_ID, locationId: LOCATION_ID }),
            jasmine.objectContaining({ kind: 'internal', locationId: LOCATION_ID }),
        ]);
        binding.render(snapshot(3));
        expect(armor.textContent).toBe('( 3 )');
        expect(cf.textContent).toBe('( 2 )');
        expect(armor.classList.contains('damaged')).toBeFalse();
        expect(cf.classList.contains('damaged')).toBeFalse();
        armor.remove();
        expect(binding.render(snapshot(3))).toContain('Missing armor pips for FR: 0/3');
        binding.destroy();
    });

    it('shows and clears the destroyed overlay from runtime state', () => {
        const svg = sheet();
        const binding = bindNonMekRecordSheet(svg, snapshot(3, true));

        expect(svg.querySelector('#destroyed-overlay')?.textContent).toBe('DESTROYED');
        binding.render(snapshot(3, false));
        expect(svg.querySelector('#destroyed-overlay')).toBeNull();
    });

    it('binds the first Battle Armor pip to the trooper and the remaining pips to armor', () => {
        const svg = combinedSheet();
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, combinedSnapshot(2), interaction => interactions.push(interaction));
        const pips = [...svg.querySelectorAll<SVGElement>('.armor.pip')];

        expect(pips[0].classList.contains('damaged')).toBeFalse();
        expect(pips.slice(1).filter(pip => pip.classList.contains('damaged')).length).toBe(1);
        pips[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        svg.querySelector('.unitLocation.armor')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'internal', locationId: TROOPER_ID }),
            jasmine.objectContaining({ kind: 'armor', faceId: TROOPER_FACE_ID, locationId: TROOPER_ID }),
        ]);

        binding.render(combinedSnapshot(2, 0));
        expect(pips.every(pip => pip.classList.contains('damaged'))).toBeTrue();
    });

    it('binds every overlapping aerospace pip hit area to the same Entity location', () => {
        const svg = hitAreaSheet();
        const interactions: RecordSheetInteraction[] = [];
        bindNonMekRecordSheet(svg, snapshot(3), interaction => interactions.push(interaction));
        const armorTargets = [...svg.querySelectorAll<SVGElement>('.pip-hit-area.armor')];
        const structureTargets = [...svg.querySelectorAll<SVGElement>('.pip-hit-area.structure')];

        expect(armorTargets.every(target => target.dataset['mekbayEntityBound'] === '1')).toBeTrue();
        expect(structureTargets.every(target => target.dataset['mekbayEntityBound'] === '1')).toBeTrue();
        expect([...svg.querySelectorAll<SVGElement>('.pip')]
            .every(pip => pip.style.pointerEvents === 'none')).toBeTrue();
        armorTargets[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        structureTargets[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'armor', faceId: FACE_ID, locationId: LOCATION_ID }),
            jasmine.objectContaining({ kind: 'internal', locationId: LOCATION_ID }),
        ]);
    });

    it('uses authored location zones without letting pips intercept them', () => {
        const svg = sheet();
        bindNonMekRecordSheet(svg, snapshot(3), () => undefined);

        expect([...svg.querySelectorAll<SVGElement>('.pip')]
            .every(pip => pip.style.pointerEvents === 'none')).toBeTrue();
        expect([...svg.querySelectorAll<SVGElement>('.unitLocation')]
            .every(zone => zone.dataset['mekbayEntityBound'] === '1')).toBeTrue();
    });

    it('binds every paperdoll fragment and leaves pips inert even when a location path is missing', () => {
        const svg = sheet();
        svg.setAttribute('data-mekbay-paperdoll', '1');
        svg.querySelector('.unitLocation.structure')?.remove();
        svg.appendChild(svg.querySelector('.unitLocation.armor')!.cloneNode(true));
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, snapshot(3), interaction => interactions.push(interaction));
        const fragments = [...svg.querySelectorAll<SVGElement>('.unitLocation.armor')];
        expect(fragments).toHaveSize(2);
        fragments.forEach(fragment => fragment.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
        expect(interactions.map(interaction => interaction.kind)).toEqual(['armor', 'armor']);
        const pips = [...svg.querySelectorAll<SVGElement>('.pip')];
        expect(pips.every(pip => pip.style.pointerEvents === 'none'
            && pip.dataset['mekbayEntityBound'] === undefined)).toBeTrue();
        pips.forEach(pip => pip.dispatchEvent(new MouseEvent('click')));
        expect(interactions).toHaveSize(2);
        binding.destroy();
        fragments[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(interactions).toHaveSize(2);
    });

    it('activates non-Mek random hits by pointer or keyboard using the current edit context', () => {
        const svg = sheet();
        svg.insertAdjacentHTML('beforeend', '<g data-mekbay-random-hit="1"></g>');
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, snapshot(3), interaction => interactions.push(interaction));
        const button = svg.querySelector<SVGElement>('[data-mekbay-random-hit]')!;
        button.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
        button.dispatchEvent(new PointerEvent('pointerdown', { button: 2 }));
        const current = { ...snapshot(3), editContext: editContext(8) };
        binding.render(current);
        button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        expect(interactions).toEqual([
            { kind: 'random-hit', element: button, context: snapshot(3).editContext },
            { kind: 'random-hit', element: button, context: current.editContext },
        ]);
        binding.destroy();
        button.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
        expect(interactions).toHaveSize(2);
        expect(button.hasAttribute('tabindex')).toBeFalse();
    });

    it('binds front and rear vehicle turret contours to their separate armor faces', () => {
        const svg = sheet();
        svg.innerHTML = '<path class="unitLocation armor" data-loc="FT"></path>'
            + '<path class="unitLocation armor" data-loc="RT"></path>';
        const initial = snapshot(3);
        const locations = ['FT', 'RT'].map(code => ({
            ...initial.locations[0],
            code: code === 'FT' ? 'Front Turret' : 'Rear Turret',
            sheetCode: code,
            locationId: asLocationId(code),
            armor: [{ ...initial.locations[0].armor[0], faceId: asArmorFaceId(`${code}-armor`),
                locationId: asLocationId(code) }],
        }));
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, { ...initial, locations }, interaction => interactions.push(interaction));
        svg.querySelector('[data-loc="RT"]')!.dispatchEvent(new MouseEvent('click'));
        svg.querySelector('[data-loc="FT"]')!.dispatchEvent(new MouseEvent('click'));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'armor', locationId: 'RT', faceId: 'RT-armor' }),
            jasmine.objectContaining({ kind: 'armor', locationId: 'FT', faceId: 'FT-armor' }),
        ]);
        binding.destroy();
    });

    it('binds every pip when an authored sheet has no location zone or hit area', () => {
        const svg = pipOnlySheet();
        const interactions: RecordSheetInteraction[] = [];
        bindNonMekRecordSheet(svg, snapshot(3), interaction => interactions.push(interaction));
        const armor = [...svg.querySelectorAll<SVGElement>('.armor.pip')];
        const structure = [...svg.querySelectorAll<SVGElement>('.structure.pip')];

        expect([...armor, ...structure].every(pip =>
            pip.style.pointerEvents === '' && pip.dataset['mekbayEntityBound'] === '1')).toBeTrue();
        armor[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        structure[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'armor', faceId: FACE_ID, locationId: LOCATION_ID }),
            jasmine.objectContaining({ kind: 'internal', locationId: LOCATION_ID }),
        ]);
    });

    it('marks separate hardened and reinforced halves before and after fresh damage expires', () => {
        jasmine.clock().install();
        const svg = pipOnlySheet();
        const entity = new TestTankEntity();
        entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
            id: 'Hardened', name: 'Hardened', type: 'armor', armor: { type: 'HARDENED' },
        }) }));
        entity.setUniformStructure(new MountedStructure({ tonnage: 50, structure: new StructureEquipment({
            id: 'Reinforced', name: 'Reinforced', type: 'structure', structure: { typeId: 4 },
        }) }));
        applyRecordSheetPipMaterials(svg, entity);
        const initial = snapshot(2);
        const base = { ...initial, locations: initial.locations.map(location => ({
            ...location, maximumInternal: 4, remainingInternal: 4, previewRemainingInternal: 4,
            armor: location.armor.map(face => ({ ...face, maximum: 6, remaining: 5, previewRemaining: 5 })),
        })) };
        const binding = bindNonMekRecordSheet(svg, base, () => undefined);
        try {
            const pips = [...svg.querySelectorAll<SVGElement>('.pip.armor, .pip.structure')];
            expect(pips.length).toBe(10);
            expect(pips.every(pip => pip.tagName === 'polygon' && pip.style.display !== 'none')).toBeTrue();
            expect(svg.querySelectorAll('.half').length).toBe(5);
            expect(svg.querySelectorAll('.armor.pip.damaged').length).toBe(1);
            const pending: NonMekRecordSheetSnapshot = {
                ...base,
                locations: base.locations.map(location => ({
                    ...location,
                    previewRemainingInternal: 3,
                    armor: location.armor.map(face => ({ ...face, previewRemaining: 4 })),
                })),
            };
            binding.render(pending);
            expect(svg.querySelectorAll('.armor.pip.damaged').length).toBe(2);
            expect(svg.querySelectorAll('.structure.pip.damaged').length).toBe(1);
            expect(svg.querySelectorAll('.pip.pending').length).toBe(2);
            expect(svg.querySelectorAll('.pip.fresh').length).toBe(2);

            jasmine.clock().tick(RECORD_SHEET_FRESH_DAMAGE_DURATION_MS);
            expect(svg.querySelectorAll('.armor.pip.damaged').length).toBe(2);
            expect(svg.querySelectorAll('.structure.pip.damaged').length).toBe(1);
            expect(svg.querySelectorAll('.pip.pending').length).toBe(2);
            expect(svg.querySelectorAll('.pip.fresh').length).toBe(0);
            expect(pips.every(pip => pip.style.display !== 'none')).toBeTrue();

            binding.render(pending);
            expect(svg.querySelectorAll('.armor.pip.damaged').length).toBe(2);
            expect(svg.querySelectorAll('.structure.pip.damaged').length).toBe(1);
        } finally {
            binding.destroy();
            jasmine.clock().uninstall();
        }
    });

    it('binds every generated capital block backdrop to its armor or integrity location', async () => {
        const entity = new testEntities.TestWarShipEntity();
        entity.setArmorValue('Nose', 'front', 101);
        entity.structuralIntegrity.set(150);
        const svg = await RecordSheetSvgGenerator.generate(entity);
        const locations = entity.damageLocations().map(location => ({
            locationId: asLocationId(location.code), code: location.code, sheetCode: location.sheetCode ?? location.code,
            maximumInternal: location.internalPoints, remainingInternal: location.internalPoints,
            previewRemainingInternal: location.internalPoints,
            armor: [{ faceId: asArmorFaceId(location.code), locationId: asLocationId(location.code), face: 'front' as const,
                maximum: location.armor.front, remaining: location.armor.front, previewRemaining: location.armor.front }],
        }));
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, { ...snapshot(3), locations }, interaction => interactions.push(interaction));
        const backdrops = [...svg.querySelectorAll<SVGElement>('.capital-pip-backdrop')];
        expect(backdrops.length).toBeGreaterThan(2);
        for (const backdrop of backdrops) {
            const location = locations.find(location => location.sheetCode === backdrop.getAttribute('data-loc'))!;
            expect(backdrop.dataset['mekbayEntityBound']).toBe('1');
            backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(interactions.at(-1)).toEqual(jasmine.objectContaining({
                kind: backdrop.classList.contains('armor') ? 'armor' : 'internal',
                locationId: location.locationId,
            }));
        }
        expect(interactions.length).toBe(backdrops.length);
        expect(svg.querySelector('.capital-pip-grid[data-mekbay-entity-bound], .capital-pip-state[data-mekbay-entity-bound]')).toBeNull();
        binding.destroy();
    });

    it('keeps dense capital paperdoll blocks inert when a location contour is missing', () => {
        const svg = capitalGridSheet();
        svg.setAttribute('data-mekbay-paperdoll', '1');
        svg.querySelector('.unitLocation')!.classList.remove('unitLocation');
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, capitalSnapshot(5_999), interaction => interactions.push(interaction));
        const targets = [...svg.querySelectorAll<SVGElement>('.capital-pip-interaction')];
        expect(targets).not.toHaveSize(0);
        expect(targets.every(target => target.style.pointerEvents === 'none'
            && target.dataset['mekbayEntityBound'] === undefined)).toBeTrue();
        targets[0].dispatchEvent(new MouseEvent('click'));
        expect(interactions).toEqual([]);
        binding.destroy();
    });

    it('binds the capital location while rendering its dense pip blocks without listeners', () => {
        const svg = capitalGridSheet();
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(
            svg,
            capitalSnapshot(5_999),
            interaction => interactions.push(interaction),
        );
        const grid = svg.querySelector<SVGElement>('.capital-pip-grid')!;
        const region = svg.querySelector<SVGElement>('.unitLocation.armor')!;
        const backing = svg.querySelector<SVGElement>('.capital-grid-backing')!;
        const targets = [...svg.querySelectorAll<SVGElement>('.capital-pip-interaction')];
        const path = (className: string): string =>
            svg.querySelector(`.${className}`)?.getAttribute('d') ?? '';

        expect(targets.length).toBe(60);
        expect(targets.every(target => target.dataset['mekbayEntityBound'] === undefined
            && target.style.pointerEvents === 'none')).toBeTrue();
        expect(targets.every(target => target.style.fill === 'transparent'
            && target.style.getPropertyPriority('fill') === 'important')).toBeTrue();
        expect(grid.dataset['mekbayEntityBound']).toBeUndefined();
        expect(region.dataset['mekbayEntityBound']).toBe('1');
        expect(svg.querySelectorAll('.pip').length).toBe(0);
        expect(path('capital-pip-state-damaged')).not.toBe('');

        expect(binding.render(capitalSnapshot(5_999, 5_997))).toEqual([]);
        expect(path('capital-pip-state-fresh-damage')).not.toBe('');
        expect(path('capital-pip-state-pending-damage')).toBe('');

        expect(binding.render(capitalSnapshot(5_999, 5_997))).toEqual([]);
        expect(path('capital-pip-state-fresh-damage')).not.toBe('');
        expect(path('capital-pip-state-pending-damage')).toBe('');

        expect(binding.render(capitalSnapshot(5_997, 5_999))).toEqual([]);
        expect(path('capital-pip-state-fresh-repair')).not.toBe('');
        expect(path('capital-pip-state-pending-repair')).toBe('');

        backing.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'armor', faceId: FACE_ID, locationId: LOCATION_ID }),
        ]);
    });

    it('renders toggle, counted motive, and VTOL rotor damage-track previews exactly', () => {
        const svg = criticalSheet();
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(
            svg,
            criticalSnapshot(0, 1, 2, 3, 2, 3),
            interaction => interactions.push(interaction),
        );
        const generic = svg.querySelector<SVGElement>('.critLoc[critId="engine"]')!;
        const motive = svg.querySelector<SVGElement>('.critLoc[critId="motive"]')!;
        const motivePips = [...svg.querySelectorAll<SVGElement>('.motiveHitPip')];
        const rotor = svg.querySelector<SVGElement>('.critLoc[critId="rotor"]')!;

        expect(generic.classList.contains('damaged')).toBeFalse();
        expect(generic.classList.contains('willChange')).toBeTrue();
        expect(motive.classList.contains('damaged')).toBeTrue();
        expect(motivePips.map(pip => ({
            damaged: pip.classList.contains('damaged'),
            pending: pip.classList.contains('willChange'),
            hidden: pip.classList.contains('hidden'),
        }))).toEqual([
            { damaged: true, pending: false, hidden: false },
            { damaged: true, pending: false, hidden: false },
            { damaged: false, pending: true, hidden: false },
            { damaged: false, pending: false, hidden: true },
        ]);
        expect(rotor.classList.contains('rotorHitsDamaged')).toBeTrue();
        expect(rotor.classList.contains('rotorHitsPendingPositive')).toBeTrue();
        expect(svg.querySelector('.rotorHitsCommitted')?.textContent).toBe('2');
        expect(svg.querySelector('.rotorHitsPending.positive')?.textContent).toBe('+1');

        binding.render(criticalSnapshot(1, 1, 2, 1, 2, 1));
        expect(generic.classList.contains('damaged')).toBeTrue();
        expect(generic.classList.contains('willChange')).toBeFalse();
        expect(motivePips[1].classList.contains('damaged')).toBeTrue();
        expect(motivePips[1].classList.contains('willChange')).toBeTrue();
        expect(motivePips[1].classList.contains('pendingRemoval')).toBeTrue();
        expect(rotor.classList.contains('rotorHitsPendingPositive')).toBeFalse();
        expect(rotor.classList.contains('rotorHitsPendingNegative')).toBeTrue();
        expect(svg.querySelector('.rotorHitsPending.negative')?.textContent).toBe('-1');

        motive.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions.at(-1)).toEqual(jasmine.objectContaining({
            kind: 'damage-track',
            damageTrackId: MOTIVE_DAMAGE_TRACK_ID,
        }));
    });

    it('renders conventional infantry with the generated aggregate-strength controls', () => {
        const svg = soldierSheet();
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, soldierSnapshot(3), interaction => interactions.push(interaction));

        const cells = [...svg.querySelectorAll('.infantry-strength-cell')];
        expect(cells.length).toBe(INFANTRY_STRENGTH_CELL_COUNT);
        expect(cells.at(-4)!.querySelector('.infantry-strength-committed')).not.toBeNull();
        expect(cells.at(-3)!.querySelector('.infantry-strength-alive')).not.toBeNull();
        expect(cells.at(-4)!.querySelector('.disabled-text')).not.toBeNull();
        cells.at(-2)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'infantry-strength', locationId: INFANTRY_ID, strength: 2 }),
        ]);
        expect(svg.querySelector('[soldier-id]')).toBeNull();

        binding.render(soldierSnapshot(2));
        expect(cells.at(-3)!.querySelector('.infantry-strength-fresh')).not.toBeNull();
        expect(binding.render(soldierSnapshot(2))).not.toContain('Missing crew layout');
        binding.destroy();
    });

    it('renders and binds the shared vehicle condition and crew controls', () => {
        const svg = stateSheet();
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, stateSnapshot(1), interaction => interactions.push(interaction));

        expect(svg.querySelector('.unitConditionBanner[condition="tagged"]')?.getAttribute('display')).toBe('');
        expect(svg.querySelector('.unitConditionBanner[condition="abandoned"]')?.getAttribute('display')).toBe('');
        expect(svg.querySelector('.crewStateButton')?.classList.contains('active')).toBeTrue();
        expect(svg.querySelector('.crewStateBanner')?.textContent).toContain('CREW KILLED');
        expect(svg.querySelectorAll('.crewHit.damaged').length).toBe(1);
        expect(svg.querySelector('#crewName0')?.textContent).toBe('Crew 1');
        expect(svg.querySelector('#gunnerySkill0')?.textContent).toBe('4');
        expect(svg.querySelector('#pilotingSkill0')?.textContent).toBe('5');

        svg.querySelector('.unitConditionButton[condition="menu"]')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        svg.querySelector('.unitConditionButton[condition="disconnected"]')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        svg.querySelector('.crewHit[hit="2"]')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        svg.querySelector('.crewStateButton')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        svg.querySelector('.crewNameButton')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'condition-menu' }),
            jasmine.objectContaining({ kind: 'condition', condition: 'disconnected' }),
            jasmine.objectContaining({ kind: 'crew-wounds', positionId: CREW_ID, wounds: 2 }),
            jasmine.objectContaining({ kind: 'crew-state-menu', positionId: CREW_ID }),
            jasmine.objectContaining({ kind: 'crew-profile', positionId: CREW_ID }),
        ]);

        binding.render(stateSnapshot(2));
        expect(svg.querySelectorAll('.crewHit.damaged').length).toBe(2);
    });

    it('renders and binds aerospace heat and active heat sinks', () => {
        const svg = heatSheet();
        const interactions: RecordSheetInteraction[] = [];
        bindNonMekRecordSheet(svg, heatSnapshot(), interaction => interactions.push(interaction));

        expect(svg.querySelectorAll('#heatScale .heat.hot').length).toBe(3);
        expect(svg.querySelector('#heatDataPanel')?.classList.contains('dirtyHeat')).toBeTrue();
        expect(svg.querySelectorAll('.hsPips .pip.disabled').length).toBe(2);
        expect(svg.querySelector('#hsCount')?.textContent).toBe('10 (16)');

        svg.querySelector('#heatScale .heat[heat="5"]')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        svg.querySelector('#applyHeatButton')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        svg.querySelector('.hsPips')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'heat', heat: 5 }),
            jasmine.objectContaining({ kind: 'apply-heat' }),
            jasmine.objectContaining({ kind: 'heat-sinks-off' }),
        ]);
    });

    it('binds generated non-Mek weapon rows to stable component IDs', () => {
        const svg = inventorySheet();
        const interactions: RecordSheetInteraction[] = [];
        const componentId = asComponentId('weapon-1');
        const recordSheet = Object.freeze({
            ...snapshot(3),
            components: Object.freeze([Object.freeze({
                componentId,
                equipmentId: 'weapon',
                label: 'AC/5',
                sheetLocations: Object.freeze(['FR']),
                status: 'available' as const,
                previewStatus: 'available' as const,
            })]),
        });
        const equipmentPanel = {
            stateRevision: 4, editContext: editContext(4),
            targetRegistryRevision: 1,
            crew: { gunnery: 4, piloting: 5 },
            targets: [],
            components: [{
                componentId,
                label: 'AC/5',
                locations: [],
                status: 'available',
                previewStatus: 'available',
                modes: [],
                jammed: false,
                weapon: { selectable: true, selection: undefined },
            }],
        } as unknown as EquipmentPanelSnapshot;

        bindNonMekRecordSheet(
            svg,
            recordSheet,
            interaction => interactions.push(interaction),
            equipmentPanel,
        );
        svg.querySelector('.mainButton')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(svg.querySelector('.mainButton')?.getAttribute('data-mekbay-entity-bound')).toBe('1');
        expect(interactions).toEqual([jasmine.objectContaining({
            kind: 'inventory-selection',
            componentIds: [componentId],
            context: editContext(4),
        })]);

        const unboundSvg = inventorySheet();
        const unboundRow = unboundSvg.querySelector('.inventoryEntry')!;
        unboundRow.removeAttribute('data-mekbay-component-ids');
        unboundRow.id = 'weapon@0';
        bindNonMekRecordSheet(unboundSvg, recordSheet, interaction => interactions.push(interaction), equipmentPanel);
        unboundSvg.querySelector('.mainButton')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions.length).toBe(1);
    });

    for (const [ammoType, minRange, ranges] of [
        ['LRM', 6, [7, 14, 21, 28]], ['MML', 6, [7, 14, 21, 28]], ['ATM', 4, [5, 10, 15, 20]],
    ] as const) {
        it(`refreshes vehicle ${ammoType} minimum range when the selected hot-loaded bin or optional rule changes`, async () => {
            const normalMinimum = String(minRange);
            const ammo = new AmmoEquipment({ id: `${ammoType}Ammo`, name: `${ammoType} Ammo`, type: 'ammo',
                flags: ammoType === 'MML' ? ['F_HOT_LOAD', 'F_MML_LRM'] : ['F_HOT_LOAD'],
                ammo: { type: ammoType, rackSize: 10, shots: 12, damagePerShot: 1, munitionType: ['M_STANDARD'] } });
            const launcher = new WeaponEquipment({ id: `${ammoType}10`, name: `${ammoType} 10`, type: 'weapon', flags: ['F_MISSILE'],
                weapon: { ammoType, rackSize: 10, minRange, ranges: [...ranges] } });
            const entity = new TestTankEntity(createTestEquipmentRegistry({ [ammo.id]: ammo, [launcher.id]: launcher }));
            const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
            entity.uuid.set(uuid);
            entity.setTonnage(100);
            const weaponId = componentIdForMount(addTestEquipment(entity, launcher, { location: entity.locationOrder[0] }));
            const ammoId = componentIdForMount(addTestEquipment(entity, ammo, { shotsCount: 12 }));
            const coldAmmoId = componentIdForMount(addTestEquipment(entity, ammo, { shotsCount: 12 }));
            const unit = createNonMekUnit(entity, { instanceId: 'hot-load-vehicle', uuid,
                scenario: { id: 'megamek', options: { hotLoadedAmmo: true } }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
            const recordSheet = () => ({ ...projectNonMekRecordSheet(entity, unit.getIndex(), unit.snapshot(), unit.ruleset(),
                0, 0, unit.getCrewAssignment()), editContext: { owner: unit, state: unit.snapshot() } });
            const panel = (enabled = true) => projectNonMekEquipmentPanel(entity, unit.getIndex(), unit.ruleset(), unit.snapshot(),
                unit.getCrewAssignment(), emptyCBTEncounterSnapshot(), true, enabled);
            const svg = await RecordSheetSvgGenerator.generate(entity);
            const row = svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${weaponId}"]`)!;
            const values = ammoType === 'LRM' ? row : row.querySelector('.alternativeMode')!;
            const minimum = values.querySelector('.range_min')!;
            const binding = bindNonMekRecordSheet(svg, recordSheet(), undefined, panel());
            expect(minimum.textContent).toBe(normalMinimum);

            unit.dispatch({ type: 'configure-ammo-source', componentId: ammoId, munitionKey: ammo.id, remaining: 12, hotLoaded: true });
            binding.render(recordSheet(), panel());
            expect(minimum.textContent).toBe('—');
            expect(['short', 'medium', 'long'].map(range => values.querySelector(`.range_${range}`)!.textContent))
                .toEqual(ranges.slice(0, 3).map(String));

            for (const [sourceId, expected] of [[coldAmmoId, normalMinimum], [ammoId, '—']] as const) {
                unit.installAttackerTargetingSessionState({ ...unit.query().attackerTargetingState(),
                    components: new Map([[weaponId, { ammo: { munitionKey: ammo.id, preferredSourceId: sourceId } }]]) });
                binding.render(recordSheet(), panel());
                expect(minimum.textContent).toBe(expected);
            }
            binding.render(recordSheet(), panel(false));
            expect(minimum.textContent).toBe(normalMinimum);
            binding.render(recordSheet(), panel());
            expect(minimum.textContent).toBe('—');

            expect(unit.dispatch({ type: 'configure-ammo-source', componentId: ammoId,
                munitionKey: ammo.id, remaining: 0 }).changed).toBeTrue();
            expect(unit.query().remainingAmmo(ammoId)).toBe(0);
            expect(unit.query().ammoHotLoaded(ammoId)).toBeTrue();
            binding.render(recordSheet(), panel());
            expect(minimum.textContent).toBe(normalMinimum);
            unit.dispatch({ type: 'configure-ammo-source', componentId: ammoId, munitionKey: ammo.id, remaining: 12, hotLoaded: false });
            binding.render(recordSheet(), panel());
            expect(minimum.textContent).toBe(normalMinimum);
            if (ammoType !== 'LRM') {
                unit.dispatch({ type: 'configure-ammo-source', componentId: ammoId, munitionKey: ammo.id, remaining: 12, hotLoaded: true });
                binding.render(recordSheet(), panel());
                expect(minimum.textContent).toBe('—');
                unit.dispatch({ type: 'set-component-mode', componentId: weaponId,
                    mode: ammoType === 'MML' ? 'SRM' : 'Extended Range' });
                binding.render(recordSheet(), panel());
                expect(minimum.textContent).toBe(normalMinimum);
                expect(row.querySelector(':scope > .range_min')!.textContent).toBe('');
            }
            binding.destroy();
        });
    }

    it('aggregates generated bay-row status directly from its stable component IDs', () => {
        const svg = groupedInventorySheet();
        const firstId = asComponentId('weapon-1');
        const secondId = asComponentId('weapon-2');
        const component = (
            componentId: typeof firstId,
            status: 'available' | 'destroyed',
            previewStatus: 'available' | 'destroyed',
        ) => Object.freeze({
            componentId,
            equipmentId: 'weapon',
            label: 'Large Laser',
            sheetLocations: Object.freeze(['FR']),
            status,
            previewStatus,
        });
        const recordSheet = (bothDestroyed: boolean) => Object.freeze({
            ...snapshot(3),
            components: Object.freeze([
                component(firstId, 'destroyed', 'destroyed'),
                component(
                    secondId,
                    bothDestroyed ? 'destroyed' : 'available',
                    bothDestroyed ? 'destroyed' : 'destroyed',
                ),
            ]),
        });
        const binding = bindNonMekRecordSheet(svg, recordSheet(false));
        const row = svg.querySelector<SVGElement>('.inventoryEntry')!;

        expect(row.classList.contains('disabledInventory')).toBeFalse();
        expect(row.classList.contains('pending')).toBeTrue();

        binding.render(recordSheet(true));
        expect(row.classList.contains('damaged')).toBeTrue();
        expect(row.classList.contains('disabledInventory')).toBeFalse();
        expect(row.classList.contains('pending')).toBeFalse();
    });

    it('binds a derived weapon bay only once when legacy rows name separate members', () => {
        const svg = duplicateInventorySheet();
        const interactions: RecordSheetInteraction[] = [];
        const firstId = asComponentId('weapon-1');
        const secondId = asComponentId('weapon-2');
        const recordSheet = Object.freeze({
            ...snapshot(3),
            components: Object.freeze([firstId, secondId].map(componentId => Object.freeze({
                componentId,
                equipmentId: 'weapon',
                label: 'Large Laser',
                sheetLocations: Object.freeze(['FR']),
                status: 'available' as const,
                previewStatus: 'available' as const,
            }))),
        });
        const equipmentPanel = {
            stateRevision: 4, editContext: editContext(4),
            targetRegistryRevision: 1,
            crew: { gunnery: 4, piloting: 5 },
            targets: [],
            components: [{
                componentId: firstId,
                label: 'Large Laser Bay',
                locations: [],
                status: 'available',
                previewStatus: 'available',
                modes: [],
                jammed: false,
                attack: {
                    kind: 'weapon-bay',
                    source: 'synthetic-bay',
                    members: [firstId, secondId].map(componentId => ({
                        componentId,
                        selectable: true,
                        ammoSources: [],
                    })),
                },
                weapon: { selectable: true, selection: undefined },
            }],
        } as unknown as EquipmentPanelSnapshot;

        bindNonMekRecordSheet(svg, recordSheet, interaction => interactions.push(interaction), equipmentPanel);
        const buttons = svg.querySelectorAll<SVGElement>('.mainButton');
        buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(buttons[0]?.getAttribute('data-mekbay-entity-bound')).toBe('1');
        expect(buttons[1]?.hasAttribute('data-mekbay-entity-bound')).toBeFalse();
        expect(interactions).toEqual([jasmine.objectContaining({
            kind: 'inventory-selection',
            componentIds: [firstId, secondId],
        })]);
    });

    it('binds generated alternative-mode rows with the authoritative component mode', () => {
        const svg = modeInventorySheet();
        const interactions: RecordSheetInteraction[] = [];
        const componentId = asComponentId('weapon-1');
        const recordSheet = Object.freeze({
            ...snapshot(3),
            components: Object.freeze([Object.freeze({
                componentId,
                equipmentId: 'weapon',
                label: 'MML 7',
                sheetLocations: Object.freeze(['FR']),
                status: 'available' as const,
                previewStatus: 'available' as const,
            })]),
        });
        const equipmentPanel = {
            stateRevision: 4, editContext: editContext(4),
            targetRegistryRevision: 1,
            crew: { gunnery: 4, piloting: 5 },
            targets: [],
            components: [{
                componentId,
                label: 'MML 7',
                locations: [],
                status: 'available',
                previewStatus: 'available',
                modes: ['LRM', 'SRM'],
                mode: 'LRM',
                jammed: false,
                weapon: { selectable: true, selection: undefined },
            }],
        } as unknown as EquipmentPanelSnapshot;

        bindNonMekRecordSheet(svg, recordSheet, interaction => interactions.push(interaction), equipmentPanel);
        expect(svg.querySelector('.alternativeMode')?.classList.contains('selected')).toBeTrue();
        svg.querySelectorAll('.alternativeModeButton')[1]
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(interactions).toEqual([jasmine.objectContaining({
            kind: 'inventory-selection',
            componentIds: [componentId],
            mode: 'SRM',
            context: editContext(4),
        })]);
    });
});

const LOCATION_ID = asLocationId('location:Front');
const FACE_ID = asArmorFaceId(`armor:${LOCATION_ID}:front`);
const TROOPER_ID = asLocationId('location:Trooper 1');
const TROOPER_FACE_ID = asArmorFaceId(`armor:${TROOPER_ID}:front`);
const INFANTRY_ID = asLocationId('location:Infantry');
const CREW_ID = asCrewPositionId('crew:vehicle:0');
const ENGINE_DAMAGE_TRACK_ID = asSystemDamageTrackId('damage-track:engine');
const MOTIVE_DAMAGE_TRACK_ID = asSystemDamageTrackId('damage-track:motive');
const ROTOR_DAMAGE_TRACK_ID = asSystemDamageTrackId('damage-track:rotor');

function ammoSnapshot(ammunition: readonly (readonly [string, number])[]): NonMekRecordSheetSnapshot {
    return {
        ...snapshot(3),
        components: ammunition.map(([displayName, remaining], index) => ({
            componentId: asComponentId(`ammo-${index}`),
            equipmentId: `standard-ammo-${index}`,
            label: 'Standard Ammo',
            sheetLocations: ['FR'],
            status: 'available' as const,
            previewStatus: 'available' as const,
            ammo: { displayName, remaining, capacity: 20 },
        })),
    };
}

function snapshot(remaining: number, destroyed = false): NonMekRecordSheetSnapshot {
    return Object.freeze({
        entityUuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1'),
        stateRevision: 4, editContext: editContext(4),
        displayName: 'Test Tank T-1',
        unitType: 'Tank',
        subtype: 'Combat Vehicle',
        tonnage: 20,
        year: 3050,
        techBase: 'IS',
        role: 'Brawler',
        movementType: 'Tracked',
        movementSelection: Object.freeze({ selectedMode: null, airborne: false, options: Object.freeze([
            { mode: 'stationary' as const, modifier: 0, legal: true, minimumMp: 0 },
            { mode: 'walk' as const, modifier: 1, legal: true, minimumMp: 0 },
            { mode: 'run' as const, modifier: 2, legal: true, minimumMp: 0 },
        ]) }),
        movement: Object.freeze({ walk: 5, run: 8, maxRun: 8, jump: 0, umu: 0 }),
        armorType: 'Standard',
        structureType: 'Standard',
        crewSize: 1,
        crew: Object.freeze([]),
        conditions: Object.freeze([]),
        conditionControlKeys: Object.freeze([]),
        crewStateControlKeys: Object.freeze([]),
        crewStateDisplayKeys: Object.freeze([]),
        destroyed,
        heat: Object.freeze({
            tracked: false,
            current: 0,
            pending: null,
            heatsinksOff: 0,
            heatSinkCount: 0,
            dissipation: 0,
            effects: Object.freeze({ fireModifier: 0 }),
        }),
        currentBattleValue: 95,
        pristineBattleValue: 100,
        locations: Object.freeze([Object.freeze({
            locationId: LOCATION_ID,
            code: 'Front',
            sheetCode: 'FR',
            maximumInternal: 2,
            remainingInternal: 2,
            previewRemainingInternal: 2,
            armor: Object.freeze([Object.freeze({
                faceId: FACE_ID,
                locationId: LOCATION_ID,
                face: 'front' as const,
                maximum: 3,
                remaining,
                previewRemaining: remaining,
            })]),
        })]),
        components: Object.freeze([]),
        damageTracks: Object.freeze([]),
    });
}

function heatSnapshot(): NonMekRecordSheetSnapshot {
    return Object.freeze({
        ...snapshot(3),
        unitType: 'Aero',
        heat: Object.freeze({
            tracked: true,
            current: 5,
            pending: 8,
            heatsinksOff: 2,
            heatSinkCount: 10,
            dissipation: 16,
            effects: Object.freeze({ fireModifier: 1, randomMovementTarget: 5 }),
        }),
    });
}

function capitalSnapshot(
    remaining: number,
    previewRemaining = remaining,
): NonMekRecordSheetSnapshot {
    const base = snapshot(3);
    const location = base.locations[0];
    const face = location.armor[0];
    return Object.freeze({
        ...base,
        locations: Object.freeze([Object.freeze({
            ...location,
            maximumInternal: 0,
            remainingInternal: 0,
            previewRemainingInternal: 0,
            armor: Object.freeze([Object.freeze({
                ...face,
                maximum: 6_000,
                remaining,
                previewRemaining,
            })]),
        })]),
    });
}

function criticalSnapshot(
    engineCommitted: number,
    enginePreview: number,
    motiveCommitted: number,
    motivePreview: number,
    rotorCommitted: number,
    rotorPreview: number,
): NonMekRecordSheetSnapshot {
    const damageTrack = (
        damageTrackId: ReturnType<typeof asSystemDamageTrackId>,
        sheetId: 'engine' | 'motive' | 'rotor',
        committedHits: number,
        previewHits: number,
        visibleHitPips?: number,
    ) => Object.freeze({
        damageTrackId,
        system: sheetId,
        sheetId,
        label: sheetId,
        maximumHits: visibleHitPips ?? 1,
        ...(visibleHitPips === undefined ? {} : { visibleHitPips }),
        committedHits,
        previewHits,
        committedHitTimestamps: Object.freeze([]),
        pendingHitTimestamps: Object.freeze([]),
    });
    return Object.freeze({
        ...snapshot(3),
        damageTracks: Object.freeze([
            damageTrack(ENGINE_DAMAGE_TRACK_ID, 'engine', engineCommitted, enginePreview),
            damageTrack(MOTIVE_DAMAGE_TRACK_ID, 'motive', motiveCommitted, motivePreview, 4),
            damageTrack(ROTOR_DAMAGE_TRACK_ID, 'rotor', rotorCommitted, rotorPreview),
        ]),
    });
}

function stateSnapshot(wounds: number): NonMekRecordSheetSnapshot {
    return Object.freeze({
        ...snapshot(3),
        conditions: Object.freeze(['tagged', 'abandoned'] as const),
        conditionControlKeys: Object.freeze(['tagged', 'disconnected'] as const),
        crewStateControlKeys: Object.freeze(['killed', 'stunned'] as const),
        crewStateDisplayKeys: Object.freeze(['killed', 'stunned'] as const),
        crew: Object.freeze([Object.freeze({
            positionId: CREW_ID,
            occurrence: 0,
            name: 'Crew 1',
            gunnery: 4,
            piloting: 5,
            state: Object.freeze({ wounds, unconscious: false, ejected: false, dead: true as const }),
            effectiveState: 'killed' as const,
        })]),
    });
}

function combinedSnapshot(remainingArmor: number, remainingInternal = 1): NonMekRecordSheetSnapshot {
    return Object.freeze({
        ...snapshot(3),
        unitType: 'Infantry',
        locations: Object.freeze([Object.freeze({
            locationId: TROOPER_ID,
            code: 'Trooper 1',
            sheetCode: 'T1',
            combinedPips: true,
            maximumInternal: 1,
            remainingInternal,
            previewRemainingInternal: remainingInternal,
            armor: Object.freeze([Object.freeze({
                faceId: TROOPER_FACE_ID,
                locationId: TROOPER_ID,
                face: 'front' as const,
                maximum: 3,
                remaining: remainingArmor,
                previewRemaining: remainingArmor,
            })]),
        })]),
    });
}

function soldierSnapshot(remainingInternal: number): NonMekRecordSheetSnapshot {
    return Object.freeze({
        ...snapshot(3),
        unitType: 'Infantry',
        locations: Object.freeze([Object.freeze({
            locationId: INFANTRY_ID,
            code: 'Infantry',
            sheetCode: '',
            soldierPips: true,
            maximumInternal: 4,
            remainingInternal,
            previewRemainingInternal: remainingInternal,
            armor: Object.freeze([]),
        })]),
    });
}

function sheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <text id="type"></text><text id="bv"></text>
        <g class="unitLocation armor" data-loc="FR"></g>
        <circle class="pip armor" data-loc="FR"></circle>
        <circle class="pip armor" data-loc="FR"></circle>
        <circle class="pip armor" data-loc="FR"></circle>
        <g class="unitLocation structure" data-loc="FR"></g>
        <circle class="pip structure" data-loc="FR"></circle>
        <circle class="pip structure" data-loc="FR"></circle>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function combinedSheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g class="unitLocation armor" data-loc="T1"></g>
        <circle class="pip armor" data-loc="T1"></circle>
        <circle class="pip armor" data-loc="T1"></circle>
        <circle class="pip armor" data-loc="T1"></circle>
        <circle class="pip armor" data-loc="T1"></circle>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function hitAreaSheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <circle class="pip armor" data-loc="FR"></circle>
        <circle class="pip armor" data-loc="FR"></circle>
        <circle class="pip armor" data-loc="FR"></circle>
        <circle class="pip-hit-area armor" data-loc="FR"></circle>
        <circle class="pip-hit-area armor" data-loc="FR"></circle>
        <circle class="pip structure" data-loc="FR"></circle>
        <circle class="pip structure" data-loc="FR"></circle>
        <circle class="pip-hit-area structure" data-loc="FR"></circle>
        <circle class="pip-hit-area structure" data-loc="FR"></circle>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function pipOnlySheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <circle class="pip armor" data-loc="FR"></circle>
        <circle class="pip armor" data-loc="FR"></circle>
        <circle class="pip armor" data-loc="FR"></circle>
        <circle class="pip structure" data-loc="FR"></circle>
        <circle class="pip structure" data-loc="FR"></circle>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function capitalGridSheet(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const region = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    region.setAttribute('class', 'unitLocation armor');
    region.setAttribute('data-loc', 'FR');
    const backing = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    backing.setAttribute('class', 'capital-grid-backing');
    backing.setAttribute('width', '1000');
    backing.setAttribute('height', '500');
    region.appendChild(backing);
    region.appendChild(CapitalShipPipRenderer.createPips(6_000, 1_000, 500, 'armor', 'FR')!);
    svg.appendChild(region);
    return optimizeGeneratedSvg(svg);
}

function criticalSheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g class="critLoc" critId="engine"><rect></rect></g>
        <g><g class="critLoc" critId="motive"><rect></rect></g>
            <g id="motive_pips" class="motiveHitPips">
                <circle class="motiveHitPip"></circle><circle class="motiveHitPip"></circle>
                <circle class="motiveHitPip"></circle><circle class="motiveHitPip"></circle>
            </g>
        </g>
        <g id="rotor_hits_group" class="critLoc" critId="rotor">
            <rect></rect><text id="rotor_hits_counter"></text>
        </g>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function heatSheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g id="heatScale">
            <rect class="heat" heat="0"></rect>
            <rect class="heat" heat="5"></rect>
            <rect class="heat" heat="8"></rect>
            <rect class="overflowFrame"></rect>
            <text class="overflowText"></text>
        </g>
        <g id="heatDataPanel"><g id="applyHeatButton"></g></g>
        <text id="hsCount"></text>
        <g class="hsPips">
            ${Array.from({ length: 10 }, () => '<circle class="pip"></circle>').join('')}
        </g>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function inventorySheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g class="inventoryEntry" id="generated-vehicle-inventory-row@0" data-mekbay-component-ids="weapon-1">
            <rect class="inventoryEntryButton mainButton"></rect>
            <text class="name">AC/5</text><text class="location">FR</text>
            <rect class="hitMod-rect" display="none"></rect><text class="hitMod-text" display="none"></text>
            <rect class="targetTn-rect" display="none"></rect><text class="targetTn-text" display="none"></text>
        </g>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function duplicateInventorySheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g class="inventoryEntry" id="generated-aero-inventory-row@0" data-mekbay-component-ids="weapon-1">
            <rect class="inventoryEntryButton mainButton"></rect>
        </g>
        <g class="inventoryEntry" id="generated-aero-inventory-row@1" data-mekbay-component-ids="weapon-2">
            <rect class="inventoryEntryButton mainButton"></rect>
        </g>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function groupedInventorySheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g class="inventoryEntry" id="weapon@0" data-mekbay-component-ids="weapon-1 weapon-2">
            <text class="location">FR</text>
        </g>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function modeInventorySheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g class="inventoryEntry" id="generated-vehicle-inventory-row@0" data-mekbay-component-ids="weapon-1">
            <rect class="inventoryEntryButton mainButton"></rect>
            <g class="alternativeMode"><rect class="inventoryEntryButton alternativeModeButton"></rect></g>
            <g class="alternativeMode"><rect class="inventoryEntryButton alternativeModeButton"></rect></g>
        </g>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function soldierSheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g id="infantryStrengthDisplay"></g>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function stateSheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g class="unitConditionButton" condition="menu"><rect></rect><text>...</text></g>
        <g class="unitConditionButton" condition="disconnected"><rect></rect><text>UNLINK</text></g>
        <g class="unitConditionBanner" condition="tagged"><rect class="unitConditionBannerRect" height="15"></rect><text class="unitConditionBannerText"></text></g>
        <g class="unitConditionBanner" condition="abandoned"><rect class="unitConditionBannerRect" height="15"></rect><text class="unitConditionBannerText"></text></g>
        <circle class="crewHit" crewId="0" hit="1"></circle>
        <circle class="crewHit" crewId="0" hit="2"></circle>
        <text id="crewName0"></text><rect class="crewNameButton" crewId="0" textElement="crewName0"></rect>
        <text id="gunnerySkill0"></text><rect class="crewSkillButton" crewId="0" skill="gunnery"></rect>
        <text id="pilotingSkill0"></text><rect class="crewSkillButton" crewId="0" skill="piloting"></rect>
        <g class="crewStateButton" crewId="0"><rect></rect><text>...</text></g>
        <g class="crewStateBanner" crewId="0"><rect class="unitConditionBannerRect"></rect><text class="unitConditionBannerText"></text></g>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}
