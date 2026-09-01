// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { bindMekRecordSheet, type MekRecordSheetInteraction } from './mek-record-sheet-binder';
import type { MekRecordSheetSnapshot } from '../../models/runtime/mek-record-sheet';
import { MM_DATA_MEK_SHEET_BINDING_MANIFEST } from '../../models/mek-sheet-binding';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { asComponentId, asCriticalSlotId, asLocationId } from '../../models/entity/entity-identifiers';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';

describe('Mek record-sheet binder', () => {
    it('renders pristine pips from the entity projection and damage only from runtime overlay values', () => {
        const svg = sheet();
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, snapshot());

        expect(svg.querySelector('#unitName')?.textContent).toBe('Atlas AS7-D');
        expect(svg.querySelector('#bv')?.textContent).toBe('1897 (1810)');
        expect(svg.querySelector('#armorType')?.textContent).toBe('Standard Armor');
        expect(svg.querySelector('#structureType')?.textContent).toBe('Endo Steel');
        expect(svg.querySelector('#mpWalk')?.textContent).toBe('2 [3]');
        expect(svg.querySelector('#mpRun')?.textContent).toBe('3 [5]');
        const currentMovement = svg.querySelector<SVGElement>('#mpRun');
        expect(currentMovement?.classList.contains('currentMoveMode'))
            .withContext(`${currentMovement?.outerHTML ?? 'missing #mpRun'}; ${svg.outerHTML.slice(0, 180)}`)
            .toBeTrue();
        expect(svg.querySelector('#hsCount')?.textContent).toBe('2');
        expect(svg.querySelectorAll('.hsPips .pip.damaged').length).toBe(1);
        expect(svg.querySelectorAll('.hsPips .pip.disabled').length).toBe(1);
        expect(svg.querySelector('.unitConditionBanner[condition="prone"]')?.getAttribute('display')).toBe('');
        const armor = [...svg.querySelectorAll('.armor.pip[loc="CT"]')];
        expect(armor.length).toBe(6);
        expect(armor.every(element => (element as SVGElement).style.pointerEvents === 'none')).toBeTrue();
        expect(armor.filter(element => (element as SVGElement).style.display !== 'none').length).toBe(4);
        expect(armor.filter(element => element.classList.contains('damaged')).length).toBe(2);
        expect(armor.filter(element => element.classList.contains('pending')).length).toBe(1);
        expect(armor.filter(element => element.classList.contains('fresh')).length).toBe(0);
        const structure = [...svg.querySelectorAll('.structure.pip[loc="CT"]')];
        expect(structure.every(element => (element as SVGElement).style.pointerEvents === 'none')).toBeTrue();
        expect(structure.filter(element => (element as SVGElement).style.display !== 'none').length).toBe(3);
        expect(structure.filter(element => element.classList.contains('damaged')).length).toBe(1);
        expect(svg.querySelector('.critSlot text')?.textContent).toBe('Ammo (AC/20) 4');
        expect(svg.querySelector('.critSlot')?.hasAttribute('uid')).toBeFalse();
        expect(svg.querySelector('.critSlot')?.hasAttribute('totalAmmo')).toBeFalse();
        expect(svg.querySelectorAll<SVGElement>('.critSlot')[1].style.display).toBe('none');
        const rollAgain = svg.querySelector<SVGElement>('[data-mekbay-empty-slot="1"]')!;
        expect(rollAgain.style.display).toBe('');
        expect(rollAgain.querySelector('text')?.textContent).toBe('Roll Again');
        const inventory = [...svg.querySelectorAll<SVGElement>('.inventoryEntry')];
        expect(inventory[0].style.display).toBe('');
        expect(inventory[0].querySelector('.name')?.textContent).toBe('AC/20');
        expect(inventory[0].querySelector('.location')?.textContent).toBe('CT');
        expect(inventory[0].querySelector('.heat')?.textContent).toBe('7');
        expect(inventory[0].querySelector('.damage')?.textContent).toBe('20');
        expect(inventory[0].querySelector('.range_short')?.textContent).toBe('3');
        expect(inventory[0].getAttribute('data-mekbay-component-ids')).toBe('["weapon-component"]');
        expect(inventory[0].hasAttribute('id')).toBeFalse();
        expect([...inventory[0].classList].some(className => className.startsWith('eq-'))).toBeFalse();
        expect(inventory[1].style.display).toBe('none');
        expect(inventory[1].querySelector('.name')?.textContent).toBe('');
        expect(inventory[2].style.display).toBe('none');
        expect(inventory[2].querySelector('.name')?.textContent).toBe('');
        expect(svg.querySelector('#ammoProfile > text')?.textContent).toBe('Ammo: (AC/20) 4');
        expect(svg.querySelector('#crewDamage1')?.textContent).not.toContain('FORGED CREW');
        expect(binding.render(snapshot())).toEqual([]);
    });

    it('binds every armor and internal pip only when the sheet has no authored location zone', () => {
        const svg = sheet();
        svg.querySelectorAll('.unitLocation.armor, .unitLocation.structure').forEach(zone => zone.remove());
        const interactions: MekRecordSheetInteraction[] = [];
        bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            snapshot(),
            interaction => interactions.push(interaction),
        );
        const armor = [...svg.querySelectorAll<SVGElement>('.armor.pip[loc="CT"]')];
        const structure = [...svg.querySelectorAll<SVGElement>('.structure.pip[loc="CT"]')];

        expect([...armor, ...structure].every(pip =>
            pip.style.pointerEvents === '' && pip.dataset['mekbayBound'] === '1')).toBeTrue();
        armor[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        structure[1]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));

        expect(interactions).toEqual([
            jasmine.objectContaining({
                kind: 'armor', faceId: 'armor-ct-front', locationId: 'location-ct', button: 'primary',
            }),
            jasmine.objectContaining({
                kind: 'internal', locationId: 'location-ct', button: 'secondary',
            }),
        ]);
    });

    it('prefers generated touch hit areas over individual pips when authored location zones are absent', () => {
        const svg = sheet();
        svg.querySelectorAll('.unitLocation.armor, .unitLocation.structure').forEach(zone => zone.remove());
        svg.insertAdjacentHTML('beforeend', `
            <circle class="pip-hit-area armor" loc="CT"></circle>
            <circle class="pip-hit-area armor" loc="CT"></circle>
            <circle class="pip-hit-area structure" loc="CT"></circle>
            <circle class="pip-hit-area structure" loc="CT"></circle>`);
        const interactions: MekRecordSheetInteraction[] = [];
        bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            snapshot(),
            interaction => interactions.push(interaction),
        );
        const armorPips = [...svg.querySelectorAll<SVGElement>('.armor.pip[loc="CT"]')];
        const structurePips = [...svg.querySelectorAll<SVGElement>('.structure.pip[loc="CT"]')];
        const armorTargets = [...svg.querySelectorAll<SVGElement>('.pip-hit-area.armor[loc="CT"]')];
        const structureTargets = [...svg.querySelectorAll<SVGElement>('.pip-hit-area.structure[loc="CT"]')];

        expect([...armorPips, ...structurePips].every(pip =>
            pip.style.pointerEvents === 'none' && pip.dataset['mekbayBound'] !== '1')).toBeTrue();
        expect([...armorTargets, ...structureTargets].every(target =>
            target.style.pointerEvents === '' && target.dataset['mekbayBound'] === '1')).toBeTrue();
        armorTargets[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        structureTargets[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));

        expect(interactions).toEqual([
            jasmine.objectContaining({
                kind: 'armor', faceId: 'armor-ct-front', locationId: 'location-ct', button: 'primary',
            }),
            jasmine.objectContaining({
                kind: 'internal', locationId: 'location-ct', button: 'secondary',
            }),
        ]);
    });

    it('restores the reference PSR warning labels for standard and LAM sheets', () => {
        const svg = sheet();
        svg.insertAdjacentHTML('beforeend', `
            <text id="mpRun-psr-warning"></text>
            <text id="mpJump-psr-warning"></text>`);
        const base = snapshot();
        if (base.movement.projection.kind !== 'supported') {
            throw new Error('Movement fixture is unsupported');
        }
        const movement = {
            ...base.movement,
            projection: {
                ...base.movement.projection,
                actions: [{
                    kind: 'run' as const,
                    legal: true,
                    reasons: [],
                    warnings: [{
                        code: 'PILOT_CHECK_REQUIRED' as const,
                        message: 'Piloting skill roll required',
                    }],
                }],
            },
        } as MekRecordSheetSnapshot['movement'];
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, {
            ...base,
            movement,
        });

        expect(svg.querySelector('#mpRun-psr-warning')?.textContent).toBe('PSR!');
        expect(svg.querySelector('#mpRun-psr-warning')?.getAttribute('display')).toBeNull();
        expect(svg.querySelector('#mpJump-psr-warning')?.textContent).toBe('PSR!');
        expect(svg.querySelector('#mpJump-psr-warning')?.getAttribute('display')).toBe('none');

        binding.render({
            ...base,
            identity: { ...base.identity, form: 'lam' },
            movement,
        });
        expect(svg.querySelector('#mpRun-psr-warning')?.textContent).toBe('!!!');
    });

    it('renders a destroyed torso and its dependent arm from derived runtime location state', () => {
        const svg = sheet();
        svg.insertAdjacentHTML('beforeend', `
            <g class="unitLocation armor" loc="LT"></g>
            <g class="unitLocation structure" loc="LT"></g>
            <g class="critGroup" loc="LT"><g class="critSlot" loc="LT" slot="0"><text>LT GEAR</text></g></g>
            <g class="unitLocation armor" loc="LA"></g>
            <g class="unitLocation structure" loc="LA"></g>
            <g class="critGroup" loc="LA"><g class="critSlot" loc="LA" slot="0"><text>LA GEAR</text></g></g>`);
        const current = snapshot();
        const torso = {
            ...current.locations[0],
            locationId: asLocationId('location-lt'),
            code: 'LT' as const,
            committedRemainingInternal: 0,
            previewRemainingInternal: 0,
            committedStructurallyDestroyed: true,
            previewStructurallyDestroyed: true,
        };
        const arm = {
            ...current.locations[0],
            locationId: asLocationId('location-la'),
            code: 'LA' as const,
            committedDetached: true,
            previewDetached: true,
        };

        bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, {
            ...current,
            locations: [torso, arm],
            criticalSlots: [{
                ...current.criticalSlots[0],
                slotId: asCriticalSlotId('slot-lt-0'),
                locationId: asLocationId('location-lt'),
                locationCode: 'LT',
                components: [{
                    ...current.criticalSlots[0].components[0],
                    status: 'destroyed',
                }],
            }, {
                ...current.criticalSlots[0],
                slotId: asCriticalSlotId('slot-la-0'),
                locationId: asLocationId('location-la'),
                locationCode: 'LA',
                components: [{
                    ...current.criticalSlots[0].components[0],
                    status: 'destroyed',
                }],
            }],
        });

        expect(svg.querySelector('.critGroup[loc="LT"]')?.classList).toContain('locationDestroyed');
        expect(svg.querySelector('.critSlot[loc="LT"]')?.classList).toContain('disabled');
        expect(svg.querySelectorAll('[loc="LA"]')).toHaveSize(4);
        expect([...svg.querySelectorAll('[loc="LA"]')]
            .every(element => element.classList.contains('detached'))).toBeTrue();
        expect(svg.querySelector('.critGroup[loc="LA"]')?.classList).not.toContain('locationDestroyed');
    });

    it('renders pending location loss without treating it as committed sheet state', () => {
        const svg = sheet();
        const current = snapshot();
        const location = {
            ...current.locations[0],
            committedDetached: false,
            previewDetached: true,
        };

        bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, {
            ...current,
            locations: [location],
        });

        const locations = [...svg.querySelectorAll('.unitLocation[loc="CT"]')];
        expect(locations.length).toBeGreaterThan(0);
        expect(locations.every(element => element.classList.contains('detached'))).toBeTrue();
        expect(locations.every(element => element.classList.contains('pending'))).toBeTrue();
    });

    it('uses the latest rendered crew wounds when a hit marker clears damage', () => {
        const svg = sheet();
        const current = snapshot();
        const interactions: MekRecordSheetInteraction[] = [];
        const binding = bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            current,
            interaction => interactions.push(interaction),
        );
        binding.render({
            ...current,
            crew: current.crew.map(position => ({
                ...position,
                state: { ...position.state, wounds: 2 },
            })),
        });

        const marker = svg.querySelector<SVGElement>('.crewHit[crewId="0"][hit="2"]');
        expect(marker).not.toBeNull();
        marker!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(interactions.at(-1)).toEqual(jasmine.objectContaining({
            kind: 'crew-wounds',
            wounds: 1,
        }) as unknown as MekRecordSheetInteraction);
    });

    it('projects only ranged weapons and typed physical attacks into the authored weapon table', () => {
        const svg = sheet();
        svg.querySelectorAll<SVGElement>('.inventoryEntry')[1].insertAdjacentHTML('beforeend', `
            <text class="location"></text>
            <text class="damage"></text>
            <rect class="hitMod-rect"></rect>
            <text class="hitMod-text"></text>`);
        const interactions: MekRecordSheetInteraction[] = [];
        const current = snapshot();
        const withPhysical = {
            ...current,
            physicalAttacks: {
                kind: 'supported' as const,
                attacks: [{
                    target: { kind: 'intrinsic' as const, actionId: 'intrinsic:punch:LA' },
                    label: 'Punch',
                    locationIds: ['location-la'],
                    locationCodes: ['LA'],
                    hitModifiers: [-2],
                    hitModifierBreakdown: [],
                    effect: {
                        kind: 'damage' as const,
                        damage: 5,
                        maximumDamage: 10,
                        baseDamage: 5,
                        weakened: true,
                        boosted: false,
                    },
                    available: true,
                    selectable: true,
                }],
            },
        } as unknown as MekRecordSheetSnapshot;

        const binding = bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            withPhysical,
            interaction => interactions.push(interaction),
        );

        const inventory = [...svg.querySelectorAll<SVGElement>('.inventoryEntry')];
        expect(inventory[0].querySelector('.name')?.textContent).toBe('AC/20');
        expect(inventory[1].querySelector('.name')?.textContent).toBe('Punch');
        expect(inventory[1].querySelector('.location')?.textContent).toBe('LA');
        expect(inventory[1].querySelector('.damage')?.textContent).toBe('5 [10]');
        expect(inventory[1].querySelector('.hitMod-text')?.textContent).toBe('-2');
        expect(inventory[1].querySelector('.hitMod-rect')?.getAttribute('display')).toBe('block');
        expect(inventory[2].style.display).toBe('none');

        inventory[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions.some(interaction => interaction.kind === 'inventory-selection')).toBeFalse();
        expect(interactions).toContain(jasmine.objectContaining({
            kind: 'action-selection',
            target: { kind: 'intrinsic', actionId: 'intrinsic:punch:LA' },
        }) as unknown as MekRecordSheetInteraction);

        if (withPhysical.physicalAttacks.kind !== 'supported') {
            throw new Error('Physical fixture is unsupported');
        }
        const physicalAttack = withPhysical.physicalAttacks.attacks[0];
        if (physicalAttack.effect.kind !== 'damage') throw new Error('Physical damage fixture is missing');
        binding.render({
            ...withPhysical,
            physicalAttacks: {
                ...withPhysical.physicalAttacks,
                attacks: [{
                    ...physicalAttack,
                    effect: {
                        ...physicalAttack.effect,
                        displayFormula: '13.5×(TMM+1)+2',
                    },
                }],
            },
        } as unknown as MekRecordSheetSnapshot);
        expect(inventory[1].querySelector('.damage')?.textContent).toBe('13.5×(TMM+1)+2');

        binding.render({
            ...withPhysical,
            physicalAttacks: {
                ...withPhysical.physicalAttacks,
                attacks: [{
                    ...physicalAttack,
                    effect: {
                        ...physicalAttack.effect,
                        damage: 14,
                        maximumDamage: 14,
                        alternateDamage: 7,
                    },
                }],
            },
        } as unknown as MekRecordSheetSnapshot);
        expect(inventory[1].querySelector('.damage')?.textContent).toBe('14 [7]');
    });

    it('emits authoritative IDs captured from the projection, never forged SVG metadata', () => {
        const svg = sheet();
        const interactions: MekRecordSheetInteraction[] = [];
        bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            snapshot(),
            interaction => interactions.push(interaction),
        );

        (svg.querySelector('.critSlot') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        (svg.querySelector('.unitLocation.armor') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        (svg.querySelector('#heatScale .heat[heat="1"]') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        (svg.querySelector('.crewSkillButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        (svg.querySelector('.crewStateButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        (svg.querySelector('#ammoProfile') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        (svg.querySelector('#hsCount') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        (svg.querySelector('.unitConditionButton[condition="immobile"]') as SVGElement)
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        (svg.querySelector('.unitConditionButton[condition="shutdown"]') as SVGElement)
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(interactions[0]).toEqual(jasmine.objectContaining({
            kind: 'critical',
            slotId: 'slot-ct-0',
            componentIds: ['ammo-component'],
        }));
        expect(interactions[1]).toEqual(jasmine.objectContaining({
            kind: 'armor',
            faceId: 'armor-ct-front',
            locationId: 'location-ct',
        }));
        expect(interactions[2]).toEqual(jasmine.objectContaining({ kind: 'heat', heat: 1 }));
        expect(interactions[3]).toEqual(jasmine.objectContaining({
            kind: 'crew-skill', positionId: 'crew-0', skill: 'gunnery',
        }));
        expect(interactions[4]).toEqual(jasmine.objectContaining({
            kind: 'crew-state-menu', positionId: 'crew-0',
        }));
        expect(interactions[5]).toEqual(jasmine.objectContaining({ kind: 'open-equipment', tab: 'ammo' }));
        expect(interactions[6]).toEqual(jasmine.objectContaining({ kind: 'heat-sinks-off' }));
        expect(interactions[7]).toEqual(jasmine.objectContaining({ kind: 'condition', condition: 'immobile' }));
        expect(interactions[8]).toEqual(jasmine.objectContaining({ kind: 'shutdown' }));
        expect(interactions.length).toBe(9);
    });

    it('does not bind or retain a hit target for an unhittable critical slot', () => {
        const svg = sheet();
        const critical = svg.querySelector<SVGElement>('.critSlot')!;
        critical.insertAdjacentHTML('afterbegin', '<rect class="critSlot-bg-rect"></rect>');
        const base = snapshot();
        const interactions: MekRecordSheetInteraction[] = [];

        bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            {
                ...base,
                criticalSlots: [{ ...base.criticalSlots[0]!, hittable: false }],
            },
            interaction => interactions.push(interaction),
        );

        expect(critical.classList).not.toContain('interactive');
        expect(critical.hasAttribute('tabindex')).toBeFalse();
        expect(critical.hasAttribute('hittable')).toBeFalse();
        expect(critical.querySelector(':scope > .critSlot-bg-rect')).toBeNull();
        critical.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions).toEqual([]);
    });

    it('renders and binds shield DA/DC tracks from the runtime projection', () => {
        const svg = sheet();
        const interactions: MekRecordSheetInteraction[] = [];
        const current = snapshot();
        bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            {
                ...current,
                shields: [{
                    componentId: asComponentId('shield-la'),
                    locationId: asLocationId('location-la'),
                    locationCode: 'LA',
                    track: 'absorption',
                    maximum: 5,
                    committedDamage: 1,
                    previewDamage: 2,
                    committedRemaining: 4,
                    previewRemaining: 3,
                }, {
                    componentId: asComponentId('shield-la'),
                    locationId: asLocationId('location-la'),
                    locationCode: 'LA',
                    track: 'capacity',
                    maximum: 18,
                    committedDamage: 5,
                    previewDamage: 5,
                    committedRemaining: 13,
                    previewRemaining: 13,
                }],
            },
            interaction => interactions.push(interaction),
        );

        const absorption = svg.querySelector<SVGElement>('.unitLocation.shield[loc="DALA"]')!;
        const capacity = svg.querySelector<SVGElement>('.unitLocation.shield[loc="DCLA"]')!;
        expect(absorption.style.display).toBe('');
        expect(absorption.querySelectorAll('.pip.damaged').length).toBe(2);
        expect(absorption.querySelectorAll('.pip.pending').length).toBe(1);
        expect(capacity.querySelectorAll('.pip.damaged').length).toBe(5);

        absorption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions[0]).toEqual(jasmine.objectContaining({
            kind: 'shield',
            componentId: 'shield-la',
            track: 'absorption',
        }));
    });

    it('renders a read-only projection without attaching mutation handlers', () => {
        const svg = sheet();
        bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, snapshot());

        expect(svg.querySelector('.unitLocation.armor')?.classList.contains('interactive')).toBeFalse();
        expect(svg.querySelector('.critSlot')?.classList.contains('interactive')).toBeFalse();
        expect(svg.querySelector('.crewHit')?.classList.contains('interactive')).toBeFalse();
        expect(svg.querySelector('.crewSkillButton')?.classList.contains('interactive')).toBeFalse();
        expect(svg.querySelector('#ammoProfile')?.classList.contains('interactive')).toBeFalse();
        expect(svg.querySelector('#heatScale .heat')?.classList.contains('interactive')).toBeFalse();
        expect(svg.querySelector('#mpWalk')?.classList.contains('interactive')).toBeFalse();
        expect(svg.querySelector('.unitConditionButton')?.classList.contains('edit-only')).toBeTrue();
    });

    it('cross-highlights inventory rows and critical slots by authoritative component ID', () => {
        const svg = sheet();
        const base = snapshot();
        const linked = {
            ...base,
            criticalSlots: [{
                ...base.criticalSlots[0],
                components: [{
                    ...base.criticalSlots[0]!.components[0],
                    componentId: asComponentId('weapon-component'),
                    label: 'AC/20',
                    ammo: undefined,
                }],
            }],
        } as MekRecordSheetSnapshot;
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, linked);
        const inventory = svg.querySelector<SVGElement>('.inventoryEntry')!;
        const critical = svg.querySelector<SVGElement>('.critSlot')!;

        inventory.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        expect(critical.classList).toContain('equipment-hover-secondary');
        expect(inventory.classList).not.toContain('equipment-hover-secondary');

        inventory.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
        critical.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        expect(inventory.classList).toContain('equipment-hover-secondary');
        expect(critical.classList).not.toContain('equipment-hover-secondary');

        binding.destroy();
        expect(svg.querySelectorAll('.equipment-hover-secondary').length).toBe(0);
    });

    it('cross-highlights exact system IDs without conflating location-scoped actuators', () => {
        const svg = sheet();
        svg.insertAdjacentHTML('beforeend', `
            <g class="critSlot" loc="LA" slot="0"><text></text></g>
            <g class="critSlot" loc="RA" slot="0"><text></text></g>
            <g class="critSlot" loc="RT" slot="0"><text></text></g>`);
        const base = snapshot();
        const systemSlot = (
            locationCode: MekRecordSheetSnapshot['criticalSlots'][number]['locationCode'],
            componentId: string,
            system: string,
        ): MekRecordSheetSnapshot['criticalSlots'][number] => ({
            ...base.criticalSlots[0],
            slotId: asCriticalSlotId(`slot-${locationCode.toLowerCase()}-0`),
            locationId: asLocationId(`location-${locationCode.toLowerCase()}`),
            locationCode,
            components: [{
                componentId: asComponentId(componentId),
                label: system,
                system,
                status: 'available',
            }],
        });
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, {
            ...base,
            criticalSlots: [
                systemSlot('LA', 'system:upper-arm-actuator:mek:left-arm', 'Upper Arm Actuator'),
                systemSlot('RA', 'system:upper-arm-actuator:mek:right-arm', 'Upper Arm Actuator'),
                systemSlot('CT', 'system:engine', 'Engine'),
                systemSlot('RT', 'system:engine', 'Engine'),
            ],
        });
        const leftActuator = svg.querySelector<SVGElement>('.critSlot[loc="LA"]')!;
        const rightActuator = svg.querySelector<SVGElement>('.critSlot[loc="RA"]')!;
        const centerEngine = svg.querySelector<SVGElement>('.critSlot[loc="CT"]')!;
        const rightEngine = svg.querySelector<SVGElement>('.critSlot[loc="RT"]')!;

        leftActuator.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        expect(rightActuator.classList).not.toContain('equipment-hover-secondary');

        centerEngine.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        expect(rightEngine.classList).toContain('equipment-hover-secondary');

        binding.destroy();
    });

    it('wraps long inventory names and preserves semantic damage text on the final row', () => {
        spyOn(CanvasRenderingContext2D.prototype, 'measureText').and.callFake(text => ({
            width: String(text).length,
        } as TextMetrics));
        const svg = sheet();
        const inventory = svg.querySelector<SVGElement>('.inventoryEntry')!;
        inventory.querySelector('.name')!.outerHTML = `
            <g class="name"><text x="0"></text><text x="0"></text></g>`;
        inventory.querySelector('.damage')!.outerHTML = `
            <g class="damage"><text x="40"></text><text x="40"></text></g>`;
        inventory.querySelector('.location')!.setAttribute('x', '20');
        inventory.querySelector('.heat')!.setAttribute('x', '30');
        inventory.querySelector('.range_min')!.setAttribute('x', '50');
        const base = snapshot();
        const weapon = base.equipment[0]!;

        bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, {
            ...base,
            equipment: [{
                ...weapon,
                label: 'Improved Heavy Gauss Rifle (R)',
                weapon: {
                    ...weapon.weapon!,
                    damage: '2/Msl [C, Msl, LG]',
                    damageText: '2/Msl [C, Msl, LG]',
                    damageTextByRange: {
                        short: '2/Msl [C, Msl, LG]',
                        medium: '2/Msl [C, Msl, LG]',
                        long: '2/Msl [C, Msl, LG]',
                        extreme: '2/Msl [C, Msl, LG]',
                    },
                },
            }, ...base.equipment.slice(1)],
        } as MekRecordSheetSnapshot);

        expect([...inventory.querySelectorAll('.name > text')].map(line => line.textContent))
            .toEqual(['Improved Heavy', 'Gauss Rifle...']);
        expect([...inventory.querySelectorAll('.damage > text')].map(line => line.textContent))
            .toEqual(['2/Msl', '[C,Msl,LG]']);
    });

    it('keeps runtime modes out of critical-table equipment labels', () => {
        const svg = sheet();
        const base = snapshot();
        const slot = base.criticalSlots[0]!;
        const componentWithRuntimeMode = {
            ...slot.components[0]!,
            label: 'Imp. Heavy Gauss Rifle (R)',
            ammo: undefined,
            mode: 'Powered Up',
        };
        bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, {
            ...base,
            criticalSlots: [{
                ...slot,
                components: [componentWithRuntimeMode],
            }],
        } as MekRecordSheetSnapshot);

        expect(svg.querySelector('.critSlot text')?.textContent).toBe('Imp. Heavy Gauss Rifle (R)');
    });

    it('renders Core extra critical hits before damaging the whole slot', () => {
        const svg = sheet();
        const base = snapshot();
        const slot = base.criticalSlots[0]!;
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, {
            ...base,
            ruleset: 'core-2026',
            criticalSlots: [{ ...slot, hitCapacity: 2, committedHits: 0, previewHits: 1 }],
        });
        const element = svg.querySelector<SVGElement>('.critSlot')!;
        const extra = element.querySelector<SVGElement>('.extraHitPip')!;

        expect(extra.getAttribute('display')).toBeNull();
        expect(extra.classList).toContain('damaged');
        expect(extra.classList).toContain('pending');
        expect(extra.classList).not.toContain('fresh');
        expect(element.classList).not.toContain('damaged');
        expect(element.classList).not.toContain('willDamage');

        binding.render({
            ...base,
            ruleset: 'core-2026',
            criticalSlots: [{ ...slot, hitCapacity: 2, committedHits: 1, previewHits: 1 }],
        });
        expect(extra.classList).toContain('damaged');
        expect(extra.classList).not.toContain('fresh');
        expect(extra.classList).not.toContain('pending');
        expect(element.classList).not.toContain('damaged');

        binding.render({
            ...base,
            ruleset: 'core-2026',
            criticalSlots: [{ ...slot, hitCapacity: 2, committedHits: 2, previewHits: 2 }],
        });
        expect(element.classList).toContain('damaged');
        expect(extra.classList).not.toContain('fresh');
    });

    it('uses displayed damage for pending and fresh pip colors', () => {
        const svg = sheet();
        const base = snapshot();
        const withArmor = (committedRemaining: number, previewRemaining: number): MekRecordSheetSnapshot => ({
            ...base,
            locations: [{
                ...base.locations[0]!,
                armor: [{
                    ...base.locations[0]!.armor[0]!,
                    committedRemaining,
                    previewRemaining,
                }],
            }],
        });
        const binding = bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            withArmor(4, 4),
        );
        const pips = [...svg.querySelectorAll<SVGElement>('.armor.pip[loc="CT"]')];

        binding.render(withArmor(4, 3));
        expect(pips.filter(pip => pip.classList.contains('damaged')).length).toBe(1);
        expect(pips.filter(pip => pip.classList.contains('pending')).length).toBe(1);
        expect(pips.filter(pip => pip.classList.contains('fresh')).length).toBe(1);

        binding.render(withArmor(4, 3));
        expect(pips.filter(pip => pip.classList.contains('fresh')).length).toBe(0);

        binding.render(withArmor(3, 3));
        expect(pips.filter(pip => pip.classList.contains('pending')).length).toBe(0);
        expect(pips.filter(pip => pip.classList.contains('damaged')).length).toBe(1);

        binding.render(withArmor(3, 4));
        expect(pips.filter(pip => pip.classList.contains('damaged')).length).toBe(0);
        expect(pips.filter(pip => pip.classList.contains('pending')).length).toBe(1);
        expect(pips.filter(pip => pip.classList.contains('fresh')).length).toBe(1);
    });

    it('uses armor, extra-hit, then whole-slot marks for an armored Core autocannon', () => {
        const svg = sheet();
        const base = snapshot();
        const slot = base.criticalSlots[0]!;
        const render = (committedHits: number): MekRecordSheetSnapshot => ({
            ...base,
            ruleset: 'core-2026',
            criticalSlots: [{
                ...slot,
                armored: true,
                hitCapacity: 3,
                committedHits,
                previewHits: committedHits,
            }],
        });
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, render(0));
        const element = svg.querySelector<SVGElement>('.critSlot')!;
        const armor = element.querySelector<SVGElement>('.armoredLocPip')!;
        const extra = element.querySelector<SVGElement>('.extraHitPip')!;

        binding.render(render(1));
        expect(armor.classList).toContain('damaged');
        expect(extra.classList).not.toContain('damaged');
        expect(element.classList).not.toContain('damaged');

        binding.render(render(2));
        expect(armor.classList).toContain('damaged');
        expect(extra.classList).toContain('damaged');
        expect(extra.classList).toContain('fresh');
        expect(element.classList).not.toContain('damaged');

        binding.render(render(3));
        expect(element.classList).toContain('damaged');
        expect(armor.classList).not.toContain('fresh');
        expect(extra.classList).not.toContain('fresh');
    });

    it('hides Core-only extra-hit pips and damages a Total Warfare slot on its first hit', () => {
        const svg = sheet();
        const base = snapshot();
        const slot = base.criticalSlots[0]!;
        bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, {
            ...base,
            ruleset: 'total-warfare',
            criticalSlots: [{ ...slot, hitCapacity: 1, committedHits: 1, previewHits: 1 }],
        });
        const element = svg.querySelector<SVGElement>('.critSlot')!;
        const extra = element.querySelector<SVGElement>('.extraHitPip')!;

        expect(extra.getAttribute('display')).toBe('none');
        expect(extra.classList).not.toContain('damaged');
        expect(element.classList).toContain('damaged');
    });

    it('uses direct authored system-hit controls and preserves the heat-drag overlay protocol', () => {
        const svg = sheet();
        const engine = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        engine.setAttribute('id', 'engine_hit_1');
        svg.appendChild(engine);
        const base = snapshot();
        const systemSnapshot = {
            ...base,
            heat: { ...base.heat, current: 1, pendingOverride: 2 },
            criticalSlots: [...base.criticalSlots, {
                slotId: 'slot-ct-engine',
                locationId: 'location-ct',
                locationCode: 'CT',
                slotIndex: 1,
                armored: false,
                committedHits: 0,
                previewHits: 0,
                components: [{
                    componentId: 'engine-component',
                    label: 'Engine',
                    system: 'Engine',
                    status: 'available',
                }],
            }],
        } as MekRecordSheetSnapshot;
        const interactions: MekRecordSheetInteraction[] = [];
        const binding = bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            systemSnapshot,
            interaction => interactions.push(interaction),
        );

        engine.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions[0]).toEqual(jasmine.objectContaining({
            kind: 'system-critical', slotId: 'slot-ct-engine', system: 'Engine', level: 1,
        }));
        expect(svg.querySelector('#heatScale .heat[heat="2"]')?.classList.contains('hot')).toBeTrue();

        const heat = svg.querySelector('#heatScale .heat[heat="1"]') as SVGElement;
        heat.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, button: 0, pointerId: 44, clientY: 10,
        }));
        expect(interactions.some(interaction => interaction.kind === 'heat-preview')).toBeTrue();
        window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 44 }));
        expect(interactions.at(-1)?.kind).toBe('heat-preview-end');
        binding.destroy();
    });

    it('ports production heat projection controls without treating automatic heat as manually applicable', () => {
        const svg = sheet();
        svg.querySelector('#heatScale')!.innerHTML = `
            ${Array.from({ length: 11 }, (_, heat) =>
                `<rect class="heat" heat="${heat}" x="10" y="${100 - heat * 5}" width="5" height="5"></rect>`).join('')}
            <path class="overflowFrame" d="M 10 40 h 5 v 5 h -5 z" stroke="#000"></path>
            <rect class="overflowButton" x="10" y="40" width="5" height="5"></rect>
        `;
        svg.insertAdjacentHTML('beforeend', `
            <g id="heatDataPanel"><g id="applyHeatButton"><path></path></g></g>
        `);
        const base = snapshot();
        const automatic = {
            ...base,
            heat: { current: 2, previous: 1, heatsinksOff: 0 },
            heatPolicy: 'automatic',
            heatProjection: {
                kind: 'supported',
                projection: {
                    current: 2,
                    sources: [{ id: 'weapons', label: 'Weapons', value: 15 }],
                    committedSources: [{ id: 'weapons', label: 'Weapons', value: 15 }],
                    capacity: 0,
                    underwaterBonus: 0,
                    previouslyConsumedDissipation: 0,
                    remainingDissipation: 0,
                    generated: 15,
                    dissipated: 0,
                    projected: 17,
                    delta: 15,
                    hasPendingResolution: true,
                    hasPendingSettlement: true,
                },
            },
        } as MekRecordSheetSnapshot;
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, automatic, () => undefined);

        expect(svg.querySelector('#now-arrow')).not.toBeNull();
        expect(svg.querySelector('#projection-arrow')).not.toBeNull();
        expect(svg.querySelector('#projection-arrow')?.getAttribute('points'))
            .toBe('25,37.5 17,42.5 25,47.5');
        expect(svg.querySelector('#heat-projection-path')).not.toBeNull();
        expect(svg.querySelector('#heat-projection-path')?.getAttribute('d')).not.toContain('NaN');
        expect(svg.querySelector('#heat-projection-overflow-text')?.textContent).toBe('17');
        expect(svg.querySelector('.overflowFrame')?.getAttribute('stroke')).toBe('#d12020');
        expect(svg.querySelector('#heatDataPanel')?.classList.contains('heatApplicationAvailable')).toBeFalse();

        binding.render({
            ...automatic,
            heat: { ...automatic.heat, pendingOverride: 4 },
        });
        expect(svg.querySelector('#next-arrow')).not.toBeNull();
        expect(svg.querySelector('#projection-arrow')).toBeNull();
        expect(svg.querySelector('#heat-projection-path')).toBeNull();
        expect(svg.querySelector('#heat-projection-overflow-text')).toBeNull();
        expect(svg.querySelector('.overflowFrame')?.getAttribute('stroke')).toBe('#000');
        expect(svg.querySelector('#heatDataPanel')?.classList.contains('heatApplicationAvailable')).toBeTrue();
        expect(svg.querySelector('#heatDataPanel')?.classList.contains('hot')).toBeTrue();

        binding.render({
            ...automatic,
            heatPolicy: 'manual',
        });
        expect(svg.querySelector('#heat-projection-target-marker')).not.toBeNull();
        expect(svg.querySelector('#heat-projection-target-marker')?.getAttribute('points'))
            .toBe('14,42.5 6,40 6,45');
        expect(svg.querySelector('#heat-projection-path')).toBeNull();
        binding.destroy();
    });

    it('groups equipment heat only in the compact SVG summary', () => {
        const svg = sheet();
        svg.insertAdjacentHTML('beforeend', '<text id="damagedEngineHeatText" x="10" y="40"></text>');
        const base = snapshot();
        const grouped = {
            ...base,
            heatProjection: {
                kind: 'supported',
                projection: {
                    current: 1,
                    sources: [
                        { id: 'nova', label: 'Nova CEWS', value: 2, group: 'Equipment' },
                        { id: 'damaged-engine', label: 'Damaged Engine', value: 5 },
                        { id: 'stealth', label: 'Stealth', value: 10, group: 'Equipment' },
                    ],
                    committedSources: [],
                    capacity: 0,
                    underwaterBonus: 0,
                    previouslyConsumedDissipation: 0,
                    remainingDissipation: 0,
                    generated: 17,
                    dissipated: 0,
                    projected: 18,
                    delta: 17,
                    hasPendingResolution: true,
                    hasPendingSettlement: true,
                },
            },
        } as MekRecordSheetSnapshot;

        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, grouped);
        expect([...svg.querySelectorAll('#damagedEngineHeatText tspan')]
            .map(line => line.textContent)).toEqual(['Equipment: +12', 'Engine: +5']);
        binding.destroy();
    });

    it('renders production Life Support pilot-damage icons from the runtime projection', () => {
        const svg = sheet();
        svg.insertAdjacentHTML('beforeend', `
            <g id="lifeSupportPilotDamageWarning" data-width="42" data-height="15" display="none">
                <symbol id="lifeSupportHeatDamageIcon"></symbol>
                <symbol id="lifeSupportOxygenDamageIcon"></symbol>
            </g>
        `);
        const base = snapshot();
        const damaged = {
            ...base,
            lifeSupport: { damaged: true, heatHits: 2, oxygenHits: 1, headHitHits: 1 },
        } as MekRecordSheetSnapshot;
        const binding = bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            damaged,
        );

        const warning = svg.getElementById('lifeSupportPilotDamageWarning')!;
        const icons = [...warning.querySelectorAll<SVGUseElement>('use')];
        expect(warning.getAttribute('display')).toBeNull();
        expect(warning.getAttribute('aria-label')).toBe('2 heat, 1 oxygen-deprivation pilot damage');
        expect(icons.map(icon => icon.getAttribute('href'))).toEqual([
            '#lifeSupportHeatDamageIcon',
            '#lifeSupportHeatDamageIcon',
            '#lifeSupportOxygenDamageIcon',
        ]);
        expect(icons.map(icon => icon.getAttribute('x'))).toEqual(['0', '13.5', '27']);

        binding.render({
            ...base,
            lifeSupport: { damaged: false, heatHits: 0, oxygenHits: 0, headHitHits: 1 },
        } as MekRecordSheetSnapshot);
        expect(warning.querySelectorAll('use').length).toBe(0);
        expect(warning.getAttribute('display')).toBe('none');
        expect(warning.hasAttribute('aria-label')).toBeFalse();
        binding.destroy();
    });

    it('renders attacker selections through the original inventory-row styling', () => {
        const svg = sheet();
        svg.querySelector('.inventoryEntry')?.insertAdjacentHTML('beforeend', `
            <rect class="inventoryEntryButton shrButton"></rect>
            <g class="alternativeMode"><text class="name"></text></g>
        `);
        const base = snapshot();
        const selected = {
            ...base,
            equipment: base.equipment.map((component, index) => index === 0
                ? {
                    ...component,
                    modes: ['Standard', 'Pulse'],
                    defaultMode: 'Standard',
                    mode: 'Pulse',
                    weapon: {
                        ...component.weapon!,
                        selection: { kind: 'manual-range', range: 'short' },
                    },
                }
                : component),
        } as MekRecordSheetSnapshot;

        const binding = bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            selected,
        );

        expect(svg.querySelector('.inventoryEntry')?.classList.contains('selected')).toBeTrue();
        expect(svg.querySelector('.inventoryEntry')?.classList.contains('selected-alternative-mode')).toBeTrue();
        expect(svg.querySelector('.inventoryEntry')?.classList.contains('selected-range-short')).toBeTrue();
        expect(svg.querySelector('.alternativeMode')?.classList.contains('selected')).toBeTrue();
        binding.render(base);
        expect(svg.querySelector('.inventoryEntry')?.classList.contains('selected')).toBeFalse();
        binding.destroy();
    });

    it('renders target color, target number, out-of-range state, and hit modifier from Entity plus runtime facts', () => {
        const svg = sheet();
        svg.querySelector('.inventoryEntry')?.insertAdjacentHTML('beforeend', `
            <rect class="hitMod-rect" display="none"></rect><text class="hitMod-text" display="none"></text>
            <rect class="targetTn-rect" display="none"></rect><text class="targetTn-text" display="none"></text>
        `);
        const base = snapshot();
        const targeted = {
            ...base,
            targets: [{
                targetId: 'target-a', letter: 'A', name: 'Enemy', color: '#d64545', readOnly: false,
                local: { distance: 4, manualTnOverride: { modifier: 2 } },
            }],
            equipment: base.equipment.map((component, index) => index === 0
                ? {
                    ...component,
                    equipment: new WeaponEquipment({
                        id: 'fixture-weapon', name: 'Fixture Weapon', type: 'weapon',
                        stats: { toHitModifier: 1 },
                    }),
                    weapon: {
                        ...component.weapon!,
                        selection: { kind: 'target', targetId: 'target-a' },
                        toHitModifier: 1,
                        hit: equipmentHit(1),
                    },
                }
                : component),
        } as unknown as MekRecordSheetSnapshot;

        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, targeted);
        const row = svg.querySelector('.inventoryEntry') as SVGElement;
        expect(row.style.getPropertyValue('--inventory-control-selection-color')).toBe('#d64545');
        expect(row.querySelector('.targetTn-text')?.textContent).toBe('10');
        expect(row.querySelector('.targetTn-rect')?.getAttribute('display')).toBe('block');
        expect(row.querySelector('.hitMod-text')?.textContent).toBe('+1');
        expect(row.querySelector('.hitMod-rect')?.getAttribute('display')).toBe('block');
        expect(row.classList.contains('selected-range-medium')).toBeTrue();
        expect(row.classList.contains('selected-target-out-of-range')).toBeFalse();
        binding.destroy();
    });

    it('restores the original crew-name blanks and crew-state button/banner presentation', () => {
        const svg = sheet();
        svg.querySelector('#crewDamage0')!.insertAdjacentHTML('beforeend', `
            <path id="blankCrewName0"></path>
            <g class="crewStateBanner" crewId="0" display="none">
                <rect class="unitConditionBannerRect"></rect>
                <text class="unitConditionBannerText"></text>
            </g>
        `);
        const nameButton = svg.querySelector('.crewNameButton')!;
        nameButton.setAttribute('textElement', 'crewName0');
        nameButton.setAttribute('blankElement', 'blankCrewName0');
        const base = snapshot();
        const unconscious = {
            ...base,
            crew: [{
                ...base.crew[0],
                name: '',
                state: { wounds: 1, unconscious: true, ejected: false },
                effectiveState: 'unconscious',
            }],
        } as MekRecordSheetSnapshot;

        const binding = bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            unconscious,
        );

        expect((svg.querySelector('#crewName0') as SVGElement).style.visibility).toBe('hidden');
        expect((svg.querySelector('#blankCrewName0') as SVGElement).style.visibility).toBe('visible');
        expect(svg.querySelector('.crewStateButton')?.classList.contains('active')).toBeTrue();
        expect(svg.querySelector('.crewStateBanner')?.getAttribute('display')).toBeNull();
        expect(svg.querySelector('.crewStateBanner .unitConditionBannerText')?.textContent).toBe('UNCONSCIOUS');
        binding.destroy();
    });

    it('preserves the authored Name label while rendering the pilot name into its mapped value', () => {
        const svg = sheet();
        const label = svg.querySelector<SVGElement>('#crewName0')!;
        label.textContent = 'Name:';
        label.insertAdjacentHTML('afterend', `
            <text id="pilotName0">FORGED PILOT</text>
            <path id="blankCrewName0"></path>`);
        const nameButton = svg.querySelector('.crewNameButton')!;
        nameButton.setAttribute('textElement', 'pilotName0');
        nameButton.setAttribute('blankElement', 'blankCrewName0');

        const binding = bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            snapshot(),
        );

        expect(label.textContent).toBe('Name:');
        expect(svg.querySelector('#pilotName0')?.textContent).toBe('Morgan');
        expect((svg.querySelector('#pilotName0') as SVGElement).style.visibility).toBe('visible');
        expect((svg.querySelector('#blankCrewName0') as SVGElement).style.visibility).toBe('hidden');

        const base = snapshot();
        binding.render({
            ...base,
            crew: base.crew.map(position => ({ ...position, name: '' })),
        });
        expect(label.textContent).toBe('Name:');
        expect((svg.querySelector('#pilotName0') as SVGElement).style.visibility).toBe('hidden');
        expect((svg.querySelector('#blankCrewName0') as SVGElement).style.visibility).toBe('visible');
    });

    it('preserves crew skill labels and renders the permanent PSR modifier', () => {
        const svg = sheet();
        svg.querySelector('#crewDamage0')!.insertAdjacentHTML('beforeend', `
            <text id="gunnerySkillText0">Gunnery Skill:</text>
            <text id="gunnerySkill0"></text>
            <text id="pilotingSkillText0">Piloting Skill:</text>
            <text id="pilotingSkill0"></text>`);
        const base = snapshot();
        if (base.movement.projection.kind !== 'supported') {
            throw new Error('Movement fixture is unsupported');
        }
        const modified = {
            ...base,
            movement: {
                ...base.movement,
                projection: { ...base.movement.projection, permanentPsrModifier: 3 },
            },
        } as MekRecordSheetSnapshot;

        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, modified);

        expect(svg.querySelector('#gunnerySkillText0')?.textContent).toBe('Gunnery Skill:');
        expect(svg.querySelector('#pilotingSkillText0')?.textContent).toBe('Piloting Skill:');
        expect(svg.querySelector('#gunnerySkill0')?.textContent).toBe('3');
        expect(svg.querySelector('#pilotingSkill0')?.childNodes[0]?.textContent).toBe('4');
        expect(svg.querySelector('#pilotingSkill0 .controlRollModifier')?.textContent).toBe(' +3PSR');
        expect(svg.querySelector('#pilotingSkill0 .controlRollLabel')?.textContent).toBe('PSR');

        binding.render(base);
        expect(svg.querySelector('#pilotingSkill0')?.textContent).toBe('4');
        expect(svg.querySelector('#pilotingSkill0 .controlRollModifier')).toBeNull();
        binding.destroy();
    });

    it('keeps printable misc equipment between ranged weapons and physical attacks', () => {
        const svg = sheet();
        const base = snapshot();
        const equipment = new MiscEquipment({
            id: 'null-signature-system',
            name: 'Null Signature System',
            type: 'misc',
            stats: { hittable: true },
        });
        const withSystem = {
            ...base,
            equipment: [...base.equipment, {
                componentId: 'signature-component',
                label: 'Null Signature System',
                equipment,
                locations: [{ locationId: 'location-ct', code: 'CT' }],
                status: 'available',
                previewStatus: 'available',
                modes: [],
                jammed: false,
            }],
        } as unknown as MekRecordSheetSnapshot;

        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, withSystem);
        const inventory = [...svg.querySelectorAll<SVGElement>('.inventoryEntry')];

        expect(inventory[0].querySelector('.name')?.textContent).toBe('AC/20');
        expect(inventory[1].style.display).toBe('');
        expect(inventory[1].querySelector('.name')?.textContent).toBe('Null Signature System');
        expect(inventory[2].style.display).toBe('none');
        binding.destroy();
    });

    it('binds the complete authored Mek interaction matrix to projected IDs', () => {
        const svg = sheet();
        const inventory = svg.querySelector<SVGElement>('.inventoryEntry')!;
        inventory.insertAdjacentHTML('beforeend', `
            <rect class="inventoryEntryButton mainButton"></rect>
            <rect class="inventoryEntryButton shrButton"></rect>
            <g class="alternativeMode">
                <text class="name"></text><rect class="inventoryEntryButton alternativeModeButton"></rect>
                <rect class="inventoryEntryButton medButton"></rect>
            </g>
        `);
        svg.insertAdjacentHTML('beforeend', `
            <g class="unitConditionButton" condition="menu"><rect></rect><text></text></g>
            <g class="unitConditionButton" condition="shutdown"><rect></rect><text></text></g>
            <g class="locationConditionControl" loc="CT"><rect></rect></g>
            <rect id="applyHeatButton"></rect>
            <rect data-mekbay-open-equipment="weapons"></rect>
            <g class="referenceTable"><rect></rect></g>
        `);
        svg.querySelector('#heatScale')!.insertAdjacentHTML('beforeend', `
            <rect class="overflowFrame"></rect><rect class="overflowButton"></rect>
        `);
        const base = snapshot();
        const interactiveSnapshot = {
            ...base,
            equipment: base.equipment.map((component, index) => index === 0
                ? { ...component, modes: ['Standard', 'Pulse'], defaultMode: 'Standard', mode: 'Standard' }
                : component),
        } as MekRecordSheetSnapshot;
        const interactions: MekRecordSheetInteraction[] = [];
        bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            interactiveSnapshot,
            interaction => interactions.push(interaction),
        );

        const activate = (selector: string, event = 'click'): void => {
            const element = svg.querySelector(selector) as SVGElement | null;
            expect(element).withContext(selector).not.toBeNull();
            element!.dispatchEvent(event === 'contextmenu'
                ? new MouseEvent(event, { bubbles: true, button: 2 })
                : new MouseEvent(event, { bubbles: true }));
        };
        activate('.unitLocation.structure', 'contextmenu');
        activate('.crewHit');
        activate('.crewNameButton');
        activate('.unitConditionButton[condition="menu"]');
        activate('.unitConditionButton[condition="shutdown"]');
        activate('.locationConditionControl[loc="CT"]');
        activate('.inventoryEntryButton.mainButton');
        activate('.inventoryEntryButton.shrButton');
        activate('.alternativeModeButton');
        activate('.alternativeMode .medButton');
        activate('#applyHeatButton');
        activate('.overflowButton');
        activate('[data-mekbay-open-equipment="weapons"]');
        activate('.referenceTable');

        expect(interactions).toContain(jasmine.objectContaining({
            kind: 'internal', locationId: 'location-ct', button: 'secondary',
        }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({
            kind: 'crew-wounds', positionId: 'crew-0', wounds: 0,
        }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'crew-name', positionId: 'crew-0' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'condition-menu' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'shutdown' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'location-condition-menu', locationId: 'location-ct' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'inventory-selection', componentIds: ['weapon-component'] }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'inventory-selection', range: 'short' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'inventory-selection', mode: 'Pulse' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'inventory-selection', mode: 'Pulse', range: 'medium' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'apply-heat' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'heat-overflow' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'open-equipment', tab: 'weapons' }) as unknown as MekRecordSheetInteraction);
        expect(interactions).toContain(jasmine.objectContaining({ kind: 'reference-table' }) as unknown as MekRecordSheetInteraction);
        expect(svg.querySelector('#mpWalk')?.classList).not.toContain('interactive');
        expect(svg.querySelector('.unitLocation.armor')?.classList).toContain('selectable');
        expect(svg.querySelector('.unitConditionButton')?.classList).toContain('edit-only');
    });

    it('rejects an attempt to reuse a binding for another entity', () => {
        const svg = sheet();
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, snapshot());
        expect(() => binding.render({
            ...snapshot(),
            entityUuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2'),
        })).toThrowError(/cannot change its entity/);
    });

    it('rejects a structurally copied or wrong-provider binding manifest', () => {
        const copied = {
            ...MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            selectors: { ...MM_DATA_MEK_SHEET_BINDING_MANIFEST.selectors },
        } as typeof MM_DATA_MEK_SHEET_BINDING_MANIFEST;
        expect(() => bindMekRecordSheet(sheet(), copied, snapshot()))
            .toThrowError(/requires the reviewed manifest/);
    });
});

function sheet(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = `
        <text id="unitName">STALE NAME</text>
        <text id="bv">99999</text><text id="armorType">FORGED ARMOR</text>
        <text id="structureType">FORGED STRUCTURE</text>
        <text id="mpWalk">99</text><text id="mpRun">99</text><text id="mpJump">99</text>
        <text id="hsCount">999</text>
        <g class="hsPips"><circle class="pip"></circle><circle class="pip"></circle>
            <circle class="pip"></circle><circle class="pip"></circle></g>
        <g class="unitConditionButton" condition="shutdown"><rect></rect><text>SHUTDOWN</text></g>
        <g class="unitConditionButton" condition="immobile"><rect></rect><text>FORGED BUTTON</text></g>
        <g class="unitConditionBanner" condition="prone" display="none">
            <rect class="unitConditionBannerRect" height="15"></rect>
            <text class="unitConditionBannerText">FORGED CONDITION</text>
        </g>
        <g class="unitLocation armor" loc="CT"></g>
        <g class="unitLocation structure" loc="CT"></g>
        <g class="unitLocation shield" loc="DALA">
            ${Array(5).fill('<circle class="pip shield"></circle>').join('')}
        </g>
        <g class="unitLocation shield" loc="DCLA">
            ${Array(18).fill('<circle class="pip shield"></circle>').join('')}
        </g>
        <circle class="armor pip" loc="CT"></circle>
        <circle class="armor pip" loc="CT"></circle>
        <circle class="armor pip" loc="CT"></circle>
        <circle class="armor pip damaged pending" loc="CT"></circle>
        <circle class="armor pip damaged pending" loc="CT"></circle>
        <circle class="armor pip damaged pending" loc="CT"></circle>
        <circle class="structure pip" loc="CT"></circle>
        <circle class="structure pip" loc="CT"></circle>
        <circle class="structure pip" loc="CT"></circle>
        <circle class="structure pip damaged pending" loc="CT"></circle>
        <g class="critSlot" loc="CT" slot="0" uid="forged-component" totalAmmo="999">
            <circle class="pip armoredLocPip"></circle>
            <circle class="pip extraHitPip" display="none"></circle>
            <text>FORGED LABEL</text>
        </g>
        <g class="critSlot damaged" loc="CT" slot="1" uid="forged-extra"><text>FORGED EXTRA CRITICAL</text></g>
        <g class="critSlot" loc="CT" slot="2" data-mekbay-empty-slot="1"><text>FORGED EMPTY</text></g>
        <g class="inventoryEntry damaged eq-Kick@—" id="forged-inventory" baseHitMod="99">
            <text class="quantity">99</text><text class="name">FORGED WEAPON</text>
            <text class="location">XX</text><text class="heat">99</text><text class="damage">999</text>
            <text class="range_min">99</text><text class="range_short">99</text>
            <text class="range_medium">99</text><text class="range_long">99</text><text class="range_extreme">99</text>
        </g>
        <g class="inventoryEntry" id="forged-ammo"><text class="name">FORGED AMMO</text></g>
        <g class="inventoryEntry" id="forged-extra-row"><text class="name">FORGED EXTRA EQUIPMENT</text></g>
        <g id="crewDamage0"><text id="crewName0">STALE PILOT</text>
            <circle class="crewHit" crewId="0" hit="1"></circle>
            <circle class="crewHit" crewId="0" hit="2"></circle>
            <rect class="crewNameButton" crewId="0"></rect>
            <rect class="crewSkillButton" crewId="0" skill="gunnery"></rect>
            <rect class="crewStateButton" crewId="0"></rect>
        </g>
        <g id="crewDamage1"><text id="crewName1">FORGED CREW</text>
            <circle class="crewHit damaged" crewId="1" hit="1"></circle>
        </g>
        <g id="ammoProfile"><text>FORGED AMMO PROFILE</text></g>
        <g id="heatScale">
            <rect class="heat" heat="0"></rect>
            <rect class="heat" heat="1"></rect>
            <rect class="heat" heat="2"></rect>
        </g>`;
    return svg;
}

function equipmentHit(value: number) {
    const resolution = Object.freeze({
        profile: Object.freeze([value]),
        value,
        changed: false,
        weakened: false,
        modifierBreakdown: Object.freeze(value === 0 ? [] : [{ label: 'Weapon', modifier: value }]),
    });
    const byRange = Object.freeze({
        short: resolution,
        medium: resolution,
        long: resolution,
        extreme: resolution,
    });
    return Object.freeze({ default: resolution, byRange, indirectByRange: byRange });
}

function snapshot(): MekRecordSheetSnapshot {
    return {
        entityUuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1'),
        ruleset: 'core-2026',
        stateRevision: 7 as MekRecordSheetSnapshot['stateRevision'],
        identity: {
            baseChassis: 'Atlas',
            model: 'AS7-D',
            displayName: 'Atlas AS7-D',
            massTons: 100,
            year: 2755,
            techBase: 'IS',
            form: 'biped',
            engine: '300 Fusion',
            cockpit: 'Standard',
            gyro: 'Standard',
            myomer: 'Standard',
        },
        construction: { armor: 'Standard Armor', structure: 'Endo Steel' },
        battleValue: { pristine: 1810, adjusted: 1897 },
        movement: {
            walkMp: 3,
            runMp: 5,
            jumpMp: 0,
            motiveType: 'Biped',
            declared: { kind: 'supported', mode: 'run' },
            projection: {
                kind: 'supported',
                rulesFlavor: 'core-2026',
                controlledByDrone: false,
                immobile: false,
                walkMp: 2,
                potentialWalkMp: 3,
                runMp: 3,
                maximumRunMp: 5,
                jumpMp: 0,
                umuMp: 0,
                movementImpaired: true,
                permanentPsrModifier: 0,
                pilotingTargetNumber: 4,
                actions: [],
                declaration: { legal: true, maximumMp: 5, reasons: [], warnings: [] },
            },
            psr: {
                movement: { schemaVersion: 1, mode: 'run', distance: 3, boosterComponentIds: [] },
                action: null,
                damageThisPhase: 0,
                checks: [],
            },
        },
        heatSinks: { count: 4, unavailableUnits: 1 },
        heat: { current: 1, previous: 0, heatsinksOff: 1 },
        heatPolicy: 'manual',
        heatProjection: {
            kind: 'supported',
            projection: {
                current: 1,
                sources: [],
                committedSources: [],
                capacity: 2,
                previouslyConsumedDissipation: 0,
                remainingDissipation: 2,
                generated: 0,
                dissipated: 1,
                projected: 0,
                delta: -1,
                hasPendingResolution: true,
                hasPendingSettlement: true,
            },
        },
        lifeSupport: { damaged: false, heatHits: 0, oxygenHits: 0, headHitHits: 1 },
        destroyed: false,
        crippled: false,
        conditions: ['prone'],
        locations: [{
            locationId: 'location-ct',
            code: 'CT',
            maximumInternal: 3,
            committedRemainingInternal: 2,
            previewRemainingInternal: 2,
            committedStructurallyDestroyed: false,
            previewStructurallyDestroyed: false,
            committedDetached: false,
            previewDetached: false,
            committedDisabled: false,
            previewDisabled: false,
            conditions: [],
            armor: [{
                faceId: 'armor-ct-front',
                locationId: 'location-ct',
                locationCode: 'CT',
                face: 'front',
                maximum: 4,
                committedRemaining: 3,
                previewRemaining: 2,
            }],
        }],
        criticalSlots: [{
            slotId: 'slot-ct-0',
            locationId: 'location-ct',
            locationCode: 'CT',
            slotIndex: 0,
            hittable: true,
            armored: false,
            hitCapacity: 1,
            committedHits: 0,
            previewHits: 0,
            components: [{
                componentId: 'ammo-component',
                label: 'FORGED SHOULD NOT SURVIVE',
                status: 'available',
                ammo: {
                    munitionKey: 'ac20-standard',
                    displayName: 'AC/20 Ammo',
                    capacity: 5,
                    remaining: 4,
                },
            }],
        }],
        shields: [],
        equipment: [{
            componentId: 'weapon-component',
            label: 'AC/20',
            equipment: new WeaponEquipment({
                id: 'ac20', name: 'AC/20', type: 'weapon',
                weapon: { heat: 7, damage: 20 },
            }),
            locations: [{ locationId: 'location-ct', code: 'CT' }],
            status: 'available',
            previewStatus: 'available',
            modes: [],
            jammed: false,
            weapon: {
                heat: 7,
                firingHeat: 7,
                selectable: true,
                damage: 20,
                damageText: '20',
                damageTextByRange: { short: '20', medium: '20', long: '20', extreme: '20' },
                hit: equipmentHit(0),
                toHitModifier: 0,
                hitModifierBreakdown: [],
                ranges: [3, 6, 9, 12],
                minimumRange: 0,
                ammoSources: [],
                underwater: false,
                attackerSubmerged: false,
                disabledTargetReasons: {},
            },
        }, {
            componentId: 'ammo-component',
            label: 'AC/20 Ammo',
            locations: [{ locationId: 'location-ct', code: 'CT' }],
            status: 'available',
            previewStatus: 'available',
            modes: [],
            jammed: false,
            ammo: {
                munitionKey: 'ac20-standard',
                displayName: 'AC/20 Ammo',
                capacity: 5,
                remaining: 4,
                loadouts: [],
            },
        }],
        physicalAttacks: { kind: 'unsupported', blockers: ['fixture'] },
        crew: [{
            positionId: 'crew-0',
            positionKey: 'crew:0',
            occurrence: 0,
            name: 'Morgan',
            role: 'MechWarrior',
            gunnery: 3,
            piloting: 4,
            state: { wounds: 1, unconscious: false },
        }],
    } as unknown as MekRecordSheetSnapshot;
}
