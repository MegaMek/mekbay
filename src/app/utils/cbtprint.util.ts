// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { getFactionAffinity } from '../models/factions.model';
import type { PrintAllOptions } from '../models/print-options.model';
import type { BaseEntity } from '../models/entity/base-entity';
import type { EntityTechBase } from '../models/entity/types';
import { AmmoEquipment } from '../models/equipment.model';
import { isJumpJetEquipment } from '../models/jump-equipment.model';
import { isHeatSinkEquipment } from '../models/heat-equipment.model';
import { isCaseEquipment } from '../models/case-equipment.model';
import type { RecordSheetSourceService } from '../services/record-sheet-source.service';
import {
    isCBTMekForceMember,
    type CBTForceMember,
} from '../models/force-member.model';
import type { NonMekRecordSheetSnapshot } from '../models/runtime/non-mek-record-sheet';
import type { MekRecordSheetSnapshot } from '../models/runtime/mek-record-sheet';
import { MM_DATA_MEK_SHEET_BINDING_MANIFEST } from '../models/mek-sheet-binding';
import { bindMekRecordSheet } from '../components/page-viewer/mek-record-sheet-binder';
import { bindNonMekRecordSheet } from '../components/page-viewer/non-mek-record-sheet-binder';
import { RecordSheetSvgGenerator } from './sheets/record-sheet-svg-generator';
import {
    planRecordSheetPages,
    type RecordSheetLayoutProfile,
} from './sheets/record-sheet-layout';
import { recordSheetLayoutProfile } from './sheets/layouts/record-sheet-layout-resolver';

interface PreparedPrintSheet {
    readonly member: CBTForceMember;
    readonly svg: SVGSVGElement;
    readonly compact: boolean;
    readonly kind: RecordSheetLayoutProfile['kind'];
    readonly height: number;
    readonly pageContentY: number | undefined;
    readonly pristineBattleValue: number;
}


export class CBTPrintUtil {

    public static async multipagePrint(
        members: readonly CBTForceMember[],
        printOptions: PrintAllOptions,
        recordSheetSource: RecordSheetSourceService,
        triggerPrint: boolean = true,
    ): Promise<void> {
        if (members.length === 0) {
            console.warn('No units to export.');
            return;
        }
        const prepared: PreparedPrintSheet[] = [];
        for (const member of members) {
            const memberSheets = await this.createPrintSheets(
                member,
                printOptions.clean,
                printOptions.paperSize,
                recordSheetSource,
            );
            for (const sheet of memberSheets) {
                const { svg } = sheet;

                await this.nextAnimationFrames(2);

                this.applyPilotDataPrintOption(
                    svg,
                    printOptions.printPilotData,
                    sheet.pristineBattleValue,
                );

                // Turn on/off fluff image
                const injectedEl = (svg.getElementById('fluff-image-fo')
                    ?? svg.getElementById('fluff-image-injected')) as SVGElement | null;
                if (injectedEl) {
                    const centerContent = printOptions.recordSheetCenterPanelContent;
                    const referenceTables = svg.querySelectorAll<SVGGraphicsElement>('.referenceTable');
                    if (centerContent === 'fluffImage') {
                        injectedEl.style.setProperty('display', 'block');
                        referenceTables.forEach((rt) => {
                            rt.style.display = 'none';
                        });
                    } else {
                        injectedEl.style.setProperty('display', 'none');
                        referenceTables.forEach((rt) => {
                            rt.style.display = 'block';
                        });
                    }
                }

                prepared.push(sheet);
            }
        }

        const pages = planRecordSheetPages(prepared, sheet => ({
            compact: sheet.compact,
            kind: sheet.kind,
            height: sheet.height,
            pageContentY: sheet.pageContentY,
        }), printOptions.paperSize).map(page => page.compact
            ? RecordSheetSvgGenerator.composeCompactPage(page.items.map(item => item.svg), printOptions.paperSize)
            : page.items[0].svg);
        const svgStrings: string[] = [];
        for (const page of pages) {
            await this.embedExternalImages(page);
            svgStrings.push(this.serializeSvg(page));
        }
        await this.generateMultipagePrintContainer(svgStrings, printOptions, triggerPrint);
    }

    private static async createPrintSheets(
        member: CBTForceMember,
        clean: boolean,
        paperSize: PrintAllOptions['paperSize'],
        recordSheetSource: RecordSheetSourceService,
    ): Promise<readonly PreparedPrintSheet[]> {
        const ready = member.force.getUnitSnapshot(member.id);
        if (!ready) throw new Error(`CBT unit ${member.id} is no longer admitted`);
        const entity = ready.entity;
        const profile = recordSheetLayoutProfile(entity, paperSize);
        const generatorOptions = {
            format: profile.compact ? 'compact' : paperSize,
            pageFormat: paperSize,
        } as const;
        const identity = member.force.getUnitSourceIdentity(member.id);
        const sheets = await recordSheetSource.load(entity, generatorOptions, {
            ...(identity ? { design: identity } : {}),
        });
        const compact = profile.compact;

        if (isCBTMekForceMember(member)) {
            const current = member.force.getMekRecordSheetSnapshot(member.id);
            if (!current) throw new Error(`CBT Mek ${member.id} is no longer admitted`);
            const snapshot = clean ? this.pristinePrintSnapshot(current) : current;
            return sheets.svgs.map(svg => {
                const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, snapshot);
                binding.render(snapshot);
                binding.destroy();
                return Object.freeze({
                    member,
                    svg,
                    compact,
                    kind: profile.kind,
                    height: profile.height,
                    pageContentY: profile.pageContentY,
                    pristineBattleValue: snapshot.battleValue.pristine
                        ?? snapshot.battleValue.current
                        ?? entity.battleValue(),
                });
            });
        }

        const current = member.force.getNonMekRecordSheetSnapshot(member.id);
        if (!current) throw new Error(`CBT Entity ${member.id} is no longer admitted`);
        const snapshot = clean ? this.pristineEntityPrintSnapshot(current) : current;
        return sheets.svgs.map(svg => {
            const binding = bindNonMekRecordSheet(svg, snapshot);
            binding.render(snapshot);
            binding.destroy();
            return Object.freeze({
                member,
                svg,
                compact,
                kind: profile.kind,
                height: profile.height,
                pageContentY: profile.pageContentY,
                pristineBattleValue: snapshot.pristineBattleValue,
            });
        });
    }

    private static pristinePrintSnapshot(
        snapshot: MekRecordSheetSnapshot,
    ): MekRecordSheetSnapshot {
        return Object.freeze({
            ...snapshot,
            destroyed: false,
            crippled: false,
            conditions: Object.freeze([]),
            locations: Object.freeze(snapshot.locations.map(location => Object.freeze({
                ...location,
                committedRemainingInternal: location.maximumInternal,
                previewRemainingInternal: location.maximumInternal,
                conditions: Object.freeze([]),
                armor: Object.freeze(location.armor.map(face => Object.freeze({
                    ...face,
                    committedRemaining: face.maximum,
                    previewRemaining: face.maximum,
                }))),
            }))),
            criticalSlots: Object.freeze(snapshot.criticalSlots.map(slot => Object.freeze({
                ...slot,
                committedHits: 0,
                previewHits: 0,
                components: Object.freeze(slot.components.map(component => Object.freeze({
                    ...component,
                    status: 'available' as const,
                    ...(component.ammo === undefined ? {} : {
                        ammo: Object.freeze({ ...component.ammo, remaining: component.ammo.capacity }),
                    }),
                }))),
            }))),
            crew: Object.freeze(snapshot.crew.map(position => Object.freeze({
                ...position,
                state: Object.freeze({ wounds: 0, unconscious: false, ejected: false }),
            }))),
        });
    }

    private static pristineEntityPrintSnapshot(
        snapshot: NonMekRecordSheetSnapshot,
    ): NonMekRecordSheetSnapshot {
        return Object.freeze({
            ...snapshot,
            destroyed: false,
            conditions: Object.freeze([]),
            currentBattleValue: snapshot.pristineBattleValue,
            heat: Object.freeze({
                ...snapshot.heat,
                current: 0,
                pending: null,
                heatsinksOff: 0,
            }),
            locations: Object.freeze(snapshot.locations.map(location => Object.freeze({
                ...location,
                remainingInternal: location.maximumInternal,
                previewRemainingInternal: location.maximumInternal,
                armor: Object.freeze(location.armor.map(face => Object.freeze({
                    ...face,
                    remaining: face.maximum,
                    previewRemaining: face.maximum,
                }))),
            }))),
            components: Object.freeze(snapshot.components.map(component => Object.freeze({
                ...component,
                status: 'available' as const,
                previewStatus: 'available' as const,
                ...(component.ammo === undefined ? {} : {
                    ammo: Object.freeze({ ...component.ammo, remaining: component.ammo.capacity }),
                }),
            }))),
            damageTracks: Object.freeze(snapshot.damageTracks.map(track => Object.freeze({
                ...track,
                committedHits: 0,
                previewHits: 0,
                committedHitTimestamps: Object.freeze([]),
                pendingHitTimestamps: Object.freeze([]),
            }))),
            crew: Object.freeze(snapshot.crew.map(position => Object.freeze({
                ...position,
                state: Object.freeze({ wounds: 0, unconscious: false, ejected: false }),
                effectiveState: 'healthy' as const,
            }))),
        });
    }

    private static serializeSvg(svg: SVGSVGElement): string {
        svg.querySelectorAll('[style]').forEach(element => {
            const style = element.getAttribute('style');
            if (!style || !/font-size\s*:\s*\d+(\.\d+)?(\s*;|;|$)/iu.test(style)) return;
            element.setAttribute('style', style.replace(
                /font-size\s*:\s*(\d+(\.\d+)?)(?!\s*[a-zA-Z%])(\s*;?)/giu,
                (_match, number, _fraction, tail) => `font-size: ${number}px${tail || ''}`,
            ));
        });
        const serializer = new XMLSerializer();
        return serializer.serializeToString(svg).replace(/^<svg([^>]*)>/u, (_match, attributes: string) => {
            let resolved = attributes;
            if (!/viewBox=/u.test(resolved)) resolved += ' viewBox="0 0 612 792"';
            if (!/xmlns=/u.test(resolved)) resolved += ' xmlns="http://www.w3.org/2000/svg"';
            if (!/xmlns:xlink=/u.test(resolved)) resolved += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
            if (!/preserveAspectRatio=/u.test(resolved)) resolved += ' preserveAspectRatio="xMidYMid meet"';
            return `<svg${resolved}>`;
        });
    }

    /**
     * Fetches external <image> hrefs and embeds them as data URLs.
     */
    private static async embedExternalImages(svg: SVGSVGElement): Promise<void> {
        const images = Array.from(svg.querySelectorAll('image')) as SVGImageElement[];
        const toDataURL = async (blob: Blob) =>
            new Promise<string>((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(String(fr.result));
                fr.onerror = reject;
                fr.readAsDataURL(blob);
            });

        await Promise.all(images.map(async (img) => {
            const href = this.getImageHref(img);
            if (!href || href.startsWith('data:')) return;

            // Resolve relative URLs against document
            let url: string;
            try {
                url = new URL(href, document.baseURI).toString();
            } catch {
                return; // ignore bad URLs
            }

            try {
                const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
                if (!resp.ok) return;
                const blob = await resp.blob();
                const dataUrl = await toDataURL(blob);
                this.setImageHref(img, dataUrl);
            } catch {
                // If CORS blocks fetch, ignore
            }
        }));
    }

    private static getImageHref(img: SVGImageElement): string | null {
        return img.getAttribute('href') ??
            img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    }

    private static setImageHref(img: SVGImageElement, value: string): void {
        img.setAttribute('href', value);
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', value);
    }

    private static applyPilotDataPrintOption(
        svg: SVGSVGElement,
        printPilotData: boolean,
        baseBv?: number
    ): void {
        svg.querySelectorAll('.skillValue').forEach((skillValue) => {
            skillValue.classList.toggle('screen-only', !printPilotData);
        });

        const skillBlanks = [
            'blankPilotingSkill0',
            'blankGunnerySkill0',
            'blankAsfGunnerySkill0',
            'blankAsfPilotingSkill0',
            'blankPilotingSkill1',
            'blankGunnerySkill1',
            'blankPilotingSkill2',
            'blankGunnerySkill2',
            'blankPilotingSkill3',
            'blankGunnerySkill3'
        ];
        skillBlanks.forEach((id) => {
            svg.getElementById(id)?.classList.toggle('print-show', !printPilotData);
        });

        if (printPilotData) return;

        const bvElement = svg.getElementById('bv');
        if (bvElement && baseBv !== undefined) {
            bvElement.textContent = baseBv.toString();
        }

        svg.querySelectorAll<SVGElement>('[id^="crewNameButton"]').forEach((crewNameButton) => {
            const nameId = crewNameButton.getAttribute('textElement');
            const blankId = crewNameButton.getAttribute('blankElement');
            if (nameId) {
                const nameElement = svg.getElementById(nameId) as SVGElement | null;
                nameElement?.style.setProperty('visibility', 'hidden');
            }
            if (blankId) {
                const blankElement = svg.getElementById(blankId) as SVGElement | null;
                blankElement?.style.setProperty('visibility', 'visible');
            }
        });
    }

    /**
     * Generates a multipage print container and waits for images to load before printing.
     */
    private static async generateMultipagePrintContainer(svgStrings: string[],
        printOptions: PrintAllOptions,
        triggerPrint: boolean = true): Promise<void> {
        const pages = svgStrings.map(svg => `<div class="svg-container">${svg}</div>`);
        if (pages.length > 0) {
            pages[pages.length - 1] = pages[pages.length - 1].replace('svg-container', 'svg-container last-svg');
        }

        const bodyContent = pages.join('');
        const overlay = document.createElement('div');
        overlay.id = 'multipage-container';
        overlay.innerHTML = bodyContent;

        const style = document.createElement('style');
        style.textContent = this.getPrintStyles(printOptions.printMargin, printOptions.paperSize);
        overlay.appendChild(style);
        document.body.appendChild(overlay);
        document.body.classList.add('multipage-container-active');

        // Wait for fonts and all <image> elements in the SVGs
        if (document.fonts?.ready) {
            try { await document.fonts.ready; } catch { }
        }
        await this.waitForSvgImagesToLoad(overlay);
        await this.nextAnimationFrames(2);

        // Trigger print
        if (triggerPrint) {
            window.print();
        }

        // Remove overlay on first user interaction
        const removeOverlay = (evt: Event) => {
            overlay.remove();
            document.body.classList.remove('multipage-container-active');

            window.removeEventListener('click', removeOverlay, { capture: true });
            window.removeEventListener('keydown', removeOverlay, { capture: true });
            window.removeEventListener('pointerdown', removeOverlay, { capture: true });
        };
        window.addEventListener('click', removeOverlay, { capture: true, once: true });
        window.addEventListener('keydown', removeOverlay, { capture: true, once: true });
        window.addEventListener('pointerdown', removeOverlay, { capture: true, once: true });
    }

    private static async waitForSvgImagesToLoad(root: ParentNode): Promise<void> {
        const svgImages = Array.from(root.querySelectorAll('image')) as SVGImageElement[];
        const htmlImages = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];

        await Promise.all([
            ...svgImages.map(img => new Promise<void>((resolve) => {
                const href = this.getImageHref(img);
                if (!href || href.startsWith('data:')) return resolve();

                let settled = false;
                const done = (loaded: boolean) => {
                    if (settled) return;
                    settled = true;
                    if (!loaded) {
                        this.fallbackFluffImageToReferenceTables(img);
                    }
                    resolve();
                };

                img.addEventListener('load', () => done(true), { once: true });
                img.addEventListener('error', () => done(false), { once: true });
                setTimeout(() => done(false), 4000);
            })),
            ...htmlImages.map(img => new Promise<void>((resolve) => {
                if (img.complete) {
                    if (img.naturalWidth === 0) {
                        this.fallbackFluffImageToReferenceTables(img);
                    }
                    resolve();
                    return;
                }

                let settled = false;
                const done = (loaded: boolean) => {
                    if (settled) return;
                    settled = true;
                    if (!loaded) {
                        this.fallbackFluffImageToReferenceTables(img);
                    }
                    resolve();
                };
                img.addEventListener('load', () => done(true), { once: true });
                img.addEventListener('error', () => done(false), { once: true });
                setTimeout(() => done(img.complete && img.naturalWidth > 0), 4000);
            }))
        ]);
    }

    private static fallbackFluffImageToReferenceTables(image: Element): void {
        if (image.id !== 'fluff-image-injected') {
            return;
        }

        const svg = image.closest('svg') as SVGSVGElement | null;
        if (!svg) {
            return;
        }

        const injectedEl = svg.getElementById('fluff-image-fo') as SVGElement | null;
        (injectedEl ?? image as SVGElement).style.setProperty('display', 'none');
        svg.querySelectorAll<SVGGraphicsElement>('.referenceTable').forEach((referenceTable) => {
            referenceTable.style.display = 'block';
        });
    }

    private static async nextAnimationFrames(n: number = 1): Promise<void> {
        for (let i = 0; i < n; i++) {
            await new Promise<void>(r => requestAnimationFrame(() => r()));
        }
    }

    private static createRosterSummaryPage(members: readonly CBTForceMember[], printPilotData: boolean): string {
        const force = members[0]?.force;
        if (!force) {
            return `
                <div class="svg-container cbt-roster-summary">
                    <div class="cbt-roster-rotated-frame">
                        <div class="cbt-roster-sheet">
                            <div class="cbt-roster-summary-content">CBT ROSTER</div>
                        </div>
                    </div>
                </div>
            `;
        }

        const roster = force.queryCanonicalRoster();
        if (roster.kind !== 'available') throw new Error(roster.message);
        const memberById = new Map(members.map(member => [String(member.id), member] as const));
        const groups = roster.snapshot.groups.map(group => Object.freeze({
            group,
            members: Object.freeze(group.members.flatMap(row => {
                const member = memberById.get(String(row.instanceId));
                return member ? [member] : [];
            })),
        })).filter(group => group.members.length > 0);

        const headerParts: string[] = [];
        const faction = force.faction();
        if (faction) {
            let factionLabel = faction.name;
            const factionAffinity = getFactionAffinity(faction);
            if (factionAffinity !== 'Other' && factionAffinity !== faction.name) {
                factionLabel += ` · ${factionAffinity}`;
            }
            headerParts.push(factionLabel);
        }
        const era = force.era();
        if (era) {
            headerParts.push(era.name);
        }

        let totalBaseBv = 0;
        let totalFinalBv = 0;
        const groupSections: string[] = [];

        for (const { group, members: groupMembers } of groups) {

            const bodyRows: string[] = [];

            for (const member of groupMembers) {
                const baseBv = member.pristineBattleValue() ?? member.entity.battleValue();
                const finalBv = this.getPrintableBv(member, printPilotData);

                totalBaseBv += baseBv;
                totalFinalBv += finalBv;

                bodyRows.push(this.createRosterTableRow(member, printPilotData));
            }

            groupSections.push(`
                <section class="cbt-roster-group-section">
                    <div class="cbt-roster-group-header">
                        <span class="cbt-roster-group-name">${this.escapeHtml(group.name?.trim() || group.groupId)}</span>
                        <span class="cbt-roster-group-bv">BV: ${groupMembers
                            .reduce((total, member) => total + this.getPrintableBv(member, printPilotData), 0)
                            .toLocaleString()}</span>
                    </div>
                    <table class="cbt-roster-table">
                        <thead>
                            <tr>
                                <th class="col-unit">Unit</th>
                                <th class="col-type">Type</th>
                                <th class="col-role">Role</th>
                                <th class="col-base-bv">Base BV</th>
                                <th class="col-gp">G/P</th>
                                <th class="col-bv">BV</th>
                                <th class="col-tons">Tons</th>
                                <th class="col-year">Year</th>
                                <th class="col-rules">Tech<br/>Rules</th>
                                <th class="col-move">Move</th>
                                <th class="col-as">A/S</th>
                                <th class="col-firepower">Firepower<br/>(Dmg/Turn)</th>
                                <th class="col-equipment">Equipment</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${bodyRows.join('')}
                        </tbody>
                    </table>
                </section>
            `);
        }

        return `
            <div class="svg-container cbt-roster-summary">
                <div class="cbt-roster-rotated-frame">
                    <div class="cbt-roster-sheet">
                        <div class="cbt-roster-header">
                            ${headerParts.length > 0 ? `<span class="cbt-roster-faction">${this.escapeHtml(headerParts.join(' · '))}</span>` : ''}
                            <span class="cbt-roster-force-name">${this.escapeHtml(force.name || force.displayName())}</span>
                        </div>
                        <div class="cbt-roster-groups">
                            ${groupSections.join('')}
                        </div>
                        <div class="cbt-roster-footer">Base BV: ${totalBaseBv.toLocaleString()} · Total BV: ${totalFinalBv.toLocaleString()}</div>
                    </div>
                </div>
            </div>
        `;
    }

    private static createRosterTableRow(member: CBTForceMember, printPilotData: boolean): string {
        const unit = member.entity;
        const primaryCrew = member.force.getUnitCrewAssignment(member.id)?.positions[0];
        const alias = printPilotData ? primaryCrew?.name : undefined;
        const model = unit.model();
        const chassis = unit.fullChassis();
        const chassisLine = alias ? `${chassis} (${alias})` : chassis;

        const unitType = unit.unitType();
        const unitSubtype = unit.unitSubtype();
        const typeSubtype = [unitType, unitSubtype !== unitType ? unitSubtype : '']
            .filter(Boolean)
            .join(' / ');
        const equipment = this.formatEquipmentSummary(unit);
        const maximumDamage = unit.rangedWeapons().reduce((total, mount) =>
            total + unit.resolveMountedWeaponDamage(mount).maximum, 0);

        return `
            <tr>
                <td class="col-unit">
                    ${model ? `<div class="cbt-roster-unit-model">${this.escapeHtml(model)}</div>` : ''}
                    <div class="cbt-roster-unit-chassis">${this.escapeHtml(chassisLine)}</div>
                </td>
                <td class="col-type">${this.escapeHtml(typeSubtype)}</td>
                <td class="col-role">${this.escapeHtml(unit.role() && unit.role() !== 'None' ? unit.role() : '')}</td>
                <td class="col-base-bv is-numeric">${this.formatNumber(member.pristineBattleValue() ?? unit.battleValue())}</td>
                <td class="col-gp is-numeric">${printPilotData && primaryCrew ? `${primaryCrew.gunnery}/${primaryCrew.piloting}` : ''}</td>
                <td class="col-bv is-numeric is-bold">${this.formatNumber(this.getPrintableBv(member, printPilotData))}</td>
                <td class="col-tons is-numeric">${this.formatNumber(unit.tonnage())}</td>
                <td class="col-year">${this.createYearValue(unit)}</td>
                <td class="col-rules">${this.escapeHtml(this.formatTechBase(unit.techBase(), unit.mixedTech()))}<br/>${this.escapeHtml(unit.staticTechLevel())}</td>
                <td class="col-move">${this.escapeHtml(this.formatMovement(unit))}</td>
                <td class="col-as is-numeric">${this.escapeHtml(this.formatArmorStructure(unit))}</td>
                <td class="col-firepower is-numeric">${this.escapeHtml(this.formatNumber(maximumDamage) || '—')}</td>
                <td class="col-equipment">${equipment}</td>
            </tr>
        `;
    }

    private static createYearValue(unit: BaseEntity): string {
        return unit.year() ? this.escapeHtml(String(unit.year())) : '—';
    }

    private static formatNumber(value: number | undefined | null): string {
        if (value === undefined || value === null || Number.isNaN(value)) {
            return '';
        }
        return value.toLocaleString();
    }

    private static getPrintableBv(member: CBTForceMember, printPilotData: boolean): number {
        if (printPilotData) return member.adjustedBattleValue() ?? member.entity.battleValue();
        return member.currentBaseBattleValue() ?? member.pristineBattleValue() ?? member.entity.battleValue();
    }

    private static formatMovement(unit: BaseEntity): string {
        const parts: string[] = [];
        const walk = unit.walkMP();
        if (walk) {
            parts.push(`${walk}/${unit.runMP()}`);
        }
        if (unit.jumpMP()) {
            parts.push(String(unit.jumpMP()));
        }
        if (unit.umuMP()) {
            parts.push(String(unit.umuMP()));
        }
        return parts.join('/');
    }

    private static formatTechBase(techBase: EntityTechBase, mixed: boolean): string {
        return mixed ? `Mixed (${techBase})` : techBase;
    }

    private static formatArmorStructure(unit: BaseEntity): string {
        return `${this.formatNumber(unit.totalArmorPoints()) || '0'}/${this.formatNumber(unit.totalInternalPoints()) || '0'}`;
    }

    private static formatEquipmentSummary(unit: BaseEntity): string {
        const equipmentCounts = new Map<string, number>();
        const ammoCounts = new Map<string, Readonly<{ bins: number; shots: number; protected: boolean }>>();
        for (const mount of unit.equipment()) {
            const equipment = mount.equipment;
            if (equipment instanceof AmmoEquipment) {
                const name = equipment.shortName || equipment.name || mount.equipmentId;
                const previous = ammoCounts.get(name) ?? { bins: 0, shots: 0, protected: false };
                ammoCounts.set(name, {
                    bins: previous.bins + 1,
                    shots: previous.shots + (mount.shotsCount ?? equipment.shots),
                    protected: previous.protected || unit.locationHasCaseProtection(mount.location),
                });
                continue;
            }
            if (isHeatSinkEquipment(equipment)
                || isCaseEquipment(equipment)
                || isJumpJetEquipment(equipment)) continue;
            const name = mount.displayName();
            equipmentCounts.set(name, (equipmentCounts.get(name) ?? 0) + 1);
        }
        const equipment = [...equipmentCounts]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, quantity]) => `${quantity}×${name}`);
        const ammo = [...ammoCounts]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, entry]) => {
                const text = `${entry.bins}×${name} (${entry.shots})`;
                return entry.protected ? `[${text}]` : text;
            });

        const equipmentMarkup = equipment.length > 0
            ? equipment
                .map(entry => `<span class="cbt-roster-equipment-entry">${this.escapeHtml(entry)}</span>`)
                .join('<span class="cbt-roster-equipment-sep">, </span>')
            : '';

        const ammoMarkup = ammo.length > 0
            ? `
                <div class="cbt-roster-equipment-ammo-line">
                    <span class="cbt-roster-equipment-ammo-label">Ammo:</span>
                    <span class="cbt-roster-equipment-ammo-values">${ammo
                        .map(entry => `<span class="cbt-roster-equipment-entry">${this.escapeHtml(entry)}</span>`)
                        .join('<span class="cbt-roster-equipment-sep">, </span>')}</span>
                </div>
            `
            : '';

        return `${equipmentMarkup}${ammoMarkup}`;
    }

    private static escapeHtml(value: string): string {
        return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    private static getPrintStyles(
        printMargin: PrintAllOptions['printMargin'],
        paperSize: PrintAllOptions['paperSize'],
    ): string {
        return `
            #multipage-container .cbt-roster-summary {
                position: relative;
                background: white !important;
                overflow: hidden;
            }

            #multipage-container .cbt-roster-rotated-frame {
                position: absolute;
                top: 0;
                left: 100%;
                width: 100vh;
                height: 100vw;
                transform: rotate(90deg);
                transform-origin: top left;
            }

            #multipage-container .cbt-roster-sheet {
                width: 100%;
                height: 100%;
                background: white;
                padding: 0.08in 0.12in 0.1in;
                font-family: sans-serif;
                color: #222;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
            }

            #multipage-container .cbt-roster-header {
                display: flex;
                align-items: baseline;
                gap: 0.1in;
                padding: 0 0.04in 0.08in;
                border-bottom: 2px solid #333;
                margin-bottom: 0.1in;
            }

            #multipage-container .cbt-roster-faction {
                font-size: 10pt;
                color: #555;
            }

            #multipage-container .cbt-roster-faction::after {
                content: ':';
                margin-left: 2px;
            }

            #multipage-container .cbt-roster-force-name {
                font-size: 12pt;
                font-weight: 700;
            }

            #multipage-container .cbt-roster-groups {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 0.06in;
                overflow: hidden;
            }

            #multipage-container .cbt-roster-group-section {
                break-inside: avoid;
                page-break-inside: avoid;
            }

            #multipage-container .cbt-roster-group-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.03in 0.01in 0.02in;
                border-top: 1px solid #cfcfcf;
                border-bottom: 1px solid #cfcfcf;
            }

            #multipage-container .cbt-roster-group-name,
            #multipage-container .cbt-roster-group-bv {
                font-weight: 700;
                font-size: 10pt;
            }

            #multipage-container .cbt-roster-table {
                width: 100%;
                border-collapse: collapse;
                table-layout: auto;
                font-size: 9pt;
            }

            #multipage-container .cbt-roster-table th,
            #multipage-container .cbt-roster-table td {
                padding: 3px 4px;
                border-bottom: 1px solid #d7d7d7;
                vertical-align: middle;
                text-align: center;
                box-sizing: border-box;
                background: white;
            }

            #multipage-container .cbt-roster-table th {
                border-bottom: 2px solid #666;
                font-weight: 700;
                white-space: nowrap;
                line-height: 1.1;
            }

            #multipage-container .cbt-roster-era-icon {
                width: 12px;
                height: 12px;
                object-fit: contain;
                vertical-align: -1px;
                filter: invert(1);
            }

            #multipage-container .cbt-roster-table .is-numeric {
                text-align: center;
                white-space: nowrap;
            }

            #multipage-container .cbt-roster-table .is-bold {
                font-weight: 700;
            }

            #multipage-container .cbt-roster-table .col-unit {
                min-width: 80px;
            }

            #multipage-container .cbt-roster-table .col-unit,
            #multipage-container .cbt-roster-table .col-role,
            #multipage-container .cbt-roster-table .col-equipment {
                white-space: normal;
            }

            #multipage-container .cbt-roster-table .col-unit,
            #multipage-container .cbt-roster-table .col-equipment {
                text-align: left;
            }

            #multipage-container .cbt-roster-table .col-equipment {
                line-height: 1.22;
            }

            #multipage-container .cbt-roster-equipment-ammo-line {
                margin-top: 2px;
            }

            #multipage-container .cbt-roster-equipment-ammo-label {
                font-weight: 700;
                margin-right: 3px;
            }

            #multipage-container .cbt-roster-equipment-entry {
                white-space: nowrap;
                display: inline;
            }

            #multipage-container .cbt-roster-equipment-sep {
                white-space: normal;
            }

            #multipage-container .cbt-roster-unit-model {
                font-size: 0.92em;
                color: #555;
                line-height: 1.15;
            }

            #multipage-container .cbt-roster-unit-chassis {
                font-weight: 700;
                line-height: 1.15;
            }

            #multipage-container .cbt-roster-table .col-year {
                white-space: nowrap;
            }

            #multipage-container .cbt-roster-footer {
                text-align: right;
                font-weight: 700;
                font-size: 11pt;
                margin-top: 0.08in;
                padding: 0.05in 0.04in 0;
                border-top: 2px solid #333;
            }

            #multipage-container .cbt-roster-summary-content {
                color: #111;
                font-size: 36pt;
                font-weight: 700;
                letter-spacing: 0.08em;
                text-align: center;
            }

            @media print {
                body, html {
                    margin: 0 !important;
                    padding: 0 !important;
                    height: 100% !important;
                    width: 100% !important;
                }

                body.multipage-container-active > *:not(#multipage-container) {
                    display: none !important;
                }

                #multipage-container {
                    width: 100% !important;
                    height: 100% !important;
                    padding: 0;
                    margin: 0;
                    left: 0;
                    top: 0;
                    display: block;
                    background: transparent !important;
                }
                #multipage-container .svg-container {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    background: white !important;
                    width: 100% !important;
                    height: 100% !important;
                    margin: 0 auto !important;
                    box-sizing: border-box;
                    page-break-after: always;
                    break-after: page;
                    overflow: hidden;
                }
                #multipage-container .svg-container.last-svg { 
                    page-break-after: auto !important;
                    break-after: auto !important;
                }

                #multipage-container .cbt-roster-summary {
                    width: 100% !important;
                    height: 100% !important;
                    min-height: 0 !important;
                }

                #multipage-container .svg-container > svg {
                    display: block;
                    box-sizing: border-box;
                    padding: 0;
                    margin: 0in 0.16in;
                    transform: none !important;
                    height: 100%;
                    width: auto;
                    max-width: 100%;
                    min-width: 0;
                    max-height: 100%;
                    page-break-inside: avoid;
                    break-inside: avoid;
                }

                @page {
                    size: ${paperSize === 'a4' ? 'A4' : 'Letter'} portrait;
                    margin: ${printMargin === 'none' ? '0in' : '0.25in'} !important;
                }
            }
        `;
    }

}
