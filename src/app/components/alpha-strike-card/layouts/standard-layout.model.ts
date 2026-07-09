export const STANDARD_CARD_GEOMETRY = {
    viewBoxWidth: 1120,
    viewBoxHeight: 800,
    contentLeft: 28,
    contentRight: 1092,
    contentBottom: 704,
    columnGap: 6,
    frameGap: 6,
    leftColumnRatio: 0.575,
    generalHeight: 96,
    damageHeight: 116,
    heatHeight: 58,
    armorHeight: 96,
    pipColumns: 16,
    pipRowHeight: 27,
    specialsPaddingX: 14,
    specialsPaddingY: 10,
    specialsFontSize: 30,
    specialsLineHeight: 34,
} as const;

export interface SvgFrameRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface StandardLayoutModel {
    general: SvgFrameRect;
    damage: SvgFrameRect;
    heat: SvgFrameRect | null;
    armor: SvgFrameRect;
    critical: SvgFrameRect | null;
    specials: SvgFrameRect | null;
    specialsLines: string[];
    mainTop: number;
    mainBottom: number;
}

export interface StandardLayoutInput {
    specialsText: string;
    usesHeat: boolean;
    hasCriticalTable: boolean;
    armorPips?: number;
    structurePips?: number;
    criticalHeight?: number;
    measureText?: (text: string, font: string) => number;
}

const DEFAULT_CRITICAL_HEIGHT = 222;

export function estimateRobotoWidth(text: string, fontSize: number): number {
    let units = 0;
    for (const character of text) {
        if (character === ' ') units += 0.25;
        else if (/[ilI1|.,:'`]/.test(character)) units += 0.28;
        else if (/[mwMW@%&]/.test(character)) units += 0.82;
        else if (/[A-Z0-9]/.test(character)) units += 0.58;
        else units += 0.48;
    }
    return units * fontSize;
}

export function wrapSvgText(
    text: string,
    maxWidth: number,
    fontSize: number,
    fontWeight = 900,
    measureText?: (text: string, font: string) => number,
): string[] {
    const normalized = text.trim().replace(/\s+/g, ' ');
    if (!normalized) return [];

    const font = `${fontWeight} ${fontSize}px Roboto`;
    const measure = (value: string): number => measureText?.(value, font)
        ?? estimateRobotoWidth(value, fontSize);
    const words = normalized.split(' ');
    const lines: string[] = [];
    let line = '';

    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (!line || measure(candidate) <= maxWidth) {
            line = candidate;
            continue;
        }
        lines.push(line);
        line = word;
    }
    if (line) lines.push(line);
    return lines;
}

export function buildStandardLayout(input: StandardLayoutInput): StandardLayoutModel {
    const geometry = STANDARD_CARD_GEOMETRY;
    const contentWidth = geometry.contentRight - geometry.contentLeft;
    const usableColumnsWidth = contentWidth - geometry.columnGap;
    const leftWidth = Math.round(usableColumnsWidth * geometry.leftColumnRatio);
    const rightX = geometry.contentLeft + leftWidth + geometry.columnGap;
    const rightWidth = geometry.contentRight - rightX;

    const specialsLines = wrapSvgText(
        input.specialsText,
        contentWidth - geometry.specialsPaddingX * 2,
        geometry.specialsFontSize,
        900,
        input.measureText,
    );
    const specialsHeight = specialsLines.length > 0
        ? geometry.specialsPaddingY * 2 + specialsLines.length * geometry.specialsLineHeight
        : 0;
    const specials = specialsHeight > 0
        ? {
            x: geometry.contentLeft,
            y: geometry.contentBottom - specialsHeight,
            width: contentWidth,
            height: specialsHeight,
        }
        : null;
    const mainBottom = specials ? specials.y - geometry.frameGap : geometry.contentBottom;

    const armorRows = Math.max(1, Math.ceil((input.armorPips ?? 0) / geometry.pipColumns));
    const structureRows = Math.max(1, Math.ceil((input.structurePips ?? 0) / geometry.pipColumns));
    const armorHeight = Math.max(
        geometry.armorHeight,
        20 + (armorRows + structureRows) * geometry.pipRowHeight,
    );

    let cursor = mainBottom;
    const armor: SvgFrameRect = {
        x: geometry.contentLeft,
        y: cursor - armorHeight,
        width: leftWidth,
        height: armorHeight,
    };
    cursor = armor.y - geometry.frameGap;

    const heat = input.usesHeat
        ? {
            x: geometry.contentLeft,
            y: cursor - geometry.heatHeight,
            width: leftWidth,
            height: geometry.heatHeight,
        }
        : null;
    if (heat) cursor = heat.y - geometry.frameGap;

    const damage: SvgFrameRect = {
        x: geometry.contentLeft,
        y: cursor - geometry.damageHeight,
        width: leftWidth,
        height: geometry.damageHeight,
    };
    cursor = damage.y - geometry.frameGap;

    const general: SvgFrameRect = {
        x: geometry.contentLeft,
        y: cursor - geometry.generalHeight,
        width: leftWidth,
        height: geometry.generalHeight,
    };
    const mainTop = general.y;

    const criticalHeight = input.criticalHeight ?? DEFAULT_CRITICAL_HEIGHT;
    const critical = input.hasCriticalTable
        ? {
            x: rightX,
            y: mainBottom - criticalHeight,
            width: rightWidth,
            height: criticalHeight,
        }
        : null;

    return {
        general,
        damage,
        heat,
        armor,
        critical,
        specials,
        specialsLines,
        mainTop,
        mainBottom,
    };
}

export interface StandardCriticalRow {
    key: string;
    name: string;
    maxPips: number;
    description: string;
}

export type StandardCriticalVariant = 'none' | 'mek' | 'vehicle' | 'protomek' | 'aerofighter' | 'emplacement';

export function getStandardCriticalRows(variant: StandardCriticalVariant): StandardCriticalRow[] {
    switch (variant) {
        case 'mek': return [
            { key: 'engine', name: 'ENGINE', maxPips: 2, description: '+1 Heat/Firing Weapons' },
            { key: 'fire-control', name: 'FIRE CONTROL', maxPips: 4, description: '+2 TN Each' },
            { key: 'mp', name: 'MP', maxPips: 4, description: '½ MV Each' },
            { key: 'weapons', name: 'WEAPONS', maxPips: 4, description: '-1 Damage Each' },
        ];
        case 'vehicle': return [
            { key: 'engine', name: 'ENGINE', maxPips: 2, description: '½ MV and Damage' },
            { key: 'fire-control', name: 'FIRE CONTROL', maxPips: 4, description: '+2 To-Hit Each' },
            { key: 'weapons', name: 'WEAPONS', maxPips: 4, description: '-1 Damage Each' },
        ];
        case 'protomek': return [
            { key: 'fire-control', name: 'FIRE CONTROL', maxPips: 4, description: '+2 To-Hit Each' },
            { key: 'mp', name: 'MP', maxPips: 4, description: '½ MV Each' },
            { key: 'weapons', name: 'WEAPONS', maxPips: 4, description: '-1 Damage Each' },
        ];
        case 'aerofighter': return [
            { key: 'engine', name: 'ENGINE', maxPips: 2, description: '½ THR (Minimum 1)' },
            { key: 'fire-control', name: 'FIRE CONTROL', maxPips: 4, description: '+2 To-Hit Each' },
            { key: 'weapons', name: 'WEAPONS', maxPips: 4, description: '-1 Damage Each' },
        ];
        case 'emplacement': return [
            { key: 'weapons', name: 'WEAPONS', maxPips: 4, description: '-1 Damage Each' },
        ];
        default: return [];
    }
}