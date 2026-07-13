import fs from 'node:fs';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';

const {
    resolveMmDataRoot,
} = require('./lib/script-paths.js') as typeof import('./lib/script-paths.js');

interface Point {
    x: number;
    y: number;
}

interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface Matrix {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

type PaperdollType = 'armor' | 'structure';
type PaperdollSide = 'front' | 'back';
type PaperdollElementTag = 'line' | 'path' | 'polygon' | 'polyline' | 'rect' | 'text';
type PaperdollElementCategory = 'armor' | 'structure' | 'shield';
type PlaceholderType = 'armor' | 'structure' | 'shield-dc' | 'shield-da';

interface PaperdollElement {
    tag: PaperdollElementTag;
    attributes: Record<string, string>;
    transforms: string[];
    style?: string;
    location?: string;
    category: PaperdollElementCategory;
    rear: boolean;
    placeholder?: PlaceholderType;
    content?: string;
}

interface PaperdollAsset {
    type: PaperdollType;
    name: string;
    side: PaperdollSide;
    elements: PaperdollElement[];
    zones: Record<string, Bounds>;
    bounds: Bounds;
}

interface PaperdollGroup {
    type: PaperdollType;
    name: string;
    group: Record<string, unknown>;
}

interface LocatedGroup {
    group: Record<string, unknown>;
    transforms: readonly string[];
}

type PathToken =
    | { kind: 'command'; value: string }
    | { kind: 'number'; value: number };

const APP_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE_DIRECTORY = path.join(
    resolveMmDataRoot(APP_ROOT),
    'data',
    'images',
    'recordsheets',
    'templates_us',
);
const DEFAULT_OUTPUT_DIRECTORY = path.join(APP_ROOT, 'public', 'images', 'paperdolls' , 'raw');
const OUTPUT_DECIMAL_PLACES = 3;
const PLACEHOLDER_STROKE = '#e11d48';
const PLACEHOLDER_STROKE_WIDTH = '1.25';
const PLACEHOLDER_STROKE_DASHARRAY = '3 1.5';
const PATH_TOKEN_PATTERN = /([a-zA-Z])|([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)/gu;
const PRESENTATION_ATTRIBUTES = [
    'clip-path',
    'fill',
    'fill-opacity',
    'fill-rule',
    'opacity',
    'stroke',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-opacity',
    'stroke-width',
];
const ARMOR_FRONT_LOCATION_ORDER = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'];
const ARMOR_REAR_LOCATION_ORDER = ['CT_R', 'LT_R', 'RT_R'];
const STRUCTURE_LOCATION_ORDER = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'];
const REAR_COMPANION_IDS = new Set([
    'path56103',
    'path56621',
    'path56625',
    'path56629',
    'path3644',
    'path3648',
    'path4476',
    'path4480',
    'path4484',
    'path4107',
    'path4115',
    'path4123',
]);
const SHIELD_GROUPS = [
    { id: 'shieldRA', location: 'RA' },
    { id: 'shieldLA', location: 'LA' },
] as const;
const PAPERDOLL_GROUP_PATTERN = /^(armor|internal)_diagram_(.+)$/u;

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
});

function getOption(name: string): string | undefined {
    const optionIndex = process.argv.indexOf(name);
    if (optionIndex === -1) {
        return undefined;
    }

    const value = process.argv[optionIndex + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Expected a value after ${name}`);
    }

    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
    return typeof value[key] === 'string' ? value[key] : undefined;
}

function findPaperdollGroups(
    value: unknown,
    result: PaperdollGroup[] = [],
): PaperdollGroup[] {
    if (Array.isArray(value)) {
        for (const child of value) {
            findPaperdollGroups(child, result);
        }
        return result;
    }

    if (!isRecord(value)) {
        return result;
    }

    const id = getString(value, 'id');
    const match = id ? PAPERDOLL_GROUP_PATTERN.exec(id) : undefined;
    if (match) {
        result.push({
            type: match[1] === 'armor' ? 'armor' : 'structure',
            name: match[2],
            group: value,
        });
    }

    for (const child of Object.values(value)) {
        findPaperdollGroups(child, result);
    }
    return result;
}

function findByIdWithTransforms(
    value: unknown,
    id: string,
    transforms: readonly string[] = [],
): LocatedGroup | undefined {
    if (Array.isArray(value)) {
        for (const child of value) {
            const result = findByIdWithTransforms(child, id, transforms);
            if (result) {
                return result;
            }
        }
        return undefined;
    }

    if (!isRecord(value)) {
        return undefined;
    }

    if (getString(value, 'id') === id) {
        return { group: value, transforms };
    }

    const nextTransforms = getString(value, 'transform')
        ? [...transforms, getString(value, 'transform') as string]
        : transforms;
    for (const child of Object.values(value)) {
        const result = findByIdWithTransforms(child, id, nextTransforms);
        if (result) {
            return result;
        }
    }
    return undefined;
}

function round(value: number): number {
    const rounded = Number(value.toFixed(OUTPUT_DECIMAL_PLACES));
    return Object.is(rounded, -0) ? 0 : rounded;
}

function tokenizePath(pathData: string): PathToken[] {
    return [...pathData.matchAll(PATH_TOKEN_PATTERN)].map(match => match[1]
        ? { kind: 'command', value: match[1] }
        : { kind: 'number', value: Number(match[2]) });
}

function parsePathBounds(pathData: string): Bounds {
    const tokens = tokenizePath(pathData);
    const bounds: Bounds = {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
    };
    let tokenIndex = 0;
    let command = '';
    let current: Point = { x: 0, y: 0 };
    let subpathStart: Point = { x: 0, y: 0 };

    const addPoint = (point: Point): void => {
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.maxY = Math.max(bounds.maxY, point.y);
    };

    const readNumber = (): number => {
        const token = tokens[tokenIndex];
        if (!token || token.kind !== 'number') {
            throw new Error(`Invalid SVG path near token ${tokenIndex}`);
        }

        tokenIndex += 1;
        return token.value;
    };

    const relativePoint = (x: number, y: number, relative: boolean): Point => relative
        ? { x: current.x + x, y: current.y + y }
        : { x, y };

    while (tokenIndex < tokens.length) {
        const nextToken = tokens[tokenIndex];
        if (nextToken.kind === 'command') {
            command = nextToken.value;
            tokenIndex += 1;
            if (command.toUpperCase() === 'Z') {
                current = subpathStart;
                addPoint(current);
                command = '';
                continue;
            }
        }

        if (!command) {
            throw new Error(`SVG path has coordinates without a command near token ${tokenIndex}`);
        }

        const commandName = command.toUpperCase();
        const relative = command === command.toLowerCase();

        switch (commandName) {
            case 'M': {
                const point = relativePoint(readNumber(), readNumber(), relative);
                current = point;
                subpathStart = point;
                addPoint(point);
                command = relative ? 'l' : 'L';
                break;
            }
            case 'L': {
                const point = relativePoint(readNumber(), readNumber(), relative);
                current = point;
                addPoint(point);
                break;
            }
            case 'H': {
                const point = { x: relative ? current.x + readNumber() : readNumber(), y: current.y };
                current = point;
                addPoint(point);
                break;
            }
            case 'V': {
                const point = { x: current.x, y: relative ? current.y + readNumber() : readNumber() };
                current = point;
                addPoint(point);
                break;
            }
            case 'C': {
                const controlOne = relativePoint(readNumber(), readNumber(), relative);
                const controlTwo = relativePoint(readNumber(), readNumber(), relative);
                const point = relativePoint(readNumber(), readNumber(), relative);
                addPoint(controlOne);
                addPoint(controlTwo);
                addPoint(point);
                current = point;
                break;
            }
            case 'S': {
                const controlTwo = relativePoint(readNumber(), readNumber(), relative);
                const point = relativePoint(readNumber(), readNumber(), relative);
                addPoint(controlTwo);
                addPoint(point);
                current = point;
                break;
            }
            case 'Q': {
                const control = relativePoint(readNumber(), readNumber(), relative);
                const point = relativePoint(readNumber(), readNumber(), relative);
                addPoint(control);
                addPoint(point);
                current = point;
                break;
            }
            case 'T': {
                const point = relativePoint(readNumber(), readNumber(), relative);
                current = point;
                addPoint(point);
                break;
            }
            case 'A': {
                readNumber();
                readNumber();
                readNumber();
                readNumber();
                readNumber();
                const point = relativePoint(readNumber(), readNumber(), relative);
                current = point;
                addPoint(point);
                break;
            }
            default:
                throw new Error(`Unsupported SVG path command: ${command}`);
        }
    }

    if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
        throw new Error('SVG path has no coordinates');
    }

    return bounds;
}

function parsePointsBounds(points: string): Bounds {
    const values = [...points.matchAll(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/gu)].map(match => Number(match[0]));
    if (values.length < 2 || values.length % 2 !== 0) {
        throw new Error(`Invalid SVG polygon points: ${points}`);
    }

    const xValues = values.filter((_value, index) => index % 2 === 0);
    const yValues = values.filter((_value, index) => index % 2 === 1);
    return {
        minX: Math.min(...xValues),
        minY: Math.min(...yValues),
        maxX: Math.max(...xValues),
        maxY: Math.max(...yValues),
    };
}

function parseRectBounds(value: Record<string, unknown>): Bounds {
    const x = Number(getString(value, 'x') ?? 0);
    const y = Number(getString(value, 'y') ?? 0);
    const width = Number(getString(value, 'width') ?? 0);
    const height = Number(getString(value, 'height') ?? 0);
    return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

function identityMatrix(): Matrix {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
    return {
        a: left.a * right.a + left.c * right.b,
        b: left.b * right.a + left.d * right.b,
        c: left.a * right.c + left.c * right.d,
        d: left.b * right.c + left.d * right.d,
        e: left.a * right.e + left.c * right.f + left.e,
        f: left.b * right.e + left.d * right.f + left.f,
    };
}

function parseTransform(transform: string): Matrix {
    const transformPattern = /([a-z]+)\s*\(([^)]*)\)/giu;
    let result = identityMatrix();
    for (const match of transform.matchAll(transformPattern)) {
        const values = [...match[2].matchAll(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/gu)].map(value => Number(value[0]));
        const name = match[1].toLowerCase();
        let operation = identityMatrix();
        switch (name) {
            case 'matrix':
                if (values.length !== 6) {
                    throw new Error(`Invalid matrix transform: ${transform}`);
                }
                operation = { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] };
                break;
            case 'translate':
                operation.e = values[0] ?? 0;
                operation.f = values[1] ?? 0;
                break;
            case 'scale':
                operation.a = values[0] ?? 1;
                operation.d = values[1] ?? operation.a;
                break;
            case 'rotate': {
                const angle = (values[0] ?? 0) * Math.PI / 180;
                const rotation: Matrix = {
                    a: Math.cos(angle),
                    b: Math.sin(angle),
                    c: -Math.sin(angle),
                    d: Math.cos(angle),
                    e: 0,
                    f: 0,
                };
                if (values.length >= 3) {
                    const center = { a: 1, b: 0, c: 0, d: 1, e: values[1], f: values[2] };
                    const inverseCenter = { a: 1, b: 0, c: 0, d: 1, e: -values[1], f: -values[2] };
                    operation = multiplyMatrices(multiplyMatrices(center, rotation), inverseCenter);
                } else {
                    operation = rotation;
                }
                break;
            }
            case 'skewx':
                operation.c = Math.tan((values[0] ?? 0) * Math.PI / 180);
                break;
            case 'skewy':
                operation.b = Math.tan((values[0] ?? 0) * Math.PI / 180);
                break;
            default:
                throw new Error(`Unsupported SVG transform: ${name}`);
        }
        result = multiplyMatrices(result, operation);
    }
    return result;
}

function combineTransforms(transforms: readonly string[]): Matrix {
    return transforms.reduce((result, transform) => multiplyMatrices(result, parseTransform(transform)), identityMatrix());
}

function transformPoint(point: Point, matrix: Matrix): Point {
    return {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
    };
}

function transformBounds(bounds: Bounds, matrix: Matrix): Bounds {
    const points = [
        transformPoint({ x: bounds.minX, y: bounds.minY }, matrix),
        transformPoint({ x: bounds.minX, y: bounds.maxY }, matrix),
        transformPoint({ x: bounds.maxX, y: bounds.minY }, matrix),
        transformPoint({ x: bounds.maxX, y: bounds.maxY }, matrix),
    ];
    return {
        minX: Math.min(...points.map(point => point.x)),
        minY: Math.min(...points.map(point => point.y)),
        maxX: Math.max(...points.map(point => point.x)),
        maxY: Math.max(...points.map(point => point.y)),
    };
}

function mergeBounds(current: Bounds | undefined, next: Bounds): Bounds {
    return current
        ? {
            minX: Math.min(current.minX, next.minX),
            minY: Math.min(current.minY, next.minY),
            maxX: Math.max(current.maxX, next.maxX),
            maxY: Math.max(current.maxY, next.maxY),
        }
        : next;
}

function isHidden(value: Record<string, unknown>, inheritedHidden: boolean): boolean {
    if (inheritedHidden || getString(value, 'visibility') === 'hidden') {
        return true;
    }

    return getString(value, 'style')?.replaceAll(' ', '').includes('visibility:hidden') ?? false;
}

function mergeStyle(parent: string | undefined, child: string | undefined): string | undefined {
    if (!parent) {
        return child;
    }
    if (!child) {
        return parent;
    }
    return `${parent};${child}`;
}

function getShieldPlaceholder(id: string | undefined): { type: 'shield-dc' | 'shield-da'; location: 'LA' | 'RA' } | undefined {
    if (!id) {
        return undefined;
    }

    const match = /shield(DC|DA)(LA|RA)/u.exec(id);
    return match
        ? { type: match[1] === 'DC' ? 'shield-dc' : 'shield-da', location: match[2] as 'LA' | 'RA' }
        : undefined;
}

function sanitizeIdPart(value: string): string {
    const sanitized = value.replaceAll(/[^A-Za-z0-9_.-]/gu, '-');
    return sanitized || 'element';
}

function getTurretVariant(sourceFile: string): 'turret' | 'dualturret' | undefined {
    const sourceName = path.basename(sourceFile, path.extname(sourceFile));
    if (/(^|_)dualturret(_|$)/u.test(sourceName)) {
        return 'dualturret';
    }
    if (/(^|_)turret(_|$)/u.test(sourceName)) {
        return 'turret';
    }
    return undefined;
}

function getPaperdollName(group: PaperdollGroup, sourceFile: string): string {
    const turretVariant = getTurretVariant(sourceFile);
    const name = turretVariant && group.name.includes('noturret')
        ? group.name.replace('noturret', turretVariant)
        : group.name;
    return sanitizeIdPart(name).replaceAll('_', '-');
}

function createArtworkId(type: PaperdollType, location: string, sourceId: string | undefined, index: number): string {
    return `paperdoll-art-${type}-${location}-${sanitizeIdPart(sourceId ?? `element-${index}`)}`;
}

function isRearContext(id: string | undefined): boolean {
    return id === 'rearArmor' || (id !== undefined && REAR_COMPANION_IDS.has(id));
}

function collectElements(
    value: unknown,
    transforms: readonly string[],
    inheritedHidden: boolean,
    inheritedStyle: string | undefined,
    inheritedAttributes: Readonly<Record<string, string>>,
    inheritedLocation: string | undefined,
    inheritedUnitLocation: boolean,
    inheritedRear: boolean,
    category: PaperdollElementCategory,
    result: PaperdollElement[],
    includeHidden: boolean,
    inheritedPlaceholder: { type: 'shield-dc' | 'shield-da'; location: 'LA' | 'RA' } | undefined,
    elementTag: PaperdollElementTag | undefined,
): void {
    if (Array.isArray(value)) {
        for (const child of value) {
            collectElements(child, transforms, inheritedHidden, inheritedStyle, inheritedAttributes, inheritedLocation, inheritedUnitLocation, inheritedRear, category, result, includeHidden, inheritedPlaceholder, elementTag);
        }
        return;
    }

    if (!isRecord(value)) {
        return;
    }

    const hidden = isHidden(value, inheritedHidden);
    if (hidden && !includeHidden) {
        return;
    }

    const nextTransforms = getString(value, 'transform')
        ? [...transforms, getString(value, 'transform') as string]
        : transforms;
    const nextStyle = mergeStyle(inheritedStyle, getString(value, 'style'));
    const className = getString(value, 'class') ?? '';
    const nextLocation = getString(value, 'loc') ?? getString(value, 'lod') ?? inheritedLocation;
    const nextUnitLocation = inheritedUnitLocation || className.split(/\s+/u).includes('unitLocation');
    const nextRear = inheritedRear || getString(value, 'rear') === '1' || isRearContext(getString(value, 'id'));
    const nextPlaceholder = getShieldPlaceholder(getString(value, 'id')) ?? inheritedPlaceholder;
    const nextAttributes: Record<string, string> = { ...inheritedAttributes };
    for (const attribute of PRESENTATION_ATTRIBUTES) {
        const attributeValue = getString(value, attribute);
        if (attributeValue !== undefined) {
            nextAttributes[attribute] = attributeValue;
        }
    }

    const sourceAttributes: Record<string, string> = { ...nextAttributes };
    for (const attribute of ['class', 'id', 'loc', 'rear']) {
        const attributeValue = getString(value, attribute);
        if (attributeValue !== undefined) {
            sourceAttributes[attribute] = attributeValue;
        }
    }

    const sourceLocation = nextLocation && nextUnitLocation
        ? (nextRear ? `${nextLocation}_R` : nextLocation)
        : undefined;
    const textContent = getString(value, '#text');
    const pathData = getString(value, 'd');
    const polygonPoints = getString(value, 'points');
    const isLine = elementTag === 'line'
        && ['x1', 'y1', 'x2', 'y2'].every(attribute => getString(value, attribute) !== undefined);
    const isRect = ['x', 'y', 'width', 'height'].every(attribute => getString(value, attribute) !== undefined);
    const isShieldText = category === 'shield' && textContent !== undefined;
    if (pathData !== undefined || polygonPoints !== undefined || isLine || isRect || isShieldText) {
        const placeholder = isRect && nextPlaceholder ? nextPlaceholder.type : undefined;
        const location = placeholder ? nextPlaceholder?.location : sourceLocation;
        if (isShieldText) {
            for (const attribute of ['x', 'y', 'dx', 'dy', 'text-anchor', 'lengthAdjust', 'textLength']) {
                const attributeValue = getString(value, attribute);
                if (attributeValue !== undefined) {
                    sourceAttributes[attribute] = attributeValue;
                }
            }
        } else if (pathData !== undefined) {
            sourceAttributes.d = pathData;
        } else if (polygonPoints !== undefined) {
            sourceAttributes.points = polygonPoints;
        } else if (isLine) {
            for (const attribute of ['x1', 'y1', 'x2', 'y2']) {
                const attributeValue = getString(value, attribute);
                if (attributeValue !== undefined) {
                    sourceAttributes[attribute] = attributeValue;
                }
            }
        } else {
            for (const attribute of ['x', 'y', 'width', 'height', 'rx', 'ry']) {
                const attributeValue = getString(value, attribute);
                if (attributeValue !== undefined) {
                    sourceAttributes[attribute] = attributeValue;
                }
            }
        }
        if (placeholder) {
            if (location) {
                sourceAttributes[category === 'shield' ? 'data-fill' : 'data-canon'] = placeholder;
                sourceAttributes['data-location'] = location;
                delete sourceAttributes.id;
            }
            sourceAttributes.fill = 'none';
            sourceAttributes.stroke = PLACEHOLDER_STROKE;
            sourceAttributes['stroke-width'] = PLACEHOLDER_STROKE_WIDTH;
            sourceAttributes['stroke-dasharray'] = PLACEHOLDER_STROKE_DASHARRAY;
            sourceAttributes['stroke-opacity'] = '0.9';
        }
        result.push({
            tag: isShieldText
                ? 'text'
                : pathData !== undefined
                    ? 'path'
                    : polygonPoints !== undefined
                        ? elementTag === 'polyline' ? 'polyline' : 'polygon'
                        : isLine ? 'line' : 'rect',
            attributes: sourceAttributes,
            transforms: [...nextTransforms],
            style: nextStyle,
            location,
            category,
            rear: nextRear,
            placeholder,
            content: isShieldText ? textContent : undefined,
        });
        return;
    }

    for (const [key, child] of Object.entries(value)) {
        const childElementTag = ['line', 'path', 'polygon', 'polyline', 'rect', 'text'].includes(key)
            ? key as PaperdollElementTag
            : undefined;
        collectElements(child, nextTransforms, includeHidden ? false : hidden, nextStyle, nextAttributes, nextLocation, nextUnitLocation, nextRear, category, result, includeHidden, nextPlaceholder, childElementTag);
    }
}

function getLocalBounds(element: PaperdollElement): Bounds {
    if (element.tag === 'path') {
        return parsePathBounds(element.attributes.d);
    }
    if (element.tag === 'polygon' || element.tag === 'polyline') {
        return parsePointsBounds(element.attributes.points);
    }
    if (element.tag === 'line') {
        const x1 = Number(element.attributes.x1);
        const y1 = Number(element.attributes.y1);
        const x2 = Number(element.attributes.x2);
        const y2 = Number(element.attributes.y2);
        return {
            minX: Math.min(x1, x2),
            minY: Math.min(y1, y2),
            maxX: Math.max(x1, x2),
            maxY: Math.max(y1, y2),
        };
    }
    if (element.tag === 'text') {
        const x = Number(element.attributes.x ?? 0);
        const y = Number(element.attributes.y ?? 0);
        return { minX: x, minY: y, maxX: x, maxY: y };
    }
    return parseRectBounds(element.attributes);
}

function getElementBounds(element: PaperdollElement): Bounds {
    return transformBounds(getLocalBounds(element), combineTransforms(element.transforms));
}

function createPlaceholder(location: string, bounds: Bounds, type: 'armor' | 'structure'): PaperdollElement {
    return {
        tag: 'rect',
        attributes: {
            x: round(bounds.minX).toString(),
            y: round(bounds.minY).toString(),
            width: round(bounds.maxX - bounds.minX).toString(),
            height: round(bounds.maxY - bounds.minY).toString(),
            fill: 'none',
            stroke: PLACEHOLDER_STROKE,
            'stroke-width': PLACEHOLDER_STROKE_WIDTH,
            'stroke-dasharray': PLACEHOLDER_STROKE_DASHARRAY,
            'stroke-opacity': '0.9',
            'data-canon': type,
            'data-location': location,
        },
        transforms: [],
        location,
        category: type,
        rear: location.endsWith('_R'),
        placeholder: type,
    };
}

function createAsset(
    type: PaperdollType,
    name: string,
    side: PaperdollSide,
    sourceGroup: Record<string, unknown>,
    shieldGroups: readonly LocatedGroup[],
): PaperdollAsset | undefined {
    const elements: PaperdollElement[] = [];
    collectElements(sourceGroup, [], false, undefined, {}, undefined, false, false, type, elements, false, undefined, undefined);
    if (side === 'front') {
        for (const shieldGroup of shieldGroups) {
            collectElements(shieldGroup.group, shieldGroup.transforms, false, undefined, {}, undefined, false, false, 'shield', elements, true, undefined, undefined);
        }
    }

    const sideElements = elements.filter(element => side === 'back' ? element.rear : !element.rear);
    if (sideElements.length === 0) {
        return undefined;
    }

    sideElements.forEach((element, index) => {
        if (element.category === type && element.location && !element.placeholder) {
            element.attributes.id = createArtworkId(type, element.location, element.attributes.id, index);
        }
    });

    const locationBounds = new Map<string, Bounds>();
    let bounds: Bounds | undefined;
    for (const element of sideElements) {
        const elementBounds = getElementBounds(element);
        bounds = mergeBounds(bounds, elementBounds);
        if (element.category === type && element.location && !element.placeholder) {
            locationBounds.set(element.location, mergeBounds(locationBounds.get(element.location), elementBounds));
        }
    }

    if (!bounds) {
        throw new Error(`Unable to determine bounds for ${type} paperdoll`);
    }

    const locationOrder = type === 'armor'
        ? side === 'back' ? ARMOR_REAR_LOCATION_ORDER : ARMOR_FRONT_LOCATION_ORDER
        : STRUCTURE_LOCATION_ORDER;
    const zones = Object.fromEntries(locationOrder
        .filter(location => locationBounds.has(location))
        .map(location => [location, locationBounds.get(location) as Bounds]));

    for (const location of locationOrder) {
        const zone = zones[location];
        if (zone) {
            sideElements.push(createPlaceholder(location, zone, type));
            bounds = mergeBounds(bounds, zone);
        }
    }

    return {
        type,
        name,
        side,
        elements: sideElements,
        zones,
        bounds,
    };
}

function escapeAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function serializeElement(element: PaperdollElement): string {
    const attributes = Object.entries(element.attributes)
        .filter(([name]) => name !== 'd' && name !== 'points')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
        .join('');
    const content = element.tag === 'path'
        ? `<path${attributes} d="${escapeAttribute(element.attributes.d)}"${element.style ? ` style="${escapeAttribute(element.style)}"` : ''} />`
        : element.tag === 'polygon'
            ? `<polygon${attributes} points="${escapeAttribute(element.attributes.points)}"${element.style ? ` style="${escapeAttribute(element.style)}"` : ''} />`
            : element.tag === 'polyline'
                ? `<polyline${attributes} points="${escapeAttribute(element.attributes.points)}"${element.style ? ` style="${escapeAttribute(element.style)}"` : ''} />`
                : element.tag === 'line'
                    ? `<line${attributes}${element.style ? ` style="${escapeAttribute(element.style)}"` : ''} />`
                    : element.tag === 'rect'
                        ? `<rect${attributes}${element.style ? ` style="${escapeAttribute(element.style)}"` : ''} />`
                        : `<text${attributes}${element.style ? ` style="${escapeAttribute(element.style)}"` : ''}>${escapeAttribute(element.content ?? '')}</text>`;

    return element.transforms.reduceRight((child, transform) => `<g transform="${escapeAttribute(transform.replaceAll(/\s+/gu, ' ').trim())}">${child}</g>`, content);
}

function getAssetSignature(asset: PaperdollAsset): string {
    const bounds = asset.bounds;
    const viewBox = `${round(bounds.minX)} ${round(bounds.minY)} ${round(bounds.maxX - bounds.minX)} ${round(bounds.maxY - bounds.minY)}`;
    const elements = asset.elements.map(element => {
        const attributes = { ...element.attributes };
        delete attributes.id;
        return serializeElement({ ...element, attributes });
    }).join('\n');
    return `${asset.type}|${asset.side}|${viewBox}|${elements}`;
}

function serializeAsset(asset: PaperdollAsset): string {
    const bounds = asset.bounds;
    const viewBox = `${round(bounds.minX)} ${round(bounds.minY)} ${round(bounds.maxX - bounds.minX)} ${round(bounds.maxY - bounds.minY)}`;
    const elements = asset.elements.map(serializeElement).join('\n    ');
    const sideLabel = asset.side === 'back' ? ' back' : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Editable MekBay ${escapeAttribute(asset.name)}${sideLabel} ${asset.type} paperdoll. Pink dashed rectangles mark pip areas and are removed at runtime. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${escapeAttribute(asset.name)}${sideLabel} ${asset.type} paperdoll">
    <g id="paperdoll-art-${asset.type}">
    ${elements}
    </g>
</svg>
`;
}

function getSourceFiles(sourceDirectory: string): string[] {
    return fs.readdirSync(sourceDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile()
            && entry.name.toLowerCase().endsWith('.svg')
            && !entry.name.toLowerCase().endsWith('_toheat.svg'))
        .map(entry => path.join(sourceDirectory, entry.name))
        .sort((left, right) => left.localeCompare(right));
}

function main(): void {
    const sourceFileOption = getOption('--source');
    const sourceDirectory = path.resolve(getOption('--source-dir') ?? DEFAULT_SOURCE_DIRECTORY);
    const sourceFiles = sourceFileOption
        ? [path.resolve(sourceFileOption)]
        : getSourceFiles(sourceDirectory);
    const outputDirectory = path.resolve(getOption('--output-dir') ?? DEFAULT_OUTPUT_DIRECTORY);
    const signatures = new Set<string>();
    const assets: Array<{ asset: PaperdollAsset; group: PaperdollGroup; sourceFile: string }> = [];
    let candidateCount = 0;
    let duplicateCount = 0;

    for (const sourceFile of sourceFiles) {
        const source = fs.readFileSync(sourceFile, 'utf8');
        const parsed = xmlParser.parse(source) as unknown;
        for (const paperdollGroup of findPaperdollGroups(parsed)) {
            candidateCount += 1;
            const paperdollName = getPaperdollName(paperdollGroup, sourceFile);
            const shieldGroups = paperdollGroup.type === 'armor'
                ? SHIELD_GROUPS
                    .map(({ id }) => findByIdWithTransforms(paperdollGroup.group, id))
                    .filter((group): group is LocatedGroup => !!group)
                : [];
            const sides: readonly PaperdollSide[] = paperdollGroup.type === 'armor'
                ? ['front', 'back']
                : ['front'];
            for (const side of sides) {
                const asset = createAsset(
                    paperdollGroup.type,
                    paperdollName,
                    side,
                    paperdollGroup.group,
                    shieldGroups,
                );
                if (!asset) {
                    continue;
                }

                const signature = getAssetSignature(asset);
                if (signatures.has(signature)) {
                    duplicateCount += 1;
                    continue;
                }

                signatures.add(signature);
                assets.push({ asset, group: paperdollGroup, sourceFile });
            }
        }
    }

    if (assets.length === 0) {
        throw new Error(`No paperdoll groups found in ${sourceFileOption ?? sourceDirectory}`);
    }

    fs.mkdirSync(outputDirectory, { recursive: true });
    const nameCounts = new Map<string, number>();
    for (const { asset, group, sourceFile } of assets) {
        const key = `${getPaperdollName(group, sourceFile)}-${asset.type}-${asset.side}`;
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }

    const nameIndexes = new Map<string, number>();
    const outputNames = new Set<string>();
    for (const { asset, group, sourceFile } of assets) {
        const key = `${getPaperdollName(group, sourceFile)}-${asset.type}-${asset.side}`;
        const nameIndex = nameIndexes.get(key) ?? 0;
        nameIndexes.set(key, nameIndex + 1);
        const groupName = getPaperdollName(group, sourceFile);
        const sourceName = sanitizeIdPart(path.basename(sourceFile, path.extname(sourceFile))).replaceAll('_', '-');
        const variantSuffix = nameCounts.get(key) === 1 || nameIndex === 0 ? '' : `-${sourceName}`;
        const sideSuffix = asset.side === 'back' ? '-back' : '';
        let outputName = `${groupName}-${asset.type}${sideSuffix}${variantSuffix}.svg`;
        let collisionIndex = 2;
        while (outputNames.has(outputName)) {
            outputName = `${groupName}-${asset.type}${variantSuffix}-${collisionIndex}.svg`;
            collisionIndex += 1;
        }
        outputNames.add(outputName);
        const outputFile = path.join(outputDirectory, outputName);
        fs.writeFileSync(outputFile, serializeAsset(asset), 'utf8');
    }

    console.log(`Generated ${assets.length} distinct paperdolls from ${candidateCount} groups at ${path.relative(APP_ROOT, outputDirectory)}`);
    console.log(`Skipped ${duplicateCount} duplicate paperdolls`);
}

main();
