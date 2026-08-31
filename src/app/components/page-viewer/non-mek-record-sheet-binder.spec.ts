// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    asArmorFaceId,
    asComponentId,
    asSystemDamageTrackId,
    asCrewPositionId,
    asLocationId,
} from '../../models/entity/entity-identifiers';
import type { EquipmentPanelSnapshot } from '../../models/runtime/equipment-panel';
import type { NonMekRecordSheetSnapshot } from '../../models/runtime/non-mek-record-sheet';
import { asStateRevision } from '../../models/runtime/runtime-state';
import { CapitalShipPipRenderer } from '../../utils/sheets/capital-ship-pip-renderer';
import { optimizeGeneratedSvg } from '../../utils/sheets/record-sheet-svg-rendering';
import {
    bindNonMekRecordSheet,
    type NonMekRecordSheetInteraction,
} from './non-mek-record-sheet-binder';

describe('bindNonMekRecordSheet', () => {
    it('renders entity damage and emits stable runtime identifiers', () => {
        const svg = sheet();
        const interactions: NonMekRecordSheetInteraction[] = [];
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

    it('shows and clears the destroyed overlay from runtime state', () => {
        const svg = sheet();
        const binding = bindNonMekRecordSheet(svg, snapshot(3, true));

        expect(svg.querySelector('#destroyed-overlay')?.textContent).toBe('DESTROYED');
        binding.render(snapshot(3, false));
        expect(svg.querySelector('#destroyed-overlay')).toBeNull();
    });

    it('binds the first Battle Armor pip to the trooper and the remaining pips to armor', () => {
        const svg = combinedSheet();
        const interactions: NonMekRecordSheetInteraction[] = [];
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
        const interactions: NonMekRecordSheetInteraction[] = [];
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

    it('binds every pip when an authored sheet has no location zone or hit area', () => {
        const svg = pipOnlySheet();
        const interactions: NonMekRecordSheetInteraction[] = [];
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

    it('binds and updates one aggregate target per capital-grid block', () => {
        const svg = capitalGridSheet();
        const interactions: NonMekRecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(
            svg,
            capitalSnapshot(5_999),
            interaction => interactions.push(interaction),
        );
        const grid = svg.querySelector<SVGElement>('.capital-pip-grid')!;
        const targets = [...svg.querySelectorAll<SVGElement>('.capital-pip-interaction')];
        const path = (className: string): string =>
            svg.querySelector(`.${className}`)?.getAttribute('d') ?? '';

        expect(targets.length).toBe(60);
        expect(targets.every(target => target.dataset['mekbayEntityBound'] === '1')).toBeTrue();
        expect(targets.every(target => target.style.fill === 'transparent'
            && target.style.getPropertyPriority('fill') === 'important')).toBeTrue();
        expect(grid.dataset['mekbayEntityBound']).toBeUndefined();
        expect(svg.querySelectorAll('.pip').length).toBe(0);
        expect(path('capital-pip-state-damaged')).not.toBe('');

        expect(binding.render(capitalSnapshot(5_999, 5_997))).toEqual([]);
        expect(path('capital-pip-state-fresh-damage')).not.toBe('');
        expect(path('capital-pip-state-pending-damage')).toBe('');

        expect(binding.render(capitalSnapshot(5_999, 5_997))).toEqual([]);
        expect(path('capital-pip-state-fresh-damage')).toBe('');
        expect(path('capital-pip-state-pending-damage')).not.toBe('');

        expect(binding.render(capitalSnapshot(5_997, 5_999))).toEqual([]);
        expect(path('capital-pip-state-fresh-repair')).not.toBe('');
        expect(path('capital-pip-state-pending-repair')).toBe('');

        targets[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'armor', faceId: FACE_ID, locationId: LOCATION_ID }),
        ]);
    });

    it('renders toggle, counted motive, and VTOL rotor damage-track previews exactly', () => {
        const svg = criticalSheet();
        const interactions: NonMekRecordSheetInteraction[] = [];
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

    it('renders and binds conventional-infantry casualties on the soldier grid', () => {
        const svg = soldierSheet();
        const interactions: NonMekRecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, soldierSnapshot(3), interaction => interactions.push(interaction));

        expect(svg.querySelector('#soldier_4')?.classList.contains('damaged')).toBeTrue();
        expect(svg.querySelector('#soldier_3')?.classList.contains('damaged')).toBeFalse();
        expect(svg.querySelector('#damage_4')?.classList.contains('disabled-text')).toBeTrue();
        svg.querySelector('#soldier_2')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(interactions).toEqual([
            jasmine.objectContaining({ kind: 'soldier', locationId: INFANTRY_ID, soldierNumber: 2 }),
        ]);
        expect(svg.querySelector('#soldier_2')?.classList.contains('soldierPip')).toBeTrue();
        expect(svg.querySelector('#soldier_2')?.getAttribute('soldier-id')).toBe('2');

        binding.render(soldierSnapshot(2));
        expect(svg.querySelector('#soldier_3')?.classList.contains('damaged')).toBeTrue();
        expect(binding.render(soldierSnapshot(2))).not.toContain('Missing crew layout');
    });

    it('renders and binds the shared vehicle condition and crew controls', () => {
        const svg = stateSheet();
        const interactions: NonMekRecordSheetInteraction[] = [];
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
        const interactions: NonMekRecordSheetInteraction[] = [];
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
        const interactions: NonMekRecordSheetInteraction[] = [];
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
            stateRevision: asStateRevision(4),
            targetRegistryRevision: asStateRevision(1),
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
            expectedRevision: asStateRevision(4),
        })]);
    });

    it('binds generated alternative-mode rows with the authoritative component mode', () => {
        const svg = modeInventorySheet();
        const interactions: NonMekRecordSheetInteraction[] = [];
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
            stateRevision: asStateRevision(4),
            targetRegistryRevision: asStateRevision(1),
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
            expectedRevision: asStateRevision(4),
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

function snapshot(remaining: number, destroyed = false): NonMekRecordSheetSnapshot {
    return Object.freeze({
        entityUuid: '019f6767-0dcb-7bb8-992f-aef08202f5e1',
        stateRevision: asStateRevision(4),
        displayName: 'Test Tank T-1',
        unitType: 'Tank',
        subtype: 'Combat Vehicle',
        tonnage: 20,
        year: 3050,
        techBase: 'IS',
        role: 'Brawler',
        movementType: 'Tracked',
        movement: Object.freeze({ walk: 5, run: 8, jump: 0, umu: 0 }),
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
        sheetId: string,
        committedHits: number,
        previewHits: number,
        visibleHitPips?: number,
    ) => Object.freeze({
        damageTrackId,
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
            role: 'Crew',
            gunnery: 4,
            piloting: 5,
            state: Object.freeze({ wounds, unconscious: false, ejected: false, state: 'killed' as const }),
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
        <g class="unitLocation armor" loc="FR"></g>
        <circle class="pip armor" loc="FR"></circle>
        <circle class="pip armor" loc="FR"></circle>
        <circle class="pip armor" loc="FR"></circle>
        <g class="unitLocation structure" loc="FR"></g>
        <circle class="pip structure" loc="FR"></circle>
        <circle class="pip structure" loc="FR"></circle>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function combinedSheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <g class="unitLocation armor" loc="T1"></g>
        <circle class="pip armor" loc="T1"></circle>
        <circle class="pip armor" loc="T1"></circle>
        <circle class="pip armor" loc="T1"></circle>
        <circle class="pip armor" loc="T1"></circle>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function hitAreaSheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <circle class="pip armor" loc="FR"></circle>
        <circle class="pip armor" loc="FR"></circle>
        <circle class="pip armor" loc="FR"></circle>
        <circle class="pip-hit-area armor" loc="FR"></circle>
        <circle class="pip-hit-area armor" loc="FR"></circle>
        <circle class="pip structure" loc="FR"></circle>
        <circle class="pip structure" loc="FR"></circle>
        <circle class="pip-hit-area structure" loc="FR"></circle>
        <circle class="pip-hit-area structure" loc="FR"></circle>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function pipOnlySheet(): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
        <circle class="pip armor" loc="FR"></circle>
        <circle class="pip armor" loc="FR"></circle>
        <circle class="pip armor" loc="FR"></circle>
        <circle class="pip structure" loc="FR"></circle>
        <circle class="pip structure" loc="FR"></circle>
    </svg>`;
    return host.querySelector('svg') as SVGSVGElement;
}

function capitalGridSheet(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.appendChild(CapitalShipPipRenderer.createPips(6_000, 1_000, 500, 'armor', 'FR')!);
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
        <g id="rotor_hits_group" class="critLoc counterGroup rotorHitsControl" critId="rotor">
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
        <image id="soldier_1"></image><text id="damage_1"></text>
        <image id="soldier_2"></image><text id="damage_2"></text>
        <image id="soldier_3"></image><text id="damage_3"></text>
        <image id="soldier_4"></image><text id="damage_4"></text>
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
