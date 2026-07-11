import { BipedPipUtil, type BipedPipRenderOptions, type BipedShieldPipRow } from './biped-pip.util';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ARMOR_ASSET_URL = '/images/paperdolls/biped-armor.svg';
const STRUCTURE_ASSET_URL = '/images/paperdolls/biped-structure.svg';
const ARMOR_LOCATIONS = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL', 'CT_R', 'LT_R', 'RT_R'] as const;
const STRUCTURE_LOCATIONS = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'] as const;
const SHIELD_LOCATIONS = ['LA', 'RA'] as const;
type PaperdollPlaceholderType = 'armor' | 'structure' | 'shield-dc' | 'shield-da';

export type BipedArmorLocation = typeof ARMOR_LOCATIONS[number];
export type BipedStructureLocation = typeof STRUCTURE_LOCATIONS[number];
export type BipedShieldLocation = typeof SHIELD_LOCATIONS[number];
export type BipedArmorValues = Readonly<Partial<Record<BipedArmorLocation, number>>>;

export interface BipedShieldLocationValues {
    readonly dc?: number;
    readonly da?: number;
}

export type BipedShieldValues = Readonly<Partial<Record<BipedShieldLocation, BipedShieldLocationValues>>>;

export interface BipedPaperdollLayerOptions {
    assetUrl?: string;
    className?: string;
    pipOptions?: BipedPipRenderOptions;
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
    rows: BipedShieldPipRow[];
    elements: SVGElement[];
}

export class BipedPaperdollUtil {
    private static readonly assetCache = new Map<string, Promise<SVGSVGElement>>();

    public static async createBipedPaperdoll(
        width: number,
        height: number,
        armor: BipedArmorValues,
        structureTonnage: number,
        options: BipedPaperdollOptions = {},
    ): Promise<SVGGElement> {
        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        group.setAttribute('class', options.className ?? 'biped-paperdoll');
        group.setAttribute('data-paperdoll-type', 'biped');
        group.setAttribute('data-paperdoll-width', width.toString());
        group.setAttribute('data-paperdoll-height', height.toString());

        const padding = Math.max(options.padding ?? 0, 0);
        const gap = Math.min(6, Math.max(width * 0.04, 0));
        const availableWidth = Math.max(width - padding * 2 - gap, 0);
        const availableHeight = Math.max(height - padding * 2, 0);
        const layout = options.layout ?? 'side-by-side';
        const armorOptions: BipedPaperdollLayerOptions = {
            ...options.armor,
            className: 'biped-paperdoll-armor',
            shieldValues: options.shields ?? options.armor?.shieldValues,
        };

        if (layout === 'stacked') {
            const armorHeight = Math.max((availableHeight - gap) * 0.64, 0);
            const structureHeight = Math.max(availableHeight - gap - armorHeight, 0);
            const armorLayer = await this.createArmorPaperdoll(availableWidth, armorHeight, armor, armorOptions);
            armorLayer.setAttribute('transform', `translate(${padding} ${padding})`);
            group.appendChild(armorLayer);

            const structureLayer = await this.createStructurePaperdoll(availableWidth, structureHeight, structureTonnage, {
                ...options.structure,
                className: 'biped-paperdoll-structure',
            });
            structureLayer.setAttribute('transform', `translate(${padding} ${padding + armorHeight + gap})`);
            group.appendChild(structureLayer);
        } else {
            const armorWidth = availableWidth * 0.58;
            const structureWidth = availableWidth - armorWidth;
            const armorLayer = await this.createArmorPaperdoll(armorWidth, availableHeight, armor, armorOptions);
            armorLayer.setAttribute('transform', `translate(${padding} ${padding})`);
            group.appendChild(armorLayer);

            const structureLayer = await this.createStructurePaperdoll(structureWidth, availableHeight, structureTonnage, {
                ...options.structure,
                className: 'biped-paperdoll-structure',
            });
            structureLayer.setAttribute('transform', `translate(${padding + armorWidth + gap} ${padding})`);
            group.appendChild(structureLayer);
        }

        return group;
    }

    public static createArmorPaperdoll(
        width: number,
        height: number,
        armor: BipedArmorValues,
        options: BipedPaperdollLayerOptions = {},
    ): Promise<SVGGElement> {
        return this.createLayer(options.assetUrl ?? ARMOR_ASSET_URL, 'armor', width, height, armor, undefined, options);
    }

    public static createStructurePaperdoll(
        width: number,
        height: number,
        tonnage: number,
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
        structureTonnage: number | undefined,
        options: BipedPaperdollLayerOptions,
    ): Promise<SVGGElement> {
        const source = await this.loadAsset(assetUrl);
        const viewBox = this.readViewBox(source);
        const layer = document.createElementNS(SVG_NAMESPACE, 'g');
        layer.setAttribute('class', options.className ?? `biped-paperdoll-${type}`);
        layer.setAttribute('data-paperdoll-type', type);
        layer.setAttribute('data-paperdoll-source', assetUrl);
        layer.setAttribute('data-paperdoll-width', width.toString());
        layer.setAttribute('data-paperdoll-height', height.toString());

        const padding = Math.max(options.pipOptions?.padding ?? 0, 0);
        const availableWidth = Math.max(width - padding * 2, 0);
        const availableHeight = Math.max(height - padding * 2, 0);
        const scale = Math.min(availableWidth / viewBox.width, availableHeight / viewBox.height);
        const renderedWidth = viewBox.width * scale;
        const renderedHeight = viewBox.height * scale;
        const offsetX = padding + (availableWidth - renderedWidth) / 2;
        const offsetY = padding + (availableHeight - renderedHeight) / 2;

        const fitGroup = document.createElementNS(SVG_NAMESPACE, 'g');
        fitGroup.setAttribute('transform', `translate(${offsetX} ${offsetY})`);
        layer.appendChild(fitGroup);

        const scaleGroup = document.createElementNS(SVG_NAMESPACE, 'g');
        scaleGroup.setAttribute('transform', `scale(${scale})`);
        fitGroup.appendChild(scaleGroup);

        const art = this.findArtRoot(source, type);
        const sourceGroup = document.createElementNS(SVG_NAMESPACE, 'g');
        sourceGroup.setAttribute('transform', `translate(${-viewBox.minX} ${-viewBox.minY})`);
        let importedArt = document.importNode(art, true) as SVGElement;
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
            return parsed.documentElement as unknown as SVGSVGElement;
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
            ...sourceGroup.querySelectorAll<SVGGraphicsElement>('[data-paperdoll-location]:not([data-paperdoll-placeholder])'),
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
        structureTonnage: number | undefined,
        options: BipedPaperdollLayerOptions,
    ): void {
        const placeholders = Array.from(sourceGroup.querySelectorAll<SVGElement>(
            '[id^="paperdoll-placeholder-"], [data-paperdoll-placeholder]',
        ));
        const groups: PlaceholderGroup[] = [];
        const shieldGroups: ShieldPlaceholderGroup[] = [];
        for (const element of placeholders) {
            const rectangles = element instanceof SVGRectElement
                ? [element]
                : Array.from(element.querySelectorAll<SVGRectElement>('rect'));
            const parent = element instanceof SVGRectElement
                ? element.parentNode instanceof SVGElement ? element.parentNode : null
                : element;
            const metadata = this.readPlaceholderMetadata(element);
            if (!parent || !metadata || rectangles.length === 0) {
                continue;
            }
            const { type: placeholderType, location } = metadata;

            const bounds = this.readRectBounds(element);
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
                for (const rectangle of rectangles) {
                    const rectangleBounds = this.readRectBounds(rectangle);
                    group.rows.push({
                        x: rectangleBounds.minX,
                        y: rectangleBounds.minY,
                        width: rectangleBounds.maxX - rectangleBounds.minX,
                        height: rectangleBounds.maxY - rectangleBounds.minY,
                    });
                    group.elements.push(rectangle);
                }
                continue;
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

        for (const group of shieldGroups) {
            const shieldValues = options.shieldValues?.[group.location as BipedShieldLocation];
            const count = group.type === 'shield-dc' ? shieldValues?.dc : shieldValues?.da;
            if (typeof count === 'number') {
                const pips = BipedPipUtil.createShieldPips(
                    group.rows,
                    count,
                    {
                        ...options.pipOptions,
                        fill: options.pipOptions?.fill ?? '#fff',
                        shape: group.type === 'shield-da' ? 'diamond' : 'circle',
                    },
                    group.type,
                    group.location,
                );
                if (pips) {
                    const zone = document.createElementNS(SVG_NAMESPACE, 'g');
                    zone.setAttribute('class', `biped-paperdoll-zone biped-paperdoll-zone-${group.location} biped-paperdoll-zone-${group.type}`);
                    zone.setAttribute('data-paperdoll-location', group.location);
                    zone.setAttribute('data-paperdoll-zone-type', group.type);
                    zone.appendChild(pips);
                    group.parent.appendChild(zone);
                }
            }
            group.elements.forEach(element => element.remove());
        }

        for (const group of groups) {
            const pips = this.createPlaceholderPips(group, type, armor, structureTonnage, options);
            if (pips) {
                const zone = document.createElementNS(SVG_NAMESPACE, 'g');
                zone.setAttribute('class', `biped-paperdoll-zone biped-paperdoll-zone-${group.location} biped-paperdoll-zone-${group.type}`);
                zone.setAttribute('data-paperdoll-location', group.location);
                zone.setAttribute('data-paperdoll-zone-type', group.type);
                zone.setAttribute('transform', `translate(${group.bounds.minX} ${group.bounds.minY})`);
                zone.appendChild(pips);
                group.parent.appendChild(zone);
            }
            group.elements.forEach(element => element.remove());
        }
    }

    private static findArtRoot(source: SVGSVGElement, type: 'armor' | 'structure'): SVGGElement | SVGSVGElement {
        return source.querySelector<SVGGElement>(`[id="paperdoll-art-${type}"]`)
            ?? source.querySelector<SVGGElement>(`[data-paperdoll-art="${type}"]`)
            ?? source;
    }

    private static readPlaceholderMetadata(element: SVGElement): { type: PaperdollPlaceholderType; location: string } | null {
        const idMatch = /^paperdoll-placeholder-(armor|structure|shield-dc|shield-da)-([A-Za-z_]+)(?:-\d+)?$/u.exec(element.getAttribute('id') ?? '');
        if (idMatch) {
            return { type: idMatch[1] as PaperdollPlaceholderType, location: idMatch[2].toUpperCase() };
        }

        const type = element.getAttribute('data-paperdoll-placeholder');
        const location = element.getAttribute('data-paperdoll-location');
        if (!this.isPlaceholderType(type) || !location) {
            return null;
        }
        return { type, location };
    }

    private static isPlaceholderType(value: string | null): value is PaperdollPlaceholderType {
        return value === 'armor' || value === 'structure' || value === 'shield-dc' || value === 'shield-da';
    }

    private static createPlaceholderPips(
        group: PlaceholderGroup,
        type: 'armor' | 'structure',
        armor: BipedArmorValues | undefined,
        structureTonnage: number | undefined,
        options: BipedPaperdollLayerOptions,
    ): SVGGElement | null {
        const width = group.bounds.maxX - group.bounds.minX;
        const height = group.bounds.maxY - group.bounds.minY;
        if (group.type === 'armor' && armor && typeof armor[group.location as BipedArmorLocation] === 'number') {
            const count = armor[group.location as BipedArmorLocation] as number;
            return BipedPipUtil.createCanonArmorPips(group.location, count, width, height, options.pipOptions);
        }
        if (group.type === 'structure' && typeof structureTonnage === 'number') {
            return BipedPipUtil.createCanonStructurePips(structureTonnage, group.location, width, height, options.pipOptions);
        }
        return null;
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
