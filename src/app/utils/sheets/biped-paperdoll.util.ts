import { CanonPipRenderer } from './canon-pip-renderer';
import { DistributedPipRenderer } from './distributed-pip-renderer';
import { FillPipRenderer } from './fill-pip-renderer';
import { GenericPipRenderer } from './generic-pip-renderer';
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
export type BipedPaperdollPipLayout = 'canon' | 'distributed' | 'rail' | 'fill' | 'generic';

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
    railPipsPerPath?: number;
    shieldValues?: BipedShieldValues;
    silhouetteFill?: string;
    silhouetteStroke?: string;
    silhouetteStrokeWidth?: string;
}

export interface BipedPaperdollOptions {
    className?: string;
    layout?: 'side-by-side' | 'stacked';
    padding?: number;
    armor?: BipedPaperdollLayerOptions;
    structure?: BipedPaperdollLayerOptions;
    shields?: BipedShieldValues;
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
    elements: SVGElement[];
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
        scaleGroup.appendChild(sourceGroup);

        this.applySilhouetteStyles(sourceGroup, type, options);
        this.replacePlaceholders(sourceGroup, type, armor, structureTonnage, options);
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
            ...sourceGroup.querySelectorAll<SVGGraphicsElement>('[data-location]:not([data-placeholder])'),
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
        type: 'armor' | 'structure',
        armor: BipedArmorValues | undefined,
        structureTonnage: BipedStructureTonnage | undefined,
        options: BipedPaperdollLayerOptions,
    ): void {
        const placeholders = Array.from(sourceGroup.querySelectorAll<SVGElement>(
            '[data-placeholder], [data-rail], [data-fill]',
        ));
        const groups: PlaceholderGroup[] = [];
        const shieldGroups: ShieldPlaceholderGroup[] = [];
        const railGroups: RailGroup[] = [];
        const fillGroups: FillPlaceholderGroup[] = [];
        const seenRails = new Set<SVGGeometryElement>();
        for (const element of placeholders) {
            const context = this.readPlaceholderContext(element);
            if (!context) {
                continue;
            }
            if (context.fill) {
                const geometry = this.readFillGeometry(element);
                const parent = geometry?.parentElement instanceof SVGElement
                    ? geometry.parentElement
                    : null;
                if (!geometry || !parent) {
                    continue;
                }
                let group = fillGroups.find(candidate =>
                    candidate.type === context.type && candidate.location === context.location);
                if (!group) {
                    const createdGroup: FillPlaceholderGroup = {
                        type: context.type,
                        location: context.location,
                        areas: [{
                            geometry,
                            parent,
                            transform: geometry.getAttribute('transform'),
                        }],
                        parent,
                        elements: [],
                    };
                    fillGroups.push(createdGroup);
                    group = createdGroup;
                } else {
                    group.areas.push({
                        geometry,
                        parent,
                        transform: geometry.getAttribute('transform'),
                    });
                }
                group.elements.push(element);
                continue;
            }
            const rectangles = element instanceof SVGRectElement
                ? [element]
                : Array.from(element.querySelectorAll<SVGRectElement>('rect'));
            const geometries = context.rail
                ? this.readRailGeometries(element).filter(geometry => {
                if (seenRails.has(geometry)) {
                    return false;
                }
                seenRails.add(geometry);
                return true;
                })
                : [];
            const { type: placeholderType, location } = context;

            if (geometries.length > 0) {
                let group = railGroups.find(candidate => candidate.type === placeholderType && candidate.location === location);
                if (!group) {
                    const createdGroup: RailGroup = {
                        type: placeholderType,
                        location,
                        rails: [],
                        elements: [],
                    };
                    railGroups.push(createdGroup);
                    group = createdGroup;
                }
                for (const geometry of geometries) {
                    const parent = geometry.parentElement instanceof SVGElement ? geometry.parentElement : null;
                    if (!parent) {
                        continue;
                    }
                    const geometryContext = this.readPlaceholderContext(geometry);
                    group.rails.push({
                        geometry,
                        parent,
                        transform: geometry.getAttribute('transform'),
                        capacity: geometryContext?.capacity ?? context.capacity,
                        index: geometryContext?.index ?? context.index,
                        order: group.rails.length,
                    });
                    group.elements.push(geometry);
                }
            }

            const shieldRows = placeholderType === 'shield-dc' || placeholderType === 'shield-da'
                ? this.readShieldRows(element, rectangles)
                : [];
            if (rectangles.length === 0 && shieldRows.length === 0) {
                continue;
            }

            const parent = rectangles.length > 0
                ? element instanceof SVGRectElement
                    ? element.parentNode instanceof SVGElement ? element.parentNode : null
                    : element
                : element.parentNode instanceof SVGElement ? element.parentNode : null;
            if (!parent) {
                continue;
            }

            if (placeholderType === 'shield-dc' || placeholderType === 'shield-da') {
                let group = shieldGroups.find(candidate => candidate.type === placeholderType && candidate.location === location);
                if (!group) {
                    const createdGroup: ShieldPlaceholderGroup = {
                        parent,
                        type: placeholderType,
                        location,
                        rows: [],
                        elements: [],
                    };
                    shieldGroups.push(createdGroup);
                    group = createdGroup;
                }
                group.rows.push(...shieldRows);
                group.elements.push(...(rectangles.length > 0 ? rectangles : [element]));
                continue;
            }

            let bounds = this.readRectBounds(rectangles[0]);
            for (const rectangle of rectangles.slice(1)) {
                bounds = this.mergeBounds(bounds, this.readRectBounds(rectangle));
            }

            let group = groups.find(candidate => candidate.parent === parent && candidate.type === placeholderType && candidate.location === location);
            if (!group) {
                const createdGroup: PlaceholderGroup = { parent, type: placeholderType, location, bounds, elements: [] };
                groups.push(createdGroup);
                group = createdGroup;
            } else {
                group.bounds = this.mergeBounds(group.bounds, bounds);
            }
            group.elements.push(...rectangles);
        }

        const selectedPipLayout = options.pipLayout ?? 'canon';
        const railKeys = new Set<string>();
        for (const group of railGroups) {
            const count = this.readPlaceholderPipCount(group.type, group.location, armor, structureTonnage, options);
            if (selectedPipLayout === 'rail'
                && typeof count === 'number'
                && this.appendRailPips(group, count, options)) {
                railKeys.add(this.getPlaceholderKey(group.type, group.location));
            }
            group.elements.forEach(element => element.remove());
        }

        const fillKeys = new Set<string>();
        for (const group of fillGroups) {
            const key = this.getPlaceholderKey(group.type, group.location);
            if (railKeys.has(key)) {
                group.elements.forEach(element => element.remove());
                continue;
            }
            if (selectedPipLayout === 'fill') {
                const count = this.readPlaceholderPipCount(group.type, group.location, armor, structureTonnage, options);
                if (typeof count === 'number') {
                    const pipOptions: PipRenderOptions = {
                        ...options.pipOptions,
                        ...(group.type === 'shield-dc' || group.type === 'shield-da'
                            ? {
                                fill: options.pipOptions?.fill ?? '#fff',
                                shape: group.type === 'shield-da' ? 'diamond' : 'circle',
                            }
                            : {}),
                    };
                    const pips = FillPipRenderer.createPips(
                        group.areas.map(area => area.geometry),
                        count,
                        pipOptions,
                        group.type,
                        group.location,
                    );
                    if (pips) {
                        const zone = document.createElementNS(SVG_NAMESPACE, 'g');
                        zone.setAttribute('class', `biped-paperdoll-zone biped-paperdoll-zone-${group.location} biped-paperdoll-zone-${group.type}`);
                        zone.setAttribute('data-location', group.location);
                        zone.setAttribute('data-zone-type', group.type);
                        zone.setAttribute('data-layout', 'fill');
                        zone.appendChild(pips);
                        group.parent.appendChild(zone);
                        fillKeys.add(key);
                    }
                }
            }
            group.elements.forEach(element => element.remove());
        }

        const shieldPipLayout = selectedPipLayout === 'canon' ? 'distributed' : selectedPipLayout;
        for (const group of shieldGroups) {
            const key = this.getPlaceholderKey(group.type, group.location);
            if (railKeys.has(key) || fillKeys.has(key)) {
                group.elements.forEach(element => element.remove());
                continue;
            }
            if (shieldPipLayout !== 'distributed' && shieldPipLayout !== 'generic') {
                group.elements.forEach(element => element.remove());
                continue;
            }
            const shieldValues = options.shieldValues?.[group.location as BipedShieldLocation];
            const count = group.type === 'shield-dc' ? shieldValues?.dc : shieldValues?.da;
            if (typeof count === 'number') {
                const pipOptions: PipRenderOptions = {
                    ...options.pipOptions,
                    fill: options.pipOptions?.fill ?? '#fff',
                    shape: group.type === 'shield-da' ? 'diamond' : 'circle',
                };
                const shieldBounds = shieldPipLayout === 'generic' ? this.getPipRowBounds(group.rows) : null;
                const pips = shieldPipLayout === 'generic'
                    ? shieldBounds
                        ? GenericPipRenderer.createPips(
                            count,
                            shieldBounds.maxX - shieldBounds.minX,
                            shieldBounds.maxY - shieldBounds.minY,
                            pipOptions,
                            group.type,
                            group.location,
                        )
                        : null
                    : DistributedPipRenderer.createPips(
                        group.rows,
                        count,
                        pipOptions,
                        group.type,
                        group.location,
                    );
                if (pips) {
                    const zone = document.createElementNS(SVG_NAMESPACE, 'g');
                    zone.setAttribute('class', `biped-paperdoll-zone biped-paperdoll-zone-${group.location} biped-paperdoll-zone-${group.type}`);
                    zone.setAttribute('data-location', group.location);
                    zone.setAttribute('data-zone-type', group.type);
                    if (shieldBounds) {
                        zone.setAttribute('transform', `translate(${shieldBounds.minX} ${shieldBounds.minY})`);
                        zone.setAttribute('data-layout', 'generic');
                    }
                    zone.appendChild(pips);
                    group.parent.appendChild(zone);
                }
            }
            group.elements.forEach(element => element.remove());
        }

        for (const group of groups) {
            const key = this.getPlaceholderKey(group.type, group.location);
            if (railKeys.has(key) || fillKeys.has(key)) {
                group.elements.forEach(element => element.remove());
                continue;
            }
            const pips = this.createPlaceholderPips(group, type, armor, structureTonnage, options);
            if (pips) {
                const zone = document.createElementNS(SVG_NAMESPACE, 'g');
                zone.setAttribute('class', `biped-paperdoll-zone biped-paperdoll-zone-${group.location} biped-paperdoll-zone-${group.type}`);
                zone.setAttribute('data-location', group.location);
                zone.setAttribute('data-zone-type', group.type);
                zone.setAttribute('transform', `translate(${group.bounds.minX} ${group.bounds.minY})`);
                zone.appendChild(pips);
                group.parent.appendChild(zone);
            }
            group.elements.forEach(element => element.remove());
        }

        placeholders.forEach(element => {
            element.removeAttribute('data-placeholder');
            element.removeAttribute('data-rail');
            element.removeAttribute('data-fill');
            element.removeAttribute('data-location');
            element.removeAttribute('data-rail-index');
            element.removeAttribute('data-rail-capacity');
        });
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

        const pipOptions: PipRenderOptions = {
            ...options.pipOptions,
            ...(group.type === 'shield-dc' || group.type === 'shield-da'
                ? {
                    fill: options.pipOptions?.fill ?? '#fff',
                    shape: group.type === 'shield-da' ? 'diamond' as const : 'circle' as const,
                }
                : {}),
        };
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
            const zone = document.createElementNS(SVG_NAMESPACE, 'g');
            zone.setAttribute('class', `biped-paperdoll-zone biped-paperdoll-zone-${group.location} biped-paperdoll-zone-${group.type}`);
            zone.setAttribute('data-location', group.location);
            zone.setAttribute('data-zone-type', group.type);
            zone.setAttribute('data-layout', 'rail');
            if (item.transform) {
                zone.setAttribute('transform', item.transform);
            }
            zone.appendChild(item.pips);
            item.parent.appendChild(zone);
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
        return element.querySelector<SVGGeometryElement>('path, polygon, polyline');
    }

    private static isFillGeometry(element: SVGElement): element is SVGGeometryElement {
        const tagName = element.tagName.toLowerCase();
        return tagName === 'path' || tagName === 'polygon' || tagName === 'polyline';
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
        const placeholderType = element.getAttribute('data-placeholder');
        const type = railType ?? fillType ?? placeholderType;
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

    private static createPlaceholderPips(
        group: PlaceholderGroup,
        type: 'armor' | 'structure',
        armor: BipedArmorValues | undefined,
        structureTonnage: BipedStructureTonnage | undefined,
        options: BipedPaperdollLayerOptions,
    ): SVGGElement | null {
        const selectedPipLayout = options.pipLayout ?? 'canon';
        const primaryPips = this.createPlaceholderPipsForLayout(
            group,
            selectedPipLayout,
            armor,
            structureTonnage,
            options,
        );
        if (primaryPips || !options.fallbackPipLayout || options.fallbackPipLayout === selectedPipLayout) {
            return primaryPips;
        }
        return this.createPlaceholderPipsForLayout(
            group,
            options.fallbackPipLayout,
            armor,
            structureTonnage,
            options,
        );
    }

    private static createPlaceholderPipsForLayout(
        group: PlaceholderGroup,
        pipLayout: BipedPaperdollPipLayout,
        armor: BipedArmorValues | undefined,
        structureTonnage: BipedStructureTonnage | undefined,
        options: BipedPaperdollLayerOptions,
    ): SVGGElement | null {
        const width = group.bounds.maxX - group.bounds.minX;
        const height = group.bounds.maxY - group.bounds.minY;
        if (pipLayout === 'generic') {
            const count = this.readPlaceholderPipCount(group.type, group.location, armor, structureTonnage, options);
            return typeof count === 'number'
                ? GenericPipRenderer.createPips(count, width, height, options.pipOptions, group.type, group.location)
                : null;
        }
        if (pipLayout === 'distributed') {
            const count = this.readPlaceholderPipCount(group.type, group.location, armor, structureTonnage, options);
            return typeof count === 'number'
                ? this.createDistributedPlaceholderPips(group, count, options)
                : null;
        }
        if (pipLayout !== 'canon') {
            return null;
        }
        if (group.type === 'armor' && armor && typeof armor[group.location as BipedArmorLocation] === 'number') {
            const count = armor[group.location as BipedArmorLocation] as number;
            return CanonPipRenderer.createArmorPips(group.location, count, width, height, options.pipOptions);
        }
        const locationTonnage = this.getStructureTonnage(structureTonnage, group.location);
        if (group.type === 'structure' && typeof locationTonnage === 'number') {
            const count = CanonPipRenderer.getStructurePipCount(locationTonnage, group.location);
            return CanonPipRenderer.createStructurePips(locationTonnage, group.location, width, height, options.pipOptions);
        }
        return null;
    }

    private static createDistributedPlaceholderPips(
        group: PlaceholderGroup,
        count: number,
        options: BipedPaperdollLayerOptions,
    ): SVGGElement | null {
        const width = group.bounds.maxX - group.bounds.minX;
        const height = group.bounds.maxY - group.bounds.minY;
        return DistributedPipRenderer.createPips(
            [{ x: 0, y: 0, width, height }],
            count,
            options.pipOptions,
            group.type,
            group.location,
        );
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
