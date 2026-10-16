// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { renderProtectionCounter } from '../../utils/sheets/record-sheet-protection-counter';

import type {
ComponentId,
} from '../../models/entity/entity-identifiers';
import { isTargetingComputerEquipment } from '../../models/entity/utils/targeting-computer';
import { WeaponEquipment } from '../../models/equipment.model';
import { isHeatSinkEquipment } from '../../models/heat-equipment.model';
import { isJumpJetEquipment } from '../../models/jump-equipment.model';
import { MEK_CREW_STATE_DISPLAYS } from '../../models/mek-record-sheet-controls';
import { MM_DATA_MEK_SHEET_BINDING_MANIFEST,type MekSheetBindingManifestV1 } from '../../models/mek-sheet-binding';
import type { AttackerActionTarget } from '../../models/runtime/attacker-targeting-state';
import {
equipmentWeaponToHitModifier,
projectTargetingTarget,
projectWeaponTargetPresentation,
} from '../../models/runtime/equipment-panel';
import { recordSheetHeatScale } from '../../models/runtime/record-sheet-heat-scale';
import type { MekHeatProjectionV2 } from '../../models/runtime/mek-heat-state-v2';
import type {
MekRecordSheetArmorFace,
MekRecordSheetLocation,
MekRecordSheetSnapshot,
} from '../../models/runtime/mek-record-sheet';
import type { UnitEditContext } from '../../models/runtime/unit-edit-context';
import { formatPilotingDisplay,UNIT_CONDITION_DEFINITIONS } from '../../models/unit-status-presentation';
import { formatEquipmentLocationCodes } from '../../utils/equipment-location-display.util';
import { buildHeatSummaryRows } from '../../utils/heat-summary.util';
import { formatPhysicalHitModifier } from '../../utils/inventory-target-number.util';
import { recordSheetAmmoName } from '../../utils/record-sheet-ammo.util';
import {
isCenterPanelTarget,
isPointInCenterPanel,
resolveCenterPanelCursorElements,
} from '../../utils/record-sheet-center-panel.util';
import { formatRecordSheetWeaponDamageText } from '../../utils/record-sheet-weapon-info.util';
import { updateRecordSheetAmmoProfile } from '../../utils/sheets/record-sheet-ammo-rendering';
import { RecordSheetDamageHighlights } from '../../utils/sheets/record-sheet-damage-highlights';
import { isMekRecordSheetInventorySupport } from '../../utils/sheets/record-sheet-inventory-equipment';
import { getSvgTextLines,measureSvgTextCanvas,writeSvgTextLines } from '../../utils/svg-text.util';
import { positionMekCriticalExtraHitPip } from '../../utils/sheets/mek-critical-slot-rendering';
import {
renderRecordSheetConditions,
renderRecordSheetCrewName,
renderRecordSheetCrewState,
renderRecordSheetCrewVacancies,
renderRecordSheetDestroyed,
renderRecordSheetPips,
} from './record-sheet-dom';
import { bindRecordSheetHeatCell,displayedHeat,renderRecordSheetHeatScale } from './record-sheet-heat-scale-rendering';
import type { RecordSheetInteraction,RecordSheetInteractionHandler } from './record-sheet-interaction';
import { bindRecordSheetMovement } from './record-sheet-movement';

export interface MekRecordSheetBinding {
    render(snapshot: MekRecordSheetSnapshot): readonly string[];
    destroy(): void;
}

const SYSTEM_DAMAGE_ANCHORS: Readonly<Record<string, string>> = Object.freeze({
    Engine: 'engine_hit_',
    Gyro: 'gyro_hit_',
    Sensors: 'sensor_hit_',
    'Life Support': 'life_support_hit_',
    Avionics: 'avionics_hit_',
    'Landing Gear': 'landing_gear_hit_',
    Cockpit: 'cockpit_hit_',
});
const CONDITION_PRESENTATION = UNIT_CONDITION_DEFINITIONS;
const EQUIPMENT_HOVER_SECONDARY_CLASS = 'equipment-hover-secondary';
const COMPONENT_IDS_ATTRIBUTE = 'data-mekbay-component-ids';
/**
 * Binds an authored SVG layout to an authoritative entity/runtime projection.
 *
 * The DOM is never parsed for game data. Attribute selectors are constructed
 * from published IDs/codes and canonical ordinal values; all displayed values
 * are then overwritten from the supplied snapshot.
 */
export function bindMekRecordSheet(
    svg: SVGSVGElement,
    manifest: MekSheetBindingManifestV1,
    initial: MekRecordSheetSnapshot,
    onInteraction?: RecordSheetInteractionHandler,
    onPresentationInteraction: RecordSheetInteractionHandler | undefined = onInteraction,
): MekRecordSheetBinding {
    assertReviewedBinding(manifest, initial);
    const abort = new AbortController();
    const highlights = new RecordSheetDamageHighlights();
    const entityUuid = initial.entityUuid;
    let current = initial;
    let firstRender = true;
    const renderMovementSelection = bindRecordSheetMovement(svg, () => current.movementSelection,
        () => current.editContext, abort.signal, onInteraction);

    const emit = (interaction: RecordSheetInteraction, event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        onInteraction?.(interaction, event);
    };
    const emitPresentation = (interaction: RecordSheetInteraction, event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        onPresentationInteraction?.(interaction, event);
    };

    const bindButton = (
        element: SVGElement,
        interaction: (button: 'primary' | 'secondary') => RecordSheetInteraction,
    ): void => {
        if (!onInteraction) return;
        if (element.dataset['mekbayBound'] === '1') return;
        element.dataset['mekbayBound'] = '1';
        element.classList.add('interactive');
        element.setAttribute('tabindex', '0');
        element.addEventListener('click', event => emit(interaction('primary'), event), { signal: abort.signal });
        element.addEventListener('contextmenu', event => emit(interaction('secondary'), event), { signal: abort.signal });
        element.addEventListener('keydown', event => {
            if (!(event instanceof KeyboardEvent) || (event.key !== 'Enter' && event.key !== ' ')) return;
            emit(interaction('primary'), event);
        }, { signal: abort.signal });
    };

    const bindHeat = (element: SVGElement, heat: number): void => {
        if (!onInteraction) return;
        bindRecordSheetHeatCell(element, heat, {
            svg,
            emit,
            signal: abort.signal,
            context: () => current.editContext,
            displayedHeat: () => displayedHeat({ current: current.heat.current, pending: current.heat.pendingOverride }),
            family: current.identity.form === 'lam' ? 'lam' : 'mek',
        });
    };

    const render = (snapshot: MekRecordSheetSnapshot): readonly string[] => {
        if (snapshot.entityUuid !== entityUuid) {
            throw new Error('Record-sheet binding cannot change its entity');
        }
        current = snapshot;
        const issues: string[] = [];
        const markChanges = !firstRender;

        if (firstRender) resetUnitDataLayout(svg, manifest);
        renderIdentity(svg, snapshot);
        renderConditions(
            svg,
            snapshot,
            emit,
            abort.signal,
            () => current.editContext,
            onInteraction !== undefined,
        );
        renderHeatSinks(svg, manifest, snapshot);

        for (const location of snapshot.locations) {
            renderLocation(
                highlights,
                svg,
                location,
                issues,
                bindButton,
                () => current.editContext,
                emit,
                abort.signal,
                onInteraction !== undefined,
                markChanges,
            );
        }
        renderShields(
            highlights,
            svg,
            snapshot,
            issues,
            bindButton,
            () => current.editContext,
            onInteraction !== undefined,
            markChanges,
        );
        for (const slot of snapshot.criticalSlots) {
            const selector = `${manifest.selectors.criticalSlot}[data-loc="${attributeValue(slot.locationCode)}"][slot="${slot.slotIndex}"]`;
            const element = svg.querySelector<SVGElement>(selector);
            if (!element) {
                issues.push(`Missing critical-slot layout ${slot.locationCode}, slot ${slot.slotIndex + 1}`);
                continue;
            }
            element.style.display = '';
            const label = slot.components.length === 0
                ? 'Roll Again'
                : slot.components.map(component => component.ammo
                    ? `${component.ammo.custom ? '*' : ''}Ammo (${recordSheetAmmoName(component.ammo.displayName)}) ${component.ammo.remaining}`
                    : component.label).join(' / ');
            const labelElement = element.querySelector<SVGTextElement>('text');
            if (labelElement) labelElement.textContent = label;
            else element.textContent = label;
            element.classList.toggle('customAmmoLoadout', slot.components.some(component => component.ammo?.custom));
            element.removeAttribute('uid');
            element.removeAttribute('totalAmmo');
            element.setAttribute('data-mekbay-slot-id', slot.slotId);
            writeComponentIds(element, slot.components.map(component => component.componentId));
            if (slot.hittable) {
                element.setAttribute('hittable', '1');
            } else {
                element.removeAttribute('hittable');
                element.classList.remove('interactive');
                element.removeAttribute('tabindex');
                if (slot.components.length === 0) {
                    element.querySelectorAll(':scope > .critSlot-bg-rect').forEach(background => background.remove());
                }
            }
            const armoredHitCapacity = slot.armored ? 1 : 0;
            const extraHit = slot.hitCapacity - armoredHitCapacity > 1;
            const pipHitCapacity = armoredHitCapacity + (extraHit ? 1 : 0);
            const committedWholeSlotHit = slot.committedHits > pipHitCapacity;
            const previewWholeSlotHit = slot.previewHits > pipHitCapacity;
            element.classList.toggle('damaged', committedWholeSlotHit);
            element.classList.toggle('pending', previewWholeSlotHit !== committedWholeSlotHit);
            element.classList.toggle('willDamage', !committedWholeSlotHit && previewWholeSlotHit);
            element.classList.toggle('willRepair', committedWholeSlotHit && !previewWholeSlotHit);
            element.classList.toggle('armored', slot.armored);
            element.classList.toggle('disabled', slot.components.some(component => component.status !== 'available'));
            element.querySelectorAll<SVGElement>('.armoredLocPip').forEach(pip => {
                updateCriticalSlotPip(highlights, pip, slot.committedHits > 0, slot.previewHits > 0,
                    markChanges && !committedWholeSlotHit);
                if (committedWholeSlotHit) pip.classList.remove('fresh');
            });
            element.querySelectorAll<SVGElement>('.extraHitPip').forEach(pip => {
                if (!extraHit) {
                    pip.setAttribute('display', 'none');
                    pip.classList.remove('damaged', 'pending', 'fresh');
                    return;
                }
                pip.removeAttribute('display');
                if (labelElement) positionMekCriticalExtraHitPip(labelElement, pip);
                updateCriticalSlotPip(
                    highlights,
                    pip,
                    slot.committedHits > armoredHitCapacity,
                    slot.previewHits > armoredHitCapacity,
                    markChanges && !committedWholeSlotHit,
                );
                if (committedWholeSlotHit) pip.classList.remove('fresh');
            });
            if (slot.hittable) {
                bindButton(element, button => Object.freeze({
                    kind: 'critical',
                    slotId: slot.slotId,
                    componentIds: Object.freeze(slot.components.map(component => component.componentId)),
                    button,
                    context: current.editContext,
                }));
            }
        }
        renderSystemDamage(svg, snapshot, bindButton, () => current.editContext);

        renderCrew(svg, snapshot, issues, emit, abort.signal, () => current, onInteraction !== undefined);
        renderInventory(
            svg,
            manifest,
            snapshot,
            issues,
            emit,
            abort.signal,
            () => current.editContext,
            onInteraction !== undefined,
        );
        if (onInteraction || onPresentationInteraction) bindEquipmentHover(svg, abort.signal);
        renderAmmoProfile(svg, snapshot, onInteraction !== undefined);
        renderHeat(svg, snapshot, bindHeat);
        renderLifeSupportPilotDamage(svg, snapshot);
        bindHeatControls(svg, emit, abort.signal, () => current.editContext, onInteraction !== undefined);
        renderMovement(svg, snapshot);
        renderMovementSelection(snapshot.movementSelection);
        bindHeatSinkControls(svg, emit, abort.signal, () => current.editContext, onInteraction !== undefined);
        bindShutdownControl(svg, emit, abort.signal, () => current.editContext, onInteraction !== undefined);
        bindEquipmentOpeners(svg, emit, abort.signal, () => current.editContext, onInteraction !== undefined);
        bindRandomHitControl(
            svg,
            emitPresentation,
            abort.signal,
            () => current.editContext,
            onPresentationInteraction !== undefined,
        );
        bindReferenceTable(
            svg,
            emitPresentation,
            abort.signal,
            () => current.editContext,
            onPresentationInteraction !== undefined,
        );
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
            const ammoProfile = svg.querySelector<SVGElement>('#ammoProfile');
            ammoProfile?.classList.remove('interactive');
            ammoProfile?.removeAttribute('tabindex');
            ammoProfile?.querySelector('.inventoryEntryButton')?.remove();
            svg.querySelectorAll<SVGElement>('[data-mekbay-bound="1"]').forEach(element => {
                delete element.dataset['mekbayBound'];
                element.classList.remove('interactive', 'selectable');
                element.removeAttribute('tabindex');
            });
            svg.querySelectorAll<SVGElement>(manifest.selectors.inventoryRow)
                .forEach(element => element.classList.remove('interactive'));
            svg.querySelectorAll('.referenceTableControl')
                .forEach(element => element.classList.remove('referenceTableControl'));
            delete svg.dataset['mekbayReferenceBound'];
        },
    });
}

function renderIdentity(svg: SVGSVGElement, snapshot: MekRecordSheetSnapshot): void {
    const battleValue = snapshot.battleValue.adjusted ?? snapshot.battleValue.pristine ?? '';
    const pristineBattleValue = snapshot.battleValue.pristine;
    const formatBattleValue = (value: string | number): string => typeof value === 'number'
        ? String(value)
        : value;
    const fields: Readonly<Record<string, string | number>> = Object.freeze({
        'display-name': snapshot.identity.displayName,
        chassis: snapshot.identity.baseChassis,
        model: snapshot.identity.model,
        'clan-name': snapshot.identity.clanName ?? '',
        tonnage: snapshot.identity.massTons,
        year: snapshot.identity.year,
        'tech-base': snapshot.identity.mixedTech
            ? 'Mixed'
            : snapshot.identity.techBase === 'IS' ? 'Inner Sphere' : snapshot.identity.techBase,
        engine: snapshot.identity.engine,
        cockpit: snapshot.identity.cockpit,
        gyro: snapshot.identity.gyro,
        myomer: snapshot.identity.myomer,
        armor: snapshot.construction.armor,
        structure: snapshot.construction.structure,
        bv: pristineBattleValue !== null && battleValue !== pristineBattleValue
            ? `${formatBattleValue(battleValue)} (${formatBattleValue(pristineBattleValue)})`
            : formatBattleValue(battleValue),
        'heat-sinks': snapshot.heatSinks.count,
        heat: snapshot.heat.current,
    });
    const legacyIds: Readonly<Record<string, readonly string[]>> = Object.freeze({
        'display-name': Object.freeze(['unitName', 'unit-name']),
        chassis: Object.freeze(['chassis']),
        model: Object.freeze(['model']),
        'clan-name': Object.freeze(['clanName']),
        tonnage: Object.freeze(['tonnage', 'tons']),
        year: Object.freeze(['year']),
        'tech-base': Object.freeze(['techBase']),
        engine: Object.freeze(['engine']),
        cockpit: Object.freeze(['cockpit']),
        gyro: Object.freeze(['gyro']),
        myomer: Object.freeze(['myomer']),
        armor: Object.freeze(['armorType', 'armor-type']),
        structure: Object.freeze(['structureType', 'structure-type']),
        bv: Object.freeze(['bv']),
        'heat-sinks': Object.freeze(['heatSinks', 'heatSinkCount']),
        heat: Object.freeze(['heatValue']),
    });
    for (const [field, value] of Object.entries(fields)) {
        svg.querySelectorAll<SVGElement>(`[data-mekbay-field="${field}"]`).forEach(element => {
            element.textContent = String(value);
        });
        for (const id of legacyIds[field] ?? []) {
            const element = svg.getElementById(id);
            if (element) element.textContent = String(value);
        }
    }
}

function renderMovement(svg: SVGSVGElement, snapshot: MekRecordSheetSnapshot): void {
    const projection = snapshot.movement.projection;
    const underwater = snapshot.movement.secondaryMode === 'UMU';
    const current = projection.kind === 'supported'
        ? Object.freeze({
            walk: projection.walkMp,
            run: projection.runMp,
            jump: underwater ? projection.umuMp : projection.jumpMp,
            walkMaximum: projection.potentialWalkMp,
            runMaximum: projection.maximumRunMp,
            impairment: projection.movementImpairment,
        })
        : Object.freeze({
            walk: snapshot.movement.walkMp,
            run: snapshot.movement.runMp,
            jump: snapshot.movement.jumpMp,
            walkMaximum: snapshot.movement.walkMp,
            runMaximum: snapshot.movement.runMp,
            impairment: { walk: false, run: false, jump: false, umu: false },
        });
    const values = Object.freeze({
        mpWalk: formatMovementMaximum(current.walk, current.walkMaximum),
        mpRun: formatMovementMaximum(current.run, current.runMaximum),
        mpJump: String(current.jump),
        mp_2: String(current.jump),
    });
    for (const [id, value] of Object.entries(values)) {
        const element = svg.getElementById(id);
        if (!element) continue;
        element.textContent = value;
        const impaired = id === 'mpWalk' ? current.impairment.walk : id === 'mpRun' ? current.impairment.run
            : underwater ? current.impairment.umu : current.impairment.jump;
        element.classList.toggle('damaged', impaired);
    }
    svg.querySelectorAll<SVGElement>('[data-mekbay-field="walk"]').forEach(element => {
        element.textContent = values.mpWalk;
    });
    svg.querySelectorAll<SVGElement>('[data-mekbay-field="run"]').forEach(element => {
        element.textContent = values.mpRun;
    });
    svg.querySelectorAll<SVGElement>('[data-mekbay-field="jump"]').forEach(element => {
        element.textContent = values.mpJump;
    });

    const declared = snapshot.movement.declared.kind === 'supported'
        ? snapshot.movement.declared.mode
        : null;
    for (const [mode, id] of [['run', 'mpRun'], ['jump', svg.getElementById('mpJump') ? 'mpJump' : 'mp_2']] as const) {
        const warning = svg.getElementById(`${id}-psr-warning`);
        if (!warning) continue;
        const action = projection.kind === 'supported'
            ? projection.actions.find(candidate => candidate.kind === mode)
            : undefined;
        const messages = action?.warnings.filter(message => message.code === 'PILOT_CHECK_REQUIRED') ?? [];
        warning.textContent = snapshot.identity.form === 'lam' ? '!!!' : 'PSR!';
        warning.classList.toggle('currentMoveMode', messages.length > 0 && declared === mode);
        if (messages.length === 0) {
            warning.setAttribute('display', 'none');
            warning.removeAttribute('title');
        } else {
            const text = messages.map(message => message.message).join('; ');
            warning.setAttribute('title', text);
            warning.removeAttribute('display');
        }
    }
}

function formatMovementMaximum(current: number, maximum: number): string {
    return maximum > current ? `${current} [${maximum}]` : String(current);
}

function renderConditions(
    svg: SVGSVGElement,
    snapshot: MekRecordSheetSnapshot,
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
    interactive: boolean,
): void {
    const active = snapshot.crippled
        ? Object.freeze([...snapshot.conditions, 'crippled'])
        : snapshot.conditions;
    renderRecordSheetConditions(svg, active, CONDITION_PRESENTATION);
    for (const condition of CONDITION_PRESENTATION) {
        svg.querySelectorAll<SVGElement>(`.unitConditionButton[condition="${condition.key}"]`)
            .forEach(button => {
                if (interactive && condition.key !== 'crippled' && condition.key !== 'shutdown') {
                    bindActivation(button, signal, event => emit(Object.freeze({
                        kind: 'condition',
                        condition: condition.key,
                        context: context(),
                    }), event));
                }
            });
    }
    svg.querySelectorAll<SVGElement>('.unitConditionButton[condition="menu"]')
        .forEach(button => {
            if (!interactive) return;
            bindActivation(button, signal, event => emit(Object.freeze({
                kind: 'condition-menu',
                context: context(),
            }), event));
        });
}

function bindHeatSinkControls(
    svg: SVGSVGElement,
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
    interactive: boolean,
): void {
    if (!interactive) return;
    const activate = (event: Event): void => emit(Object.freeze({
        kind: 'heat-sinks-off',
        context: context(),
    }), event);
    svg.querySelectorAll<SVGElement>('#hsCount, .hsPips, [data-mekbay-field="heat-sinks"]')
        .forEach(element => bindActivation(element, signal, activate));
}

function bindShutdownControl(
    svg: SVGSVGElement,
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
    interactive: boolean,
): void {
    if (!interactive) return;
    svg.querySelectorAll<SVGElement>('.unitConditionButton[condition="shutdown"]')
        .forEach(element => bindActivation(element, signal, event => emit(Object.freeze({
            kind: 'shutdown',
            context: context(),
        }), event)));
}

function renderHeatSinks(
    svg: SVGSVGElement,
    manifest: MekSheetBindingManifestV1,
    snapshot: MekRecordSheetSnapshot,
): void {
    const pips = [...svg.querySelectorAll<SVGElement>(manifest.selectors.heatSinkPip)]
        .filter((pip, index, all) => all.indexOf(pip) === index);
    const unavailable = Math.min(snapshot.heatSinks.count, snapshot.heatSinks.unavailableUnits);
    const disabled = Math.min(snapshot.heatSinks.count - unavailable, snapshot.heat.heatsinksOff);
    pips.forEach((pip, index) => {
        const ordinal = index + 1;
        pip.style.display = ordinal <= snapshot.heatSinks.count ? '' : 'none';
        pip.classList.toggle('damaged', ordinal <= unavailable);
        pip.classList.toggle('disabled', ordinal > snapshot.heatSinks.count - disabled);
    });
    const projection = snapshot.heatProjection.kind === 'supported'
        ? snapshot.heatProjection.projection
        : null;
    const capacity = projection?.capacity ?? null;
    write(svg, '#hsCount', capacity !== null && capacity !== snapshot.heatSinks.count
        ? `${snapshot.heatSinks.count} (${capacity})`
        : snapshot.heatSinks.count);
    const profile = svg.querySelector<SVGElement>('#heatProfile');
    if (profile) {
        const maximum = profile.getAttribute('data-maximum-heat');
        profile.textContent = capacity === null
            ? maximum === null ? '' : `Maximum Heat: ${maximum}`
            : maximum === null
                ? `Projected Heat: ${projection!.projected} (Dissipation ${capacity})`
                : `Maximum Heat: ${maximum}; Projected: ${projection!.projected} (Dissipation ${capacity})`;
    }
    const partialWing = svg.getElementById('partialWingBonus');
    if (partialWing) {
        partialWing.textContent = '';
        partialWing.setAttribute('display', 'none');
    }
}

function renderLocation(
    highlights: RecordSheetDamageHighlights,
    svg: SVGSVGElement,
    location: MekRecordSheetLocation,
    issues: string[],
    bindButton: (
        element: SVGElement,
        interaction: (button: 'primary' | 'secondary') => RecordSheetInteraction,
    ) => void,
    context: () => UnitEditContext,
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    interactive: boolean,
    markChanges: boolean,
): void {
    const code = attributeValue(location.code);
    const condition = new Map(location.conditions.map(row => [row.condition, row] as const));
    const flooded = (condition.get('flooded')?.preview ?? 0) > 0;
    const detached = location.previewDetached;
    const disabled = location.previewDisabled;
    const structurallyDestroyed = location.previewStructurallyDestroyed;
    const pending = flooded !== ((condition.get('flooded')?.committed ?? 0) > 0)
        || detached !== location.committedDetached
        || disabled !== location.committedDisabled
        || structurallyDestroyed !== location.committedStructurallyDestroyed;
    const narc = condition.get('narc');
    const locationNodes = svg.querySelectorAll<SVGElement>(`[data-loc="${code}"]`);
    locationNodes.forEach(element => {
        element.classList.toggle('flooded', flooded);
        element.classList.toggle('detached', detached);
        element.classList.toggle('disabledLocation', disabled);
        element.classList.toggle('pending', pending);
    });
    const criticalGroup = svg.querySelector<SVGElement>(`.critGroup[data-loc="${code}"]`);
    criticalGroup?.classList.toggle('flooded', flooded);
    criticalGroup?.classList.toggle('detached', detached);
    criticalGroup?.classList.toggle('disabledLocation', disabled);
    criticalGroup?.classList.toggle('locationDestroyed', structurallyDestroyed);
    criticalGroup?.classList.toggle('pending', pending);
    svg.querySelectorAll<SVGElement>(`.unitLocation[data-loc="${code}"]`).forEach(element => {
        if (!element.classList.contains('armor') && !element.classList.contains('structure')) return;
        element.classList.toggle('damaged', structurallyDestroyed);
    });
    svg.querySelectorAll<SVGElement>(`.locationNarcBanner[data-loc="${code}"]`).forEach(banner => {
        const count = narc?.committed ?? 0;
        const preview = narc?.preview ?? count;
        banner.setAttribute('display', count > 0 || preview > 0 ? '' : 'none');
        banner.classList.toggle('pending', preview !== count);
        const text = banner.querySelector<SVGElement>('text');
        if (text) text.textContent = count > 0 || preview > 0 ? `NARC: ${preview}` : '';
    });
    if (interactive) {
        svg.querySelectorAll<SVGElement>(`.locationConditionControl[data-loc="${code}"]`)
            .forEach(control => bindActivation(control, signal, event => emit(Object.freeze({
                kind: 'location-condition-menu',
                locationId: location.locationId,
                context: context(),
            }), event)));
    }

    const internalSelector = `.structure.pip[data-loc="${code}"]`;
    const internalPips = [...svg.querySelectorAll<SVGElement>(internalSelector)];
    renderRecordSheetPips(
        highlights,
        internalPips,
        location.maximumInternal,
        location.committedRemainingInternal,
        location.previewRemainingInternal,
        markChanges,
    );
    renderProtectionCounter(
        svg,
        `textIS_${location.code}`,
        location.previewRemainingInternal,
        location.maximumInternal,
    );
    if (location.maximumInternal > 0 && internalPips.length < location.maximumInternal) {
        issues.push(`Missing structure pips for ${location.code}: ${internalPips.length}/${location.maximumInternal}`);
    }
    const internalTargets = recordSheetDamageTargets(
        [...svg.querySelectorAll<SVGElement>(`.unitLocation.structure[data-loc="${code}"]`)],
        [...svg.querySelectorAll<SVGElement>(`.pip-hit-area.structure[data-loc="${code}"]`)],
        internalPips,
    );
    internalTargets.forEach(target => {
        if (!target.classList.contains('pip')) {
            target.classList.toggle(
                'damaged',
                location.previewStructurallyDestroyed || location.previewRemainingInternal === 0,
            );
        }
        target.classList.toggle('selectable', interactive);
        bindButton(target, button => Object.freeze({
            kind: 'internal',
            locationId: location.locationId,
            button,
            context: context(),
        }));
    });

    for (const face of location.armor) {
        renderArmorFace(
            highlights,
            svg,
            face,
            issues,
            bindButton,
            context,
            interactive,
            markChanges,
            location.previewStructurallyDestroyed,
        );
    }
}

function renderShields(
    highlights: RecordSheetDamageHighlights,
    svg: SVGSVGElement,
    snapshot: MekRecordSheetSnapshot,
    issues: string[],
    bindButton: (
        element: SVGElement,
        interaction: (button: 'primary' | 'secondary') => RecordSheetInteraction,
    ) => void,
    context: () => UnitEditContext,
    interactive: boolean,
    markChanges: boolean,
): void {
    for (const shield of snapshot.shields) {
        const prefix = shield.track === 'absorption' ? 'DA' : 'DC';
        const code = `${prefix}${shield.locationCode}`;
        const targets = [...svg.querySelectorAll<SVGElement>(
            `.unitLocation.shield[data-loc="${attributeValue(code)}"]`,
        )];
        if (targets.length === 0) {
            issues.push(`Missing shield layout ${code}`);
            continue;
        }
        const pips = [...svg.querySelectorAll<SVGElement>(`.pip.shield[data-loc="${attributeValue(code)}"]`)];
        renderRecordSheetPips(
            highlights,
            pips,
            shield.maximum,
            shield.committedRemaining,
            shield.previewRemaining,
            markChanges,
        );
        if (pips.length < shield.maximum) {
            issues.push(`Missing shield pips for ${code}: ${pips.length}/${shield.maximum}`);
        }
        for (const target of targets) {
            target.style.display = '';
            target.classList.toggle('damaged', shield.previewRemaining === 0);
            target.classList.toggle('pending', shield.previewRemaining !== shield.committedRemaining);
            target.classList.toggle('selectable', interactive);
            bindButton(target, button => Object.freeze({
                kind: 'shield',
                componentId: shield.componentId,
                track: shield.track,
                button,
                context: context(),
            }));
        }
    }
}

function renderSystemDamage(
    svg: SVGSVGElement,
    snapshot: MekRecordSheetSnapshot,
    bindButton: (
        element: SVGElement,
        interaction: (button: 'primary' | 'secondary') => RecordSheetInteraction,
    ) => void,
    context: () => UnitEditContext,
): void {
    for (const [system, anchor] of Object.entries(SYSTEM_DAMAGE_ANCHORS)) {
        const slots = snapshot.criticalSlots.filter(slot =>
            slot.components.some(component => component.system === system));
        const count = slots.reduce((total, slot) => total + slot.committedHits, 0);
        if (anchor.endsWith('_')) {
            for (let index = 1; index <= 5; index++) {
                const element = svg.getElementById(`${anchor}${index}`) as SVGElement | null;
                element?.classList.toggle('damaged', index <= count);
                const slot = slots[index - 1];
                if (element && slot) bindButton(element, () => Object.freeze({
                    kind: 'system-critical',
                    slotId: slot.slotId,
                    system,
                    level: index,
                    context: context(),
                }));
            }
        } else {
            const element = svg.getElementById(anchor) as SVGElement | null;
            element?.classList.toggle('damaged', count > 0);
            const slot = slots[0];
            if (element && slot) bindButton(element, () => Object.freeze({
                kind: 'system-critical',
                slotId: slot.slotId,
                system,
                level: 1,
                context: context(),
            }));
        }
    }
}

function renderArmorFace(
    highlights: RecordSheetDamageHighlights,
    svg: SVGSVGElement,
    face: MekRecordSheetArmorFace,
    issues: string[],
    bindButton: (
        element: SVGElement,
        interaction: (button: 'primary' | 'secondary') => RecordSheetInteraction,
    ) => void,
    context: () => UnitEditContext,
    interactive: boolean,
    markChanges: boolean,
    locationDestroyed: boolean,
): void {
    const code = attributeValue(face.locationCode);
    const rear = face.face === 'rear';
    const rearSelector = rear ? '[data-rear]' : ':not([data-rear])';
    const pips = [...svg.querySelectorAll<SVGElement>(`.armor.pip${rearSelector}[data-loc="${code}"]`)];
    renderRecordSheetPips(
        highlights,
        pips,
        face.maximum,
        face.committedRemaining,
        face.previewRemaining,
        markChanges,
    );
    renderProtectionCounter(
        svg,
        `textArmor_${face.locationCode}${rear ? 'R' : ''}`,
        face.previewRemaining,
        face.maximum,
    );
    if (face.maximum > 0 && pips.length < face.maximum) {
        issues.push(`Missing ${rear ? 'rear ' : ''}armor pips for ${face.locationCode}: ${pips.length}/${face.maximum}`);
    }
    const targets = recordSheetDamageTargets(
        [...svg.querySelectorAll<SVGElement>(`.unitLocation.armor${rearSelector}[data-loc="${code}"]`)],
        [...svg.querySelectorAll<SVGElement>(`.pip-hit-area.armor${rearSelector}[data-loc="${code}"]`)],
        pips,
    );
    targets.forEach(target => {
        if (!target.classList.contains('pip')) {
            target.classList.toggle('damaged', locationDestroyed || face.previewRemaining === 0);
        }
        target.classList.toggle('selectable', interactive);
        bindButton(target, button => Object.freeze({
            kind: 'armor',
            faceId: face.faceId,
            locationId: face.locationId,
            button,
            context: context(),
        }));
    });
}


function updateCriticalSlotPip(
    highlights: RecordSheetDamageHighlights,
    pip: SVGElement,
    committedHit: boolean,
    previewHit: boolean,
    markChanges: boolean,
): void {
    renderRecordSheetPips(highlights, [pip], 1, committedHit ? 0 : 1, previewHit ? 0 : 1, markChanges);
}

function recordSheetDamageTargets(
    locations: readonly SVGElement[],
    hitAreas: readonly SVGElement[],
    pips: readonly SVGElement[],
): readonly SVGElement[] {
    if (locations.length > 0) {
        hitAreas.forEach(hitArea => { hitArea.style.pointerEvents = 'none'; });
        pips.forEach(pip => { pip.style.pointerEvents = 'none'; });
        return locations;
    }
    // Paperdoll geometry owns damage interaction even if a location is omitted.
    if (pips.some(pip => pip.closest('[data-mekbay-paperdoll="1"]'))
        || hitAreas.some(area => area.closest('[data-mekbay-paperdoll="1"]'))) {
        hitAreas.forEach(element => { element.style.pointerEvents = 'none'; });
        pips.forEach(element => { element.style.pointerEvents = 'none'; });
        return [];
    }
    if (hitAreas.length > 0) {
        hitAreas.forEach(hitArea => { hitArea.style.pointerEvents = ''; });
        pips.forEach(pip => { pip.style.pointerEvents = 'none'; });
        return hitAreas;
    }
    pips.forEach(pip => { pip.style.pointerEvents = ''; });
    return pips;
}

function renderInventory(
    svg: SVGSVGElement,
    manifest: MekSheetBindingManifestV1,
    snapshot: MekRecordSheetSnapshot,
    issues: string[],
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
    interactive: boolean,
): void {
    const layoutRows = [...svg.querySelectorAll<SVGElement>(manifest.selectors.inventoryRow)]
        .filter(row => row.parentElement?.closest('.inventoryEntry') === null);
    const rows = recordSheetEquipmentRows(snapshot);
    rows.forEach((row, index) => {
        const element = layoutRows[index];
        if (!element) return;
        element.style.display = '';
        writeComponentIds(element, row.componentIds);
        element.classList.toggle('interactive', interactive
            && (row.kind === 'weapon' || (row.kind === 'physical' && row.actionTarget !== undefined)));
        element.classList.toggle('damaged', row.status === 'destroyed' || row.status === 'missing');
        element.classList.toggle('disabled', row.status === 'disabled');
        element.classList.toggle('disabledInventory', row.status === 'disabled');
        element.classList.toggle('selected', row.selected && row.status !== 'destroyed' && row.status !== 'missing');
        element.classList.toggle(
            'selected-alternative-mode',
            row.selected && row.mode !== undefined && row.defaultMode !== undefined && row.mode !== row.defaultMode,
        );
        for (const range of ['short', 'medium', 'long', 'extreme'] as const) {
            element.classList.toggle(`selected-range-${range}`, row.selected && row.selectedRange === range);
        }
        if (row.targetColor) element.style.setProperty('--inventory-control-selection-color', row.targetColor);
        else element.style.removeProperty('--inventory-control-selection-color');
        renderInventoryTargetNumber(element, row.targetNumberText);
        renderInventoryHitModifier(element, row.hitModifierText, row.status !== 'available');
        writeInventoryField(element, 'quantity', row.componentIds.length > 1 ? row.componentIds.length : '');
        writeInventoryName(element, row.label);
        writeInventoryField(element, 'location', row.location);
        writeInventoryField(element, 'heat', row.heat);
        writeInventoryDamage(element, row.damage);
        writeInventoryField(element, 'range_min', row.minimumRange);
        writeInventoryField(element, 'range_short', row.ranges[0] ?? '');
        writeInventoryField(element, 'range_medium', row.ranges[1] ?? '');
        writeInventoryField(element, 'range_long', row.ranges[2] ?? '');
        writeInventoryField(element, 'range_extreme', row.ranges[3] ?? '');
        writeGeneratedInventorySummary(element, row);
        const alternativeModes = [...element.querySelectorAll<SVGElement>(':scope > .alternativeMode')];
        const modes = alternativeModes.some(mode => mode.dataset['mekbayStaticModeProfile'] === '1')
            ? row.modes
            : row.modes.filter(mode => mode !== row.defaultMode);
        alternativeModes.forEach((modeElement, modeIndex) => {
            const mode = modes[modeIndex];
            modeElement.style.display = mode === undefined ? 'none' : '';
            modeElement.classList.toggle('selected', row.selected && mode === row.mode);
            modeElement.removeAttribute('mode');
            modeElement.querySelectorAll<SVGElement>('[mode]').forEach(child => child.removeAttribute('mode'));
            if (mode === undefined) return;
            modeElement.setAttribute('data-mekbay-mode', mode);
            if (modeElement.dataset['mekbayStaticModeProfile'] !== '1') {
                writeInventoryName(
                    modeElement,
                    modeElement.dataset['mekbayModeLabelOnly'] === '1' ? mode : `${row.baseLabel} (${mode})`,
                );
                writeInventoryField(modeElement, 'location', row.location);
                writeInventoryField(modeElement, 'heat', row.heat);
                writeInventoryDamage(modeElement, row.damage);
                writeInventoryField(modeElement, 'range_min', row.minimumRange);
                writeInventoryField(modeElement, 'range_short', row.ranges[0] ?? '');
                writeInventoryField(modeElement, 'range_medium', row.ranges[1] ?? '');
                writeInventoryField(modeElement, 'range_long', row.ranges[2] ?? '');
                writeInventoryField(modeElement, 'range_extreme', row.ranges[3] ?? '');
            }
            if (!interactive || row.kind !== 'weapon') return;
            const modeButton = modeElement.querySelector<SVGElement>('.inventoryEntryButton.alternativeModeButton')
                ?? modeElement;
            bindActivation(modeButton, signal, event => emit(Object.freeze({
                kind: 'inventory-selection',
                componentIds: row.componentIds,
                mode,
                context: context(),
            }), event));
            bindInventoryRangeButtons(modeElement, row, mode, emit, signal, context);
        });
        if (interactive && row.kind === 'weapon') {
            const target = element.querySelector<SVGElement>('.inventoryEntryButton.mainButton') ?? element;
            bindActivation(target, signal, event => emit(Object.freeze({
                kind: 'inventory-selection',
                componentIds: row.componentIds,
                context: context(),
            }), event));
            bindInventoryRangeButtons(element, row, undefined, emit, signal, context);
        } else if (interactive && row.kind === 'physical' && row.actionTarget !== undefined) {
            const target = element.querySelector<SVGElement>('.inventoryEntryButton.mainButton') ?? element;
            bindActivation(target, signal, event => emit(Object.freeze({
                kind: 'action-selection',
                target: row.actionTarget!,
                context: context(),
            }), event));
        }
    });
    layoutRows.slice(rows.length).forEach(element => {
        element.style.display = 'none';
        element.removeAttribute(COMPONENT_IDS_ATTRIBUTE);
        element.classList.remove(
            'damaged',
            'disabled',
            'disabledInventory',
            'selected',
            'selected-alternative-mode',
        );
    });
    if (layoutRows.length < rows.length) {
        issues.push(`Missing equipment layout rows: ${layoutRows.length}/${rows.length}`);
    }
}

/** Cross-highlights an inventory row and every critical slot backed by the same Entity component. */
function bindEquipmentHover(svg: SVGSVGElement, signal: AbortSignal): void {
    svg.querySelectorAll<SVGElement>('.inventoryEntry, .critSlot').forEach(element => {
        element.classList.toggle('equipment-hover-source', readComponentIds(element).size > 0);
    });
    if (svg.dataset['mekbayEquipmentHoverBound'] === '1') return;
    svg.dataset['mekbayEquipmentHoverBound'] = '1';
    let highlighted: SVGElement[] = [];

    const clear = (): void => {
        highlighted.forEach(element => element.classList.remove(EQUIPMENT_HOVER_SECONDARY_CLASS));
        highlighted = [];
    };
    const source = (target: EventTarget | null): SVGElement | null => {
        if (!(target instanceof Element)) return null;
        const element = target.closest<SVGElement>(
            `.inventoryEntry[${COMPONENT_IDS_ATTRIBUTE}], .critSlot[${COMPONENT_IDS_ATTRIBUTE}]`,
        );
        return element && svg.contains(element) ? element : null;
    };
    const update = (element: SVGElement | null): void => {
        clear();
        if (!element) return;
        const ids = readComponentIds(element);
        if (ids.size === 0) return;
        highlighted = [...svg.querySelectorAll<SVGElement>(
            `.inventoryEntry[${COMPONENT_IDS_ATTRIBUTE}], .critSlot[${COMPONENT_IDS_ATTRIBUTE}]`,
        )].filter(candidate => candidate !== element
            && [...readComponentIds(candidate)].some(componentId => ids.has(componentId)));
        highlighted.forEach(candidate => candidate.classList.add(EQUIPMENT_HOVER_SECONDARY_CLASS));
    };

    svg.addEventListener('pointerover', event => update(source(event.target)), { signal });
    svg.addEventListener('pointerout', event => update(source(event.relatedTarget)), { signal });
    signal.addEventListener('abort', () => {
        clear();
        svg.querySelectorAll('.equipment-hover-source')
            .forEach(element => element.classList.remove('equipment-hover-source'));
        delete svg.dataset['mekbayEquipmentHoverBound'];
    }, { once: true });
}

function writeComponentIds(element: SVGElement, componentIds: readonly ComponentId[]): void {
    element.setAttribute(COMPONENT_IDS_ATTRIBUTE, JSON.stringify(componentIds));
}

function readComponentIds(element: SVGElement): ReadonlySet<string> {
    const value = element.getAttribute(COMPONENT_IDS_ATTRIBUTE);
    if (value === null) return new Set();
    try {
        const componentIds: unknown = JSON.parse(value);
        if (!Array.isArray(componentIds)) return new Set();
        return new Set(componentIds.filter((componentId): componentId is string => typeof componentId === 'string'));
    } catch {
        return new Set();
    }
}

interface RecordSheetEquipmentRow {
    readonly kind: 'weapon' | 'equipment' | 'physical';
    readonly componentIds: readonly ComponentId[];
    readonly baseLabel: string;
    readonly label: string;
    readonly location: string;
    readonly status: string;
    readonly selected: boolean;
    readonly ammo: boolean;
    readonly heat: string | number;
    readonly damage: string;
    readonly minimumRange: string | number;
    readonly ranges: readonly (number | string)[];
    readonly modes: readonly string[];
    readonly defaultMode?: string;
    readonly mode?: string;
    readonly selectedRange?: 'short' | 'medium' | 'long' | 'extreme';
    readonly targetColor?: string;
    readonly targetNumberText?: string;
    readonly hitModifierText?: string;
    readonly actionTarget?: AttackerActionTarget;
}

function recordSheetEquipmentRows(snapshot: MekRecordSheetSnapshot): readonly RecordSheetEquipmentRow[] {
    const weaponRows: {
        readonly componentId: ComponentId;
        readonly row: Omit<RecordSheetEquipmentRow, 'componentIds'>;
    }[] = [];
    const crewGunnery = snapshot.crew.find(position => position.occurrence === 0)?.gunnery
        ?? snapshot.crew[0]?.gunnery
        ?? 4;
    for (const component of snapshot.equipment) {
        if (component.weapon === undefined) continue;
        const weapon = component.weapon;
        const label = component.label;
        const selection = weapon?.selection;
        const selectedTarget = selection?.kind === 'target'
            ? snapshot.targets.find(target => target.targetId === selection.targetId)
            : undefined;
        const target = selectedTarget === undefined
            ? null
            : projectTargetingTarget(selectedTarget, snapshot.ruleset);
        const targetPresentation = projectWeaponTargetPresentation(
            component,
            target,
            crewGunnery,
            snapshot.movement.declared.kind === 'supported'
                ? snapshot.movement.declared.mode
                : null,
            snapshot.ruleset,
        );
        const hitModifier = equipmentWeaponToHitModifier(component);
        const row = Object.freeze({
            kind: 'weapon' as const,
            baseLabel: component.label,
            label,
            location: formatEquipmentLocationCodes(component.locations.map(location => location.code)),
            status: component.status,
            selected: selection !== undefined,
            ammo: false,
            heat: weapon.heat,
            damage: component.equipment instanceof WeaponEquipment
                ? formatRecordSheetWeaponDamageText(
                    component.equipment,
                    weapon.damageText ?? formatDamage(weapon.damage),
                    weapon.effectiveWeaponTypes ?? component.equipment.getWeaponTypes(),
                )
                : weapon.damageText ?? formatDamage(weapon.damage),
            minimumRange: weapon.minimumRange > 0 ? weapon.minimumRange : '—',
            ranges: Object.freeze([...weapon.ranges]),
            modes: component.modes,
            ...(component.defaultMode === undefined ? {} : { defaultMode: component.defaultMode }),
            ...(component.mode === undefined ? {} : { mode: component.mode }),
            ...(selection !== undefined && targetPresentation.rangeSelection !== null
                ? { selectedRange: targetPresentation.rangeSelection.range }
                : {}),
            ...(selectedTarget === undefined ? {} : { targetColor: selectedTarget.color }),
            ...(targetPresentation.targetNumberText === ''
                ? {}
                : { targetNumberText: targetPresentation.targetNumberText }),
            ...(hitModifier === 0 ? {} : { hitModifierText: `${hitModifier > 0 ? '+' : ''}${hitModifier}` }),
        });
        weaponRows.push({ componentId: component.componentId, row });
    }
    const weapons = weaponRows
        .sort((left, right) => compareRecordSheetWeaponRows(left.row, right.row))
        .map(({ componentId, row }) => Object.freeze({
        componentIds: Object.freeze([componentId]),
        ...row,
    }));
    const equipment = snapshot.equipment
        .filter(component => component.weapon === undefined && isPrintableMekInventoryComponent(component))
        .map(component => Object.freeze({
            kind: 'equipment' as const,
            componentIds: Object.freeze([component.componentId]),
            baseLabel: component.label,
            label: component.label,
            location: formatEquipmentLocationCodes(component.locations.map(location => location.code)),
            status: component.status,
            selected: false,
            ammo: false,
            heat: '—',
            damage: miscInventoryDamage(component.equipment),
            minimumRange: '—',
            ranges: Object.freeze(['—', '—', '—']),
            modes: Object.freeze([]),
        }))
        .sort((left, right) => {
            const name = left.label.localeCompare(right.label);
            return name !== 0 ? name : left.location.localeCompare(right.location);
        });
    const physical = snapshot.physicalAttacks?.kind !== 'supported'
        ? []
        : snapshot.physicalAttacks.attacks.map(attack => {
            const selection = attack.selection;
            const hitModifierText = attack.hitModifiers.map(formatPhysicalHitModifier).join('/');
            const damage = attack.effect.kind === 'none'
                ? '—'
                : attack.effect.kind === 'modifier'
                    ? `${attack.effect.modifier >= 0 ? '+' : ''}${attack.effect.modifier}`
                : attack.effect.displayFormula !== undefined
                    ? attack.effect.displayFormula
                : attack.effect.alternateDamage !== undefined
                    ? `${attack.effect.damage} [${attack.effect.alternateDamage}]`
                : attack.effect.damage === attack.effect.maximumDamage
                    ? `${attack.effect.damage}`
                    : `${attack.effect.damage} [${attack.effect.maximumDamage}]`;
            const selectedTarget = selection?.kind === 'target'
                ? snapshot.targets.find(target => target.targetId === selection.targetId)
                : undefined;
            return Object.freeze({
                kind: 'physical' as const,
                componentIds: Object.freeze(attack.target.kind === 'component'
                    ? [attack.target.componentId]
                    : []),
                baseLabel: attack.label,
                label: attack.label,
                location: attack.locationCodes.join('/'),
                status: attack.available ? 'available' : 'disabled',
                selected: selection !== undefined,
                ammo: false,
                heat: '',
                damage,
                minimumRange: '',
                ranges: Object.freeze([]),
                modes: Object.freeze([]),
                ...(hitModifierText === '' ? {} : { hitModifierText }),
                ...(attack.available && attack.selectable ? { actionTarget: attack.target } : {}),
                ...(selectedTarget === undefined ? {} : { targetColor: selectedTarget.color }),
            });
        });
    return Object.freeze([...weapons, ...equipment, ...physical]);
}

function isPrintableMekInventoryComponent(
    component: MekRecordSheetSnapshot['equipment'][number],
): boolean {
    const equipment = component.equipment;
    if (!equipment || equipment.type !== 'misc' || !equipment.hittable) return false;
    if (component.locations.length === 0
        || component.locations.some(location => location.code === 'Engine' || location.code === 'Unallocated')) {
        return false;
    }
    if (isHeatSinkEquipment(equipment) || isJumpJetEquipment(equipment)) return false;
    return !isMekRecordSheetInventorySupport(equipment);
}

function miscInventoryDamage(
    equipment: MekRecordSheetSnapshot['equipment'][number]['equipment'],
): string {
    if (!equipment) return '—';
    if (equipment.hasFlag('F_AP_POD')) return '[PB,OS,AI]';
    return isTargetingComputerEquipment(equipment) ? '[E]' : '—';
}

function compareRecordSheetWeaponRows(
    left: Omit<RecordSheetEquipmentRow, 'componentIds'>,
    right: Omit<RecordSheetEquipmentRow, 'componentIds'>,
): number {
    const rangeCount = Math.max(left.ranges.length, right.ranges.length);
    for (let index = 0; index < rangeCount; index++) {
        const delta = Number(right.ranges[index] ?? 0) - Number(left.ranges[index] ?? 0);
        if (delta !== 0) return delta;
    }
    return Number(right.heat) - Number(left.heat);
}

function renderInventoryTargetNumber(element: SVGElement, value: string | undefined): void {
    const rect = element.querySelector<SVGElement>(':scope > .targetTn-rect');
    const text = element.querySelector<SVGElement>(':scope > .targetTn-text');
    const visible = value !== undefined && value !== '';
    rect?.setAttribute('display', visible ? 'block' : 'none');
    text?.setAttribute('display', visible ? 'block' : 'none');
    if (text) text.textContent = value ?? '';
    element.classList.toggle('selected-target-out-of-range', value === 'X');
}

function renderInventoryHitModifier(
    element: SVGElement,
    value: string | undefined,
    unavailable: boolean,
): void {
    const rect = element.querySelector<SVGElement>(':scope > .hitMod-rect');
    const text = element.querySelector<SVGElement>(':scope > .hitMod-text');
    const visible = !unavailable && value !== undefined && value !== '';
    rect?.setAttribute('display', visible ? 'block' : 'none');
    text?.setAttribute('display', visible ? 'block' : 'none');
    if (text) text.textContent = visible ? value : '';
}

const INVENTORY_RANGE_BUTTONS = Object.freeze([
    Object.freeze({ selector: '.shrButton', range: 'short' as const }),
    Object.freeze({ selector: '.medButton', range: 'medium' as const }),
    Object.freeze({ selector: '.lngButton', range: 'long' as const }),
    Object.freeze({ selector: '.extButton', range: 'extreme' as const }),
]);

function bindInventoryRangeButtons(
    root: SVGElement,
    row: RecordSheetEquipmentRow,
    mode: string | undefined,
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
): void {
    for (const definition of INVENTORY_RANGE_BUTTONS) {
        root.querySelectorAll<SVGElement>(`:scope > .inventoryEntryButton${definition.selector}`)
            .forEach(button => {
                bindActivation(button, signal, event => emit(Object.freeze({
                    kind: 'inventory-selection',
                    componentIds: row.componentIds,
                    ...(mode === undefined ? {} : { mode }),
                    range: definition.range,
                    context: context(),
                }), event));
            });
    }
}

function formatDamage(value: string | number | readonly number[]): string {
    return Array.isArray(value) ? value.join('/') : String(value);
}

function writeGeneratedInventorySummary(rowElement: SVGElement, row: RecordSheetEquipmentRow): void {
    const field = rowElement.querySelector<SVGElement>('.mekbay-inventory-summary');
    if (!field) return;
    const ranges = row.ranges.join('/');
    field.textContent = [
        row.componentIds.length > 1 ? `×${row.componentIds.length}` : '',
        row.heat === '' ? '' : `H${row.heat}`,
        row.damage === '' ? '' : `D${formatDamage(row.damage)}`,
        ranges ? `R${row.minimumRange ? `${row.minimumRange}/` : ''}${ranges}` : '',
    ].filter(Boolean).join(' ');
}

function writeInventoryField(row: SVGElement, className: string, value: string | number): void {
    const field = row.querySelector<SVGElement>(`.${className}`);
    if (!field) return;
    const textNodes = field.matches('text')
        ? [field]
        : [...field.querySelectorAll<SVGElement>('text')];
    if (textNodes.length === 0) {
        field.textContent = String(value);
        return;
    }
    textNodes.forEach((node, index) => { node.textContent = index === 0 ? String(value) : ''; });
}

function writeInventoryName(row: SVGElement, value: string): void {
    const field = row.querySelector<SVGElement>('.name');
    const lines = getSvgTextLines(field);
    if (lines.length === 0) {
        writeInventoryField(row, 'name', value);
        return;
    }
    writeSvgTextLines(field, value, {
        maxWidth: inventoryNameLineWidth(row, lines[0]),
        measure: measureSvgTextCanvas,
    });
}

function writeInventoryDamage(row: SVGElement, value: string | number): void {
    const field = row.querySelector<SVGElement>('.damage');
    const lines = getSvgTextLines(field);
    if (lines.length === 0) {
        writeInventoryField(row, 'damage', value);
        return;
    }
    writeSvgTextLines(field, String(value), {
        maxWidth: inventoryDamageLineWidth(row, lines[0]),
        allowFinalLineOverflow: true,
        measure: measureSvgTextCanvas,
    });
}

function inventoryNameLineWidth(row: SVGElement, line: SVGTextContentElement): number | null {
    const nameX = svgTextCoordinate(line, 'x');
    if (!Number.isFinite(nameX)) return null;

    const boundaryAnchors = [
        'location', 'heat', 'damage', 'range_min',
        'range_short', 'range_medium', 'range_long', 'range_extreme',
    ]
        .map(className => firstInventoryTextLine(row, className))
        .map(column => column === undefined ? Number.NaN : svgTextCoordinate(column, 'x'))
        .filter(x => Number.isFinite(x) && x > nameX)
        .sort((left, right) => left - right);
    const firstColumnX = boundaryAnchors[0];
    let rightEdge: number;
    if (firstColumnX !== undefined) {
        const secondColumnX = boundaryAnchors[1];
        const columnGap = secondColumnX === undefined ? 0 : secondColumnX - firstColumnX;
        rightEdge = firstColumnX - Math.max(0, columnGap) / 2;
    } else {
        const button = row.querySelector<SVGRectElement>('.mainButton');
        const buttonX = Number.parseFloat(button?.getAttribute('x') ?? '');
        const buttonWidth = Number.parseFloat(button?.getAttribute('width') ?? '');
        if (!Number.isFinite(buttonX) || !Number.isFinite(buttonWidth)) return null;
        rightEdge = buttonX + buttonWidth;
    }

    const width = rightEdge - nameX - 1;
    return width > 0 ? width : null;
}

function inventoryDamageLineWidth(row: SVGElement, line: SVGTextContentElement): number | null {
    const rangeMin = firstInventoryTextLine(row, 'range_min');
    if (!rangeMin) return null;
    const damageX = svgTextCoordinate(line, 'x');
    const rangeMinX = svgTextCoordinate(rangeMin, 'x');
    if (!Number.isFinite(damageX) || !Number.isFinite(rangeMinX)) return null;

    const width = rangeMinX - damageX - 1;
    return width > 0 ? width : null;
}

function firstInventoryTextLine(row: SVGElement, className: string): SVGTextContentElement | undefined {
    return getSvgTextLines(row.querySelector<SVGElement>(`.${className}`))[0];
}

function svgTextCoordinate(line: SVGTextContentElement, attribute: string): number {
    const value = Number.parseFloat(line.getAttribute(attribute) ?? '');
    if (Number.isFinite(value)) return value;
    return Number.parseFloat(line.parentElement?.getAttribute(attribute) ?? '');
}

function renderAmmoProfile(svg: SVGSVGElement, snapshot: MekRecordSheetSnapshot, interactive: boolean): void {
    const profile = svg.querySelector<SVGElement>('#ammoProfile');
    if (!profile) return;
    const totals = new Map<string, number>();
    snapshot.equipment.forEach(component => {
        if (component.ammo === undefined) return;
        const name = recordSheetAmmoName(component.ammo.displayName);
        totals.set(name, (totals.get(name) ?? 0) + component.ammo.remaining);
    });
    updateRecordSheetAmmoProfile(profile, [...totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, remaining]) => `(${name}) ${remaining}`), interactive);
}

function renderCrew(
    svg: SVGSVGElement,
    snapshot: MekRecordSheetSnapshot,
    issues: string[],
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    currentSnapshot: () => MekRecordSheetSnapshot,
    interactive: boolean,
): void {
    const context = (): UnitEditContext => currentSnapshot().editContext;
    renderRecordSheetCrewVacancies(svg, snapshot.crew);
    const permanentPsrModifier = snapshot.movement.projection.kind === 'supported'
        ? snapshot.movement.projection.permanentPsrModifier
        : 0;
    for (const position of snapshot.crew) {
        const occurrence = position.occurrence;
        const vacant = position.effectiveState === 'vacant';
        const displayName = vacant ? '' : position.name;
        if (!renderRecordSheetCrewName(svg, occurrence, displayName)) {
            write(svg, `#crewName${occurrence}`, displayName);
        }
        write(svg, `#gunnerySkill${occurrence}`, vacant ? '—' : position.gunnery);
        write(svg, `#aeroGunnerySkill${occurrence}`, vacant ? '—' : position.aeroGunnery ?? 4);
        write(svg, `#aeroPilotingSkill${occurrence}`, vacant ? '—' : position.aeroPiloting ?? 5);
        if (vacant) write(svg, `#pilotingSkill${occurrence}`, '—');
        else renderPilotingSkillDisplay(
            svg.querySelector<SVGElement>(`#pilotingSkill${occurrence}`),
            position.piloting,
            permanentPsrModifier,
        );
        for (let wounds = 1; wounds <= 6; wounds++) {
            const marker = svg.querySelector<SVGElement>(`.crewHit[crewId="${occurrence}"][hit="${wounds}"]`);
            if (!marker) continue;
            marker.style.display = vacant ? 'none' : '';
            marker.classList.toggle('damaged', wounds <= position.state.wounds);
            if (!interactive || vacant) continue;
            if (marker.dataset['mekbayBound'] === '1') continue;
            marker.dataset['mekbayBound'] = '1';
            marker.classList.add('interactive');
            marker.setAttribute('tabindex', '0');
            const select = (event: Event): void => {
                if (marker.style.display === 'none') return;
                const current = currentSnapshot().crew.find(row => row.positionId === position.positionId)?.state.wounds ?? 0;
                const next = current === wounds ? Math.max(0, wounds - 1) : wounds;
                emit(Object.freeze({
                    kind: 'crew-wounds',
                    positionId: position.positionId,
                    wounds: next,
                    context: context(),
                }), event);
            };
            marker.addEventListener('click', select, { signal });
            marker.addEventListener('keydown', event => {
                if (!(event instanceof KeyboardEvent) || (event.key !== 'Enter' && event.key !== ' ')) return;
                select(event);
            }, { signal });
        }
        svg.querySelector<SVGElement>(`#crewDamage${occurrence}`)
            ?.classList.toggle('unconscious', position.effectiveState === 'unconscious');
        renderCrewState(
            svg,
            occurrence,
            position.effectiveState === 'healthy' || position.effectiveState === 'vacant'
                ? null : position.effectiveState,
        );
        if (interactive) {
            bindCrewControls(svg, position, emit, signal, context);
        }
    }
    if (snapshot.crew.length > 0 && !svg.querySelector('.crewHit, [id^="crewName"]')) {
        issues.push('Missing crew layout');
    }
}

function renderPilotingSkillDisplay(
    element: SVGElement | null,
    pilotingSkill: number,
    controlRollModifier: number,
): void {
    if (!element) return;
    const controlRollLabel = 'PSR';
    const displayText = formatPilotingDisplay(pilotingSkill, controlRollModifier, controlRollLabel);
    element.textContent = displayText;
    if (!controlRollModifier) return;

    const suffixStart = String(pilotingSkill).length;
    const labelStart = displayText.lastIndexOf(controlRollLabel);
    element.textContent = displayText.slice(0, suffixStart);
    const suffix = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    suffix.setAttribute('class', 'controlRollModifier');
    suffix.setAttribute('font-size', '0.72em');
    suffix.setAttribute('dominant-baseline', 'central');
    suffix.setAttribute('dy', '-0.15em');
    suffix.textContent = displayText.slice(suffixStart, labelStart);
    const label = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    label.setAttribute('class', 'controlRollLabel');
    label.setAttribute('font-size', '0.5em');
    label.setAttribute('font-family', 'Roboto Condensed');
    label.setAttribute('dy', '-0.3em');
    label.textContent = controlRollLabel;
    suffix.appendChild(label);
    element.appendChild(suffix);
}

function renderCrewState(
    svg: SVGSVGElement,
    occurrence: number,
    key: 'unconscious' | 'ejected' | 'dead' | null,
): void {
    const state = key === null ? null : MEK_CREW_STATE_DISPLAYS.find(candidate => candidate.key === key) ?? null;
    renderRecordSheetCrewState(svg, occurrence, state);
}

function bindCrewControls(
    svg: SVGSVGElement,
    position: MekRecordSheetSnapshot['crew'][number],
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
): void {
    const occurrence = position.occurrence;
    svg.querySelectorAll<SVGElement>(`.crewNameButton[crewId="${occurrence}"]`)
        .forEach(button => bindActivation(button, signal, event => emit(Object.freeze({
        kind: 'crew-name',
        positionId: position.positionId,
        context: context(),
    }), event)));
    for (const [control, skill] of [
        ['gunnery', 'gunnery'], ['piloting', 'piloting'],
        ['aero-gunnery', 'aeroGunnery'], ['aero-piloting', 'aeroPiloting'],
    ] as const) {
        svg.querySelectorAll<SVGElement>(`.crewSkillButton[crewId="${occurrence}"][skill="${control}"]`)
            .forEach(button => bindActivation(button, signal, event => emit(Object.freeze({
                kind: 'crew-skill',
                positionId: position.positionId,
                skill,
                context: context(),
            }), event)));
    }
    svg.querySelectorAll<SVGElement>(`.crewStateButton[crewId="${occurrence}"]`)
        .forEach(button => bindActivation(button, signal, event => emit(Object.freeze({
            kind: 'crew-state-menu',
            positionId: position.positionId,
            context: context(),
        }), event)));
}

function bindRandomHitControl(
    svg: SVGSVGElement,
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
    interactive: boolean,
): void {
    if (!interactive) return;
    svg.querySelectorAll<SVGElement>('[data-mekbay-random-hit="1"]').forEach(element => {
        if (element.dataset['mekbayBound'] === '1') return;
        element.dataset['mekbayBound'] = '1';
        element.classList.add('interactive');
        element.setAttribute('tabindex', '0');
        const activate = (event: Event): void => emit(Object.freeze({
            kind: 'random-hit',
            element,
            context: context(),
        }), event);
        element.addEventListener('pointerdown', event => {
            if (!(event instanceof PointerEvent) || event.button !== 0) return;
            activate(event);
        }, { signal });
        element.addEventListener('keydown', event => {
            if (!(event instanceof KeyboardEvent) || (event.key !== 'Enter' && event.key !== ' ')) return;
            activate(event);
        }, { signal });
    });
}

function bindEquipmentOpeners(
    svg: SVGSVGElement,
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
    interactive: boolean,
): void {
    if (!interactive) return;
    const bind = (selector: string, tab: 'weapons' | 'ammo'): void => {
        svg.querySelectorAll<SVGElement>(selector).forEach(element => bindActivation(
            element,
            signal,
            event => emit(Object.freeze({ kind: 'open-equipment', tab, context: context() }), event),
        ));
    };
    bind('#ammoProfile', 'ammo');
    bind('[data-mekbay-open-equipment="weapons"]', 'weapons');
}

function bindHeatControls(
    svg: SVGSVGElement,
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
    interactive: boolean,
): void {
    if (!interactive) return;
    svg.querySelectorAll<SVGElement>('#heatScale .overflowButton, #heatScale .overflowFrame')
        .forEach(element => bindActivation(element, signal, event => emit(Object.freeze({
            kind: 'heat-overflow',
            context: context(),
        }), event)));
    const apply = svg.getElementById('applyHeatButton') as SVGElement | null;
    if (apply) bindActivation(apply, signal, event => emit(Object.freeze({
        kind: 'apply-heat',
        context: context(),
    }), event));
}

function bindReferenceTable(
    svg: SVGSVGElement,
    emit: (interaction: RecordSheetInteraction, event: Event) => void,
    signal: AbortSignal,
    context: () => UnitEditContext,
    interactive: boolean,
): void {
    if (!interactive) return;
    if (svg.dataset['mekbayReferenceBound'] === '1') return;
    svg.dataset['mekbayReferenceBound'] = '1';
    resolveCenterPanelCursorElements(svg).forEach(element => element.classList.add('referenceTableControl'));
    svg.addEventListener('click', event => {
        if (!(event instanceof MouseEvent) || event.button !== 0) return;
        if (!isCenterPanelTarget(svg, event.target)
            && !isPointInCenterPanel(svg, event.clientX, event.clientY)) return;
        emit(Object.freeze({ kind: 'reference-table', context: context() }), event);
    }, { capture: true, signal });
}

function bindActivation(
    element: SVGElement,
    signal: AbortSignal,
    activate: (event: Event) => void,
): void {
    if (element.dataset['mekbayBound'] === '1') return;
    element.dataset['mekbayBound'] = '1';
    element.classList.add('interactive');
    element.setAttribute('tabindex', '0');
    element.addEventListener('click', activate, { signal });
    element.addEventListener('keydown', event => {
        if (!(event instanceof KeyboardEvent) || (event.key !== 'Enter' && event.key !== ' ')) return;
        activate(event);
    }, { signal });
}

function renderHeat(
    svg: SVGSVGElement,
    snapshot: MekRecordSheetSnapshot,
    bindHeat: (element: SVGElement, heat: number) => void,
): void {
    renderRecordSheetHeatScale(svg, recordSheetHeatScale(snapshot), snapshot.identity.form === 'lam' ? 'lam' : 'mek', bindHeat);
    renderHeatSourcesSummary(svg, snapshot.heatProjection.kind === 'supported' ? snapshot.heatProjection.projection : null);
}

function renderHeatSourcesSummary(
    svg: SVGSVGElement,
    projection: MekHeatProjectionV2 | null,
): void {
    const target = svg.getElementById('damagedEngineHeatText') as SVGTextElement | null;
    if (!target) return;
    const rows = projection === null ? [] : buildHeatSummaryRows(
        projection.sources,
        projection.remainingDissipation,
        projection.dissipated,
        projection.projected,
        { groupSources: true },
    );
    if (rows.length === 0) {
        target.textContent = '';
        target.setAttribute('display', 'none');
        target.style.display = 'none';
        return;
    }

    const x = target.getAttribute('x') ?? '0';
    const y = Number(target.getAttribute('y') ?? '0');
    const lineHeight = 8;
    target.textContent = '';
    target.removeAttribute('display');
    target.style.display = 'block';
    rows.forEach((row, index) => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        line.setAttribute('x', x);
        line.setAttribute('y', String(y - ((rows.length - 1 - index) * lineHeight)));
        if (row.inventorySelection) line.setAttribute('fill', 'orange');
        else if (row.kind === 'sink') line.setAttribute('fill', row.value < 0 ? '#2070d1' : '#f00');
        line.textContent = `${row.label}: ${row.value >= 0 ? '+' : ''}${row.value}`;
        target.appendChild(line);
    });
}

function renderLifeSupportPilotDamage(
    svg: SVGSVGElement,
    snapshot: MekRecordSheetSnapshot,
): void {
    const warning = svg.getElementById('lifeSupportPilotDamageWarning');
    if (!warning) return;

    warning.querySelectorAll('.lifeSupportPilotDamageIcon').forEach(icon => icon.remove());
    const icons = [
        ...Array(snapshot.lifeSupport.heatHits).fill('heat' as const),
        ...Array(snapshot.lifeSupport.oxygenHits).fill('oxygen' as const),
    ];
    if (icons.length === 0) {
        warning.setAttribute('display', 'none');
        warning.removeAttribute('aria-label');
        return;
    }

    const warningWidth = Number(warning.getAttribute('data-width')) || 42;
    const iconSize = Number(warning.getAttribute('data-height')) || 15;
    const iconGap = -1.5;
    const iconsWidth = icons.length * iconSize + (icons.length - 1) * iconGap;
    const startX = warningWidth - iconsWidth;
    icons.forEach((kind, index) => {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        icon.setAttribute('class', `lifeSupportPilotDamageIcon ${kind}`);
        icon.setAttribute('href', kind === 'heat'
            ? '#lifeSupportHeatDamageIcon'
            : '#lifeSupportOxygenDamageIcon');
        icon.setAttribute('x', String(startX + index * (iconSize + iconGap)));
        icon.setAttribute('y', '0');
        icon.setAttribute('width', String(iconSize));
        icon.setAttribute('height', String(iconSize));
        warning.appendChild(icon);
    });
    warning.setAttribute(
        'aria-label',
        `${snapshot.lifeSupport.heatHits} heat, ${snapshot.lifeSupport.oxygenHits} oxygen-deprivation pilot damage`,
    );
    warning.removeAttribute('display');
}

/** Erases every legacy unit-specific value before applying entity/runtime facts. */
function resetUnitDataLayout(
    svg: SVGSVGElement,
    manifest: MekSheetBindingManifestV1,
): void {
    svg.querySelectorAll<SVGElement>(
        `${manifest.selectors.armorPip}, ${manifest.selectors.structurePip}`,
    ).forEach(element => {
        element.style.display = 'none';
        element.style.pointerEvents = '';
        element.classList.remove('damaged', 'pending', 'fresh');
    });
    svg.querySelectorAll<SVGElement>(manifest.selectors.criticalSlot).forEach(element => {
        const generatedEmptySlot = element.dataset['mekbayEmptySlot'] === '1';
        element.style.display = generatedEmptySlot ? '' : 'none';
        element.classList.remove('damaged', 'pending', 'willDamage', 'willRepair', 'armored', 'disabled', 'customAmmoLoadout');
        element.classList.remove('interactive');
        element.removeAttribute('tabindex');
        element.removeAttribute('hittable');
        element.removeAttribute('uid');
        element.removeAttribute('totalAmmo');
        element.removeAttribute('data-mekbay-slot-id');
        element.removeAttribute('data-mekbay-component-ids');
        element.querySelectorAll<SVGElement>('.armoredLocPip, .extraHitPip')
            .forEach(pip => pip.classList.remove('damaged', 'pending', 'fresh'));
        const label = element.querySelector<SVGTextElement>('text');
        if (label) label.textContent = generatedEmptySlot ? 'Roll Again' : '';
    });
    svg.querySelectorAll<SVGElement>(manifest.selectors.inventoryRow).forEach(element => {
        element.style.display = 'none';
        element.classList.remove('damaged', 'disabled');
        // Authored `eq-*` classes are historical Unit/summary identities. They
        // are neither stable nor authoritative and can disagree with the
        // Entity row projected into this layout (notably Club/Kick rows).
        [...element.classList]
            .filter(className => className.startsWith('eq-'))
            .forEach(className => element.classList.remove(className));
        element.removeAttribute('id');
        element.removeAttribute('baseHitMod');
        element.removeAttribute('hitMod');
        element.removeAttribute('hitMod2');
        element.removeAttribute('data-mekbay-component-ids');
        element.querySelectorAll<SVGElement>('[inventory-id], [mode]').forEach(child => {
            child.removeAttribute('inventory-id');
            child.removeAttribute('mode');
        });
        for (const field of [
            'quantity', 'name', 'location', 'heat', 'damage', 'hitmod',
            'range_min', 'range_short', 'range_medium', 'range_long', 'range_extreme',
        ]) writeInventoryField(element, field, '');
    });
    svg.querySelectorAll<SVGElement>(manifest.selectors.crewHit).forEach(element => {
        element.style.display = 'none';
        element.classList.remove('damaged');
    });
    resetCrewText(svg);
    writeSvgTextLines(svg.querySelector('#ammoProfile'), '');
    svg.querySelectorAll<SVGElement>(manifest.selectors.heatSinkPip).forEach(element => {
        element.style.display = 'none';
        element.classList.remove('damaged', 'disabled', 'fresh');
    });
    svg.querySelectorAll<SVGElement>('.unitLocation.shield').forEach(element => {
        element.style.display = 'none';
        element.classList.remove('damaged', 'pending');
    });
    svg.querySelectorAll<SVGElement>('.pip.shield').forEach(pip => {
        pip.style.display = 'none';
        pip.classList.remove('damaged', 'pending', 'fresh');
    });
    svg.querySelectorAll<SVGElement>('.locationNarcBanner').forEach(element => {
        element.setAttribute('display', 'none');
        element.classList.remove('pending');
        const text = element.querySelector<SVGElement>('text');
        if (text) text.textContent = '';
    });
    svg.querySelectorAll<SVGElement>(manifest.selectors.conditionButton).forEach(element => {
        element.classList.remove('active');
        element.querySelector<SVGElement>('rect')?.setAttribute('fill', '#fff');
        element.querySelector<SVGElement>('text')?.setAttribute('fill', '#000');
    });
    svg.querySelectorAll<SVGElement>(manifest.selectors.conditionBanner).forEach(element => {
        element.classList.remove('visible');
        element.setAttribute('display', 'none');
        element.setAttribute('opacity', '0');
        element.removeAttribute('transform');
    });
    svg.querySelectorAll<SVGElement>('[id^="engine_hit_"], [id^="gyro_hit_"], [id^="sensor_hit_"], [id^="life_support_hit_"], [id^="avionics_hit_"], [id^="landing_gear_hit_"], [id^="cockpit_hit_"]')
        .forEach(element => element.classList.remove('damaged'));
    svg.querySelectorAll('#heat-projection-path, #heat-projection-target-marker, #heat-selected-weapons-target-marker, #heat-projection-overflow-text, #now-arrow, #next-arrow, #projection-arrow, #faded-arrow, #now-arrow-label')
        .forEach(element => element.remove());
}

function resetCrewText(svg: SVGSVGElement): void {
    svg.querySelectorAll<SVGElement>('[id^="crewName"]').forEach(element => {
        const occurrence = element.id.slice('crewName'.length);
        const mappedToAnotherElement = [...svg.querySelectorAll<SVGElement>(
            `.crewNameButton[crewId="${attributeValue(occurrence)}"]`,
        )].some(button => {
            const textElement = button.getAttribute('textElement');
            return textElement !== null && textElement !== element.id;
        });
        if (!mappedToAnotherElement) element.textContent = '';
    });
    svg.querySelectorAll<SVGElement>(
        '[id^="pilotName"], [id^="gunnerySkill"], [id^="pilotingSkill"], [id^="aeroGunnerySkill"], [id^="aeroPilotingSkill"]',
    ).forEach(element => {
        if (/^(?:pilotName|gunnerySkill|pilotingSkill|aeroGunnerySkill|aeroPilotingSkill)\d+$/u.test(element.id)) {
            element.textContent = '';
        }
    });
}

function write(svg: SVGSVGElement, selector: string, value: string | number): void {
    const element = svg.querySelector<SVGElement>(selector);
    if (element) element.textContent = String(value);
}

function assertReviewedBinding(
    manifest: MekSheetBindingManifestV1,
    snapshot: MekRecordSheetSnapshot,
): void {
    if (manifest !== MM_DATA_MEK_SHEET_BINDING_MANIFEST) {
        throw new Error('Record-sheet binding requires the reviewed manifest');
    }
}

function attributeValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
