import type { SvgFrameRect } from './standard-layout.model';
import { CARD_LAYOUT_GEOMETRY } from './card-layout.geometry';

const VESSEL_FRONT_LEFT_WIDTH = 520;
const VESSEL_FRONT_STATS_Y = 88;
const VESSEL_FRONT_STATS_HEIGHT = 62;

export const VESSEL_FRONT_GEOMETRY = {
    leftX: CARD_LAYOUT_GEOMETRY.bodyInset,
    leftWidth: VESSEL_FRONT_LEFT_WIDTH,
    rightX: CARD_LAYOUT_GEOMETRY.bodyInset + VESSEL_FRONT_LEFT_WIDTH + CARD_LAYOUT_GEOMETRY.frameGap,
    rightWidth: CARD_LAYOUT_GEOMETRY.bodyRight
        - (CARD_LAYOUT_GEOMETRY.bodyInset + VESSEL_FRONT_LEFT_WIDTH + CARD_LAYOUT_GEOMETRY.frameGap),
    statsY: VESSEL_FRONT_STATS_Y,
    statsHeight: VESSEL_FRONT_STATS_HEIGHT,
    secondRowY: VESSEL_FRONT_STATS_Y + VESSEL_FRONT_STATS_HEIGHT + CARD_LAYOUT_GEOMETRY.frameGap,
    damageHeight: 237,
    criticalY: VESSEL_FRONT_STATS_Y + VESSEL_FRONT_STATS_HEIGHT
        + CARD_LAYOUT_GEOMETRY.frameGap + 237 + CARD_LAYOUT_GEOMETRY.frameGap,
    criticalBottom: CARD_LAYOUT_GEOMETRY.bodyBottom,
    mainBottom: CARD_LAYOUT_GEOMETRY.bodyBottom,
} as const;

const VESSEL_REAR_NOTE_BASELINE_OFFSET = 22;
const VESSEL_REAR_NOTE_CLEARANCE = 34;
const VESSEL_REAR_TOP = 78;
const vesselRearNoteBaseline = CARD_LAYOUT_GEOMETRY.bodyBottom - VESSEL_REAR_NOTE_BASELINE_OFFSET;
const vesselRearFramesBottom = vesselRearNoteBaseline - VESSEL_REAR_NOTE_CLEARANCE;

export const VESSEL_REAR_GEOMETRY = {
    top: VESSEL_REAR_TOP,
    frameWidth: (CARD_LAYOUT_GEOMETRY.bodyWidth - CARD_LAYOUT_GEOMETRY.frameGap) / 2,
    frameHeight: (
        vesselRearFramesBottom - VESSEL_REAR_TOP - CARD_LAYOUT_GEOMETRY.frameGap
    ) / 2,
    noteBaseline: vesselRearNoteBaseline,
} as const;

export const VESSEL_SPECIALS_GEOMETRY = {
    x: VESSEL_FRONT_GEOMETRY.rightX,
    width: VESSEL_FRONT_GEOMETRY.rightWidth,
    bottom: VESSEL_FRONT_GEOMETRY.mainBottom,
    paddingTop: 16,
    paddingBottom: 16,
    lineHeight: 34,
    textX: VESSEL_FRONT_GEOMETRY.rightX + 14,
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