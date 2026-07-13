import { CanonPipRenderer } from './canon-pip-renderer';
import { DistributedPipRenderer } from './distributed-pip-renderer';
import { GenericPipRenderer } from './generic-pip-renderer';
import { PipRendererShared } from './pip-renderer.shared';
import { PipRowGenerator } from './pip-row-generator';
import { RailPipRenderer } from './rail-pip-renderer';
import type { PipRenderOptions, PipRow } from './pip-renderer.types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ARMOR_ASSET_URL = '/images/paperdolls/biped-armor.svg';
const ARMOR_REAR_ASSET_URL = '/images/paperdolls/biped-armor-back.svg';
const STRUCTURE_ASSET_URL = '/images/paperdolls/biped-structure.svg';
const ARMOR_LOCATIONS = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL', 'CT_R', 'LT_R', 'RT_R'] as const;
const STRUCTURE_LOCATIONS = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'] as const;
const SHIELD_LOCATIONS = ['LA', 'RA'] as const;
type PaperdollPlaceholderType = 'armor' | 'structure' | 'shield-dc' | 'shield-da';

export type BipedArmorLocation = typeof ARMOR_LOCATIONS[number];
export type BipedStructureLocation = typeof STRUCTURE_LOCATIONS[number];
export type BipedShieldLocation = typeof SHIELD_LOCATIONS[number];
export type BipedArmorValues = Readonly<Partial<Record<BipedArmorLocation, number>>>;
export type BipedStructureTonnage = number | Readonly<Record<BipedStructureLocation, number>>;
export type BipedPaperdollPipLayout = 'canon' | 'distributed' | 'rail' | 'generic';

export interface BipedShieldLocationValues {
    readonly dc?: number;
    readonly da?: number;
}

export type BipedShieldValues = Readonly<Partial<Record<BipedShieldLocation, BipedShieldLocationValues>>>;

export interface BipedPaperdollLayerOptions {
    assetUrl?: string;
    className?: string;
    centeredHorizontally?: boolean;
    centeredVertically?: boolean;
    outline?: boolean;
    scale?: boolean;
    pipLayout?: BipedPaperdollPipLayout;
    fallbackPipLayout?: BipedPaperdollPipLayout;
    pipOptions?: PipRenderOptions;
    generateFillRows?: boolean;
    showFillPlaceholders?: boolean;
    railPipsPerPath?: number;
    shieldValues?: BipedShieldValues;
    silhouetteFill?: string;
    silhouetteStroke?: string;
    silhouetteStrokeWidth?: string;
}

interface ViewBox {
    minX: number;
    minY: number;
    width: number;
    height: number;
}

interface PlaceholderBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface PlaceholderGroup {
    parent: SVGElement;
    type: PaperdollPlaceholderType;
    location: string;
    bounds: PlaceholderBounds;
    canon: boolean;
    fill: boolean;
    elements: SVGElement[];
}

interface PlaceholderCollection {
    placeholders: SVGElement[];
    bounds: PlaceholderGroup[];
    shields: ShieldPlaceholderGroup[];
    rails: RailGroup[];
    fills: FillPlaceholderGroup[];
}

interface ShieldPlaceholderGroup {
    parent: SVGElement;
    type: 'shield-dc' | 'shield-da';
    location: string;
    rows: PipRow[];
    elements: SVGElement[];
}

interface PlaceholderContext {
    type: PaperdollPlaceholderType;
    location: string;
    rail: boolean;
    fill: boolean;
    canon: boolean;
    capacity?: number;
    index?: number;
}

interface RailDefinition {
    geometry: SVGGeometryElement;
    parent: SVGElement;
    transform: string | null;
    capacity?: number;
    index?: number;
    order: number;
}

interface RailGroup {
    type: PaperdollPlaceholderType;
    location: string;
    rails: RailDefinition[];
    elements: SVGElement[];
}

interface FillPlaceholderGroup {
    type: PaperdollPlaceholderType;
    location: string;
    areas: Array<{
        geometry: SVGGeometryElement;
        parent: SVGElement;
        transform: string | null;
    }>;
    parent: SVGElement;
    elements: SVGElement[];
}

interface PlaceholderRenderContext {
    armor: BipedArmorValues | undefined;
    structureTonnage: BipedStructureTonnage | undefined;
    options: BipedPaperdollLayerOptions;
}

export class BipedPaperdollUtil {
    private static readonly assetCache = new Map<string, Promise<SVGSVGElement>>();

    public static createArmorPaperdoll(
        width: number,
        height: number,
        armor: BipedArmorValues,
        options: BipedPaperdollLayerOptions = {},
    ): Promise<SVGGElement> {
        return this.createLayer(options.assetUrl ?? ARMOR_ASSET_URL, 'armor', width, height, armor, undefined, options);
    }

    public static createArmorRearPaperdoll(
        width: number,
        height: number,
        armor: BipedArmorValues,
        options: BipedPaperdollLayerOptions = {},
    ): Promise<SVGGElement> {
        return this.createLayer(options.assetUrl ?? ARMOR_REAR_ASSET_URL, 'armor', width, height, armor, undefined, options);
    }

    public static createStructurePaperdoll(
        width: number,
        height: number,
        tonnage: BipedStructureTonnage,
        options: BipedPaperdollLayerOptions = {},
    ): Promise<SVGGElement> {
        return this.createLayer(options.assetUrl ?? STRUCTURE_ASSET_URL, 'structure', width, height, undefined, tonnage, options);
    }

    private static async createLayer(
        assetUrl: string,
        type: 'armor' | 'structure',
        width: number,
        height: number,
        armor: BipedArmorValues | undefined,
        structureTonnage: BipedStructureTonnage | undefined,
        options: BipedPaperdollLayerOptions,
    ): Promise<SVGGElement> {
        const source = await this.loadAsset(assetUrl);
        const viewBox = this.readViewBox(source);
        const layer = document.createElementNS(SVG_NAMESPACE, 'g');
        layer.setAttribute('class', options.className ?? `biped-paperdoll-${type}`);
        layer.setAttribute('data-type', type);
        layer.setAttribute('data-source', assetUrl);
        layer.setAttribute('data-width', width.toString());
        layer.setAttribute('data-height', height.toString());

        const inset = Math.max(options.pipOptions?.inset ?? 0, 0);
        const availableWidth = Math.max(width - inset * 2, 0);
        const availableHeight = Math.max(height - inset * 2, 0);
        const shouldScale = options.scale !== false;
        const scale = shouldScale
            ? Math.min(availableWidth / viewBox.width, availableHeight / viewBox.height)
            : 1;
        const renderedWidth = viewBox.width * scale;
        const renderedHeight = viewBox.height * scale;
        const offsetX = inset + (options.centeredHorizontally ? (availableWidth - renderedWidth) / 2 : 0);
        const offsetY = inset + (options.centeredVertically ? (availableHeight - renderedHeight) / 2 : 0);

        const fitGroup = document.createElementNS(SVG_NAMESPACE, 'g');
        fitGroup.setAttribute('transform', `translate(${offsetX} ${offsetY})`);
        layer.appendChild(fitGroup);

        const scaleGroup = document.createElementNS(SVG_NAMESPACE, 'g');
        if (shouldScale) {
            scaleGroup.setAttribute('transform', `scale(${scale})`);
        }
        fitGroup.appendChild(scaleGroup);

        const art = this.findArtRoot(source, type);
        const sourceGroup = document.createElementNS(SVG_NAMESPACE, 'g');
        sourceGroup.setAttribute('transform', `translate(${-viewBox.minX} ${-viewBox.minY})`);
        let importedArt: SVGElement;
        if (art === source) {
            const importedGroup = document.createElementNS(SVG_NAMESPACE, 'g');
            importedGroup.setAttribute('id', `paperdoll-art-${type}`);
            const sourceStyle = source.getAttribute('style');
            if (sourceStyle) {
                importedGroup.setAttribute('style', sourceStyle);
            }
            for (const child of Array.from(source.childNodes)) {
                importedGroup.appendChild(document.importNode(child, true));
            }
            importedArt = importedGroup;
        } else {
            importedArt = document.importNode(art, true) as SVGElement;
        }
        if (!importedArt.getAttribute('id')) {
            importedArt.setAttribute('id', `paperdoll-art-${type}`);
        }
        const ancestorTransforms: string[] = [];
        let ancestor = art.parentElement;
        while (ancestor && ancestor !== (source as unknown as HTMLElement)) {
            const transform = ancestor.getAttribute('transform');
            if (transform) {
                ancestorTransforms.push(transform);
            }
            ancestor = ancestor.parentElement;
        }
        for (const transform of ancestorTransforms) {
            const wrapper = document.createElementNS(SVG_NAMESPACE, 'g');
            wrapper.setAttribute('transform', transform);
            wrapper.appendChild(importedArt);
            importedArt = wrapper;
        }
        sourceGroup.appendChild(importedArt);
        if (art !== source) {
            for (const child of Array.from(source.children)) {
                if (child !== art && this.containsPlaceholderMarker(child)) {
                    sourceGroup.appendChild(document.importNode(child, true));
                }
            }
        }
        scaleGroup.appendChild(sourceGroup);

        this.applySilhouetteStyles(sourceGroup, type, options);
        this.replacePlaceholders(sourceGroup, armor, structureTonnage, options);
        if (options.outline) {
            const frame = document.createElementNS(SVG_NAMESPACE, 'rect');
            frame.setAttribute('class', 'biped-paperdoll-frame');
            frame.setAttribute('x', '0');
            frame.setAttribute('y', '0');
            frame.setAttribute('width', width.toString());
            frame.setAttribute('height', height.toString());
            frame.setAttribute('fill', 'none');
            frame.setAttribute('stroke', '#00a8ff');
            frame.setAttribute('stroke-width', '1');
            frame.setAttribute('vector-effect', 'non-scaling-stroke');
            layer.appendChild(frame);
        }
        return layer;
    }

    private static async loadAsset(url: string): Promise<SVGSVGElement> {
        const cached = this.assetCache.get(url);
        if (cached) {
            return cached;
        }

        const load = fetch(url).then(async response => {
            if (!response.ok) {
                throw new Error(`Unable to load biped paperdoll SVG: ${url} (${response.status})`);
            }
            const source = await response.text();
            const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
            if (parsed.querySelector('parsererror')) {
                throw new Error(`Unable to parse biped paperdoll SVG: ${url}`);
            }
            const asset = parsed.documentElement as unknown as SVGSVGElement;
            return asset;
        });
        this.assetCache.set(url, load);
        return load;
    }

    private static readViewBox(source: SVGSVGElement): ViewBox {
        const values = (source.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/u).map(Number);
        if (values.length === 4 && values.every(value => Number.isFinite(value)) && values[2] > 0 && values[3] > 0) {
            return { minX: values[0], minY: values[1], width: values[2], height: values[3] };
        }

        const width = this.readSvgLength(source.getAttribute('width'));
        const height = this.readSvgLength(source.getAttribute('height'));
        if (width > 0 && height > 0) {
            return { minX: 0, minY: 0, width, height };
        }
        throw new Error('Biped paperdoll SVG must define a positive viewBox or width and height');
    }

    private static readSvgLength(value: string | null): number {
        const match = /^\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:px)?\s*$/iu.exec(value ?? '');
        return match ? Number(match[1]) : Number.NaN;
    }

    private static applySilhouetteStyles(sourceGroup: SVGGElement, type: 'armor' | 'structure', options: BipedPaperdollLayerOptions): void {
        if (!options.silhouetteFill && !options.silhouetteStroke && !options.silhouetteStrokeWidth) {
            return;
        }

        const elements = new Set<SVGGraphicsElement>([
            ...sourceGroup.querySelectorAll<SVGGraphicsElement>(`[id^="paperdoll-art-${type}-"]`),
            ...sourceGroup.querySelectorAll<SVGGraphicsElement>(type === 'armor' ? '[id^="armor"]' : '[id^="is"]'),
            ...sourceGroup.querySelectorAll<SVGGraphicsElement>(
                '[data-location]:not([data-canon]):not([data-fill]):not([data-rail])',
            ),
        ]);
        elements.forEach(element => {
            if (options.silhouetteFill) {
                element.style.setProperty('fill', options.silhouetteFill);
            }
            if (options.silhouetteStroke) {
                element.style.setProperty('stroke', options.silhouetteStroke);
            }
            if (options.silhouetteStrokeWidth) {
                element.style.setProperty('stroke-width', options.silhouetteStrokeWidth);
            }
        });
    }

    private static replacePlaceholders(
        sourceGroup: SVGGElement,
        armor: BipedArmorValues | undefined,
        structureTonnage: BipedStructureTonnage | undefined,
        options: BipedPaperdollLayerOptions,
    ): void {
        const collection = this.collectPlaceholderGroups(sourceGroup);
        const context: PlaceholderRenderContext = { armor, structureTonnage, options };
        const requestedLayout = options.pipLayout ?? 'canon';
        const blockedKeys = new Set<string>();

        this.renderRailGroups(collection.rails, requestedLayout, context, blockedKeys);
        this.renderFillGroups(collection.fills, requestedLayout, context, blockedKeys);
        if (options.showFillPlaceholders && options.generateFillRows) {
            this.renderFillPlaceholderRows(collection.fills, options);
        }
        this.renderShieldGroups(collection.shields, requestedLayout, context, blockedKeys);
        this.renderBoundsGroups(collection.bounds, requestedLayout, context, blockedKeys);
        this.cleanupPlaceholders(collection);
    }

    private static collectPlaceholderGroups(sourceGroup: SVGGElement): PlaceholderCollection {
        const collection: PlaceholderCollection = {
            placeholders: Array.from(sourceGroup.querySelectorAll<SVGElement>(
                '[data-canon], [data-rail], [data-fill]',
            )),
            bounds: [],
            shields: [],
            rails: [],
            fills: [],
        };
        const seenRails = new Set<SVGGeometryElement>();
        for (const element of collection.placeholders) {
            this.collectPlaceholder(element, collection, seenRails);
        }
        return collection;
    }

    private static collectPlaceholder(
        element: SVGElement,
        collection: PlaceholderCollection,
        seenRails: Set<SVGGeometryElement>,
    ): void {
        const context = this.readPlaceholderContext(element);
        if (!context) {
            return;
        }
        const rectangles = this.readPlaceholderRectangles(element);
        if (context.rail) {
            this.addRailPlaceholder(element, context, collection.rails, seenRails);
        }

        const shieldRows = this.isShieldPlaceholderType(context.type)
            ? this.readShieldRows(element, rectangles)
            : [];
        if (context.fill && !this.isShieldPlaceholderType(context.type)) {
            this.addFillPlaceholder(element, context, collection.fills);
        }
        if (rectangles.length === 0 && shieldRows.length === 0) {
            return;
        }

        const parent = this.getPlaceholderParent(element, rectangles);
        if (!parent) {
            return;
        }
        if (this.isShieldPlaceholderType(context.type)
            && shieldRows.length > 0
            && (context.fill || context.canon)) {
            this.addShieldPlaceholder(
                element,
                context.type,
                context.location,
                parent,
                rectangles,
                shieldRows,
                collection.shields,
            );
            return;
        }
        if (context.canon && rectangles.length > 0) {
            this.addBoundsPlaceholder(context, parent, rectangles, collection.bounds);
        }
    }

    private static addFillPlaceholder(
        element: SVGElement,
        context: PlaceholderContext,
        groups: FillPlaceholderGroup[],
    ): void {
        const geometry = this.readFillGeometry(element);
        const parent = geometry?.parentElement instanceof SVGElement
            ? geometry.parentElement
            : null;
        if (!geometry || !parent) {
            return;
        }

        let group = groups.find(candidate =>
            candidate.type === context.type && candidate.location === context.location);
        if (!group) {
            const createdGroup: FillPlaceholderGroup = {
                type: context.type,
                location: context.location,
                areas: [],
                parent,
                elements: [],
            };
            groups.push(createdGroup);
            group = createdGroup;
        }
        group.areas.push({
            geometry,
            parent,
            transform: geometry.getAttribute('transform'),
        });
        group.elements.push(geometry);
    }

    private static addRailPlaceholder(
        element: SVGElement,
        context: PlaceholderContext,
        groups: RailGroup[],
        seenRails: Set<SVGGeometryElement>,
    ): void {
        const geometries = this.readRailGeometries(element).filter(geometry => {
            if (seenRails.has(geometry)) {
                return false;
            }
            seenRails.add(geometry);
            return true;
        });
        if (geometries.length === 0) {
            return;
        }

        let group = groups.find(candidate =>
            candidate.type === context.type && candidate.location === context.location);
        if (!group) {
            const createdGroup: RailGroup = {
                type: context.type,
                location: context.location,
                rails: [],
                elements: [],
            };
            groups.push(createdGroup);
            group = createdGroup;
        }
        for (const geometry of geometries) {
            const parent = geometry.parentElement instanceof SVGElement
                ? geometry.parentElement
                : null;
            if (!parent) {
                continue;
            }
            group.rails.push({
                geometry,
                parent,
                transform: geometry.getAttribute('transform'),
                capacity: this.parsePositiveInteger(geometry.getAttribute('data-rail-capacity'))
                    ?? context.capacity,
                index: this.parseNonNegativeInteger(geometry.getAttribute('data-rail-index'))
                    ?? context.index,
                order: group.rails.length,
            });
            group.elements.push(geometry);
        }
    }

    private static addShieldPlaceholder(
        element: SVGElement,
        type: 'shield-dc' | 'shield-da',
        location: string,
        parent: SVGElement,
        rectangles: SVGRectElement[],
        rows: PipRow[],
        groups: ShieldPlaceholderGroup[],
    ): void {
        let group = groups.find(candidate =>
            candidate.type === type && candidate.location === location);
        if (!group) {
            const createdGroup: ShieldPlaceholderGroup = {
                parent,
                type,
                location,
                rows: [],
                elements: [],
            };
            groups.push(createdGroup);
            group = createdGroup;
        }
        group.rows.push(...rows);
        group.elements.push(...(rectangles.length > 0 ? rectangles : [element]));
    }

    private static addBoundsPlaceholder(
        context: PlaceholderContext,
        parent: SVGElement,
        rectangles: SVGRectElement[],
        groups: PlaceholderGroup[],
    ): void {
        let bounds = this.readRectBounds(rectangles[0]);
        for (const rectangle of rectangles.slice(1)) {
            bounds = this.mergeBounds(bounds, this.readRectBounds(rectangle));
        }

        let group = groups.find(candidate =>
            candidate.parent === parent
            && candidate.type === context.type
            && candidate.location === context.location);
        if (!group) {
            const createdGroup: PlaceholderGroup = {
                parent,
                type: context.type,
                location: context.location,
                bounds,
                canon: context.canon,
                fill: context.fill,
                elements: [],
            };
            groups.push(createdGroup);
            group = createdGroup;
        } else {
            group.bounds = this.mergeBounds(group.bounds, bounds);
            group.canon ||= context.canon;
            group.fill ||= context.fill;
        }
        group.elements.push(...rectangles);
    }

    private static readPlaceholderRectangles(element: SVGElement): SVGRectElement[] {
        return element instanceof SVGRectElement
            ? [element]
            : Array.from(element.querySelectorAll<SVGRectElement>('rect'));
    }

    private static getPlaceholderParent(
        element: SVGElement,
        rectangles: readonly SVGRectElement[],
    ): SVGElement | null {
        if (rectangles.length > 0) {
            return element instanceof SVGRectElement
                ? element.parentNode instanceof SVGElement ? element.parentNode : null
                : element;
        }
        return element.parentNode instanceof SVGElement ? element.parentNode : null;
    }

    private static renderRailGroups(
        groups: readonly RailGroup[],
        requestedLayout: BipedPaperdollPipLayout,
        context: PlaceholderRenderContext,
        blockedKeys: Set<string>,
    ): void {
        if (requestedLayout !== 'rail') {
            return;
        }
        for (const group of groups) {
            const key = this.getPlaceholderKey(group.type, group.location);
            if (blockedKeys.has(key)) {
                continue;
            }
            const count = this.readPlaceholderPipCount(
                group.type,
                group.location,
                context.armor,
                context.structureTonnage,
                context.options,
            );
            if (typeof count === 'number' && this.appendRailPips(group, count, context.options)) {
                blockedKeys.add(key);
            }
        }
    }

    private static renderFillGroups(
        groups: readonly FillPlaceholderGroup[],
        requestedLayout: BipedPaperdollPipLayout,
        context: PlaceholderRenderContext,
        blockedKeys: Set<string>,
    ): void {
        if (requestedLayout !== 'distributed' && requestedLayout !== 'generic') {
            return;
        }
        for (const group of groups) {
            const key = this.getPlaceholderKey(group.type, group.location);
            if (blockedKeys.has(key)) {
                continue;
            }
            const count = this.readPlaceholderPipCount(
                group.type,
                group.location,
                context.armor,
                context.structureTonnage,
                context.options,
            );
            const pips = typeof count === 'number'
                ? this.createFillPlaceholderPips(group, count, requestedLayout, context.options)
                : null;
            if (!pips) {
                continue;
            }
            this.appendPipZone(group.parent, group.type, group.location, pips, null, null);
            blockedKeys.add(key);
        }
    }

    private static renderFillPlaceholderRows(
        groups: readonly FillPlaceholderGroup[],
        options: BipedPaperdollLayerOptions,
    ): void {
        for (const group of groups) {
            for (const area of group.areas) {
                const rows = PipRowGenerator.createDebugRows(area.geometry, options.pipOptions?.rowHeight);
                if (!rows) {
                    continue;
                }
                rows.setAttribute('data-fill-type', group.type);
                rows.setAttribute('data-fill-location', group.location);
                area.parent.appendChild(rows);
            }
        }
    }

    private static renderShieldGroups(
        groups: readonly ShieldPlaceholderGroup[],
        requestedLayout: BipedPaperdollPipLayout,
        context: PlaceholderRenderContext,
        blockedKeys: Set<string>,
    ): void {
        const shieldLayout = requestedLayout === 'canon' ? 'distributed' : requestedLayout;
        for (const group of groups) {
            const key = this.getPlaceholderKey(group.type, group.location);
            if (blockedKeys.has(key)) {
                continue;
            }
            const pips = this.createShieldPlaceholderPips(group, shieldLayout, context);
            if (!pips) {
                continue;
            }
            const bounds = shieldLayout === 'generic'
                ? this.getPipRowBounds(group.rows)
                : null;
            this.appendPipZone(
                group.parent,
                group.type,
                group.location,
                pips,
                bounds ? `translate(${bounds.minX} ${bounds.minY})` : null,
                bounds ? 'generic' : null,
            );
        }
    }

    private static renderBoundsGroups(
        groups: readonly PlaceholderGroup[],
        requestedLayout: BipedPaperdollPipLayout,
        context: PlaceholderRenderContext,
        blockedKeys: Set<string>,
    ): void {
        for (const group of groups) {
            const key = this.getPlaceholderKey(group.type, group.location);
            if (blockedKeys.has(key)) {
                continue;
            }
            const pips = this.createBoundsPlaceholderPips(group, requestedLayout, context);
            if (!pips) {
                continue;
            }
            this.appendPipZone(
                group.parent,
                group.type,
                group.location,
                pips,
                `translate(${group.bounds.minX} ${group.bounds.minY})`,
                null,
            );
        }
    }

    private static createBoundsPlaceholderPips(
        group: PlaceholderGroup,
        requestedLayout: BipedPaperdollPipLayout,
        context: PlaceholderRenderContext,
    ): SVGGElement | null {
        const primaryPips = (requestedLayout === 'canon' ? group.canon : group.fill)
            ? this.createBoundsPlaceholderPipsForLayout(group, requestedLayout, context)
            : null;
        const fallbackLayout = context.options.fallbackPipLayout;
        if (primaryPips || !fallbackLayout || fallbackLayout === requestedLayout) {
            return primaryPips;
        }
        return this.createBoundsPlaceholderPipsForLayout(group, fallbackLayout, context);
    }

    private static createBoundsPlaceholderPipsForLayout(
        group: PlaceholderGroup,
        layout: BipedPaperdollPipLayout,
        context: PlaceholderRenderContext,
    ): SVGGElement | null {
        const width = group.bounds.maxX - group.bounds.minX;
        const height = group.bounds.maxY - group.bounds.minY;
        if (layout === 'canon') {
            return this.createCanonicalPlaceholderPips(group, width, height, context);
        }

        const count = this.readPlaceholderPipCount(
            group.type,
            group.location,
            context.armor,
            context.structureTonnage,
            context.options,
        );
        if (typeof count !== 'number') {
            return null;
        }
        const pipOptions = this.getPlaceholderPipOptions(group.type, context.options);
        switch (layout) {
            case 'distributed':
                return DistributedPipRenderer.createPips(
                    [{ x: 0, y: 0, width, height }],
                    count,
                    pipOptions,
                    group.type,
                    group.location,
                );
            case 'generic':
                return GenericPipRenderer.createPips(
                    count,
                    width,
                    height,
                    pipOptions,
                    group.type,
                    group.location,
                );
            default:
                return null;
        }
    }

    private static createCanonicalPlaceholderPips(
        group: PlaceholderGroup,
        width: number,
        height: number,
        context: PlaceholderRenderContext,
    ): SVGGElement | null {
        if (group.type === 'armor') {
            const count = context.armor?.[group.location as BipedArmorLocation];
            return typeof count === 'number'
                ? CanonPipRenderer.createArmorPips(group.location, count, width, height, context.options.pipOptions)
                : null;
        }
        if (group.type === 'structure') {
            const tonnage = this.getStructureTonnage(context.structureTonnage, group.location);
            return typeof tonnage === 'number'
                ? CanonPipRenderer.createStructurePips(tonnage, group.location, width, height, context.options.pipOptions)
                : null;
        }
        return null;
    }

    private static createFillPlaceholderPips(
        group: FillPlaceholderGroup,
        count: number,
        layout: BipedPaperdollPipLayout,
        options: BipedPaperdollLayerOptions,
    ): SVGGElement | null {
        const pipOptions = this.getPlaceholderPipOptions(group.type, options);
        if (group.areas.length === 1) {
            return this.createActiveFillPlaceholderPips(
                group.areas[0].geometry,
                count,
                layout,
                options,
                group.type,
                group.location,
            );
        }

        const allocations = this.allocateFillAreaPips(group, count);
        const rendered: SVGGElement[] = [];
        for (let index = 0; index < group.areas.length; index++) {
            const areaCount = allocations[index];
            if (areaCount <= 0) {
                continue;
            }
            const pips = this.createActiveFillPlaceholderPips(
                group.areas[index].geometry,
                areaCount,
                layout,
                options,
                group.type,
                group.location,
            );
            if (!pips) {
                return null;
            }
            rendered.push(pips);
        }
        if (rendered.length === 0) {
            return null;
        }

        const combined = PipRendererShared.createGroup(
            pipOptions,
            group.type,
            group.location,
            Math.floor(count),
            layout,
        );
        rendered.forEach(pips => combined.appendChild(pips));
        return combined;
    }

    private static createActiveFillPlaceholderPips(
        geometry: SVGGeometryElement,
        count: number,
        layout: BipedPaperdollPipLayout,
        layerOptions: BipedPaperdollLayerOptions,
        type: PaperdollPlaceholderType,
        location: string,
    ): SVGGElement | null {
        const options = this.getPlaceholderPipOptions(type, layerOptions);
        const generated = layerOptions.generateFillRows
            ? PipRowGenerator.createRows(geometry, options.rowHeight)
            : null;
        const bounds = generated
            ? this.getPipRowBounds(generated.rows)
            : this.readGeometryBounds(geometry);
        if (!bounds) {
            return null;
        }
        const sourceTransform = generated
            ? generated.transform
            : PipRowGenerator.getEffectiveTransform(geometry);

        switch (layout) {
            case 'distributed': {
                const rows = generated?.rows ?? [{
                    x: bounds.minX,
                    y: bounds.minY,
                    width: bounds.maxX - bounds.minX,
                    height: bounds.maxY - bounds.minY,
                }];
                const pips = DistributedPipRenderer.createPips(rows, count, options, type, location);
                if (pips && sourceTransform) {
                    pips.setAttribute('transform', sourceTransform);
                }
                return pips;
            }
            case 'generic': {
                const pips = GenericPipRenderer.createPips(
                    count,
                    bounds.maxX - bounds.minX,
                    bounds.maxY - bounds.minY,
                    options,
                    type,
                    location,
                );
                if (pips) {
                    const transforms = sourceTransform ? [
                        sourceTransform,
                        `translate(${bounds.minX} ${bounds.minY})`,
                    ] : [`translate(${bounds.minX} ${bounds.minY})`];
                    pips.setAttribute('transform', transforms.join(' '));
                }
                return pips;
            }
            default:
                return null;
        }
    }

    private static allocateFillAreaPips(
        group: FillPlaceholderGroup,
        count: number,
    ): number[] {
        const pipCount = Math.floor(count);
        const areas = group.areas.map(area => {
            try {
                const bounds = area.geometry.getBBox();
                return bounds.width > 0 && bounds.height > 0
                    ? bounds.width * bounds.height
                    : 0;
            } catch {
                return 0;
            }
        });
        const totalArea = areas.reduce((sum, area) => sum + area, 0);
        const weights = totalArea > 0 ? areas : areas.map(() => 1);
        const weightTotal = weights.reduce((sum, area) => sum + area, 0);
        const allocations = weights.map(area => Math.floor(pipCount * area / weightTotal));
        let allocated = allocations.reduce((sum, allocation) => sum + allocation, 0);
        const remainderOrder = weights
            .map((area, index) => ({
                index,
                remainder: pipCount * area / weightTotal - allocations[index],
            }))
            .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
        let remainderIndex = 0;
        while (allocated < pipCount) {
            allocations[remainderOrder[remainderIndex % remainderOrder.length].index]++;
            allocated++;
            remainderIndex++;
        }
        return allocations;
    }

    private static createShieldPlaceholderPips(
        group: ShieldPlaceholderGroup,
        layout: BipedPaperdollPipLayout,
        context: PlaceholderRenderContext,
    ): SVGGElement | null {
        const count = this.readPlaceholderPipCount(
            group.type,
            group.location,
            context.armor,
            context.structureTonnage,
            context.options,
        );
        if (typeof count !== 'number') {
            return null;
        }
        const pipOptions = this.getPlaceholderPipOptions(group.type, context.options);
        switch (layout) {
            case 'distributed':
                return DistributedPipRenderer.createPips(group.rows, count, pipOptions, group.type, group.location);
            case 'generic': {
                const bounds = this.getPipRowBounds(group.rows);
                if (!bounds) {
                    return null;
                }
                return GenericPipRenderer.createPips(
                    count,
                    bounds.maxX - bounds.minX,
                    bounds.maxY - bounds.minY,
                    pipOptions,
                    group.type,
                    group.location,
                );
            }
            default:
                return null;
        }
    }

    private static appendPipZone(
        parent: SVGElement,
        type: PaperdollPlaceholderType,
        location: string,
        pips: SVGGElement,
        transform: string | null,
        layout: string | null,
    ): void {
        const zone = document.createElementNS(SVG_NAMESPACE, 'g');
        zone.setAttribute('class', `biped-paperdoll-zone biped-paperdoll-zone-${location} biped-paperdoll-zone-${type}`);
        zone.setAttribute('data-location', location);
        zone.setAttribute('data-zone-type', type);
        if (transform) {
            zone.setAttribute('transform', transform);
        }
        if (layout) {
            zone.setAttribute('data-layout', layout);
        }
        zone.appendChild(pips);
        parent.appendChild(zone);
    }

    private static cleanupPlaceholders(collection: PlaceholderCollection): void {
        const groups = [
            ...collection.bounds,
            ...collection.shields,
            ...collection.rails,
            ...collection.fills,
        ];
        const removable = new Set<SVGElement>();
        const preservedParents = new Set<SVGElement>();
        for (const group of groups) {
            group.elements.forEach(element => removable.add(element));
        }
        for (const group of [...collection.bounds, ...collection.shields, ...collection.fills]) {
            preservedParents.add(group.parent);
        }
        for (const group of collection.rails) {
            group.rails.forEach(rail => preservedParents.add(rail.parent));
        }
        removable.forEach(element => element.remove());

        for (const placeholder of collection.placeholders) {
            if (this.isPlaceholderGraphic(placeholder) || !preservedParents.has(placeholder)) {
                placeholder.remove();
                continue;
            }
            this.clearPlaceholderAttributes(placeholder);
        }
    }

    private static clearPlaceholderAttributes(element: SVGElement): void {
        element.removeAttribute('data-canon');
        element.removeAttribute('data-rail');
        element.removeAttribute('data-fill');
        element.removeAttribute('data-location');
        element.removeAttribute('data-rail-index');
        element.removeAttribute('data-rail-capacity');
    }

    private static isPlaceholderGraphic(element: SVGElement): boolean {
        return this.isFillGeometry(element) || this.isRailGeometry(element);
    }

    private static containsPlaceholderMarker(element: Element): boolean {
        return element.matches('[data-canon], [data-fill], [data-rail]')
            || element.querySelector('[data-canon], [data-fill], [data-rail]') !== null;
    }

    private static isShieldPlaceholderType(
        type: PaperdollPlaceholderType,
    ): type is 'shield-dc' | 'shield-da' {
        return type === 'shield-dc' || type === 'shield-da';
    }

    private static getPlaceholderPipOptions(
        type: PaperdollPlaceholderType,
        options: BipedPaperdollLayerOptions,
    ): PipRenderOptions {
        const pipOptions = options.pipOptions ?? {};
        if (!this.isShieldPlaceholderType(type)) {
            return pipOptions;
        }
        return {
            ...pipOptions,
            fill: pipOptions.fill ?? '#fff',
            shape: type === 'shield-da' ? 'diamond' : 'circle',
        };
    }

    private static appendRailPips(
        group: RailGroup,
        count: number,
        options: BipedPaperdollLayerOptions,
    ): boolean {
        const defaultCapacity = Number.isFinite(options.railPipsPerPath)
            ? Math.max(1, Math.floor(options.railPipsPerPath ?? 5))
            : 5;
        const rails = [...group.rails].sort((first, second) => {
            if (first.index === undefined && second.index === undefined) {
                return first.order - second.order;
            }
            if (first.index === undefined) {
                return 1;
            }
            if (second.index === undefined) {
                return -1;
            }
            return first.index - second.index || first.order - second.order;
        });
        const totalCapacity = rails.reduce(
            (total, rail) => total + (rail.capacity ?? defaultCapacity),
            0,
        );
        if (count <= 0 || totalCapacity < count) {
            return false;
        }

        const pipOptions = this.getPlaceholderPipOptions(group.type, options);
        const assignedRails: Array<{ rail: RailDefinition; capacity: number; count: number }> = [];
        let remaining = count;
        for (const rail of rails) {
            if (remaining <= 0) {
                break;
            }
            const capacity = rail.capacity ?? defaultCapacity;
            const railCount = Math.min(remaining, capacity);
            assignedRails.push({ rail, capacity, count: railCount });
            remaining -= railCount;
        }
        if (remaining > 0) {
            return false;
        }

        const railRadius = Math.min(...assignedRails.map(({ rail, capacity }) => {
            try {
                return RailPipRenderer.getPipRadius(
                    rail.geometry.getTotalLength(),
                    capacity,
                    pipOptions,
                );
            } catch {
                return 0;
            }
        }));
        if (!Number.isFinite(railRadius) || railRadius <= 0) {
            return false;
        }
        const railPipOptions: PipRenderOptions = {
            ...pipOptions,
            pipRadius: railRadius,
        };
        const rendered: Array<{ parent: SVGElement; transform: string | null; pips: SVGGElement }> = [];
        for (const assignment of assignedRails) {
            const { rail, capacity, count: railCount } = assignment;
            const pips = RailPipRenderer.createPips(
                rail.geometry,
                railCount,
                railPipOptions,
                group.type,
                group.location,
                capacity,
            );
            if (!pips) {
                return false;
            }
            rendered.push({ parent: rail.parent, transform: rail.transform, pips });
        }

        for (const item of rendered) {
            this.appendPipZone(
                item.parent,
                group.type,
                group.location,
                item.pips,
                item.transform,
                'rail',
            );
        }
        return true;
    }

    private static readPlaceholderPipCount(
        placeholderType: PaperdollPlaceholderType,
        location: string,
        armor: BipedArmorValues | undefined,
        structureTonnage: BipedStructureTonnage | undefined,
        options: BipedPaperdollLayerOptions,
    ): number | undefined {
        if (placeholderType === 'armor') {
            const value = armor?.[location as BipedArmorLocation];
            return typeof value === 'number' ? value : undefined;
        }
        if (placeholderType === 'structure') {
            const locationTonnage = this.getStructureTonnage(structureTonnage, location);
            return typeof locationTonnage === 'number'
                ? CanonPipRenderer.getStructurePipCount(locationTonnage, location)
                : undefined;
        }
        const shieldValues = options.shieldValues?.[location as BipedShieldLocation];
        return placeholderType === 'shield-dc' ? shieldValues?.dc : shieldValues?.da;
    }

    private static getStructureTonnage(
        structureTonnage: BipedStructureTonnage | undefined,
        location: string,
    ): number | undefined {
        return typeof structureTonnage === 'number'
            ? structureTonnage
            : structureTonnage?.[location as BipedStructureLocation];
    }

    private static getPlaceholderKey(type: PaperdollPlaceholderType, location: string): string {
        return `${type}:${location}`;
    }

    private static readFillGeometry(element: SVGElement): SVGGeometryElement | null {
        if (this.isFillGeometry(element)) {
            return element;
        }
        return element.querySelector<SVGGeometryElement>('path, polygon, polyline, rect, circle, ellipse');
    }

    private static isFillGeometry(element: SVGElement): element is SVGGeometryElement {
        const tagName = element.tagName.toLowerCase();
        return tagName === 'path'
            || tagName === 'polygon'
            || tagName === 'polyline'
            || tagName === 'rect'
            || tagName === 'circle'
            || tagName === 'ellipse';
    }

    private static readRailGeometries(element: SVGElement): SVGGeometryElement[] {
        const geometries: SVGGeometryElement[] = [];
        const addGeometry = (candidate: SVGElement): void => {
            if (this.isRailGeometry(candidate)) {
                geometries.push(candidate);
            }
        };
        addGeometry(element);
        element.querySelectorAll<SVGElement>('path, line, polyline').forEach(addGeometry);
        return geometries;
    }

    private static readShieldRows(element: SVGElement, rectangles: SVGRectElement[]): PipRow[] {
        if (rectangles.length > 0) {
            return rectangles.map(rectangle => {
                const bounds = this.readRectBounds(rectangle);
                return {
                    x: bounds.minX,
                    y: bounds.minY,
                    width: bounds.maxX - bounds.minX,
                    height: bounds.maxY - bounds.minY,
                };
            });
        }
        if (!this.isRailGeometry(element)) {
            return [];
        }
        try {
            const bounds = element.getBBox();
            if (bounds.width > 0 && bounds.height > 0) {
                return [{ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }];
            }
        } catch {
        }
        if (!(element instanceof SVGPathElement)) {
            return [];
        }
        const coordinates = (element.getAttribute('d') ?? '')
            .match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/giu)
            ?.map(Number) ?? [];
        if (coordinates.length < 2) {
            return [];
        }
        const points = [];
        for (let index = 0; index + 1 < coordinates.length; index += 2) {
            points.push({ x: coordinates[index], y: coordinates[index + 1] });
        }
        const minX = Math.min(...points.map(point => point.x));
        const minY = Math.min(...points.map(point => point.y));
        const maxX = Math.max(...points.map(point => point.x));
        const maxY = Math.max(...points.map(point => point.y));
        return maxX > minX && maxY > minY
            ? [{ x: minX, y: minY, width: maxX - minX, height: maxY - minY }]
            : [];
    }

    private static getPipRowBounds(rows: readonly PipRow[]): PlaceholderBounds | null {
        const validRows = rows.filter(row => row.width > 0 && row.height > 0);
        if (validRows.length === 0) {
            return null;
        }
        return {
            minX: Math.min(...validRows.map(row => row.x)),
            minY: Math.min(...validRows.map(row => row.y)),
            maxX: Math.max(...validRows.map(row => row.x + row.width)),
            maxY: Math.max(...validRows.map(row => row.y + row.height)),
        };
    }

    private static readGeometryBounds(geometry: SVGGeometryElement): PlaceholderBounds | null {
        const readBounds = (candidate: SVGGeometryElement): PlaceholderBounds | null => {
            const bounds = candidate.getBBox();
            if (!Number.isFinite(bounds.x)
                || !Number.isFinite(bounds.y)
                || !Number.isFinite(bounds.width)
                || !Number.isFinite(bounds.height)
                || bounds.width <= 0
                || bounds.height <= 0) {
                return null;
            }
            return {
                minX: bounds.x,
                minY: bounds.y,
                maxX: bounds.x + bounds.width,
                maxY: bounds.y + bounds.height,
            };
        };

        try {
            const bounds = readBounds(geometry);
            if (bounds) {
                return bounds;
            }
        } catch {
        }

        const samplingRoot = document.createElementNS(SVG_NAMESPACE, 'svg');
        const samplingGeometry = geometry.cloneNode(true) as SVGGeometryElement;
        samplingRoot.setAttribute('width', '1');
        samplingRoot.setAttribute('height', '1');
        samplingRoot.style.setProperty('position', 'fixed');
        samplingRoot.style.setProperty('left', '-10000px');
        samplingRoot.style.setProperty('top', '-10000px');
        samplingRoot.style.setProperty('visibility', 'hidden');
        samplingRoot.style.setProperty('pointer-events', 'none');
        samplingGeometry.removeAttribute('transform');
        samplingRoot.appendChild(samplingGeometry);
        document.body.appendChild(samplingRoot);
        try {
            return readBounds(samplingGeometry);
        } catch {
            return null;
        } finally {
            samplingRoot.remove();
        }
    }

    private static isRailGeometry(element: SVGElement): element is SVGGeometryElement {
        const tagName = element.tagName.toLowerCase();
        return tagName === 'path' || tagName === 'line' || tagName === 'polyline';
    }

    private static findArtRoot(source: SVGSVGElement, type: 'armor' | 'structure'): SVGGElement | SVGSVGElement {
        return source.querySelector<SVGGElement>(`[id="paperdoll-art-${type}"]`)
            ?? source.querySelector<SVGGElement>(`[data-art="${type}"]`)
            ?? source;
    }

    private static readPlaceholderContext(element: SVGElement): PlaceholderContext | null {
        const railType = element.getAttribute('data-rail');
        const fillType = element.getAttribute('data-fill');
        const canonType = element.getAttribute('data-canon');
        const type = [railType, canonType, fillType]
            .find(candidate => this.isPlaceholderType(candidate));
        const location = element.getAttribute('data-location');
        if (!this.isPlaceholderType(type) || !location) {
            return null;
        }
        const capacity = element.getAttribute('data-rail-capacity');
        return {
            type,
            location: location.toUpperCase(),
            rail: railType !== null,
            fill: fillType !== null,
            canon: canonType !== null,
            capacity: this.parsePositiveInteger(capacity),
            index: this.parseNonNegativeInteger(element.getAttribute('data-rail-index')),
        };
    }

    private static parseNonNegativeInteger(value: string | null): number | undefined {
        if (value === null) {
            return undefined;
        }
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
    }

    private static parsePositiveInteger(value: string | null): number | undefined {
        if (value === null) {
            return undefined;
        }
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    }

    private static isPlaceholderType(value: string | null | undefined): value is PaperdollPlaceholderType {
        return value === 'armor' || value === 'structure' || value === 'shield-dc' || value === 'shield-da';
    }

    private static readRectBounds(element: SVGElement): PlaceholderBounds {
        const rectangle = element instanceof SVGRectElement
            ? element
            : element.querySelector<SVGRectElement>('rect');
        if (!rectangle) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        const x = Number(rectangle.getAttribute('x') ?? 0);
        const y = Number(rectangle.getAttribute('y') ?? 0);
        const width = Number(rectangle.getAttribute('width') ?? 0);
        const height = Number(rectangle.getAttribute('height') ?? 0);
        return { minX: x, minY: y, maxX: x + width, maxY: y + height };
    }

    private static mergeBounds(left: PlaceholderBounds, right: PlaceholderBounds): PlaceholderBounds {
        return {
            minX: Math.min(left.minX, right.minX),
            minY: Math.min(left.minY, right.minY),
            maxX: Math.max(left.maxX, right.maxX),
            maxY: Math.max(left.maxY, right.maxY),
        };
    }
}
