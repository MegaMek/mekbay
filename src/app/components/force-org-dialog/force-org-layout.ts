// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Canvas geometry for TO&E cards and the groups that contain them. */
export interface Rect { x: number; y: number; width: number; height: number }

export const GRID_SNAP_SIZE = 20;
export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 70;
export const GROUP_PADDING = 20;
export const GROUP_HEADER_HEIGHT = 60;
const COLLISION_EDGE_PADDING = 8;

export function snapToGrid(value: number): number {
    return Math.round(value / GRID_SNAP_SIZE) * GRID_SNAP_SIZE;
}

function snapDownToGrid(value: number): number {
    return Math.floor(value / GRID_SNAP_SIZE) * GRID_SNAP_SIZE;
}

export function snapUpToGrid(value: number): number {
    return Math.ceil(value / GRID_SNAP_SIZE) * GRID_SNAP_SIZE;
}

export function snapGroupXToGrid(value: number): number {
    return snapToGrid(value + GROUP_PADDING) - GROUP_PADDING;
}

export function snapGroupYToGrid(value: number): number {
    return snapToGrid(value + GROUP_HEADER_HEIGHT + GROUP_PADDING) - GROUP_HEADER_HEIGHT - GROUP_PADDING;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
    // Touching edges still collide: sibling cards need a visible gap.
    return !(a.x + a.width < b.x || b.x + b.width < a.x ||
             a.y + a.height < b.y || b.y + b.height < a.y);
}

export function getOverlapArea(a: Rect, b: Rect): number {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return width > 0 && height > 0 ? width * height : 0;
}

export function rectContainsPoint(rect: Rect, point: { x: number; y: number }): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width
        && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** The same padding/header bounds apply to live groups and drag previews. */
export function enclosingGroupBounds(children: readonly Rect[]): Rect | null {
    if (children.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
        minX = Math.min(minX, child.x);
        minY = Math.min(minY, child.y);
        maxX = Math.max(maxX, child.x + child.width);
        maxY = Math.max(maxY, child.y + child.height);
    }
    return {
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING - GROUP_HEADER_HEIGHT,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT,
    };
}

/** Find the nearest clear grid candidate; null means no move is needed or possible. */
export function resolveCollisionPosition(
    rect: Rect,
    obstacles: readonly Rect[],
    kind: 'force' | 'group',
): { x: number; y: number } | null {
    const paddedObstacles = obstacles.map(obstacle => ({
        x: obstacle.x - COLLISION_EDGE_PADDING,
        y: obstacle.y - COLLISION_EDGE_PADDING,
        width: obstacle.width + COLLISION_EDGE_PADDING * 2,
        height: obstacle.height + COLLISION_EDGE_PADDING * 2,
    }));
    if (!paddedObstacles.some(obstacle => rectsOverlap(rect, obstacle))) return null;

    const xCandidates = new Set<number>([rect.x]);
    const yCandidates = new Set<number>([rect.y]);
    const xGridOffset = kind === 'group' ? GROUP_PADDING : 0;
    const yGridOffset = kind === 'group' ? GROUP_HEADER_HEIGHT + GROUP_PADDING : 0;
    for (const obstacle of obstacles) {
        xCandidates.add(snapDownToGrid(obstacle.x - rect.width - COLLISION_EDGE_PADDING + xGridOffset) - xGridOffset);
        xCandidates.add(snapUpToGrid(obstacle.x + obstacle.width + COLLISION_EDGE_PADDING + xGridOffset) - xGridOffset);
        yCandidates.add(snapDownToGrid(obstacle.y - rect.height - COLLISION_EDGE_PADDING + yGridOffset) - yGridOffset);
        yCandidates.add(snapUpToGrid(obstacle.y + obstacle.height + COLLISION_EDGE_PADDING + yGridOffset) - yGridOffset);
    }

    let best: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    // Keep insertion order for equal distances, matching the stable ordering of
    // candidates around sibling edges without allocating and sorting their product.
    for (const x of xCandidates) {
        for (const y of yCandidates) {
            const distance = Math.abs(x - rect.x) + Math.abs(y - rect.y);
            if (distance >= bestDistance) continue;
            const candidate = { ...rect, x, y };
            if (paddedObstacles.some(obstacle => rectsOverlap(candidate, obstacle))) continue;
            best = { x, y };
            bestDistance = distance;
        }
    }
    return best;
}
