import type { SvgFrameRect } from './standard-layout.model';

export const VESSEL_SPECIALS_GEOMETRY = {
    x: 556,
    width: 536,
    bottom: 696,
    paddingTop: 16,
    paddingBottom: 16,
    lineHeight: 34,
    textX: 570,
} as const;

export interface VesselSpecialsLayoutModel {
    frame: SvgFrameRect | null;
    lineCount: number;
    firstBaseline: number;
}

export function buildVesselSpecialsLayout(lineCount: number): VesselSpecialsLayoutModel {
    const normalizedLineCount = Math.max(0, Math.floor(lineCount));
    if (normalizedLineCount === 0) {
        return {
            frame: null,
            lineCount: 0,
            firstBaseline: VESSEL_SPECIALS_GEOMETRY.bottom,
        };
    }

    const height = VESSEL_SPECIALS_GEOMETRY.paddingTop
        + normalizedLineCount * VESSEL_SPECIALS_GEOMETRY.lineHeight
        + VESSEL_SPECIALS_GEOMETRY.paddingBottom;
    const y = VESSEL_SPECIALS_GEOMETRY.bottom - height;

    return {
        frame: {
            x: VESSEL_SPECIALS_GEOMETRY.x,
            y,
            width: VESSEL_SPECIALS_GEOMETRY.width,
            height,
        },
        lineCount: normalizedLineCount,
        firstBaseline: y + VESSEL_SPECIALS_GEOMETRY.paddingTop + VESSEL_SPECIALS_GEOMETRY.lineHeight - 6,
    };
}