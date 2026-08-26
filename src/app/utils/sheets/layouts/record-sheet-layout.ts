// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type {
    CompactRecordSheetKind,
    RecordSheetLayoutProfile,
    RecordSheetPageFormat,
    RecordSheetPageProfile,
} from '../record-sheet-layout';
import { recordSheetPageProfile } from '../record-sheet-layout';
import {
    type Box,
    appendSheetContent,
    compactPageTitle,
    createRoot,
    drawGeneratedFooter,
    drawPageChrome,
    formatNumber,
    readViewBox,
    renumberCompactBlock,
} from '../record-sheet-svg-rendering';

export type RecordSheetSvgFormat = RecordSheetPageFormat | 'compact' | 'auto';

export interface RecordSheetLayoutRequest {
    readonly format: RecordSheetSvgFormat;
    readonly page: RecordSheetPageProfile;
    readonly profile: RecordSheetLayoutProfile;
}

/** Owns page composition for one record-sheet family. */
export interface RecordSheetLayout {
    readonly id: string;
    matches(entity: BaseEntity): boolean;
    profile(
        entity: BaseEntity,
        pageFormat?: RecordSheetPageFormat,
    ): RecordSheetLayoutProfile;
    generate(
        entity: BaseEntity,
        request: RecordSheetLayoutRequest,
    ): Promise<SVGSVGElement>;
}

/** Shared compact/full-page behavior for the small-unit sheet families. */
export abstract class CompactRecordSheetLayout implements RecordSheetLayout {
    public constructor(
        public readonly id: string,
        public readonly compactKind: CompactRecordSheetKind,
        private readonly pageTitle: string,
        private readonly geometryFor: (
            page: RecordSheetPageProfile,
        ) => Readonly<{ height: number; stride: number }>,
        private readonly numberedTitlePrefix?: string,
    ) {}

    public abstract matches(entity: BaseEntity): boolean;

    protected abstract drawCompact(svg: SVGSVGElement, entity: BaseEntity): Promise<void> | void;

    public profile(
        entity: BaseEntity,
        pageFormat: RecordSheetPageFormat = 'letter',
    ): RecordSheetLayoutProfile {
        if (!this.matches(entity)) {
            throw new Error(`${this.id} layout received an unsupported entity`);
        }
        const page = recordSheetPageProfile(pageFormat);
        const geometry = this.geometryFor(page);
        return Object.freeze({
            kind: this.compactKind,
            compact: true,
            width: page.contentWidth,
            height: geometry.height,
            stride: geometry.stride,
            pageContentY: this.printablePageContentY(page),
        });
    }

    /** Family-owned content that surrounds compact unit blocks on a printable page. */
    public drawCompactPageSupplement(
        page: SVGSVGElement,
        profile: RecordSheetPageProfile,
        _blocks: readonly SVGSVGElement[],
        _entity?: BaseEntity,
    ): void {
        drawGeneratedFooter(page, profile);
    }

    /** Family-owned printable-page chrome. Vehicle families override this because
     * their compact template already includes its own full-width masthead. */
    protected drawPrintablePageChrome(
        page: SVGSVGElement,
        profile: RecordSheetPageProfile,
        _blocks: readonly SVGSVGElement[],
        entity?: BaseEntity,
    ): void {
        drawPageChrome(page, this.pageTitle, profile, true, entity, {
            titleLines: this.compactMastheadTitleLines(),
            drawIcon: (parent, box, svg) => this.drawCompactMastheadIcon(parent, box, svg),
        });
    }

    /** Family classes own their masthead wording and optional identifying art. */
    protected compactMastheadTitleLines(): readonly string[] {
        return [this.pageTitle];
    }

    protected drawCompactMastheadIcon(
        _parent: SVGGElement,
        _box: Box,
        _svg: SVGSVGElement,
    ): void {
        // Most compact families intentionally have no masthead icon.
    }

    protected printablePageContentY(profile: RecordSheetPageProfile): number {
        return profile.compactContentY;
    }

    public async generate(
        entity: BaseEntity,
        request: RecordSheetLayoutRequest,
    ): Promise<SVGSVGElement> {
        const compact = createRoot(request.profile.width, request.profile.height, this.compactKind);
        compact.setAttribute('data-mekbay-compact', this.compactKind);
        compact.setAttribute('data-mekbay-page-title', this.pageTitle);
        if (this.numberedTitlePrefix !== undefined) {
            compact.setAttribute('data-mekbay-numbered-title-prefix', this.numberedTitlePrefix);
        }
        if (request.profile.stride !== undefined) {
            compact.setAttribute('data-mekbay-compact-stride', formatNumber(request.profile.stride));
        }
        await this.drawCompact(compact, entity);
        return request.format === 'compact' || request.format === 'auto'
            ? compact
            : this.composePage([compact], request.page, entity);
    }

    /** Composes a homogeneous run of this family's compact unit blocks. */
    public composePage(
        blocks: readonly SVGSVGElement[],
        profile: RecordSheetPageProfile,
        entity?: BaseEntity,
    ): SVGSVGElement {
        const kind = entity === undefined
            ? `${this.id}-${profile.format}`
            : `${entity.entityType.toLowerCase()}-${profile.format}`;
        const page = createRoot(profile.width, profile.height, kind);
        page.setAttribute('data-mekbay-page-format', profile.format);
        this.drawPrintablePageChrome(page, profile, blocks, entity);
        appendCompactBlocks(page, blocks, profile, this.printablePageContentY(profile), false);
        this.drawCompactPageSupplement(page, profile, blocks, entity);
        page.setAttribute('data-mekbay-unit-count', String(blocks.length));
        return page;
    }
}

/** Safe fallback for explicitly mixed compact blocks. Normal force planning keeps
 * families homogeneous, so no family-specific supplement is applied here. */
export function composeMixedCompactRecordSheetPage(
    blocks: readonly SVGSVGElement[],
    profile: RecordSheetPageProfile,
): SVGSVGElement {
    const page = createRoot(profile.width, profile.height, 'compact-page');
    page.setAttribute('data-mekbay-page-format', profile.format);
    drawPageChrome(page, compactPageTitle(blocks), profile, true, undefined, {
        titleLines: ['CLASSIC BATTLETECH', 'RECORD SHEET'],
    });
    const finalBottom = appendCompactBlocks(page, blocks, profile, profile.compactContentY, true);
    if (finalBottom <= profile.height - profile.margin - 14) drawGeneratedFooter(page, profile);
    page.setAttribute('data-mekbay-unit-count', String(blocks.length));
    return page;
}

function appendCompactBlocks(
    page: SVGSVGElement,
    blocks: readonly SVGSVGElement[],
    profile: RecordSheetPageProfile,
    startY: number,
    omitVehicleChrome: boolean,
): number {
    let y = startY;
    let previousY = y;
    let previousHeight = 0;
    let previousStride = 0;
    let previousKind: CompactRecordSheetKind | null = null;
    blocks.forEach((block, index) => {
        const viewBox = readViewBox(block);
        const scale = viewBox.width > 0 ? profile.contentWidth / viewBox.width : 1;
        const height = viewBox.height * scale;
        const kind = block.getAttribute('data-mekbay-compact') as CompactRecordSheetKind | null;
        if (index > 0) {
            y = kind !== null && kind === previousKind
                ? previousY + previousStride
                : previousY + previousHeight + profile.compactGap;
        }
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'compact-sheet-block');
        group.setAttribute('data-sheet-index', String(index));
        group.setAttribute(
            'transform',
            `translate(${formatNumber(profile.margin)} ${formatNumber(y)}) scale(${formatNumber(scale)}) translate(${-viewBox.x} ${-viewBox.y})`,
        );
        appendSheetContent(group, block, {
            omitVehicleChrome,
            definitionsTarget: page,
        });
        if (blocks.length > 1) namespaceCompactBlockIds(group, index + 1);
        renumberCompactBlock(
            group,
            block.getAttribute('data-mekbay-numbered-title-prefix'),
            index + 1,
        );
        page.appendChild(group);
        previousY = y;
        previousHeight = height;
        const declaredStride = Number(block.getAttribute('data-mekbay-compact-stride'));
        previousStride = Number.isFinite(declaredStride) && declaredStride > 0
            ? declaredStride
            : height + profile.compactGap;
        previousKind = kind;
    });
    return previousY + previousHeight;
}

/** A composed page is one SVG document, so every copied block must have its own
 * ID namespace. Shared definitions are merged outside the block and therefore
 * deliberately keep their stable IDs. */
function namespaceCompactBlockIds(group: SVGGElement, unitNumber: number): void {
    const replacements = new Map<string, string>();
    group.querySelectorAll<SVGElement>('[id]').forEach(element => {
        const original = element.id.trim();
        if (original.length === 0) return;
        const namespaced = `unit${unitNumber}-${original}`;
        replacements.set(original, namespaced);
        element.id = namespaced;
    });
    if (replacements.size === 0) return;

    group.querySelectorAll<SVGElement>('*').forEach(element => {
        rewriteFragmentReference(element, 'href', replacements);
        rewriteFragmentReference(element, 'xlink:href', replacements);
        for (const attribute of ['clip-path', 'filter', 'fill', 'mask', 'marker-start', 'marker-mid', 'marker-end']) {
            const value = element.getAttribute(attribute);
            if (value === null || !value.includes('url(#')) continue;
            element.setAttribute(attribute, value.replace(/url\(#([^\s)]+)\)/gu, (match, id: string) => {
                const replacement = replacements.get(id);
                return replacement === undefined ? match : `url(#${replacement})`;
            }));
        }
        for (const attribute of ['aria-labelledby', 'aria-describedby']) {
            const value = element.getAttribute(attribute);
            if (value === null) continue;
            element.setAttribute(attribute, value.split(/\s+/u)
                .map(id => replacements.get(id) ?? id)
                .join(' '));
        }
        const textElement = element.getAttribute('textElement');
        if (textElement !== null && replacements.has(textElement)) {
            element.setAttribute('textElement', replacements.get(textElement)!);
        }
    });
}

function rewriteFragmentReference(
    element: SVGElement,
    attribute: string,
    replacements: ReadonlyMap<string, string>,
): void {
    const value = element.getAttribute(attribute);
    if (value === null || !value.startsWith('#')) return;
    const replacement = replacements.get(value.slice(1));
    if (replacement !== undefined) element.setAttribute(attribute, `#${replacement}`);
}
