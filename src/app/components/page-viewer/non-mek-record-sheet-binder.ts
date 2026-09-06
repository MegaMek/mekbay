// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
ComponentId,
} from '../../models/entity/entity-identifiers';
import type { EntityTechBase } from '../../models/entity/types';
import type { AttackerSelection } from '../../models/runtime/attacker-targeting-state';
import type { EquipmentPanelComponent,EquipmentPanelSnapshot } from '../../models/runtime/equipment-panel';
import {
equipmentWeaponToHitModifier,
projectTargetingTarget,
projectWeaponTargetPresentation,
} from '../../models/runtime/equipment-panel';
import { recordSheetHeatEffects } from '../../models/runtime/heat-effect-presentation';
import type {
NonMekRecordSheetArmorFace,
NonMekRecordSheetDamageTrack,
NonMekRecordSheetLocation,
NonMekRecordSheetSnapshot,
} from '../../models/runtime/non-mek-record-sheet';
import type { UnitEditContext } from '../../models/runtime/unit-edit-context';
import {
crewStateDefinitions,
UNIT_CONDITION_DEFINITIONS,
unitConditionControls,
} from '../../models/unit-status-presentation';
import { recordSheetAmmoName } from '../../utils/record-sheet-ammo.util';
import { CapitalShipPipRenderer } from '../../utils/sheets/capital-ship-pip-renderer';
import { RecordSheetDamageHighlights } from '../../utils/sheets/record-sheet-damage-highlights';
import {
createInfantryStrengthDisplay,
INFANTRY_STRENGTH_DISPLAY_ID,
type InfantryStrengthDisplay,
} from '../../utils/sheets/infantry-strength-display';
import { updateRecordSheetAmmoProfile } from '../../utils/sheets/record-sheet-ammo-rendering';
import { renderHandheldWeaponAmmoPips } from '../../utils/sheets/layouts/handheld-weapon-record-sheet-layout';
import { formatRecordSheetTonnage } from '../../utils/sheets/record-sheet-svg-rendering';
import {
renderRecordSheetConditions,
renderRecordSheetCrewState,
renderRecordSheetDestroyed,
renderRecordSheetPips,
} from './record-sheet-dom';
import { renderRecordSheetHeatEffects } from './record-sheet-heat-effects';
import type { RecordSheetInteraction } from './record-sheet-interaction';

export interface NonMekRecordSheetBinding {
    render(snapshot: NonMekRecordSheetSnapshot, equipmentPanel?: EquipmentPanelSnapshot | null): readonly string[];
    destroy(): void;
}

export function bindNonMekRecordSheet(
    svg: SVGSVGElement,
    initial: NonMekRecordSheetSnapshot,
    onInteraction?: (interaction: RecordSheetInteraction, event: Event) => void,
    initialEquipmentPanel?: EquipmentPanelSnapshot | null,
): NonMekRecordSheetBinding {
    const abort = new AbortController();
    const highlights = new RecordSheetDamageHighlights();
    const entityUuid = initial.entityUuid;
    let current = initial;
    let currentEquipmentPanel = initialEquipmentPanel ?? null;
    let firstRender = true;
    let infantryDisplay: InfantryStrengthDisplay | undefined;

    const bind = (
        element: SVGElement,
        interaction: () => RecordSheetInteraction | null,
    ): void => {
        if (!onInteraction || element.dataset['mekbayEntityBound'] === '1') return;
        element.dataset['mekbayEntityBound'] = '1';
        element.classList.add('interactive', 'selectable');
        element.setAttribute('tabindex', '0');
        const emit = (event: Event): void => {
            if (element.style.display === 'none') return;
            event.preventDefault();
            event.stopPropagation();
            const selected = interaction();
            if (selected) onInteraction(selected, event);
        };
        element.addEventListener('click', emit, { signal: abort.signal });
        element.addEventListener('contextmenu', emit, { signal: abort.signal });
        element.addEventListener('keydown', event => {
            if (!(event instanceof KeyboardEvent) || (event.key !== 'Enter' && event.key !== ' ')) return;
            emit(event);
        }, { signal: abort.signal });
    };

    const render = (
        snapshot: NonMekRecordSheetSnapshot,
        equipmentPanel: EquipmentPanelSnapshot | null = currentEquipmentPanel,
    ): readonly string[] => {
        if (snapshot.entityUuid !== entityUuid) {
            throw new Error('Record-sheet binding cannot change its entity');
        }
        current = snapshot;
        currentEquipmentPanel = equipmentPanel;
        const issues: string[] = [];
        const markChanges = !firstRender;
        renderIdentity(svg, snapshot);
        if (onInteraction) {
            svg.querySelectorAll<SVGElement>('[data-mekbay-random-hit="1"]').forEach(element => {
                if (element.dataset['mekbayEntityBound'] === '1') return;
                element.dataset['mekbayEntityBound'] = '1';
                element.classList.add('interactive');
                element.setAttribute('tabindex', '0');
                const activate = (event: Event): void => {
                    event.preventDefault();
                    event.stopPropagation();
                    onInteraction(Object.freeze({ kind: 'random-hit', element, context: current.editContext }), event);
                };
                element.addEventListener('pointerdown', event => {
                    if (event instanceof PointerEvent && event.button === 0) activate(event);
                }, { signal: abort.signal });
                element.addEventListener('keydown', event => {
                    if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) activate(event);
                }, { signal: abort.signal });
            });
        }
        renderConditions(svg, snapshot, bind, () => current);
        renderCrew(svg, snapshot, bind, () => current);
        for (const location of snapshot.locations) {
            if (location.soldierPips === true) {
                infantryDisplay = renderInfantryStrength(highlights, svg, location, snapshot, infantryDisplay, issues, bind,
                    () => current.editContext, markChanges);
                continue;
            }
            if (!location.sheetCode) continue;
            if (location.combinedPips === true) {
                renderCombinedLocation(highlights, svg, location, issues, bind, () => current.editContext, markChanges);
                continue;
            }
            const code = attributeValue(location.sheetCode);
            const internalPips = [...svg.querySelectorAll<SVGElement>(`.structure.pip[data-loc="${code}"]`)];
            const internalGrids = [
                ...svg.querySelectorAll<SVGElement>(`.capital-pip-grid.structure[data-loc="${code}"]`),
            ];
            renderRecordSheetPips(
                highlights,
                internalPips,
                location.maximumInternal,
                location.remainingInternal,
                location.previewRemainingInternal,
                markChanges,
            );
            CapitalShipPipRenderer.renderDamage(
                highlights,
                internalGrids,
                location.maximumInternal,
                location.remainingInternal,
                location.previewRemainingInternal,
                markChanges,
            );
            const internalCapacity = internalPips.length + CapitalShipPipRenderer.capacity(internalGrids);
            if (location.maximumInternal > 0 && internalCapacity < location.maximumInternal) {
                issues.push(`Missing structure pips for ${location.sheetCode}: ${internalCapacity}/${location.maximumInternal}`);
            }
            const internalTargets = interactionTargets(
                [...svg.querySelectorAll<SVGElement>(`.unitLocation.structure[data-loc="${code}"]`)],
                [...svg.querySelectorAll<SVGElement>(`.pip-hit-area.structure[data-loc="${code}"]`)],
                internalPips,
            );
            internalTargets.forEach(target => {
                if (!target.classList.contains('pip')) {
                    target.classList.toggle('damaged', location.previewRemainingInternal === 0);
                }
                bind(target, () => Object.freeze({
                    kind: 'internal',
                    locationId: location.locationId,
                    context: current.editContext,
                }));
            });

            for (const face of location.armor) {
                renderArmorFace(
                    highlights,
                    svg,
                    location.sheetCode,
                    face,
                    issues,
                    bind,
                    () => current.editContext,
                    markChanges,
                );
            }
        }
        renderDamageTracks(svg, snapshot.damageTracks, issues, bind, () => current.editContext);
        renderComponents(svg, snapshot, issues);
        renderAmmoProfile(svg, snapshot, onInteraction !== undefined);
        const ammoProfile = svg.querySelector<SVGElement>('#ammoProfile');
        if (ammoProfile) bind(ammoProfile, () => Object.freeze({
            kind: 'open-equipment',
            tab: 'ammo',
            context: current.editContext,
        }));
        if (currentEquipmentPanel !== null) {
            renderInventorySelections(
                svg,
                snapshot,
                currentEquipmentPanel,
                bind,
                () => current.editContext,
            );
        }
        renderHeat(svg, snapshot, issues, bind, () => current);
        renderRecordSheetDestroyed(svg, snapshot.destroyed);
        firstRender = false;
        return Object.freeze(issues);
    };

    render(initial);
    return Object.freeze({
        render,
        destroy: () => {
            abort.abort();
            highlights.destroy();
            svg.querySelector('#ammoProfile > .inventoryEntryButton')?.remove();
            svg.querySelectorAll<SVGElement>('[data-mekbay-entity-bound="1"]').forEach(element => {
                delete element.dataset['mekbayEntityBound'];
                element.classList.remove('interactive', 'selectable');
                element.removeAttribute('tabindex');
            });
        },
    });
}

function renderConditions(
    svg: SVGSVGElement,
    snapshot: NonMekRecordSheetSnapshot,
    bind: (element: SVGElement, interaction: () => RecordSheetInteraction) => void,
    current: () => NonMekRecordSheetSnapshot,
): void {
    renderRecordSheetConditions(svg, snapshot.conditions, UNIT_CONDITION_DEFINITIONS);
    const controls = unitConditionControls(snapshot.conditionControlKeys);
    for (const control of controls.filter(candidate => candidate.placement === 'button')) {
        svg.querySelectorAll<SVGElement>(`.unitConditionButton[condition="${attributeValue(control.key)}"]`)
            .forEach(button => bind(button, () => Object.freeze({
                kind: 'condition',
                condition: control.key,
                context: current().editContext,
            })));
    }
    if (controls.some(control => control.placement === 'menu')) {
        svg.querySelectorAll<SVGElement>('.unitConditionButton[condition="menu"]')
            .forEach(button => bind(button, () => Object.freeze({
                kind: 'condition-menu',
                context: current().editContext,
            })));
    }
}

function renderCrew(
    svg: SVGSVGElement,
    snapshot: NonMekRecordSheetSnapshot,
    bind: (element: SVGElement, interaction: () => RecordSheetInteraction) => void,
    current: () => NonMekRecordSheetSnapshot,
): void {
    const displays = crewStateDefinitions(snapshot.crewStateDisplayKeys);
    for (const position of snapshot.crew) {
        const occurrence = position.occurrence;
        const vacant = position.effectiveState === 'vacant';
        const nameButton = svg.querySelector<SVGElement>(`.crewNameButton[crewId="${occurrence}"]`);
        const mappedName = nameButton?.getAttribute('textElement');
        const name = mappedName ? svg.getElementById(mappedName) : svg.getElementById(`crewName${occurrence}`);
        if (name) name.textContent = vacant ? 'VACANT' : position.name;
        const gunnery = svg.getElementById(`gunnerySkill${occurrence}`);
        if (gunnery) gunnery.textContent = vacant ? '—' : String(position.gunnery);
        const piloting = svg.getElementById(`pilotingSkill${occurrence}`);
        if (piloting) piloting.textContent = vacant ? '—' : String(position.piloting);
        svg.querySelectorAll<SVGElement>(
            `.crewNameButton[crewId="${occurrence}"], .crewSkillButton[crewId="${occurrence}"]`,
        ).forEach(button => bind(button, () => Object.freeze({
            kind: 'crew-profile',
            positionId: position.positionId,
            context: current().editContext,
        })));
        for (let wounds = 1; wounds <= 6; wounds += 1) {
            const marker = svg.querySelector<SVGElement>(
                `.crewHit[crewId="${position.occurrence}"][hit="${wounds}"]`,
            );
            if (!marker) continue;
            marker.style.display = vacant ? 'none' : '';
            marker.classList.toggle('damaged', wounds <= position.state.wounds);
            if (vacant) continue;
            bind(marker, () => {
                const latest = current();
                const currentPosition = latest.crew.find(row => row.positionId === position.positionId);
                const currentWounds = currentPosition?.state.wounds ?? 0;
                return Object.freeze({
                    kind: 'crew-wounds',
                    positionId: position.positionId,
                    wounds: currentWounds === wounds ? Math.max(0, wounds - 1) : wounds,
                    context: latest.editContext,
                });
            });
        }
        const display = position.effectiveState === 'healthy'
            ? null
            : displays.find(candidate => candidate.key === position.effectiveState) ?? null;
        renderRecordSheetCrewState(svg, position.occurrence, display);
        svg.querySelectorAll<SVGElement>(`.crewStateButton[crewId="${position.occurrence}"]`)
            .forEach(button => bind(button, () => Object.freeze({
                kind: 'crew-state-menu',
                positionId: position.positionId,
                context: current().editContext,
            })));
    }
}

function renderDamageTracks(
    svg: SVGSVGElement,
    damageTracks: readonly NonMekRecordSheetDamageTrack[],
    issues: string[],
    bind: (
        element: SVGElement,
        interaction: () => RecordSheetInteraction,
    ) => void,
    context: () => UnitEditContext,
): void {
    for (const track of damageTracks) {
        const element = damageTrackElement(svg, track.sheetId);
        if (!element) {
            if (track.committedHits > 0 || track.previewHits > 0) {
                issues.push(`Missing damage-track control ${track.sheetId}`);
            }
            continue;
        }
        const pendingHits = track.previewHits - track.committedHits;
        if (track.visibleHitPips !== undefined) {
            renderCountedDamageTrackPips(svg, track, issues);
            element.classList.toggle('damaged', track.committedHits > 0);
            element.classList.toggle('willChange',
                (track.committedHits > 0) !== (track.previewHits > 0));
        } else if (track.sheetId === 'rotor') {
            renderRotorHits(svg, track.committedHits, pendingHits);
            element.classList.toggle('rotorHitsDamaged', track.committedHits > 0);
            element.classList.toggle('rotorHitsPendingPositive', pendingHits > 0);
            element.classList.toggle('rotorHitsPendingNegative', pendingHits < 0);
        } else {
            element.classList.toggle('damaged', track.committedHits > 0);
            element.classList.toggle('willChange', track.previewHits !== track.committedHits);
        }
        bind(element, () => Object.freeze({
            kind: 'damage-track',
            damageTrackId: track.damageTrackId,
            context: context(),
        }));
    }
}

function renderCountedDamageTrackPips(
    svg: SVGSVGElement,
    track: NonMekRecordSheetDamageTrack,
    issues: string[],
): void {
    const group = svg.getElementById(`${track.sheetId}_pips`);
    const pips = [...(group?.querySelectorAll<SVGElement>('.motiveHitPip') ?? [])];
    if (pips.length < (track.visibleHitPips ?? 0)) {
        issues.push(`Missing damage-track pips for ${track.sheetId}: ${pips.length}/${track.visibleHitPips}`);
    }
    const pendingHits = track.previewHits - track.committedHits;
    const pendingAdds = Math.max(0, pendingHits);
    const pendingRepairs = Math.max(0, -pendingHits);
    pips.forEach((pip, index) => {
        const committed = index < track.committedHits;
        const pendingAdd = index >= track.committedHits
            && index < track.committedHits + pendingAdds;
        const pendingRepair = index >= Math.max(0, track.committedHits - pendingRepairs)
            && index < track.committedHits;
        pip.classList.toggle('damaged', committed);
        pip.classList.toggle('willChange', pendingAdd || pendingRepair);
        pip.classList.toggle('pendingRemoval', pendingRepair);
        pip.classList.toggle('hidden', !committed && !pendingAdd);
    });
    group?.classList.toggle('hasVisiblePips', pips.some(pip => !pip.classList.contains('hidden')));
}

function renderRotorHits(svg: SVGSVGElement, committedHits: number, pendingHits: number): void {
    const counter = svg.getElementById('rotor_hits_counter');
    if (!counter) return;
    counter.textContent = '';
    const committed = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    committed.setAttribute('class', 'rotorHitsCommitted');
    committed.textContent = String(committedHits);
    counter.appendChild(committed);
    if (pendingHits === 0) return;
    const pending = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    pending.setAttribute('class', pendingHits > 0 ? 'rotorHitsPending positive' : 'rotorHitsPending negative');
    pending.textContent = pendingHits > 0 ? `+${pendingHits}` : String(pendingHits);
    counter.appendChild(pending);
}

function damageTrackElement(svg: SVGSVGElement, sheetId: string): SVGElement | null {
    return svg.querySelector<SVGElement>(`.critLoc[critId="${attributeValue(sheetId)}"]`)
        ?? svg.getElementById(sheetId) as SVGElement | null;
}

function renderInfantryStrength(
    highlights: RecordSheetDamageHighlights,
    svg: SVGSVGElement,
    location: NonMekRecordSheetLocation,
    snapshot: NonMekRecordSheetSnapshot,
    existing: InfantryStrengthDisplay | undefined,
    issues: string[],
    bind: (
        element: SVGElement,
        interaction: () => RecordSheetInteraction | null,
    ) => void,
    context: () => UnitEditContext,
    markChanges: boolean,
): InfantryStrengthDisplay | undefined {
    const host = svg.getElementById(INFANTRY_STRENGTH_DISPLAY_ID) as SVGGElement | null;
    if (host === null) {
        issues.push('Missing generated infantry strength display');
        return existing;
    }
    const display = existing ?? createInfantryStrengthDisplay(svg, host, highlights);
    display.render(snapshot.infantry, {
        maximum: location.maximumInternal,
        committedRemaining: location.remainingInternal,
        previewRemaining: location.previewRemainingInternal,
    }, markChanges);
    for (const cell of display.cells) {
        if (!host.contains(cell.element)) {
            issues.push('Missing generated infantry strength cell');
            continue;
        }
        if (cell.selection() === null) continue;
        bind(cell.element, () => {
            const strength = cell.selection();
            return strength === null ? null : Object.freeze({
                kind: 'infantry-strength',
                locationId: location.locationId,
                strength,
                context: context(),
            });
        });
    }
    return display;
}

function renderCombinedLocation(
    highlights: RecordSheetDamageHighlights,
    svg: SVGSVGElement,
    location: NonMekRecordSheetLocation,
    issues: string[],
    bind: (
        element: SVGElement,
        interaction: () => RecordSheetInteraction,
    ) => void,
    context: () => UnitEditContext,
    markChanges: boolean,
): void {
    const face = location.armor.find(candidate => candidate.face === 'front');
    if (!face) return;
    const code = attributeValue(location.sheetCode);
    const pips = [...svg.querySelectorAll<SVGElement>(`.armor.pip:not([data-rear])[data-loc="${code}"]`)];
    const internalPips = pips.slice(0, location.maximumInternal);
    const armorPips = pips.slice(location.maximumInternal);
    renderRecordSheetPips(
        highlights,
        internalPips,
        location.maximumInternal,
        location.remainingInternal,
        location.previewRemainingInternal,
        markChanges,
    );
    renderRecordSheetPips(
        highlights,
        armorPips,
        face.maximum,
        location.remainingInternal === 0 ? 0 : face.remaining,
        location.previewRemainingInternal === 0 ? 0 : face.previewRemaining,
        markChanges,
    );
    const required = location.maximumInternal + face.maximum;
    if (required > 0 && pips.length < required) {
        issues.push(`Missing combined pips for ${location.sheetCode}: ${pips.length}/${required}`);
    }

    internalPips.forEach(target => {
        target.style.pointerEvents = '';
        bind(target, () => Object.freeze({
            kind: 'internal',
            locationId: location.locationId,
            context: context(),
        }));
    });
    const armorTargets = interactionTargets(
        [...svg.querySelectorAll<SVGElement>(`.unitLocation.armor:not([data-rear])[data-loc="${code}"]`)],
        [],
        armorPips,
    );
    armorTargets.forEach(target => {
        if (!target.classList.contains('pip')) {
            target.classList.toggle(
                'damaged',
                location.previewRemainingInternal === 0 || face.previewRemaining === 0,
            );
        }
        bind(target, () => Object.freeze({
            kind: 'armor',
            faceId: face.faceId,
            locationId: location.locationId,
            context: context(),
        }));
    });
}

function renderArmorFace(
    highlights: RecordSheetDamageHighlights,
    svg: SVGSVGElement,
    sheetCode: string,
    face: NonMekRecordSheetArmorFace,
    issues: string[],
    bind: (
        element: SVGElement,
        interaction: () => RecordSheetInteraction,
    ) => void,
    context: () => UnitEditContext,
    markChanges: boolean,
): void {
    const code = attributeValue(sheetCode);
    const rear = face.face === 'rear';
    const rearSelector = rear ? '[data-rear]' : ':not([data-rear])';
    const pips = [...svg.querySelectorAll<SVGElement>(`.armor.pip${rearSelector}[data-loc="${code}"]`)];
    const grids = [
        ...svg.querySelectorAll<SVGElement>(`.capital-pip-grid.armor${rearSelector}[data-loc="${code}"]`),
    ];
    renderRecordSheetPips(highlights, pips, face.maximum, face.remaining, face.previewRemaining, markChanges);
    CapitalShipPipRenderer.renderDamage(
        highlights,
        grids,
        face.maximum,
        face.remaining,
        face.previewRemaining,
        markChanges,
    );
    const capacity = pips.length + CapitalShipPipRenderer.capacity(grids);
    if (face.maximum > 0 && capacity < face.maximum) {
        issues.push(`Missing ${rear ? 'rear ' : ''}armor pips for ${sheetCode}: ${capacity}/${face.maximum}`);
    }
    const targets = interactionTargets(
        [...svg.querySelectorAll<SVGElement>(`.unitLocation.armor${rearSelector}[data-loc="${code}"]`)],
        [...svg.querySelectorAll<SVGElement>(`.pip-hit-area.armor${rearSelector}[data-loc="${code}"]`)],
        pips,
    );
    targets.forEach(target => {
        if (!target.classList.contains('pip')) {
            target.classList.toggle('damaged', face.previewRemaining === 0);
        }
        bind(target, () => Object.freeze({
            kind: 'armor',
            faceId: face.faceId,
            locationId: face.locationId,
            context: context(),
        }));
    });
}

function interactionTargets(
    unitLocations: readonly SVGElement[],
    hitAreas: readonly SVGElement[],
    pips: readonly SVGElement[],
): readonly SVGElement[] {
    if (unitLocations.length > 0) {
        hitAreas.forEach(element => { element.style.pointerEvents = 'none'; });
        pips.forEach(element => { element.style.pointerEvents = 'none'; });
        return unitLocations;
    }
    // Paperdoll geometry owns damage interaction even if a location is omitted.
    if (pips.some(pip => pip.closest('[data-mekbay-paperdoll="1"]'))
        || hitAreas.some(area => area.closest('[data-mekbay-paperdoll="1"]'))) {
        hitAreas.forEach(element => { element.style.pointerEvents = 'none'; });
        pips.forEach(element => { element.style.pointerEvents = 'none'; });
        return [];
    }
    if (hitAreas.length > 0) {
        hitAreas.forEach(element => { element.style.pointerEvents = ''; });
        pips.forEach(element => { element.style.pointerEvents = 'none'; });
        return hitAreas;
    }
    pips.forEach(element => { element.style.pointerEvents = ''; });
    return pips;
}

function renderIdentity(svg: SVGSVGElement, snapshot: NonMekRecordSheetSnapshot): void {
    const battleValue = snapshot.currentBattleValue === snapshot.pristineBattleValue
        ? snapshot.currentBattleValue
        : `${snapshot.currentBattleValue} (${snapshot.pristineBattleValue})`;
    const battleValueSuffix = svg.getElementById('bv')?.getAttribute('data-mekbay-bv-suffix') ?? '';
    const jump = snapshot.movement.umu > 0 ? snapshot.movement.umu : snapshot.movement.jump;
    const tonnage = formatRecordSheetTonnage(snapshot.tonnage,
        svg.querySelector('[data-mekbay-weight-unit="kg"]') !== null);
    const fields: Readonly<Record<string, string | number>> = Object.freeze({
        type: snapshot.displayName,
        unitName: snapshot.displayName,
        'unit-name': snapshot.displayName,
        tonnage,
        year: snapshot.year,
        techBase: formatTechBase(snapshot.techBase, snapshot.mixedTech),
        role: snapshot.role,
        movementType: snapshot.movementType,
        mpWalk: snapshot.movement.walk,
        mpRun: snapshot.movement.run,
        mpJump: jump,
        mp_2: jump,
        bv: `${battleValue}${battleValueSuffix}`,
    });
    for (const [id, value] of Object.entries(fields)) {
        const element = svg.getElementById(id);
        if (element) element.textContent = String(value);
    }
    const semanticFields: Readonly<Record<string, string | number>> = Object.freeze({
        'display-name': snapshot.displayName,
        tonnage,
        year: snapshot.year,
        'tech-base': formatTechBase(snapshot.techBase, snapshot.mixedTech),
        role: snapshot.role,
        bv: battleValue,
        walk: snapshot.movement.walk,
        run: snapshot.movement.run,
        jump,
    });
    for (const [field, value] of Object.entries(semanticFields)) {
        svg.querySelectorAll<SVGElement>(`[data-mekbay-field="${field}"]`)
            .forEach(element => { element.textContent = String(value); });
    }
}

function renderHeat(
    svg: SVGSVGElement,
    snapshot: NonMekRecordSheetSnapshot,
    issues: string[],
    bind: (element: SVGElement, interaction: () => RecordSheetInteraction) => void,
    current: () => NonMekRecordSheetSnapshot,
): void {
    if (!snapshot.heat.tracked) return;
    const cells = [...svg.querySelectorAll<SVGElement>('#heatScale .heat[heat]')]
        .map(element => ({ element, heat: Number(element.getAttribute('heat')) }))
        .filter((row): row is { element: SVGElement; heat: number } => Number.isSafeInteger(row.heat));
    if (cells.length === 0) issues.push('Missing heat scale');
    const displayed = snapshot.heat.pending ?? snapshot.heat.current;
    const highest = cells.reduce((maximum, row) => Math.max(maximum, row.heat), 0);
    cells.forEach(row => {
        row.element.classList.toggle('hot', row.heat <= displayed);
        bind(row.element, () => Object.freeze({
            kind: 'heat',
            heat: row.heat,
            context: current().editContext,
        }));
    });
    renderRecordSheetHeatEffects(svg, recordSheetHeatEffects('aero', displayed));
    const overflow = svg.querySelector<SVGElement>('#heatScale .overflowButton, #heatScale .overflowFrame');
    overflow?.classList.toggle('hot', displayed > highest);
    if (overflow) bind(overflow, () => Object.freeze({
        kind: 'heat-overflow',
        context: current().editContext,
    }));
    const overflowText = svg.querySelector<SVGElement>('#heatScale .overflowText');
    if (overflowText) overflowText.textContent = displayed > highest ? String(displayed) : '';

    const panel = svg.querySelector<SVGElement>('#heatDataPanel');
    panel?.classList.toggle('dirtyHeat', snapshot.heat.pending !== null);
    panel?.classList.toggle('heatApplicationAvailable', snapshot.heat.pending !== null);
    panel?.classList.toggle('hot', snapshot.heat.pending !== null
        && snapshot.heat.pending >= snapshot.heat.current);
    panel?.classList.toggle('cold', snapshot.heat.pending !== null
        && snapshot.heat.pending < snapshot.heat.current);
    const apply = svg.getElementById('applyHeatButton') as SVGElement | null;
    if (apply) bind(apply, () => Object.freeze({
        kind: 'apply-heat',
        context: current().editContext,
    }));

    const pips = [...svg.querySelectorAll<SVGElement>('.hsPips .pip')];
    pips.forEach((pip, index) => {
        const ordinal = index + 1;
        pip.style.display = ordinal <= snapshot.heat.heatSinkCount ? '' : 'none';
        pip.classList.toggle(
            'disabled',
            ordinal > snapshot.heat.heatSinkCount - snapshot.heat.heatsinksOff,
        );
    });
    const count = svg.getElementById('hsCount');
    if (count) {
        count.textContent = snapshot.heat.heatSinkCount !== snapshot.heat.dissipation
            || snapshot.heat.heatsinksOff > 0
            ? `${snapshot.heat.heatSinkCount} (${snapshot.heat.dissipation})`
            : String(snapshot.heat.dissipation);
    }
    svg.querySelectorAll<SVGElement>('#hsCount, .hsPips, [data-mekbay-field="heat-sinks"]')
        .forEach(element => bind(element, () => Object.freeze({
            kind: 'heat-sinks-off',
            context: current().editContext,
        })));
}

function renderComponents(svg: SVGSVGElement, snapshot: NonMekRecordSheetSnapshot, issues: string[]): void {
    const rows = [...svg.querySelectorAll<SVGElement>('.inventoryEntry[id]')];
    rows.forEach(row => row.classList.remove('disabled', 'disabledInventory', 'pending'));
    const componentsById = new Map(snapshot.components.map(component => [component.componentId, component]));
    for (const row of rows) {
        const components = inventoryComponentIds(row).flatMap(componentId => {
            const component = componentsById.get(componentId);
            return component === undefined ? [] : [component];
        });
        if (components.length > 0) {
            renderInventoryComponentStatus(row, components);
        } else if (inventoryComponentIds(row).length > 0) {
            issues.push(`Unknown inventory component binding for ${row.id}`);
        }
    }
}

function renderAmmoProfile(svg: SVGSVGElement, snapshot: NonMekRecordSheetSnapshot, interactive: boolean): void {
    if (renderHandheldWeaponAmmoPips(svg, snapshot.components)) return;
    const profile = svg.querySelector<SVGElement>('#ammoProfile');
    if (!profile) return;
    const totals = new Map<string, number>();
    for (const component of snapshot.components) {
        if (component.ammo === undefined) continue;
        const name = recordSheetAmmoName(component.ammo.displayName);
        totals.set(name, (totals.get(name) ?? 0) + component.ammo.remaining);
    }
    updateRecordSheetAmmoProfile(profile, [...totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, remaining]) => `(${name}) ${remaining}`), interactive);
}

function renderInventoryComponentStatus(
    row: SVGElement,
    components: readonly NonMekRecordSheetSnapshot['components'][number][],
): void {
    const disabled = components.every(component => component.status !== 'available');
    row.classList.toggle('disabled', disabled);
    row.classList.toggle('disabledInventory', disabled);
    row.classList.toggle('pending', components.some(component =>
        component.previewStatus !== component.status));
}

const INVENTORY_RANGE_BUTTONS = Object.freeze([
    { selector: '.shrButton', range: 'short' as const },
    { selector: '.medButton', range: 'medium' as const },
    { selector: '.lngButton', range: 'long' as const },
    { selector: '.extButton', range: 'extreme' as const },
]);

function renderInventorySelections(
    svg: SVGSVGElement,
    snapshot: NonMekRecordSheetSnapshot,
    panel: EquipmentPanelSnapshot,
    bind: (element: SVGElement, interaction: () => RecordSheetInteraction) => void,
    context: () => UnitEditContext,
): void {
    const rows = [...svg.querySelectorAll<SVGElement>('.inventoryEntry[id]')];
    const assignments = inventoryRowAssignments(rows, panel);
    for (const row of rows) {
        row.classList.remove(
            'selected',
            'selected-range-short',
            'selected-range-medium',
            'selected-range-long',
            'selected-range-extreme',
            'selected-target-out-of-range',
            'weakenedHitMod',
        );
        row.style.removeProperty('--inventory-control-selection-color');
        renderInventoryOverlay(row, 'targetTn', undefined);
        renderInventoryOverlay(row, 'hitMod', undefined);

        const components = assignments.get(row) ?? [];
        const weapons = components.filter((component): component is EquipmentPanelComponent & {
            readonly weapon: NonNullable<EquipmentPanelComponent['weapon']>;
        } => component.weapon !== undefined);
        if (weapons.length === 0) continue;

        const componentIds = Object.freeze([...new Set(weapons.flatMap(component =>
            equipmentPanelAttackComponentIds(component)))]);
        row.setAttribute('data-mekbay-component-ids', componentIds.join(' '));
        const unavailable = weapons.every(component => component.status !== 'available');
        row.classList.toggle('disabled', unavailable);
        row.classList.toggle('disabledInventory', unavailable);
        row.classList.toggle('pending', weapons.some(component => component.previewStatus !== component.status));

        const selections = weapons.map(component => component.weapon.selection);
        const selection = selections[0];
        const uniformSelection = selections.every(candidate => sameInventorySelection(candidate, selection));
        const selected = selections.some(candidate => candidate !== undefined);
        row.classList.toggle('selected', selected && !unavailable);

        const selectedTarget = uniformSelection && selection?.kind === 'target'
            ? panel.targets.find(target => target.targetId === selection.targetId)
            : undefined;
        const runtimeTarget = selectedTarget === undefined
            ? null
            : projectTargetingTarget(selectedTarget, panel.ruleset);
        const presentation = uniformSelection && selection !== undefined
            ? projectWeaponTargetPresentation(
                weapons[0],
                runtimeTarget,
                panel.crew.gunnery,
                null,
                panel.ruleset,
            )
            : null;
        const selectedRange = uniformSelection && selection !== undefined
            ? presentation?.rangeSelection?.range
            : undefined;
        if (selectedRange !== undefined) row.classList.add(`selected-range-${selectedRange}`);
        if (selectedTarget !== undefined) {
            row.style.setProperty('--inventory-control-selection-color', selectedTarget.color);
        }
        row.classList.toggle('selected-target-out-of-range', selected && presentation?.outOfRange === true);
        renderInventoryOverlay(
            row,
            'targetTn',
            selected && presentation?.targetNumberText ? presentation.targetNumberText : undefined,
        );
        const modifier = equipmentWeaponToHitModifier(
            weapons[0],
            runtimeTarget,
            presentation?.rangeSelection?.range ?? null,
        );
        renderInventoryOverlay(
            row,
            'hitMod',
            unavailable || modifier === 0 ? undefined : `${modifier > 0 ? '+' : ''}${modifier}`,
        );

        const main = row.querySelector<SVGElement>(':scope > .inventoryEntryButton.mainButton') ?? row;
        bind(main, () => Object.freeze({
            kind: 'inventory-selection',
            componentIds,
            context: context(),
        }));
        for (const definition of INVENTORY_RANGE_BUTTONS) {
            row.querySelectorAll<SVGElement>(`:scope > .inventoryEntryButton${definition.selector}`)
                .forEach(button => bind(button, () => Object.freeze({
                    kind: 'inventory-selection',
                    componentIds,
                    range: definition.range,
                    context: context(),
                })));
        }
        const modeElements = [...row.querySelectorAll<SVGElement>(':scope > .alternativeMode')];
        const modes = weapons[0].modes;
        modeElements.forEach((modeElement, modeIndex) => {
            const mode = modes[modeIndex];
            modeElement.style.display = mode === undefined ? 'none' : '';
            modeElement.classList.toggle(
                'selected',
                mode !== undefined && weapons.every(component => component.mode === mode),
            );
            if (mode === undefined) return;
            modeElement.setAttribute('data-mekbay-mode', mode);
            const modeButton = modeElement.querySelector<SVGElement>(
                ':scope > .inventoryEntryButton.alternativeModeButton',
            ) ?? modeElement;
            bind(modeButton, () => Object.freeze({
                kind: 'inventory-selection',
                componentIds,
                mode,
                context: context(),
            }));
            for (const definition of INVENTORY_RANGE_BUTTONS) {
                modeElement.querySelectorAll<SVGElement>(`:scope > .inventoryEntryButton${definition.selector}`)
                    .forEach(button => bind(button, () => Object.freeze({
                        kind: 'inventory-selection',
                        componentIds,
                        mode,
                        range: definition.range,
                        context: context(),
                    })));
            }
        });
    }
}

function inventoryRowAssignments(
    rows: readonly SVGElement[],
    panel: EquipmentPanelSnapshot,
): ReadonlyMap<SVGElement, readonly EquipmentPanelComponent[]> {
    const panelById = new Map<ComponentId, EquipmentPanelComponent>();
    panel.components.forEach(component => equipmentPanelAttackComponentIds(component)
        .forEach(componentId => panelById.set(componentId, component)));
    const assignments = new Map<SVGElement, EquipmentPanelComponent[]>();
    const used = new Set<ComponentId>();
    for (const row of rows) {
        const ids = inventoryComponentIds(row);
        const components = [...new Set(ids.flatMap(id => {
            const component = panelById.get(id);
            return component === undefined ? [] : [component];
        }))].filter(component => equipmentPanelAttackComponentIds(component)
            .some(componentId => !used.has(componentId)));
        if (components.length === 0) continue;
        assignments.set(row, components);
        components.forEach(component => equipmentPanelAttackComponentIds(component)
            .forEach(componentId => used.add(componentId)));
    }

    return assignments;
}

function equipmentPanelAttackComponentIds(
    component: EquipmentPanelComponent,
): readonly ComponentId[] {
    return component.attack?.members.map(member => member.componentId)
        ?? Object.freeze([component.componentId]);
}

function renderInventoryOverlay(
    row: SVGElement,
    kind: 'hitMod' | 'targetTn',
    value: string | undefined,
): void {
    const rect = row.querySelector<SVGElement>(`:scope > .${kind}-rect`);
    const text = row.querySelector<SVGElement>(`:scope > .${kind}-text`);
    const visible = value !== undefined && value !== '';
    rect?.setAttribute('display', visible ? 'block' : 'none');
    text?.setAttribute('display', visible ? 'block' : 'none');
    if (text) text.textContent = value ?? '';
}

function sameInventorySelection(
    left: AttackerSelection | undefined,
    right: AttackerSelection | undefined,
): boolean {
    if (left === undefined || right === undefined) return left === right;
    if (left.kind !== right.kind) return false;
    if (left.kind === 'target' && right.kind === 'target') return left.targetId === right.targetId;
    if (left.kind === 'manual-range' && right.kind === 'manual-range') return left.range === right.range;
    return true;
}

function inventoryComponentIds(row: SVGElement): readonly ComponentId[] {
    return (row.getAttribute('data-mekbay-component-ids') ?? '')
        .trim()
        .split(/\s+/u)
        .filter(Boolean) as ComponentId[];
}

function formatTechBase(value: EntityTechBase, mixedTech = false): string {
    if (mixedTech) return 'Mixed';
    if (value === 'IS') return 'Inner Sphere';
    return value;
}

function attributeValue(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
