// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { formatProtectionCounter, renderProtectionCounter } from '../../utils/sheets/record-sheet-protection-counter';

import type {
ComponentId,
} from '../../models/entity/entity-identifiers';
import { layoutBombStores,type BombSection } from '../../models/aerospace-bomb.model';
import { velocityRecordValue,type VelocityRecordField } from '../../models/aerospace-velocity-record.model';
import { WeaponEquipment } from '../../models/equipment.model';
import type { EquipmentPanelComponent,EquipmentPanelSnapshot } from '../../models/runtime/equipment-panel';
import { nonMekRecordSheetHeatScale } from '../../models/runtime/record-sheet-heat-scale';
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
import { CapitalShipPipRenderer } from '../../utils/sheets/capital-ship-pip-renderer';
import { RecordSheetDamageHighlights } from '../../utils/sheets/record-sheet-damage-highlights';
import {
createInfantryStrengthDisplay,
INFANTRY_STRENGTH_DISPLAY_ID,
type InfantryStrengthDisplay,
} from '../../utils/sheets/infantry-strength-display';
import { AERO_DEFAULT_BOMB_KEY } from '../../utils/sheets/layouts/aero-record-sheet-components';
import { renderHandheldWeaponAmmoPips } from '../../utils/sheets/layouts/handheld-weapon-record-sheet-layout';
import { formatMovementWithMaximum, formatRecordSheetTonnage, formatTechBase, formatWholeNumber, recordSheetAmmoProfiles, setAttributes, svgElement, textFitsWidth } from '../../utils/sheets/record-sheet-svg-rendering';
import { writeSvgTextLines } from '../../utils/svg-text.util';
import {
attributeValue,
bindRecordSheetEquipmentOpeners,
bindRecordSheetRandomHit,
createRecordSheetBind,
recordSheetDamageTargets,
renderRecordSheetAmmoProfile,
renderRecordSheetConditions,
renderRecordSheetCrewControls,
renderRecordSheetCrewName,
renderRecordSheetCrewState,
renderRecordSheetCrewVacancies,
renderRecordSheetDestroyed,
renderRecordSheetPilotingSkill,
renderRecordSheetPips,
type RecordSheetBind,
} from './record-sheet-dom';
import {
bindRecordSheetHeatCell,
bindRecordSheetHeatControls,
displayedHeat,
renderRecordSheetHeatScale,
} from './record-sheet-heat-scale-rendering';
import {
bindRecordSheetInventoryButtons,
NO_INVENTORY_SELECTION,
projectRecordSheetWeaponSelection,
readRecordSheetComponentIds,
renderRecordSheetHeatProfile,
renderRecordSheetInventorySelection,
writeRecordSheetComponentIds,
type RecordSheetInventorySource,
type RecordSheetPanelWeapon,
} from './record-sheet-inventory';
import type { RecordSheetInteraction, RecordSheetInteractionHandler } from './record-sheet-interaction';
import { bindRecordSheetMovement } from './record-sheet-movement';

export interface NonMekRecordSheetBinding {
    readonly initialIssues: readonly string[];
    render(snapshot: NonMekRecordSheetSnapshot, inventory?: RecordSheetInventorySource | null): readonly string[];
    destroy(): void;
}

export function bindNonMekRecordSheet(
    svg: SVGSVGElement,
    initial: NonMekRecordSheetSnapshot,
    onInteraction?: RecordSheetInteractionHandler,
    onPresentationInteraction: RecordSheetInteractionHandler | undefined = onInteraction,
    initialInventory: RecordSheetInventorySource | null = null,
): NonMekRecordSheetBinding {
    const abort = new AbortController();
    const highlights = new RecordSheetDamageHighlights();
    const entityUuid = initial.entityUuid;
    let current = initial;
    let currentInventory = initialInventory;
    let firstRender = true;
    const renderMovementSelection = bindRecordSheetMovement(svg, () => current.movementSelection,
        () => current.editContext, abort.signal, onInteraction);
    let infantryDisplay: InfantryStrengthDisplay | undefined;

    const bind = createRecordSheetBind(abort.signal, onInteraction);
    const bindPresentation = createRecordSheetBind(abort.signal, onPresentationInteraction);
    const context = (): UnitEditContext => current.editContext;
    for (const table of svg.querySelectorAll<SVGElement>('[data-mekbay-reference="cluster-hits"]')) {
        bindPresentation(table, () => Object.freeze({ kind: 'reference-table', context: context() }), 'control');
    }
    const bindHeatCell = (element: SVGElement, heat: number): void => {
        if (!onInteraction) return;
        bindRecordSheetHeatCell(element, heat, {
            svg,
            onInteraction,
            signal: abort.signal,
            context: () => current.editContext,
            displayedHeat: () => displayedHeat({ current: current.heat.current, pending: current.heat.pending ?? undefined }),
            family: 'aero',
        });
    };

    const render = (
        snapshot: NonMekRecordSheetSnapshot,
        inventory: RecordSheetInventorySource | null = currentInventory,
    ): readonly string[] => {
        if (snapshot.entityUuid !== entityUuid) {
            throw new Error('Record-sheet binding cannot change its entity');
        }
        current = snapshot;
        currentInventory = inventory;
        const issues: string[] = [];
        const markChanges = !firstRender;
        renderIdentity(svg, snapshot);
        renderMovementSelection(snapshot.movementSelection);
        bindRecordSheetRandomHit(svg, bindPresentation, context);
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
            renderProtectionCounter(svg, `textIS_${location.sheetCode}`, location.previewRemainingInternal, location.maximumInternal);
            const integrityId = ({ SI: 'textSI', KF: 'textKFIntegrity', SAIL: 'textSailIntegrity', DC: 'textDockingCollars' } as Record<string, string>)[location.sheetCode];
            if (integrityId) renderProtectionCounter(svg, integrityId, location.previewRemainingInternal, location.maximumInternal);
            const internalCapacity = internalPips.length + CapitalShipPipRenderer.capacity(internalGrids);
            const numericInternal = renderNumericProtection(svg, 'structure', code, location.maximumInternal, location.previewRemainingInternal);
            if (!numericInternal && location.maximumInternal > 0 && internalCapacity < location.maximumInternal) {
                issues.push(`Missing structure pips for ${location.sheetCode}: ${internalCapacity}/${location.maximumInternal}`);
            }
            const internalTargets = recordSheetDamageTargets(
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
        if (!renderHandheldWeaponAmmoPips(svg, snapshot.components)) {
            renderRecordSheetAmmoProfile(svg, snapshot.components, onInteraction !== undefined);
        }
        bindRecordSheetEquipmentOpeners(svg, bind, context);
        for (const store of renderBombStores(svg, snapshot)) {
            bind(store, () => Object.freeze({ kind: 'open-equipment', tab: 'ammo', context: context() }), 'control');
        }
        for (const cell of renderVelocityRecord(svg, snapshot)) {
            bind(cell, () => Object.freeze({
                kind: 'velocity-record',
                turn: Number(cell.dataset['turn']),
                field: cell.dataset['field'] as VelocityRecordField,
                context: current.editContext,
            }), 'value');
        }
        renderInventorySelections(svg, inventory, bind, context);
        renderHeat(svg, snapshot, issues, bind, bindHeatCell, context, inventory);
        renderRecordSheetDestroyed(svg, snapshot.destroyed);
        firstRender = false;
        return Object.freeze(issues);
    };

    const initialIssues = render(initial);
    return Object.freeze({
        initialIssues,
        render,
        destroy: () => {
            abort.abort();
            highlights.destroy();
            svg.querySelector('#ammoProfile > .inventoryEntryButton')?.remove();
        },
    });
}

function renderConditions(
    svg: SVGSVGElement,
    snapshot: NonMekRecordSheetSnapshot,
    bind: RecordSheetBind,
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
            }), 'control'));
    }
    if (controls.some(control => control.placement === 'menu')) {
        svg.querySelectorAll<SVGElement>('.unitConditionButton[condition="menu"]')
            .forEach(button => bind(button, () => Object.freeze({
                kind: 'condition-menu',
                context: current().editContext,
            }), 'control'));
    }
}

function renderCrew(
    svg: SVGSVGElement,
    snapshot: NonMekRecordSheetSnapshot,
    bind: RecordSheetBind,
    current: () => NonMekRecordSheetSnapshot,
): void {
    const displays = crewStateDefinitions(snapshot.crewStateDisplayKeys);
    const controlRollModifier = snapshot.controlRoll.modifiers.reduce((total, entry) => total + entry.modifier, 0);
    renderRecordSheetCrewVacancies(svg, snapshot.crew);
    for (const position of snapshot.crew) {
        const occurrence = position.occurrence;
        const vacant = position.effectiveState === 'vacant';
        const displayName = vacant ? '' : position.name;
        if (!renderRecordSheetCrewName(svg, occurrence, displayName)) {
            const name = svg.getElementById(`crewName${occurrence}`);
            if (name) name.textContent = displayName;
        }
        const gunnery = svg.getElementById(`gunnerySkill${occurrence}`);
        if (gunnery) gunnery.textContent = vacant ? '—' : String(position.gunnery);
        const unskilled = vacant || position.piloting === null;
        renderRecordSheetPilotingSkill(
            svg.querySelector<SVGTextElement>(`#pilotingSkill${occurrence}`),
            unskilled ? '—' : String(position.piloting),
            unskilled ? 0 : controlRollModifier,
            snapshot.controlRoll.shortLabel,
        );
        renderRecordSheetCrewControls(svg, position, bind, () => current().editContext, () =>
            current().crew.find(row => row.positionId === position.positionId)?.state.wounds ?? 0);
        const display = position.effectiveState === 'healthy'
            ? null
            : displays.find(candidate => candidate.key === position.effectiveState) ?? null;
        renderRecordSheetCrewState(svg, position.occurrence, display);
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
    // The row reads internal pip(s) then armor; damage fills it from the right, so
    // armor is crossed off first and the internal pip last.
    const internalPips = pips.slice(0, location.maximumInternal).reverse();
    const armorPips = pips.slice(location.maximumInternal).reverse();
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
    renderProtectionCounter(svg, `textIS_${location.sheetCode}`, location.previewRemainingInternal, location.maximumInternal);
    renderProtectionCounter(svg, `textArmor_${location.sheetCode}`, location.previewRemainingInternal === 0 ? 0 : face.previewRemaining, face.maximum);
    const required = location.maximumInternal + face.maximum;
    if (required > 0 && pips.length < required) {
        issues.push(`Missing combined pips for ${location.sheetCode}: ${pips.length}/${required}`);
    }

    // One trooper picker covers the whole row; the runtime splits damage and repairs
    // between armor and internal structure.
    const armorTargets = recordSheetDamageTargets(
        [...svg.querySelectorAll<SVGElement>(`.unitLocation.armor:not([data-rear])[data-loc="${code}"]`)],
        [],
        pips,
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
    renderProtectionCounter(svg, `textArmor_${sheetCode}${rear ? 'R' : ''}`, face.previewRemaining, face.maximum);
    const capacity = pips.length + CapitalShipPipRenderer.capacity(grids);
    const numericArmor = renderNumericProtection(svg, 'armor', code, face.maximum, face.previewRemaining, rearSelector);
    if (!numericArmor && face.maximum > 0 && capacity < face.maximum) {
        issues.push(`Missing ${rear ? 'rear ' : ''}armor pips for ${sheetCode}: ${capacity}/${face.maximum}`);
    }
    const targets = recordSheetDamageTargets(
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

/** Structure sheets track CF and armor in numeric table cells instead of pip fields. */
function renderNumericProtection(svg: SVGSVGElement, kind: 'structure' | 'armor', escapedCode: string,
    maximum: number, remaining: number, faceSelector = ''): boolean {
    const values = [...svg.querySelectorAll<SVGTextElement>(
        `[data-mekbay-protection-value="${kind}"][data-loc="${escapedCode}"]${faceSelector}`)];
    for (const value of values) {
        value.textContent = formatProtectionCounter(remaining, maximum);
        value.classList.toggle('damaged', remaining < maximum);
    }
    return values.length > 0;
}

function renderIdentity(svg: SVGSVGElement, snapshot: NonMekRecordSheetSnapshot): void {
    const battleValue = snapshot.currentBattleValue === snapshot.pristineBattleValue
        ? formatWholeNumber(snapshot.currentBattleValue)
        : `${formatWholeNumber(snapshot.currentBattleValue)} (${formatWholeNumber(snapshot.pristineBattleValue)})`;
    const battleValueSuffix = svg.getElementById('bv')?.getAttribute('data-mekbay-bv-suffix') ?? '';
    const jump = snapshot.movement.umu > 0 ? snapshot.movement.umu : snapshot.movement.jump;
    const run = formatMovementWithMaximum(snapshot.movement.run, snapshot.movement.maxRun);
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
        mpRun: run,
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
        run,
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
    bind: RecordSheetBind,
    bindHeatCell: (element: SVGElement, heat: number) => void,
    context: () => UnitEditContext,
    inventory: RecordSheetInventorySource | null,
): void {
    if (!snapshot.heat.tracked) return;
    renderRecordSheetHeatProfile(svg, snapshot.heat.dissipation, inventory);
    if (!svg.querySelector('#heatScale .heat[heat]')) issues.push('Missing heat scale');
    renderRecordSheetHeatScale(svg, nonMekRecordSheetHeatScale(snapshot), 'aero', bindHeatCell);
    bindRecordSheetHeatControls(svg, bind, context);

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
}

function renderComponents(svg: SVGSVGElement, snapshot: NonMekRecordSheetSnapshot, issues: string[]): void {
    const rows = [...svg.querySelectorAll<SVGElement>('.inventoryEntry[id]')];
    rows.forEach(row => row.classList.remove('damaged', 'disabled', 'disabledInventory', 'pending'));
    const componentsById = new Map(snapshot.components.map(component => [component.componentId, component]));
    for (const row of rows) {
        const components = readRecordSheetComponentIds(row).flatMap(componentId => {
            const component = componentsById.get(componentId);
            return component === undefined ? [] : [component];
        });
        if (components.length > 0) {
            renderInventoryComponentStatus(row, components);
        } else if (readRecordSheetComponentIds(row).length > 0) {
            issues.push(`Unknown inventory component binding for ${row.id}`);
        }
    }
}

/**
 * Labels one store per carried bomb and greys out, with a slash, the further hardpoints larger bombs take from the
 * end of the stores. Returns the stores for interaction.
 */
function renderBombStores(svg: SVGSVGElement, snapshot: NonMekRecordSheetSnapshot): readonly SVGElement[] {
    const boxes = [...svg.querySelectorAll<SVGRectElement>('.bombBox[data-store-index]')];
    const layer = svg.querySelector<SVGGElement>('.bombSlots');
    if (!layer) return boxes;
    const boxByStore = new Map(boxes.map(box => [Number(box.dataset['storeIndex']), box] as const));
    const stores: Record<BombSection, number[]> = { external: [], internal: [] };
    for (const [store, box] of boxByStore) stores[box.dataset['bombSection'] as BombSection].push(store);
    const { slots, taken } = layoutBombStores(snapshot.bombs, stores);
    const slotByStore = new Map(slots.map(slot => [slot.store, slot] as const));
    const takenStores = new Set(taken);
    const labelSize = Number(layer.dataset['labelSize']);
    layer.replaceChildren();
    for (const [store, box] of boxByStore) {
        const slot = slotByStore.get(store);
        const isTaken = takenStores.has(store);
        box.classList.toggle('bombLoaded', slot !== undefined);
        box.classList.toggle('bombSpent', slot?.spent === true);
        box.classList.toggle('bombTaken', isTaken);
        const tooltip = slot ? `${slot.bomb.name}${slot.spent ? ' (spent)' : ''}` : isTaken ? 'Hardpoint taken by a larger bomb' : '';
        const title = svgElement('title');
        title.textContent = tooltip;
        box.replaceChildren(...(tooltip ? [title] : []));
        const x = box.x.baseVal.value;
        const y = box.y.baseVal.value;
        const width = box.width.baseVal.value;
        const height = box.height.baseVal.value;
        if (slot) {
            const label = svgElement('text');
            setAttributes(label, {
                x: x + width / 2,
                y: y + height / 2,
                'font-size': labelSize,
                'font-weight': 700,
                'text-anchor': 'middle',
                'dominant-baseline': 'central',
                class: slot.spent ? 'bombLabel bombSpent' : 'bombLabel',
            });
            label.textContent = slot.bomb.label;
            layer.appendChild(label);
        } else if (isTaken) {
            const inset = Number(box.getAttribute('rx') ?? 0);
            const slash = svgElement('line');
            setAttributes(slash, {
                x1: x + inset,
                y1: y + height - inset,
                x2: x + width - inset,
                y2: y + inset,
                'stroke-width': box.getAttribute('stroke-width') ?? undefined,
                class: 'bombTakenMark',
            });
            layer.appendChild(slash);
        }
    }
    const carried = [...new Map(slots.map(slot => [slot.bomb.id, slot.bomb] as const)).values()];
    renderBombKey(svg, carried.length > 0
        ? carried.map(bomb => `${bomb.label} - ${bomb.name}`)
        : AERO_DEFAULT_BOMB_KEY);
    return boxes;
}

/** Explains the abbreviated bombs carried, or shows the sheet's default key for an empty loadout. */
function renderBombKey(svg: SVGSVGElement, entries: readonly string[]): void {
    const title = svg.querySelector<SVGTextElement>('.bombKeyTitle');
    if (!title) return;
    title.style.display = entries.length > 0 ? '' : 'none';
    svg.querySelectorAll<SVGTextElement>('.bombKeyLine').forEach((line, index) => {
        line.textContent = entries[index] ?? '';
        const maxWidth = Number(line.dataset['maxWidth']);
        const fits = textFitsWidth(line.textContent, Number(line.getAttribute('font-size')), maxWidth);
        if (fits) line.removeAttribute('textLength');
        else setAttributes(line, { textLength: maxWidth, lengthAdjust: 'spacingAndGlyphs' });
    });
}

/** Writes the velocity record values into their cells; returns the cells for interaction. */
function renderVelocityRecord(svg: SVGSVGElement, snapshot: NonMekRecordSheetSnapshot): readonly SVGElement[] {
    svg.querySelectorAll<SVGTextElement>('.velocityValue[data-turn]').forEach(text => {
        const value = velocityRecordValue(snapshot.velocityRecord, Number(text.dataset['turn']),
            text.dataset['field'] as VelocityRecordField);
        text.textContent = value === undefined ? '' : String(value);
    });
    return [...svg.querySelectorAll<SVGElement>('.velocityCell[data-turn]')];
}

function renderInventoryComponentStatus(
    row: SVGElement,
    components: readonly Pick<NonMekRecordSheetSnapshot['components'][number], 'status' | 'previewStatus'>[],
): void {
    const destroyed = components.length > 0 && components.every(component => component.status === 'destroyed');
    const disabled = !destroyed && components.every(component => component.status !== 'available');
    row.classList.toggle('damaged', destroyed);
    row.classList.toggle('disabled', disabled);
    row.classList.toggle('disabledInventory', disabled);
    row.classList.toggle('pending', components.some(component =>
        component.previewStatus !== component.status));
}

function renderInventorySelections(
    svg: SVGSVGElement,
    source: RecordSheetInventorySource | null,
    bind: RecordSheetBind,
    context: () => UnitEditContext,
): void {
    const rows = [...svg.querySelectorAll<SVGElement>('.inventoryEntry[id]')];
    const assignments = source === null ? new Map<SVGElement, readonly EquipmentPanelComponent[]>()
        : inventoryRowAssignments(rows, source.panel);
    for (const row of rows) {
        const weapons = (assignments.get(row) ?? []).filter((component): component is RecordSheetPanelWeapon =>
            component.weapon !== undefined);
        if (weapons.length === 0) {
            renderRecordSheetInventorySelection(row, NO_INVENTORY_SELECTION);
            continue;
        }

        const weapon = weapons[0].weapon;
        const ammoProfiles = weapons[0].equipment instanceof WeaponEquipment
            ? recordSheetAmmoProfiles(weapons[0].equipment) : [];
        if (weapon.aerospace === undefined && ammoProfiles.length === 0) {
            writeSvgTextLines(row.querySelector(':scope > .range_min'), weapon.minimumRange > 0 ? String(weapon.minimumRange) : '—');
        }

        const componentIds = Object.freeze([...new Set(weapons.flatMap(component =>
            equipmentPanelAttackComponentIds(component)))]);
        writeRecordSheetComponentIds(row, componentIds);
        renderInventoryComponentStatus(row, weapons);
        const selection = projectRecordSheetWeaponSelection(weapons, source);

        bindRecordSheetInventoryButtons(row, componentIds, undefined, bind, context);
        const modeElements = [...row.querySelectorAll<SVGElement>(':scope > .alternativeMode')];
        const modes = weapons[0].modes;
        modeElements.forEach((modeElement, modeIndex) => {
            const mode = modes[modeIndex];
            modeElement.style.display = mode === undefined ? 'none' : '';
            modeElement.classList.toggle('selected', mode !== undefined && weapons.every(component => component.mode === mode));
            if (mode === undefined) return;
            modeElement.setAttribute('data-mekbay-mode', mode);
            const profile = ammoProfiles.find(profile => profile.displayName === mode);
            if (profile && weapon.aerospace === undefined) {
                const minimumRange = mode === weapons[0].mode ? weapon.minimumRange : profile.minimumRange;
                writeSvgTextLines(modeElement.querySelector(':scope > .range_min'), minimumRange > 0 ? String(minimumRange) : '—');
            }
            bindRecordSheetInventoryButtons(modeElement, componentIds, mode, bind, context);
        });
        renderRecordSheetInventorySelection(row, selection);
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
        const ids = readRecordSheetComponentIds(row);
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

