// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PrintAllOptions } from '../models/print-options.model';
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
import { printRecordSheetPages } from './record-sheet-print.util';
import { nextAnimationFrames } from './print-overlay.util';

interface PreparedPrintSheet {
    readonly member: CBTForceMember;
    readonly svg: SVGSVGElement;
    readonly compact: boolean;
    readonly kind: RecordSheetLayoutProfile['kind'];
    readonly height: number;
    readonly stride: number | undefined;
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

                await nextAnimationFrames(2);

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
            stride: sheet.stride,
            pageContentY: sheet.pageContentY,
        }), printOptions.paperSize).map(page => page.compact
            ? RecordSheetSvgGenerator.composeCompactPage(page.items.map(item => item.svg), printOptions.paperSize)
            : page.items[0].svg);
        for (const page of pages) await this.embedExternalImages(page);
        await printRecordSheetPages(pages, printOptions, triggerPrint);
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
        const sheets = await recordSheetSource.load(entity, generatorOptions);
        const compact = profile.compact;

        if (isCBTMekForceMember(member)) {
            const current = member.force.getMekRecordSheetSnapshot(member.id);
            if (!current) throw new Error(`CBT Mek ${member.id} is no longer admitted`);
            const snapshot = clean ? this.pristinePrintSnapshot(current) : current;
            return sheets.svgs.map(svg => {
                const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, snapshot);
                binding.render(snapshot);
                binding.destroy();
                recordSheetSource.applyUnitName(svg, entity);
                return Object.freeze({
                    member,
                    svg,
                    compact,
                    kind: profile.kind,
                    height: profile.height,
                    stride: profile.stride,
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
            recordSheetSource.applyUnitName(svg, entity);
            return Object.freeze({
                member,
                svg,
                compact,
                kind: profile.kind,
                height: profile.height,
                stride: profile.stride,
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
}
