// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  isCenterPanelTarget,
  isPointInCenterPanel,
  resolveCenterPanelCursorElements,
  resolveCenterPanelInteractiveElements,
  resolveCenterPanelTables,
} from './record-sheet-center-panel.util';

describe('record-sheet-center-panel', () => {
  it('uses center-overlapping tables as fallback targets when center geometry is hidden', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const center = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    center.id = 'fluffSinglePilot';
    center.style.display = 'none';
    center.getBoundingClientRect = () => rect(10, 20, 100, 80);
    const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    table.classList.add('referenceTable');
    table.getBoundingClientRect = () => rect(10, 20, 100, 80);
    svg.append(center, table);

    expect(resolveCenterPanelTables(svg)).toEqual([table]);
    expect(resolveCenterPanelInteractiveElements(svg)).toEqual([center, table]);
    expect(isPointInCenterPanel(svg, 50, 50)).toBeTrue();
  });

  it('returns all reference tables when a legacy sheet has no center marker', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    table.classList.add('referenceTable');
    svg.appendChild(table);

    expect(resolveCenterPanelTables(svg)).toEqual([table]);
    expect(resolveCenterPanelInteractiveElements(svg)).toEqual([table]);
  });

  it('recognizes foreignObject clicks without decorating its compositing layer', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img');
    foreignObject.id = 'fluff-image-fo';
    image.id = 'fluff-image-injected';
    foreignObject.appendChild(image);
    svg.appendChild(foreignObject);

    expect(resolveCenterPanelInteractiveElements(svg)).toEqual([foreignObject]);
    expect(resolveCenterPanelCursorElements(svg)).toEqual([]);
    expect(isCenterPanelTarget(svg, foreignObject)).toBeTrue();
    expect(isCenterPanelTarget(svg, image)).toBeTrue();
  });

  it('recognizes nested descendants but rejects unrelated SVG content', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const nestedPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const outside = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    table.classList.add('referenceTable');
    table.appendChild(nestedPath);
    svg.append(table, outside);

    expect(isCenterPanelTarget(svg, nestedPath)).toBeTrue();
    expect(isCenterPanelTarget(svg, table)).toBeTrue();
    expect(isCenterPanelTarget(svg, outside)).toBeFalse();
    expect(isCenterPanelTarget(svg, null)).toBeFalse();
  });

  it('does not treat an untransformed SVG bounding box as client coordinates', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    table.classList.add('referenceTable');
    table.getBoundingClientRect = () => rect(0, 0, 0, 0);
    table.getBBox = () => ({ x: 10, y: 20, width: 100, height: 80 } as DOMRect);
    table.getScreenCTM = () => null;
    svg.appendChild(table);

    expect(isPointInCenterPanel(svg, 50, 50)).toBeFalse();
  });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
}