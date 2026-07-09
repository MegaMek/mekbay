import { CARD_LAYOUT_GEOMETRY } from './card-layout.geometry';

export const STANDARD_CARD_GEOMETRY = {
    viewBoxWidth: CARD_LAYOUT_GEOMETRY.viewBoxWidth,
    viewBoxHeight: CARD_LAYOUT_GEOMETRY.viewBoxHeight,
    contentLeft: CARD_LAYOUT_GEOMETRY.bodyInset,
    contentRight: CARD_LAYOUT_GEOMETRY.bodyRight,
    contentBottom: CARD_LAYOUT_GEOMETRY.bodyBottom,
    leftColumnRatio: 0.575,
    generalHeight: 119,
    damageHeight: 117,
    heatHeight: 66,
    armorHeight: 96,
    pipColumns: 14,
    pipRadius: 13,
    pipColumnWidth: 37,
    pipRowHeight: 37,
    pipFirstRowOffset: 23,
    specialsPaddingX: 14,
    specialsPaddingY: 14,
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

export function estimateRobotoCondensedWidth(text: string, fontSize: number, letterSpacingEm = 0.05): number {
    const glyphWidth = estimateRobotoWidth(text, fontSize) * 0.9;
    const letterSpacing = Math.max(0, text.length - 1) * fontSize * letterSpacingEm;
    return glyphWidth + letterSpacing;
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
    const usableColumnsWidth = contentWidth - CARD_LAYOUT_GEOMETRY.frameGap;
    const leftWidth = Math.round(usableColumnsWidth * geometry.leftColumnRatio);
    const rightX = geometry.contentLeft + leftWidth + CARD_LAYOUT_GEOMETRY.frameGap;
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
    const mainBottom = specials ? specials.y - CARD_LAYOUT_GEOMETRY.frameGap : geometry.contentBottom;

    const armorRows = Math.max(1, Math.ceil((input.armorPips ?? 0) / geometry.pipColumns));
    const structureRows = Math.max(1, Math.ceil((input.structurePips ?? 0) / geometry.pipColumns));
    const armorHeight = Math.max(
        geometry.armorHeight,
        14 + (armorRows + structureRows) * geometry.pipRowHeight,
    );

    let cursor = mainBottom;
    const armor: SvgFrameRect = {
        x: geometry.contentLeft,
        y: cursor - armorHeight,
        width: leftWidth,
        height: armorHeight,
    };
    cursor = armor.y - CARD_LAYOUT_GEOMETRY.frameGap;

    const heat = input.usesHeat
        ? {
            x: geometry.contentLeft,
            y: cursor - geometry.heatHeight,
            width: leftWidth,
            height: geometry.heatHeight,
        }
        : null;
    if (heat) cursor = heat.y - CARD_LAYOUT_GEOMETRY.frameGap;

    const damage: SvgFrameRect = {
        x: geometry.contentLeft,
        y: cursor - geometry.damageHeight,
        width: leftWidth,
        height: geometry.damageHeight,
    };
    cursor = damage.y - CARD_LAYOUT_GEOMETRY.frameGap;

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