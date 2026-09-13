// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { StaticEmplacementEntity } from '../../../models/entity/entities/misc/static-emplacement-entity';
import { buildingConnectedComponents, buildingHexKey, buildingNeighbors, type BuildingHex } from '../../../models/entity/types/building';
import { BUILDING_MAP_KEY, buildingDoorPoints, buildingMapDoors, buildingMapFeatures, buildingMapFill } from '../../building-map-presentation';
import { TABLETOP_HEX_CORNERS, TABLETOP_HEX_FLAT_TO_FLAT as FLAT_TO_FLAT, TABLETOP_HEX_RADIUS as RADIUS } from '../../tabletop-hex';
import type { RecordSheetPageProfile } from '../record-sheet-layout';
import { addLine, addText, createRoot, setAttributes, svgElement, type Box } from '../record-sheet-svg-rendering';

const PADDING = 18;
const CAPTION = 18;
const GAP = 12;
const CUT_SEARCH_STATES = 2000;
const centerX = (hex: BuildingHex) => 1.5 * RADIUS * hex.q;
const centerY = (hex: BuildingHex) => FLAT_TO_FLAT * (hex.r + hex.q / 2);

interface Floor {
    level: number;
    hexes: readonly BuildingHex[];
    bounds: Box;
    width: number;
    height: number;
    caption: string;
}

interface Placement { floor: Floor; x: number; y: number; caption: Box }
const hexOrder = (a: BuildingHex, b: BuildingHex) => centerX(a) - centerX(b) || centerY(a) - centerY(b);

function floorPlan(entity: StaticEmplacementEntity, level: number, hexes: readonly BuildingHex[], section = false): Floor {
    const xs = hexes.map(centerX), ys = hexes.map(centerY);
    const bounds = { x: Math.min(...xs) - RADIUS, y: Math.min(...ys) - FLAT_TO_FLAT / 2,
        width: Math.max(...xs) - Math.min(...xs) + 2 * RADIUS,
        height: Math.max(...ys) - Math.min(...ys) + FLAT_TO_FLAT };
    let caption = `Level: ${entity.levelLabel(level, true)}`;
    if (section) {
        const labels = hexes.map(hex => entity.displayHex(hex)).sort();
        caption += ` · ${labels[0]}${labels.length > 1 ? '–' + labels.at(-1) : ''}`;
    }
    return { level, hexes, bounds, caption, width: bounds.width + 2 * PADDING, height: bounds.height + 2 * PADDING };
}

/** Compare whole-floor cuts before packing: fewest connected pieces, then fewest severed hex edges. */
function splitFloor(entity: StaticEmplacementEntity, floor: Floor, width: number, height: number): Floor[] {
    if (placementIn([], floor, width, height, true)) return [floor];
    interface Plan { pieces: Floor[]; cuts: number }
    // Different cut sequences reach the same subset; evaluate each subset once for this floor only.
    const plans = new Map<string, Plan>();
    const solve = (hexes: BuildingHex[]): Plan => {
        hexes.sort(hexOrder);
        const key = hexes.map(buildingHexKey).join(';'), cached = plans.get(key);
        if (cached) return cached;
        const piece = floorPlan(entity, floor.level, hexes, true);
        let best: Plan;
        const components = buildingConnectedComponents(hexes);
        if (components.length > 1) {
            const children = components.map(solve);
            best = { pieces: children.flatMap(child => child.pieces), cuts: children.reduce((sum, child) => sum + child.cuts, 0) };
        } else if (placementIn([], piece, width, height, true)) best = { pieces: [piece], cuts: 0 };
        else {
            best = { pieces: hexes.map(hex => floorPlan(entity, floor.level, [hex], true)), cuts: Infinity };
            const wholeFloor = hexes.length === floor.hexes.length;
            let bestPages = Infinity;
            const columnsPerPiece = Math.floor((width - 2 * PADDING - 2 * RADIUS) / (1.5 * RADIUS)) + 1;
            const minimumPieces = Math.max(2, Math.ceil(new Set(hexes.map(hex => hex.q)).size / columnsPerPiece));
            // Beyond the local search budget, use full-page bands for subproblems; still compare all whole-floor cuts.
            const bounded = !wholeFloor && plans.size >= CUT_SEARCH_STATES;
            const horizontal = (hex: BuildingHex) => hex.q, vertical = (hex: BuildingHex) => 2 * hex.r + hex.q;
            const axes = bounded ? [piece.width > width ? horizontal : vertical]
                : [horizontal, vertical, (hex: BuildingHex) => hex.r, (hex: BuildingHex) => -hex.q - hex.r];
            search: for (const coordinate of axes) {
                const positions = [...new Set(hexes.map(coordinate))].sort((a, b) => a - b);
                let cutsToTry = positions.slice(0, -1).reverse();
                if (bounded) {
                    const span = coordinate === horizontal ? columnsPerPiece - 1 : (height - 2 * PADDING - FLAT_TO_FLAT) / (FLAT_TO_FLAT / 2);
                    cutsToTry = [cutsToTry.find(cut => cut <= positions[0] + span) ?? positions[0]];
                }
                for (const cut of cutsToTry) {
                    const left = hexes.filter(hex => coordinate(hex) <= cut), right = hexes.filter(hex => coordinate(hex) > cut);
                    const a = solve(left), b = solve(right);
                    const rightKeys = new Set(right.map(buildingHexKey));
                    const cuts = a.cuts + b.cuts + left.reduce((sum, hex) => sum + buildingNeighbors(hex)
                        .filter(neighbor => rightKeys.has(buildingHexKey(neighbor))).length, 0);
                    const pieces = [...a.pieces, ...b.pieces].sort((a, b) => hexOrder(a.hexes[0], b.hexes[0]));
                    if (pieces.length > best.pieces.length) continue;
                    const pages: Placement[][] = [];
                    if (wholeFloor) placeSections(pages, pieces, width, height);
                    const smallest = Math.min(...pieces.map(piece => piece.hexes.length));
                    const bestSmallest = Math.min(...best.pieces.map(piece => piece.hexes.length));
                    if (pieces.length < best.pieces.length || pages.length < bestPages
                        || pages.length === bestPages && (smallest > bestSmallest || smallest === bestSmallest && cuts < best.cuts)) {
                        best = { pieces, cuts };
                        bestPages = pages.length;
                    }
                    // A connected floor needs at least one severed edge per additional piece.
                    if (best.pieces.length === minimumPieces && best.cuts === minimumPieces - 1
                        && Math.min(...best.pieces.map(piece => piece.hexes.length)) === Math.floor(hexes.length / minimumPieces)
                        && (!wholeFloor || bestPages === 1)) break search;
                }
            }
        }
        plans.set(key, best);
        return best;
    };
    return solve([...floor.hexes]).pieces.sort((a, b) => hexOrder(a.hexes[0], b.hexes[0]));
}

function footprint(floor: Floor): Box[] {
    return floor.hexes.map(hex => ({
        x: -floor.bounds.x + centerX(hex) - RADIUS,
        y: -floor.bounds.y + centerY(hex) - FLAT_TO_FLAT / 2,
        width: 2 * RADIUS + 2 * PADDING, height: FLAT_TO_FLAT + 2 * PADDING,
    }));
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function occupied(placement: Placement): Box[] {
    return [...footprint(placement.floor), placement.caption].map(box => ({ ...box, x: box.x + placement.x, y: box.y + placement.y }));
}

/** Captions stay beside the outline, including empty corners, instead of taking a full-width header strip. */
function captionSpots(floor: Floor, ink: Box[]): Box[] {
    const width = Math.min(floor.width, floor.caption.length * 6);
    // Half a hex of extra clearance can clear the neighboring column's staggered edge.
    const spots = ink.flatMap(box => [GAP, GAP + FLAT_TO_FLAT / 2].flatMap(clearance => [
        { x: box.x + (box.width - width) / 2, y: box.y - CAPTION - clearance, width, height: CAPTION },
        { x: box.x - width - clearance, y: box.y, width, height: CAPTION },
        { x: box.x + box.width + clearance, y: box.y, width, height: CAPTION },
        { x: box.x + (box.width - width) / 2, y: box.y + box.height + clearance, width, height: CAPTION },
    ])).filter(box => !ink.some(hex => overlaps(box, hex)));
    return spots.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Search empty space around actual hexes and captions, keeping successive sections in reading order. */
function placementIn(page: Placement[], floor: Floor, width: number, height: number, firstFit = false): Placement | undefined {
    const previous = page.at(-1), other = page.flatMap(occupied), ink = footprint(floor);
    const maxX = width - floor.width, maxY = height - floor.height;
    if (maxX < 0 || maxY < 0) return undefined;
    const captions = captionSpots(floor, ink);
    const first = ink[0], bottom = Math.max(0, ...other.map(box => box.y + box.height));
    let best: Placement | undefined, bestScore = Infinity;
    // The page edges are candidates too, so the search does not lose a near-exact fit to its 12-point step.
    for (let y = previous?.y ?? 0; y <= maxY; y = y < maxY ? Math.min(y + GAP, maxY) : Infinity) {
        if (y + floor.height > bestScore) break;
        for (let x = 0; x <= maxX; x = x < maxX ? Math.min(x + GAP, maxX) : Infinity) {
            if (previous && y === previous.y && x < previous.x) continue;
            if (ink.some(box => other.some(rect => overlaps({ ...box, x: x + box.x, y: y + box.y }, rect)))) continue;
            for (const caption of captions) {
                const box = caption;
                const rect = { ...box, x: x + box.x, y: y + box.y };
                if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > width || rect.y + rect.height > height) continue;
                if (previous && (rect.y < previous.y + previous.caption.y
                    || rect.y === previous.y + previous.caption.y && rect.x < previous.x + previous.caption.x)) continue;
                if (other.some(ink => overlaps(rect, ink))) continue;
                if (firstFit) return { floor, x, y, caption };
                // Prefer compact placements with a caption near the start of the section, rather than at a remote tip.
                const distance = Math.abs(box.x + box.width / 2 - first.x - first.width / 2) + Math.abs(box.y - first.y);
                const score = Math.max(bottom, y + floor.height, rect.y + rect.height) + distance / 4;
                if (score < bestScore) { best = { floor, x, y, caption }; bestScore = score; }
            }
        }
    }
    return best;
}

function placeSections(pages: Placement[][], sections: Floor[], width: number, height: number): void {
    for (const floor of sections) {
        const placement = pages.length ? placementIn(pages.at(-1)!, floor, width, height) : undefined;
        if (placement) pages.at(-1)!.push(placement);
        else {
            const first = placementIn([], floor, width, height);
            if (!first) throw new Error('The template page must fit one full-size hex and its level caption');
            pages.push([first]);
        }
    }
}

function packFloors(entity: StaticEmplacementEntity, width: number, height: number): Placement[][] {
    const floors: Floor[] = [];
    for (const level of entity.mapLevels()) {
        const hexes = entity.coordinates().filter(hex => entity.occupiesMapLevel(hex, level) && entity.segmentsInHex(hex) > 0);
        if (hexes.length) floors.push(floorPlan(entity, level, hexes));
    }
    // Order complete floors by size; their sections stay in spatial order across pages.
    floors.sort((a, b) => b.height - a.height || b.width - a.width);
    const pages: Placement[][] = [];
    for (const floor of floors) {
        if (width < 2 * RADIUS + 2 * PADDING || height < FLAT_TO_FLAT + 2 * PADDING + CAPTION) {
            throw new Error('The template page must fit one full-size hex and its level caption');
        }
        placeSections(pages, splitFloor(entity, floor, width, height), width, height);
    }
    return pages.map(page => {
        const ink = page.flatMap(occupied);
        const left = Math.min(...ink.map(box => box.x)), top = Math.min(...ink.map(box => box.y));
        const right = Math.max(...ink.map(box => box.x + box.width)), bottom = Math.max(...ink.map(box => box.y + box.height));
        return page.map(p => ({ ...p, x: p.x + (width - right - left) / 2, y: p.y + (height - bottom - top) / 2 }));
    });
}

/** Clean, full-page tabletop templates, following the normal structure record sheets. */
export function buildingTemplatePages(entity: StaticEmplacementEntity, page: RecordSheetPageProfile): SVGSVGElement[] {
    const area = { x: page.margin, y: page.margin + 26, width: page.contentWidth, height: page.contentHeight - 26 };
    return packFloors(entity, area.width, area.height).map(placements => {
        const svg = createRoot(page.width, page.height, 'building-template');
        svg.setAttribute('data-mekbay-design-source', 'native');
        addText(svg, `${entity.displayName()} TEMPLATE`.toUpperCase(), page.width / 2, page.margin + 16,
            { size: 12, weight: 700, anchor: 'middle', maxWidth: page.contentWidth }).id = 'title';
        const region = svgElement('rect');
        setAttributes(region, { id: 'buildingTemplate', ...area, fill: 'none' });
        svg.appendChild(region);
        for (const placement of placements) drawFloor(svg, entity, placement, area);
        return svg;
    });
}

function drawFloor(svg: SVGSVGElement, entity: StaticEmplacementEntity, placement: Placement, area: Box): void {
    const { floor } = placement;
    const layer = svgElement('g');
    setAttributes(layer, { class: 'building-template-floor', 'data-building-floor': floor.level,
        transform: `translate(${area.x + placement.x} ${area.y + placement.y})` });
    svg.appendChild(layer);
    addText(layer, floor.caption, placement.caption.x + placement.caption.width / 2, placement.caption.y + 11,
        { size: 10, weight: 700, anchor: 'middle', maxWidth: placement.caption.width });
    const footprint = svgElement('g'), annotations = svgElement('g');
    const visibleHexes = new Set(floor.hexes.map(buildingHexKey));
    const footprintHexes = new Set(entity.coordinates().map(buildingHexKey));
    layer.append(footprint, annotations);
    const corners = TABLETOP_HEX_CORNERS;
    for (const hex of floor.hexes) {
        const x = PADDING - floor.bounds.x + centerX(hex);
        const y = PADDING - floor.bounds.y + centerY(hex);
        const features = buildingMapFeatures(entity, hex, floor.level);
        const points = (vertices: readonly (readonly number[])[]) => vertices.map(([dx, dy]) => `${x + dx},${y + dy}`).join(' ');
        const polygon = svgElement('polygon');
        setAttributes(polygon, { class: 'building-template-hex', 'data-building-hex': entity.displayHex(hex),
            points: points(corners), fill: buildingMapFill(features) ?? 'none',
            stroke: entity.usesHexsides() ? '#bbb' : '#000', 'stroke-width': entity.usesHexsides() ? .35 : .8 });
        footprint.appendChild(polygon);
        if (entity.usesHexsides()) for (let side = 0; side < 6; side++) {
            if (!entity.hasSide(hex, side)) continue;
            const a = corners[(side + 4) % 6], b = corners[(side + 5) % 6];
            addLine(annotations, x + a[0], y + a[1], x + b[0], y + b[1], '#000', 2)
                .setAttribute('data-building-side', String(side));
        }
        addText(annotations, entity.displayHex(hex), x, y + 4, { size: 12, anchor: 'middle' });
        const glyphs = features.map(symbol => BUILDING_MAP_KEY[symbol].glyph).filter(Boolean).join(' ');
        if (glyphs) addText(annotations, glyphs, x, y + 19, { size: 9, anchor: 'middle', weight: 700 });
        const doors = buildingMapDoors(entity, hex, floor.level, visibleHexes);
        buildingNeighbors(hex).forEach((neighbor, side) => {
            const key = buildingHexKey(neighbor);
            if (!footprintHexes.has(key) || visibleHexes.has(key) || !entity.occupiesMapLevel(neighbor, floor.level)
                || !entity.segmentsInHex(neighbor)) return;
            const marker = svgElement('g');
            setAttributes(marker, { class: 'building-template-continuation', 'data-continuation-from': entity.displayHex(hex),
                'data-continuation-to': entity.displayHex(neighbor), 'data-continuation-side': side, transform: `translate(${x} ${y})` });
            annotations.appendChild(marker);
            drawContinuation(marker, corners[(side + 4) % 6], corners[(side + 5) % 6], entity.displayHex(neighbor),
                doors.some(door => door.facing === side));
        });
        for (const door of doors) {
            const arrow = door.geometry ? door.geometry.arrow.map(([px, py]) => [px * RADIUS, py * RADIUS])
                : buildingDoorPoints(corners[(door.facing + 4) % 6], corners[(door.facing + 5) % 6]);
            if (door.geometry) {
                const opening = svgElement('polyline');
                setAttributes(opening, { class: 'linked-door-opening', fill: 'none', stroke: '#000', 'stroke-width': 3,
                    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
                    points: points(door.geometry.line.map(([px, py]) => [px * RADIUS, py * RADIUS])) });
                annotations.appendChild(opening);
            }
            const marker = svgElement('polygon');
            setAttributes(marker, { 'data-building-symbol': door.symbol, 'data-building-facing': door.facing,
                points: points(arrow), fill: BUILDING_MAP_KEY[door.symbol].color, stroke: '#000', 'stroke-width': .8 });
            annotations.appendChild(marker);
        }
    }
}

/** A cut edge and short ghost-hex corners fit within the existing 18-point clearance. */
function drawContinuation(marker: SVGGElement, a: readonly number[], b: readonly number[], destination: string, door: boolean): void {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / length, ty = (b[1] - a[1]) / length;
    const nx = mx / (FLAT_TO_FLAT / 2), ny = my / (FLAT_TO_FLAT / 2);
    addLine(marker, a[0], a[1], b[0], b[1], '#fff', 2.4);
    const ghost = svgElement('path');
    setAttributes(ghost, { fill: 'none', stroke: '#999', 'stroke-width': .8, 'stroke-dasharray': '3 2',
        d: `M ${a[0] + 12 * (nx * Math.sqrt(3) / 2 - tx / 2)} ${a[1] + 12 * (ny * Math.sqrt(3) / 2 - ty / 2)}`
            + ` L ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`
            + ` L ${b[0] + 12 * (nx * Math.sqrt(3) / 2 + tx / 2)} ${b[1] + 12 * (ny * Math.sqrt(3) / 2 + ty / 2)}` });
    marker.appendChild(ghost);
    // Keep a door/elevator arrow clear by moving the reference along the edge.
    const shift = door ? 16 : 0;
    let angle = Math.atan2(ty, tx) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const label = svgElement('g');
    setAttributes(label, { transform: `translate(${mx + 14 * nx + shift * tx} ${my + 14 * ny + shift * ty}) rotate(${angle})` });
    marker.appendChild(label);
    addText(label, `to ${destination}`, 0, 2, { size: 7, anchor: 'middle', fill: '#666', maxWidth: 28 });
}
