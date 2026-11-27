// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { measureSvgTextCanvas } from '../../svg-text.util';
import { svgElement } from '../record-sheet-svg-rendering';

/** An aerospace inventory's location, heat and range-bracket columns, and the name width left beside them. */
export interface AeroValueColumns {
    readonly nameMaxWidth: number;
    readonly locationX: number;
    readonly locationMaxWidth: number;
    readonly heatX: number;
    readonly heatMaxWidth: number;
    readonly rangeX: readonly [number, number, number, number];
    readonly rangeMaxWidth: number;
}

const LOCATION_WIDTH = 21;
const HEAT_WIDTH = 12;
const RANGE_WIDTH = 16.312;
/** Where the range brackets end in the 222.4-wide templates: three points inside the frame. */
const RANGE_RIGHT = 222;
/** Between value columns, so centred values never run together. */
const COLUMN_GAP = 3;

/**
 * The value columns of the fighter, small craft and large-vessel front templates: the range brackets against the
 * frame, heat and location a gap before them, and the name column taking all the width from `nameX` up to two
 * points before the location.
 */
export function aeroValueColumns(nameX: number): AeroValueColumns {
    const [short, medium, long, extreme] = [3, 2, 1, 0].map(step => RANGE_RIGHT - RANGE_WIDTH / 2 - step * RANGE_WIDTH);
    const heatX = short - RANGE_WIDTH / 2 - COLUMN_GAP - HEAT_WIDTH / 2;
    const locationX = heatX - HEAT_WIDTH / 2 - COLUMN_GAP - LOCATION_WIDTH / 2;
    return Object.freeze({
        nameMaxWidth: locationX - LOCATION_WIDTH / 2 - 2 - nameX,
        locationX,
        locationMaxWidth: LOCATION_WIDTH,
        heatX,
        heatMaxWidth: HEAT_WIDTH,
        rangeX: [short, medium, long, extreme] as const,
        rangeMaxWidth: RANGE_WIDTH,
    });
}

/**
 * The template's columns, widened where a printed location, heat or damage value would wrap at `fontSize`.
 * The range, heat and location columns keep their right edge and grow leftwards, taking the extra width from
 * the name column, so each of those values prints on one line.
 */
export function fitAeroValueColumns<T extends AeroValueColumns>(
    columns: T,
    values: { readonly locations: readonly string[]; readonly heats: readonly string[]; readonly damage: readonly string[] },
    fontSize: number,
): T {
    const probe = svgElement('text');
    probe.setAttribute('font-size', String(fontSize));
    probe.setAttribute('font-family', 'Roboto, Arial, sans-serif');
    // A quarter point of room keeps the widest value clear of the wrap test's rounding.
    const extra = (texts: readonly string[], width: number) =>
        Math.max(0, ...texts.map(text => measureSvgTextCanvas(probe, text) + 0.25 - width));
    const range = extra(values.damage, columns.rangeMaxWidth);
    const heat = extra(values.heats, columns.heatMaxWidth);
    const location = extra(values.locations, columns.locationMaxWidth);
    const rangeGrowth = 4 * range;
    const [short, medium, long, extreme] = columns.rangeX;
    return {
        ...columns,
        rangeX: [short - 3.5 * range, medium - 2.5 * range, long - 1.5 * range, extreme - 0.5 * range],
        rangeMaxWidth: columns.rangeMaxWidth + range,
        heatX: columns.heatX - rangeGrowth - heat / 2,
        heatMaxWidth: columns.heatMaxWidth + heat,
        locationX: columns.locationX - rangeGrowth - heat - location / 2,
        locationMaxWidth: columns.locationMaxWidth + location,
        nameMaxWidth: columns.nameMaxWidth - rangeGrowth - heat - location,
    };
}
