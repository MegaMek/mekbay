// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { RECORD_SHEET_FONT } from './record-sheet-typography';

import { ATM_AMMO_PROFILES, MML_AMMO_PROFILES, type AmmoWeaponProfile } from '../../models/ammo-weapon-profile.model';
import { isCaseEquipment } from '../../models/case-equipment.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { CBTRuleset } from '../../models/cbt-ruleset.model';
import { asComponentId } from '../../models/entity/entity-identifiers';
import type { EntityDamageLocation, EntityMountedEquipment, EntityMountedWeapon, EntityTechBase } from '../../models/entity/types';
import type { WeaponEquipment } from '../../models/equipment.model';
import { isPpcCapacitorEquipment, PPC_CAPACITOR_HEAT_BONUS } from '../../models/ppc-capacitor.model';
import { laserInsulatorAdjustedHeat } from '../../models/laser-insulator.model';
import { isRiscLaserPulseModule, RISC_LASER_PULSE_HEAT_BONUS } from '../../models/risc-laser-mode.model';
import { isWeaponEnhancementEquipment } from '../../models/weapon-enhancement.model';
import { ppcCapacitorWeaponDamage, ppcCapacitorWeaponTypes } from '../../models/runtime/component-ppc-capacitor';
import { buildNonMekRuntimeIndex } from '../../models/runtime/non-mek-runtime-index';
import { systemDamagePresentation } from '../../models/runtime/system-damage-presentation';
import { recordSheetHeatEffects } from '../../models/runtime/heat-effect-presentation';
import { heatSinkTypeDissipation, type HeatSinkType } from '../../models/entity/types/heat-sink';
import { clusterHits } from '../cluster-hit-table';
import { formatEquipmentLocationCodes } from '../equipment-location-display.util';
import { resolveInventoryControlDamageText } from '../inventory-control-damage.util';
import { recordSheetAmmoName } from '../record-sheet-ammo.util';
import {
  defaultRecordSheetWeaponDamageText,
  formatRecordSheetWeaponDamageText,
} from '../record-sheet-weapon-info.util';
import type { PaperdollPipLayout } from './paperdoll-generator';
import { DistributedPipRenderer } from './distributed-pip-renderer';
import { GenericPipRenderer } from './generic-pip-renderer';
import { createPipShapeProfile } from './pip-shape-profile';
import { createBattleTechLogo, createCatalystGameLabsLogo } from './record-sheet-brand';
import {
  RECORD_SHEET_CONTENT_HEIGHT,
  RECORD_SHEET_CONTENT_WIDTH,
  type RecordSheetPageProfile,
} from './record-sheet-layout';
import { SvgFrameUtil } from './svg-frame.util';
import { measureSvgTextCanvas } from '../svg-text.util';
import recordSheetIntrinsicStyle from './styles/record-sheet-intrinsic.css' with { loader: 'text' };

const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

export function formatMovementWithMaximum(base: number, maximum: number): string {
  return maximum > base ? `${base} [${maximum}]` : String(base);
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CompactMastheadOptions {
  readonly titleLines: readonly string[];
  readonly drawIcon?: (parent: SVGGElement, box: Box, svg: SVGSVGElement) => void;
}

export function createRoot(width: number, height: number, kind: string): SVGSVGElement {
  const svg = svgElement('svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('xmlns:xlink', XLINK_NS);
  svg.setAttribute('width', formatNumber(width));
  svg.setAttribute('height', formatNumber(height));
  svg.setAttribute('viewBox', `0 0 ${formatNumber(width)} ${formatNumber(height)}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('class', 'mekbay-sheet');
  svg.setAttribute('data-mekbay-generated', '1');
  svg.setAttribute('data-mekbay-generator-version', '2');
  svg.setAttribute('data-mekbay-sheet-kind', kind);
  const defs = svgElement('defs');
  const nightFilter = svgElement('filter');
  nightFilter.id = 'mekbay-night-image-invert';
  nightFilter.setAttribute('color-interpolation-filters', 'sRGB');
  const componentTransfer = svgElement('feComponentTransfer');
  for (const channel of ['R', 'G', 'B'] as const) {
    const fn = svgElement(`feFunc${channel}`);
    fn.setAttribute('type', 'table');
    fn.setAttribute('tableValues', '1 0');
    componentTransfer.appendChild(fn);
  }
  nightFilter.appendChild(componentTransfer);
  defs.appendChild(nightFilter);
  svg.appendChild(defs);

  const background = svgElement('rect');
  setAttributes(background, { x: 0, y: 0, width, height, fill: 'none', class: 'record-sheet-background' });
  svg.appendChild(background);
  const style = svgElement('style');
  style.id = 'mekbay-svg-style';
  style.textContent = recordSheetIntrinsicStyle;
  svg.appendChild(style);
  return svg;
}

export function drawPageChrome(
  svg: SVGSVGElement,
  title: string,
  page: RecordSheetPageProfile,
  compact: boolean,
  compactOptions?: CompactMastheadOptions,
): void {
  const brand = svgElement('g');
  brand.setAttribute('class', 'record-sheet-masthead');
  const logoScale = 0.791 * page.horizontalScale;
  const logoY = page.margin;
  const logo = createBattleTechLogo();
  logo.setAttribute(
    'transform',
    `translate(${formatNumber(page.margin)} ${formatNumber(logoY)}) scale(${formatNumber(logoScale)})`,
  );
  brand.appendChild(logo);

  if (compact) {
    const calloutWidth = 184 * page.horizontalScale;
    const calloutHeight = 45.357 * page.verticalScale;
    const callout = SvgFrameUtil.createSVGFrame('', calloutWidth, calloutHeight, {
      showHeader: false,
      cornerAngleDegrees: 45,
    });
    callout.setAttribute('class', 'record-sheet-unit-title-frame');
    callout.setAttribute(
      'transform',
      `translate(${formatNumber(page.margin + 387 * page.horizontalScale)} ` +
        `${formatNumber(page.margin + 3 * page.verticalScale)})`,
    );
    const lines = compactOptions?.titleLines ?? [title];
    const titleX = 103.95 * page.horizontalScale;
    const firstY = (27.578 - (lines.length - 1) * 6.5) * page.verticalScale;
    lines.forEach((line, index) =>
      addText(callout, line, titleX, firstY + index * 13 * page.verticalScale, {
        size: 11.59 * Math.min(page.horizontalScale, page.verticalScale),
        weight: 700,
        anchor: 'middle',
        maxWidth: 124 * page.horizontalScale,
      }),
    );
    const icon = svgElement('g');
    compactOptions?.drawIcon?.(
      icon,
      {
        x: 12.841 * page.horizontalScale,
        y: 2 * page.verticalScale,
        width: 31.018 * page.horizontalScale,
        height: 41.357 * page.verticalScale,
      },
      svg,
    );
    if (icon.childElementCount > 0) {
      // PrintSmallUnitSheet uses the same editable-art box for unit fluff.
      setAttributes(icon, {
        'data-mekbay-masthead-art': '1',
        'data-mekbay-fluff-art': '1',
        'data-image-x': formatNumber(9.45 * page.horizontalScale),
        'data-image-y': formatNumber(2 * page.verticalScale),
        'data-image-width': formatNumber(37.8 * page.horizontalScale),
        'data-image-height': formatNumber(41.357 * page.verticalScale),
      });
      callout.appendChild(icon);
    }
    brand.appendChild(callout);
  } else {
    addText(brand, title, page.margin + 192 * page.horizontalScale, page.margin + 63.357 * page.horizontalScale, {
      size: 11.59 * page.horizontalScale,
      weight: 700,
      anchor: 'middle',
      maxWidth: 260 * page.horizontalScale,
    });
  }
  svg.appendChild(brand);
}

export function compactPageTitle(blocks: readonly SVGSVGElement[]): string {
  const titles = new Set(
    blocks
      .map((block) => block.getAttribute('data-mekbay-page-title'))
      .filter((title): title is string => title !== null && title.length > 0),
  );
  return titles.size === 1 ? [...titles][0] : 'CLASSIC BATTLETECH RECORD SHEET';
}

export function renumberCompactBlock(group: SVGGElement, expectedPrefix: string | null, number: number): void {
  if (expectedPrefix === null || expectedPrefix.length === 0) return;
  const title = Array.from(group.querySelectorAll<SVGTextElement>('.svg-frame-title')).find((node) =>
    node.textContent?.startsWith(expectedPrefix),
  );
  if (title) title.textContent = `${expectedPrefix}${number}`;
}

export function compactLocationLabel(value: string): string {
  return value
    .split('/')
    .map(
      (location) =>
        ({
          'Main Gun': 'MG',
          'Right Arm': 'RA',
          'Left Arm': 'LA',
          Torso: 'T',
          Legs: 'L',
          Head: 'HD',
          Body: 'BD',
        })[location] ?? location,
    )
    .join('/');
}

export function compactArmorDisplayName(value: string | undefined, fallback: string): string {
  const compact = (value ?? '')
    .replace(/\b(?:Battle Armor|BA|ProtoMech|ProtoMek)\b/giu, '')
    .replace(/\bArmor\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return compact || fallback;
}

export function drawCheckbox(
  parent: SVGElement,
  x: number,
  y: number,
  size: number,
  checked: boolean,
  className = 'record-sheet-checkbox',
): SVGRectElement {
  const box = svgElement('rect');
  setAttributes(box, {
    x,
    y,
    width: size,
    height: size,
    rx: Math.max(0.5, size * 0.12),
    fill: '#fff',
    stroke: '#111',
    'stroke-width': Math.max(0.45, size * 0.08),
    class: className,
  });
  parent.appendChild(box);
  if (checked) {
    const check = svgElement('path');
    check.setAttribute(
      'd',
      `M${formatNumber(x + size * 0.18)} ${formatNumber(y + size * 0.52)} l${formatNumber(size * 0.22)} ${formatNumber(size * 0.24)} l${formatNumber(size * 0.46)} -${formatNumber(size * 0.58)}`,
    );
    check.setAttribute('fill', 'none');
    check.setAttribute('stroke', '#111');
    check.setAttribute('stroke-width', formatNumber(Math.max(0.65, size * 0.12)));
    check.setAttribute('stroke-linecap', 'round');
    check.setAttribute('stroke-linejoin', 'round');
    parent.appendChild(check);
  }
  return box;
}

/**
 * A critical-damage box the binders toggle by `critId`, captioned with its modifier.
 * Templates differ only in the box geometry, the caption size and their drawing scale.
 */
export function drawCriticalDamageBox(
  parent: SVGElement,
  id: string,
  box: Box,
  modifier?: { readonly text: string | undefined; readonly size: number },
  scale = 1,
): SVGRectElement {
  const control = svgElement('rect');
  control.id = id;
  control.setAttribute('critId', id);
  setAttributes(control, {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rx: 1.315 * scale,
    fill: 'none',
    stroke: '#000',
    'stroke-width': 0.96,
    class: 'critLoc criticalPip',
  });
  parent.appendChild(control);
  if (modifier?.text) {
    addText(parent, modifier.text, box.x + box.width / 2, box.y + box.height / 2 + modifier.size * 0.36, {
      size: modifier.size,
      anchor: 'middle',
      maxWidth: box.width - 1.5 * scale,
    }).style.pointerEvents = 'none';
  }
  return control;
}

/** Marks the inventory heat line with the design's maximum heat, which binders keep while dissipation changes. */
export const HEAT_PROFILE_MAXIMUM_ATTRIBUTE = 'data-maximum-heat';

/** The inventory's heat line: the heat of firing every weapon, and the heat the unit dissipates. */
export function recordSheetHeatProfileText(heat: number | string, dissipation: number | string): string {
  return `Maximum Heat (Dissipation): ${heat} (${dissipation})`;
}

/** The inventory's heat line, as both generators print it and the binders rewrite it. */
export function markRecordSheetHeatProfile(text: SVGTextElement, heat: number): void {
  text.id = 'heatProfile';
  text.setAttribute(HEAT_PROFILE_MAXIMUM_ATTRIBUTE, String(heat));
}

/** The reference inventory sorts ground ranges descending, including aerospace units. */
export function recordSheetInventoryWeaponMounts(entity: BaseEntity): readonly EntityMountedWeapon[] {
  return [...entity.rangedWeapons()].sort((left, right) => {
    if (left.equipment.id === right.equipment.id) {
      if (left.rearMounted !== right.rearMounted) return left.rearMounted ? 1 : -1;
      return 0;
    }
    const leftRanges = recordSheetSortRanges(left.equipment);
    const rightRanges = recordSheetSortRanges(right.equipment);
    const rangeCount = Math.max(leftRanges.length, rightRanges.length);
    for (let index = 0; index < rangeCount; index++) {
      const delta = (rightRanges[index] ?? 0) - (leftRanges[index] ?? 0);
      if (delta !== 0) return delta;
    }
    return right.equipment.heat - left.equipment.heat;
  });
}

export function recordSheetInventoryWeapons(
  entity: BaseEntity,
  mergeIdentical = false,
): readonly {
  readonly name: string;
  readonly location: string;
  readonly heat: string;
  readonly damage: string;
  readonly minimumRange: string;
  readonly ranges: readonly string[];
  readonly componentIds: readonly string[];
  readonly quantity: number;
  readonly linkedEquipment: RecordSheetLinkedEquipment | null;
  readonly alternativeModes: readonly RecordSheetInventoryAlternativeMode[];
}[] {
  const unmerged = recordSheetInventoryWeaponMounts(entity).map((mount) => {
    const ammoModes = recordSheetAlternativeModes(mount.equipment);
    const enhancement = entity.getLinkingMount(mount);
    const semanticDamage = defaultRecordSheetWeaponDamageText(mount.equipment, entity.getEquipmentRegistry());
    return {
      name: mount.displayName(),
      location: formatEquipmentLocationCodes(mount.getOccupiedLocations()),
      heat: String(laserInsulatorAdjustedHeat(mount.equipment.heat, enhancement?.equipment, mount.equipment)),
      damage: ammoModes.length > 0 ? (semanticDamage.match(/\[[^\]]+\]\s*$/u)?.[0] ?? '') : semanticDamage,
      minimumRange:
        ammoModes.length > 0 ? '' : mount.equipment.minimumRange > 0 ? String(mount.equipment.minimumRange) : '—',
      ranges:
        ammoModes.length > 0
          ? Object.freeze(['', '', ''])
          : Object.freeze(
              recordSheetWeaponRanges(mount.equipment)
                .slice(0, 3)
                .map((value) => (value > 0 ? String(value) : '—')),
            ),
      componentIds: Object.freeze([mount.mountId]),
      quantity: 1,
      linkedEquipment: recordSheetLinkedEquipment(entity, mount, enhancement, semanticDamage),
      alternativeModes: ammoModes,
    };
  });
  if (!mergeIdentical) return Object.freeze(unmerged.map((row) => Object.freeze(row)));

  const rows = new Map<
    string,
    {
      name: string;
      location: string;
      heat: string;
      damage: string;
      minimumRange: string;
      ranges: readonly string[];
      componentIds: string[];
      quantity: number;
      linkedEquipment: RecordSheetLinkedEquipment | null;
      alternativeModes: readonly RecordSheetInventoryAlternativeMode[];
    }
  >();
  unmerged.forEach((row) => {
    const linked = row.linkedEquipment && { ...row.linkedEquipment, componentId: undefined };
    const key = JSON.stringify({ ...row, componentIds: undefined, linkedEquipment: linked });
    const existing = rows.get(key);
    if (existing) {
      existing.componentIds.push(...row.componentIds);
      existing.quantity += row.quantity;
    } else {
      rows.set(key, { ...row, componentIds: [...row.componentIds] });
    }
  });
  return Object.freeze(
    [...rows.values()].map((row) =>
      Object.freeze({
        ...row,
        componentIds: Object.freeze([...row.componentIds]),
      }),
    ),
  );
}

export interface RecordSheetInventoryAlternativeMode {
  readonly name: string;
  readonly heat?: string;
  readonly damage: string;
  readonly minimumRange: string;
  readonly ranges: readonly [string, string, string];
}

/** The weapon enhancement printed on its own line under the weapon it is linked to. */
export interface RecordSheetLinkedEquipment {
  /** The enhancement's own mount, so bound sheets show its damage and hover with its slots. */
  readonly componentId: string;
  readonly name: string;
  readonly heat: string;
  readonly damage: string;
}

/**
 * The line for the weapon enhancement linked to a weapon (Artemis, Apollo, PPC Capacitor, RISC Laser Pulse Module,
 * Laser Insulator), labelled like the equipment panel's modifier. Enhancements that add a firing profile print its
 * heat and damage; the others only name themselves.
 */
function recordSheetLinkedEquipment(
  entity: BaseEntity,
  mount: EntityMountedWeapon,
  linking: EntityMountedEquipment | undefined,
  semanticDamage: string,
): RecordSheetLinkedEquipment | null {
  const enhancement = linking?.equipment;
  if (!linking || !enhancement || !isWeaponEnhancementEquipment(enhancement)) return null;
  const weapon = mount.equipment;
  const line = { componentId: linking.mountId, name: enhancement.shortName || enhancement.name } as const;
  if (isPpcCapacitorEquipment(enhancement)) {
    const damage = resolveInventoryControlDamageText(
      { componentId: asComponentId(mount.mountId), physical: false, weapon },
      {
        selectedRange: null,
        selectedAmmo: null,
        equipmentCatalog: entity.getEquipmentRegistry(),
        damageOverride: ppcCapacitorWeaponDamage(weapon.damage, true),
      },
      { applyWeaponTypes: (_id, types) => ppcCapacitorWeaponTypes(types, true) },
    );
    return Object.freeze({
      ...line,
      heat: String(weapon.heat + PPC_CAPACITOR_HEAT_BONUS),
      damage: formatRecordSheetWeaponDamageText(weapon, damage ?? semanticDamage),
    });
  }
  if (isRiscLaserPulseModule(enhancement)) {
    return Object.freeze({ ...line, heat: String(weapon.heat + RISC_LASER_PULSE_HEAT_BONUS), damage: '' });
  }
  return Object.freeze({ ...line, heat: '—', damage: '' });
}

function recordSheetSortRanges(weapon: WeaponEquipment): readonly number[] {
  const profiles = recordSheetAmmoProfiles(weapon);
  return profiles.length === 0
    ? weapon.ranges
    : profiles.reduce<readonly number[]>(
        (best, profile) => (profile.ranges[2] > (best[2] ?? 0) ? profile.ranges : best),
        weapon.ranges,
      );
}

/** Matches MegaMekLab's StandardInventoryEntry range choice for torpedo launchers. */
function recordSheetWeaponRanges(weapon: WeaponEquipment): readonly number[] {
  return weapon.ammoType.includes('TORPEDO') ? weapon.weapon.wRanges : weapon.ranges;
}

function recordSheetAlternativeModes(weapon: WeaponEquipment): readonly RecordSheetInventoryAlternativeMode[] {
  return Object.freeze(
    recordSheetAmmoProfiles(weapon).map((profile) =>
      Object.freeze({
        name: profile.displayName,
        damage: recordSheetModeDamage(profile),
        minimumRange: profile.minimumRange > 0 ? String(profile.minimumRange) : '—',
        ranges: Object.freeze(profile.ranges.slice(0, 3).map((range) => String(range))) as readonly [
          string,
          string,
          string,
        ],
      }),
    ),
  );
}

export function recordSheetAmmoProfiles(weapon: WeaponEquipment): readonly AmmoWeaponProfile[] {
  if (weapon.ammoType === 'MML') return MML_AMMO_PROFILES;
  if (weapon.ammoType === 'ATM' || weapon.ammoType === 'IATM') return ATM_AMMO_PROFILES;
  return [];
}

function recordSheetModeDamage(profile: AmmoWeaponProfile): string {
  switch (profile.id) {
    case 'mml-lrm':
    case 'atm-extended-range':
      return '1/Msl';
    case 'mml-srm':
    case 'atm-standard':
      return '2/Msl';
    case 'atm-high-explosive':
      return '3/Msl';
  }
}

export function recordSheetAmmoProfile(entity: BaseEntity): readonly string[] {
  return recordSheetAmmoEntries(
    entity.equipment().flatMap((mount) => {
      const shots = mount.getAmmoShots();
      // MegaMekLab keys ammo by its type's short name, as the live profile does; placement modifiers such as
      // a battle armor "(Body)" mount never print.
      const name = mount.equipment ? mount.equipment.shortName || mount.equipment.name : mount.displayName();
      return shots === undefined ? [] : [[name, shots] as const];
    }),
  );
}

/** Printed and live ammo profiles: shots summed per printed ammo name, in MegaMekLab's (TreeMap) name order. */
export function recordSheetAmmoEntries(
  ammo: Iterable<readonly [displayName: string, shots: number]>,
): readonly string[] {
  const totals = new Map<string, number>();
  for (const [displayName, shots] of ammo) {
    const name = recordSheetAmmoName(displayName);
    totals.set(name, (totals.get(name) ?? 0) + shots);
  }
  return Object.freeze(
    [...totals.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, shots]) => `(${name}) ${shots}`),
  );
}

/** MegaMekLab marks CASE-protected ammunition on non-Mek sheets. */
export function recordSheetNonMekAmmoPrefix(entity: BaseEntity): string {
  return entity.equipment().some((mount) => isCaseEquipment(mount.equipment)) ? 'Ammo (CASE):' : 'Ammo:';
}

export function drawIdentityPanel(svg: SVGSVGElement, entity: BaseEntity, box: Box, ruleset: CBTRuleset): void {
  const group = addFrame(svg, entity.entityType.toUpperCase(), box);
  const content = innerBox(box, 8, 22);
  const lines: readonly [string, string, string?][] = [
    ['UNIT', entity.displayName(), 'display-name'],
    ['TONS', formatNumber(entity.tonnage()), 'tonnage'],
    ['YEAR', String(entity.year()), 'year'],
    ['TECH', formatTechBase(entity.techBase(), entity.mixedTech()), 'tech-base'],
    ['ROLE', entity.role() || '—', 'role'],
    ['MOTIVE', entity.getMotiveTypeAsString() ?? entity.entityType, undefined],
    ['MOVEMENT', `${entity.walkMP()} / ${entity.runMP()} / ${entity.jumpMP()}`, undefined],
    ['BATTLE VALUE', formatWholeNumber(entity.battleValue(ruleset)), 'bv'],
  ];
  const available = Math.max(1, content.height);
  const rowHeight = Math.min(14, available / lines.length);
  lines.forEach(([label, value, field], index) => {
    const y = content.y - box.y + 8 + index * rowHeight;
    addText(group, label, content.x - box.x, y, { size: 6.4, weight: 700, fill: '#555' });
    const valueText = addText(group, value, content.x - box.x + 46, y, {
      size: index === 0 ? 8.7 : 7.6,
      weight: index === 0 ? 700 : 500,
      maxWidth: Math.max(10, content.width - 46),
    });
    if (field) valueText.setAttribute('data-mekbay-field', field);
    if (index < lines.length - 1)
      addLine(group, content.x - box.x, y + 3, content.x - box.x + content.width, y + 3, '#ddd', 0.5);
  });
  appendLegacyIdentityAnchors(group, entity, box, ruleset);
}

export function appendLegacyIdentityAnchors(group: SVGGElement, entity: BaseEntity, box: Box, ruleset: CBTRuleset): void {
  const values: Readonly<Record<string, string>> = {
    type: entity.displayName(),
    unitName: entity.displayName(),
    tonnage: formatNumber(entity.tonnage()),
    year: String(entity.year()),
    techBase: formatTechBase(entity.techBase(), entity.mixedTech()),
    role: entity.role(),
    movementType: entity.getMotiveTypeAsString() ?? entity.entityType,
    mpWalk: String(entity.walkMP()),
    mpRun: String(entity.runMP()),
    mpJump: String(entity.jumpMP()),
    bv: formatWholeNumber(entity.battleValue(ruleset)),
  };
  Object.entries(values).forEach(([id, value]) => {
    if (group.ownerSVGElement?.getElementById(id)) return;
    const anchor = addText(group, value, box.width - 3, box.height - 3, { size: 0.1, fill: '#fff' });
    anchor.id = id;
    anchor.setAttribute('aria-hidden', 'true');
  });
}

/**
 * Every family's "BV:" caption and value. MegaMekLab groups BV digits on all sheets;
 * binders rewriting `#bv` at runtime must format with `formatWholeNumber` too.
 */
export function appendBattleValue(
  parent: SVGElement,
  battleValue: number,
  position: { readonly x: number; readonly valueX: number; readonly y: number; readonly size: number; readonly maxWidth?: number },
  suffix = '',
): SVGTextElement {
  addTemplateCaption(parent, 'BV:', position.x, position.y, { size: position.size, weight: 700 });
  const value = addText(parent, `${formatWholeNumber(battleValue)}${suffix}`, position.valueX, position.y, {
    size: position.size,
    maxWidth: position.maxWidth,
  });
  value.id = 'bv';
  if (suffix) value.setAttribute('data-mekbay-bv-suffix', suffix);
  return value;
}

/**
 * MegaMekLab template captions keep a fixed `textLength`; these are those widths per point of type,
 * taken from its record-sheet templates, so every template and type size prints them alike.
 */
const TEMPLATE_CAPTION_EMS: Readonly<Record<string, number>> = {
  'Type:': 21.401 / 9.67,
  'Name:': 21.471 / 7.7,
  'Tonnage:': 29.785 / 7.7,
  'Tech Base:': 35.949 / 7.7,
  'Role:': 16.16 / 7.7,
  'Engine Type:': 40.915 / 7.7,
  'Movement Type:': 54.285 / 7.7,
  'Safe Thrust:': 38.723 / 7.7,
  'Maximum Thrust:': 58.411 / 7.7,
  'Weapons & Equipment Inventory': 121.508 / 8.6,
  'BV:': 14.117 / 9.67,
  Heat: 13.53 / 6.76,
  'Level*': 18.187 / 6.76,
  Effects: 19.001 / 6.76,
};

/** A template caption at MegaMekLab's width for its type size (plain text when the template has none). */
export function addTemplateCaption(
  parent: SVGElement,
  caption: string,
  x: number,
  y: number,
  options: Omit<NonNullable<Parameters<typeof addText>[4]>, 'textLength' | 'maxWidth'> & { readonly size: number },
): SVGTextElement {
  const ems = TEMPLATE_CAPTION_EMS[caption];
  return addText(parent, caption, x, y, { ...options, ...(ems === undefined ? {} : { textLength: ems * options.size }) });
}

/** The data panel's "Type:" row; every template sets its value 26.229 points after the caption. */
export function appendDataPanelType(
  group: SVGGElement,
  entity: BaseEntity,
  { x, y, font }: { readonly x: (value: number) => number; readonly y: (value: number) => number; readonly font: (value: number) => number },
  captionX: number,
): SVGTextElement {
  addTemplateCaption(group, 'Type:', x(captionX), y(28), { size: font(9.67), weight: 700 });
  const type = addText(group, entity.displayName(), x(captionX + 26.229), y(28), {
    size: font(9.67),
    weight: 700,
    maxWidth: x(187),
  });
  type.id = 'type';
  type.setAttribute('data-mekbay-field', 'display-name');
  return type;
}

export interface DataPanelFact {
  readonly label: string;
  readonly value: string;
  readonly baseline: number;
  readonly id?: string;
  readonly field?: string;
  /** Defaults to the templates' right-hand fact column. */
  readonly labelX?: number;
  readonly valueX?: number;
  readonly maxWidth?: number;
  readonly anchor?: 'middle';
  readonly weightUnit?: 'kg';
}

/** Data-panel fact rows at MegaMekLab geometry: template caption widths, values at 158.24 unless placed. */
export function appendDataPanelFacts(
  group: SVGGElement,
  facts: readonly DataPanelFact[],
  { x, y, font }: { readonly x: (value: number) => number; readonly y: (value: number) => number; readonly font: (value: number) => number },
): void {
  const size = font(RECORD_SHEET_FONT.body);
  for (const fact of facts) {
    addTemplateCaption(group, fact.label, x(fact.labelX ?? 115.7), y(fact.baseline), { size, weight: 700 });
    const value = addText(group, fact.value, x(fact.valueX ?? 158.24), y(fact.baseline), {
      size,
      anchor: fact.anchor,
      maxWidth: x(fact.maxWidth ?? 58),
    });
    if (fact.id) value.id = fact.id;
    if (fact.field) value.setAttribute('data-mekbay-field', fact.field);
    if (fact.weightUnit) value.setAttribute('data-mekbay-weight-unit', fact.weightUnit);
  }
}

/**
 * X for a crew value following its caption: the layout's column, or just past the
 * caption's natural width when the caption needs more room. Captions are never squeezed.
 */
export function crewSkillValueX(caption: SVGTextElement, column: number, fontScale = 1): number {
  const captionEnd = Number(caption.getAttribute('x')) + measureSvgTextCanvas(caption, caption.textContent ?? '');
  return Math.max(column, captionEnd + 3 * fontScale);
}

/** Crew values share a readable size while retaining each layout's scale and baseline. */
export function addCrewSkillValue(
  parent: SVGElement,
  value: string,
  x: number,
  y: number,
  fontScale = 1,
  anchor: 'start' | 'middle' | 'end' = 'start',
): SVGTextElement {
  return addText(parent, value, x, y, {
    size: 12 * fontScale, weight: 700, class: 'skillValue', anchor,
  });
}

/** Width a layout reserves after its crew-name field for the crew-state menu and its gap. */
export const CREW_STATE_MENU_SPACE = 12;

export function drawGenericCrewPanel(svg: SVGSVGElement, entity: BaseEntity, box: Box): void {
  const group = addFrame(svg, 'CREW', box, {
    cornerAngleDegrees: { topRight: 0, bottomLeft: 0, bottomRight: 45 },
  });
  const count = Math.max(1, entity.crewSlotCount());
  const rowHeight = Math.max(25, Math.min(43, (box.height - 22) / count));
  for (let occurrence = 0; occurrence < count; occurrence++) {
    const position = svgElement('g');
    setAttributes(position, {
      transform: `translate(0 ${16 + occurrence * rowHeight})`,
      'data-mekbay-crew-position': occurrence,
      'data-mekbay-crew-width': box.width,
      'data-mekbay-crew-height': rowHeight,
    });
    group.appendChild(position);
    const y = 11;
    const nameEnd = SvgFrameUtil.innerRight(box.width) - 2 - CREW_STATE_MENU_SPACE;
    const name = addText(position, '', 9, y, { size: 7.2, weight: 700, maxWidth: nameEnd - 9 });
    name.id = `crewName${occurrence}`;
    const nameButton = transparentRect(6, y - 10, nameEnd - 6, 13, 'crewNameButton');
    nameButton.setAttribute('crewId', String(occurrence));
    nameButton.setAttribute('textElement', name.id);
    position.appendChild(nameButton);
    addText(position, 'GUNNERY', 9, y + 11, { size: 5.7, weight: 700 });
    const gunnery = addCrewSkillValue(position, '4', 47, y + 11);
    gunnery.id = `gunnerySkill${occurrence}`;
    const gunButton = transparentRect(39, y + 2, 17, 13, 'crewSkillButton');
    gunButton.setAttribute('crewId', String(occurrence));
    gunButton.setAttribute('skill', 'gunnery');
    position.appendChild(gunButton);
    addText(position, 'PILOTING', 60, y + 11, { size: 5.7, weight: 700 });
    const piloting = addCrewSkillValue(position, '5', 96, y + 11);
    piloting.id = `pilotingSkill${occurrence}`;
    const pilotButton = transparentRect(90, y + 2, 17, 13, 'crewSkillButton');
    pilotButton.setAttribute('crewId', String(occurrence));
    pilotButton.setAttribute('skill', 'piloting');
    position.appendChild(pilotButton);
    drawCrewHitGrid(position, occurrence, {
      x: 52, y: y + 15, cellWidth: (box.width - 58) / 6,
      cellHeight: Math.min(7, (rowHeight - 20) / 2),
      labelX: 6, labelWidth: 44, fontScale: Math.min(7, (rowHeight - 20) / 2) / 9,
    });
    const state = transparentRect(6, y - 11, box.width - 12, rowHeight - 1, 'crewStateButton');
    state.setAttribute('crewId', String(occurrence));
    position.insertBefore(state, name);
  }
}

/** The shared wound track; aerospace crews retain their applicable modifier rows. */
export function drawCrewHitGrid(
  parent: SVGGElement,
  crewId: number,
  options: {
    readonly x: number;
    readonly y: number;
    readonly cellWidth: number;
    readonly cellHeight: number;
    readonly labelX: number;
    readonly labelWidth: number;
    readonly fontScale: number;
    readonly mode?: 'pilot' | 'aero-pilot' | 'vessel-crew';
  },
): void {
  const { x, y, cellWidth, cellHeight, labelX, labelWidth, fontScale, mode = 'pilot' } = options;
  const group = svgElement('g');
  group.setAttribute('class', 'crew-hit-grid');
  parent.appendChild(group);
  const baseline = y + cellHeight * 7 / 9;
  for (let index = 0; index < 6; index++) {
    const cellX = x + index * cellWidth;
    const hit = svgElement('rect');
    setAttributes(hit, {
      x: cellX, y, width: cellWidth, height: cellHeight,
      class: 'crewHit', fill: '#fff', stroke: 'none',
      id: `crew_damage_${crewId}_${index + 1}`, crewId, hit: index + 1,
    });
    group.appendChild(hit);
    addText(group, String(index + 1), cellX + cellWidth / 2, baseline, {
      size: 5.8 * fontScale, weight: 700, anchor: 'middle', class: 'crewHitLabel',
    });
  }

  // Captions, numbers and borders must never intercept a wound-cell click.
  const decoration = svgElement('g');
  decoration.setAttribute('pointer-events', 'none');
  group.appendChild(decoration);
  const modifiers = ['+1', '+2', '+3', '+4', '+5'];
  const rows = [
    { label: 'Hits Taken', values: ['1', '2', '3', '4', '5', '6'] },
    mode === 'vessel-crew'
      ? { label: 'Modifier', values: [...modifiers, 'Incp.'] }
      : { label: 'Consciousness #', values: ['3', '5', '7', '10', '11', 'Dead'] },
  ];
  if (mode === 'aero-pilot') rows.push({ label: 'Modifier', values: modifiers });
  rows.forEach((row, rowIndex) => {
    const rowBaseline = baseline + rowIndex * cellHeight;
    addText(decoration, row.label, labelX + labelWidth, rowBaseline, {
      size: 5.2 * fontScale, weight: 700, anchor: 'end', maxWidth: labelWidth,
    });
    if (rowIndex === 0) return;
    row.values.forEach((value, index) => addText(
      decoration, value, x + (index + 0.5) * cellWidth, rowBaseline,
      { size: 5.8 * fontScale, weight: 700, anchor: 'middle', maxWidth: cellWidth - fontScale },
    ));
  });

  const right = x + cellWidth * 6;
  const bottom = y + cellHeight * rows.length;
  const lastRight = x + cellWidth * rows[rows.length - 1].values.length;
  const radius = 1.015 * fontScale;
  const grid = svgElement('path');
  const step = lastRight < right ? `V ${bottom - cellHeight} H ${lastRight}` : '';
  setAttributes(grid, {
    d: `M ${x + radius} ${y} H ${right - radius} Q ${right} ${y} ${right} ${y + radius} ${step}`
      + ` V ${bottom - radius} Q ${lastRight} ${bottom} ${lastRight - radius} ${bottom}`
      + ` H ${x + radius} Q ${x} ${bottom} ${x} ${bottom - radius}`
      + ` V ${y + radius} Q ${x} ${y} ${x + radius} ${y} Z`,
    fill: 'none', stroke: '#111', 'stroke-width': 0.8 * fontScale,
  });
  decoration.appendChild(grid);
  rows.forEach((row, rowIndex) => {
    const rowY = y + rowIndex * cellHeight;
    if (rowIndex > 0) addLine(decoration, x, rowY, x + row.values.length * cellWidth, rowY, '#111', 0.8 * fontScale);
    for (let divider = 1; divider < row.values.length; divider++) {
      const dividerX = x + divider * cellWidth;
      addLine(decoration, dividerX, rowY, dividerX, rowY + cellHeight, '#111', 0.8 * fontScale);
    }
  });
}

export function drawDamagePanel(svg: SVGSVGElement, entity: BaseEntity, box: Box): void {
  const group = addFrame(svg, 'ARMOR DIAGRAM', box);
  const locations = entity.damageLocations();
  drawDamageLocationGrid(group, locations, { x: 6, y: 23, width: box.width - 12, height: box.height - 28 },
    locations.length <= 4 ? 2 : locations.length <= 9 ? 3 : 4);
}

/** The text-only damage diagram: one location cell per grid slot, used where no artwork applies. */
export function drawDamageLocationGrid(
  group: SVGGElement,
  locations: readonly EntityDamageLocation[],
  area: Box,
  columns: number,
  minimumCellHeight = 0,
): void {
  const cellWidth = area.width / columns;
  const cellHeight = Math.max(minimumCellHeight, area.height / Math.max(1, Math.ceil(locations.length / columns)));
  locations.forEach((location, index) =>
    drawDamageLocation(
      group,
      location,
      area.x + (index % columns) * cellWidth,
      area.y + Math.floor(index / columns) * cellHeight,
      cellWidth - 2,
      cellHeight - 2,
    ),
  );
}

export function drawDamageLocation(
  group: SVGGElement,
  location: EntityDamageLocation,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const code = location.sheetCode ?? location.code;
  const border = svgElement('rect');
  setAttributes(border, { x, y, width, height, rx: 2, fill: '#fafafa', stroke: '#bbb', 'stroke-width': 0.55 });
  group.appendChild(border);
  addText(group, code, x + width / 2, y + 8, { size: 5.8, weight: 700, anchor: 'middle', maxWidth: width - 4 });

  if (location.soldierPips) {
    const pipWidth = Math.max(1, width - 8);
    const pips = GenericPipRenderer.createPips(location.internalPoints, pipWidth, Math.max(1, height - 15), {
      pipRadius: 3.3,
      minPipRadius: 1.5,
    });
    if (pips) {
      pips.setAttribute('transform', `translate(${x + 4} ${y + 12})`);
      decoratePips(pips, 'structure', code);
      group.appendChild(pips);
    }
    return;
  }

  const front = Math.max(0, location.armor.front);
  if (location.combinedPips) {
    const pips = makePips(location.internalPoints + front, width - 8, height - 18, 'armor', code);
    if (pips) {
      pips.setAttribute('transform', `translate(${x + 4} ${y + 14})`);
      group.appendChild(pips);
    }
    const hit = transparentRect(x + 2, y + 10, width - 4, height - 12, 'unitLocation armor');
    hit.setAttribute('data-loc', code);
    group.appendChild(hit);
    return;
  }

  const internalHeight = Math.max(8, (height - 18) * 0.36);
  const armorHeight = Math.max(8, height - 18 - internalHeight);
  const structure = makePips(location.internalPoints, width - 8, internalHeight - 2, 'structure', code);
  if (structure) {
    structure.setAttribute('transform', `translate(${x + 4} ${y + 14})`);
    group.appendChild(structure);
  }
  const armor = makePips(front, width - 8, armorHeight - 2, 'armor', code);
  if (armor) {
    armor.setAttribute('transform', `translate(${x + 4} ${y + 14 + internalHeight})`);
    group.appendChild(armor);
  }
  if (location.armor.rear > 0) {
    const rear = makePips(location.armor.rear, Math.max(8, width * 0.35), armorHeight - 2, 'armor', code, true);
    if (rear) {
      rear.setAttribute('transform', `translate(${x + width * 0.62} ${y + 14 + internalHeight})`);
      group.appendChild(rear);
    }
  }
  const structureTarget = transparentRect(x + 2, y + 11, width - 4, internalHeight + 3, 'unitLocation structure');
  structureTarget.setAttribute('data-loc', code);
  group.appendChild(structureTarget);
  const armorTarget = transparentRect(x + 2, y + 13 + internalHeight, width - 4, armorHeight, 'unitLocation armor');
  armorTarget.setAttribute('data-loc', code);
  group.appendChild(armorTarget);
}

export function paperdollPipOptions(pipLayout: PaperdollPipLayout, pipRadius: number, minPipRadius: number) {
  return {
    pipRadius,
    minPipRadius,
    useCanonPipRadius: pipLayout === 'canon',
  };
}

export function constructionMaterialSubtitle(
  value: string | undefined,
  suffix: 'Armor' | 'Structure',
  fallback: string,
): string {
  const materialName = value?.trim();
  if (!materialName) {
    return fallback;
  }

  // MegaMekLab's templates spell out the standard construction types, while
  // every specialist material is printed using its catalog name verbatim.
  return materialName === 'Standard' ? `${materialName} ${suffix}` : materialName;
}

/** The armor diagram subtitle; support vehicles with BAR armor print the rating, as MegaMekLab does. */
export function armorDiagramSubtitle(entity: BaseEntity): string {
  const armor = entity.uniformArmor()?.armor;
  const name = entity.isSupportVehicle() && armor?.armorType.startsWith('SV_BAR_') ? `BAR: ${armor.bar}` : armor?.name;
  return constructionMaterialSubtitle(name, 'Armor', 'Patchwork Armor');
}

/** A positioned run inside a multi-part template text, such as a caption and its armor counter. */
export function appendTspan(parent: SVGTextElement, value: string, x: number, y: number): SVGTSpanElement {
  const tspan = svgElement('tspan');
  setAttributes(tspan, { x, y });
  tspan.textContent = value;
  parent.appendChild(tspan);
  return tspan;
}

interface DiagramHeadingOptions {
  readonly showSubtitleRibbon?: boolean;
  readonly titleWidth?: number;
  readonly titleX?: number;
  readonly titleY?: number;
  readonly ribbonWidth?: number;
  readonly ribbonX?: number;
  readonly ribbonY?: number;
  readonly ribbonCut?: number;
  readonly subtitleX?: number;
  readonly subtitleY?: number;
  readonly subtitleFontSize?: number;
  readonly subtitleId?: string;
  readonly subtitleHorizontalScale?: number;
}

export function addDiagramHeading(
  group: SVGGElement,
  title: string,
  subtitle: string,
  width: number,
  y: number,
  options: DiagramHeadingOptions = {},
): void {
  const titleWidth = options.titleWidth ?? Math.min(84, width * 0.49);
  const titleFrame = SvgFrameUtil.createSVGFrameHeader(title, titleWidth, {
    headerWidth: titleWidth,
    // The utility adds 2.5pt top/bottom padding; 6.25 yields MML's 11.25pt tab.
    headerHeight: 6.25,
    headerFontSize: 8.6,
    cornerAngleDegrees: 56.31,
  });
  titleFrame.setAttribute(
    'transform',
    `translate(${formatNumber(options.titleX ?? (width - titleWidth) / 2)} ${formatNumber(options.titleY ?? y)})`,
  );
  group.appendChild(titleFrame);

  const ribbonWidth = options.ribbonWidth ?? Math.min(124, width * 0.72);
  const ribbonX = options.ribbonX ?? (width - ribbonWidth) / 2;
  const ribbonY = options.ribbonY ?? y;
  const ribbonCut = options.ribbonCut ?? 5.625;
  if (options.showSubtitleRibbon !== false) {
    const ribbon = SvgFrameUtil.createSVGFrameHeader('', ribbonWidth + ribbonCut, {
      headerHeight: 6.25,
      headerAngleDegrees: Math.atan2(5.625, ribbonCut) * 180 / Math.PI,
      headerFill: '#c7c7c7',
    });
    ribbon.setAttribute('transform', `translate(${formatNumber(ribbonX - ribbonCut)} ${formatNumber(ribbonY + 13)})`);
    group.appendChild(ribbon);
  }
  const subtitleText = addText(group, subtitle, options.subtitleX ?? width / 2, options.subtitleY ?? y + 21.5, {
    size: options.subtitleFontSize ?? 8.6,
    weight: 700,
    anchor: 'middle',
    maxWidth: ribbonWidth - 10,
  });
  if (options.subtitleHorizontalScale !== undefined) {
    const anchorX = options.subtitleX ?? width / 2;
    subtitleText.setAttribute(
      'transform',
      `translate(${formatNumber(anchorX)} 0) scale(${formatNumber(options.subtitleHorizontalScale)} 1) translate(${formatNumber(-anchorX)} 0)`,
    );
  }
  if (options.subtitleId) subtitleText.id = options.subtitleId;
}

export function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}

export function decoratePaperdollPips(layer: SVGGElement, forceRear = false): void {
  layer.querySelectorAll<SVGGElement>('[data-pip-type][data-pip-location]').forEach((pipGroup) => {
    const typeValue = pipGroup.dataset['pipType'] ?? 'armor';
    const rawLocation = pipGroup.dataset['pipLocation'] ?? '';
    if (typeValue === 'shield-dc' || typeValue === 'shield-da') {
      const code = `${typeValue === 'shield-dc' ? 'DC' : 'DA'}${rawLocation}`;
      pipGroup.classList.add('shield');
      pipGroup.setAttribute('data-loc', code);
      decoratePips(pipGroup, 'shield', code);
      return;
    }
    const rear = forceRear || rawLocation.endsWith('_R');
    const location = rawLocation.replace(/_R$/u, '');
    decoratePips(pipGroup, typeValue === 'structure' ? 'structure' : 'armor', location, rear);
  });
}

export function drawCriticalPanel(svg: SVGSVGElement, entity: BaseEntity, box: Box, title = 'CRITICAL HITS'): void {
  const group = addFrame(svg, title, box);
  const criticals = [...buildNonMekRuntimeIndex(entity).damageTracks.values()].map(systemDamagePresentation);
  const visible = criticals.slice(0, Math.max(1, Math.floor((box.height - 25) / 11)));
  visible.forEach((critical, index) => {
    const y = 29 + index * 11;
    const control = svgElement('g');
    control.id = critical.sheetId;
    control.setAttribute('class', 'critLoc');
    control.setAttribute('critId', critical.sheetId);
    control.setAttribute('transform', `translate(7 ${y - 8})`);
    const background = svgElement('rect');
    setAttributes(background, { x: 0, y: 0, width: box.width - 14, height: 10, fill: index % 2 ? '#fff' : '#f3f3f3' });
    control.appendChild(background);
    addText(control, critical.label, 3, 7.2, { size: 5.9, maxWidth: box.width - 47 });
    if (critical.visibleHitPips !== undefined) {
      const pips = svgElement('g');
      pips.id = `${critical.sheetId}_pips`;
      for (let pipIndex = 0; pipIndex < critical.visibleHitPips; pipIndex++) {
        pips.appendChild(circle(box.width - 50 + pipIndex * 4.2, 5, 1.45, 'motiveHitPip pip hidden'));
      }
      control.appendChild(pips);
    } else {
      control.appendChild(circle(box.width - 22, 5, 2.4, 'criticalPip pip'));
    }
    if (critical.sheetId === 'rotor') {
      const counter = addText(control, '0', box.width - 30, 7, { size: 6, anchor: 'end' });
      counter.id = 'rotor_hits_counter';
    }
    group.appendChild(control);
  });
}

/** The heat data panel's heat sink caption, naming every type but single heat sinks. */
export function heatSinkCaption(type: HeatSinkType): string {
  return type === 'Single' ? 'Heat Sinks:' : `${type} Heat Sinks:`;
}

/**
 * Live controls shared by heat data panels: an APPLY HEAT tab cloned from the panel header, the frame that colours
 * with pending heat, and a hit area over the heat sink pips when the panel draws them.
 */
export function appendHeatPanelControls(group: SVGGElement, heatSinkArea?: Box): void {
  const header = Array.from(group.children)
    .find((child): child is SVGGElement => child.tagName.toLowerCase() === 'g');
  if (header) {
    const apply = header.cloneNode(true) as SVGGElement;
    apply.id = 'applyHeatButton';
    apply.setAttribute('class', 'screen-only no-autocolor');
    const label = apply.querySelector('text');
    if (label) label.textContent = 'APPLY HEAT';
    group.appendChild(apply);
  }
  const framePaths = Array.from(group.children)
    .filter((child): child is SVGPathElement => child.tagName.toLowerCase() === 'path');
  framePaths[1]?.classList.add('applyHeatButtonFrame');
  const heatSinks = group.querySelector<SVGGElement>('g.hsPips');
  if (heatSinks && heatSinkArea) {
    heatSinks.insertBefore(
      transparentRect(heatSinkArea.x, heatSinkArea.y, heatSinkArea.width, heatSinkArea.height,
        'changeActiveHeatsinksCountButton screen-only'),
      heatSinks.firstChild,
    );
  }
}

export interface HeatEffectRow {
  readonly heat: number;
  /** The effect text; continuation lines indent as on MegaMekLab's heat tables. */
  readonly lines: readonly string[];
  readonly baseline: number;
  readonly movementModifier?: number;
}

/** A heat data panel's headings and effect rows; templates differ only in baselines, columns and leading. */
export function appendHeatEffectRows(
  group: SVGGElement,
  rows: readonly HeatEffectRow[],
  { x, y, font }: { readonly x: (value: number) => number; readonly y: (value: number) => number; readonly font: (value: number) => number },
  layout: {
    readonly headingBaselines: readonly [heat: number, level: number];
    readonly effectsX: number;
    readonly lineHeight: number;
    readonly labelMaxWidth: number;
  },
): void {
  const size = font(RECORD_SHEET_FONT.inventory);
  const [heatBaseline, levelBaseline] = layout.headingBaselines;
  addTemplateCaption(group, 'Heat', x(15), y(heatBaseline), { size, anchor: 'middle' });
  addTemplateCaption(group, 'Level*', x(15), y(levelBaseline), { size, anchor: 'middle' });
  addTemplateCaption(group, 'Effects', x(layout.effectsX), y(levelBaseline), { size, anchor: 'middle' });
  rows.forEach((effect) => {
    const row = svgElement('g');
    setAttributes(row, { class: 'heatEffect', heat: effect.heat });
    addText(row, String(effect.heat), x(15), y(effect.baseline), { size, anchor: 'middle' });
    effect.lines.forEach((line, index) => {
      const indent = index === 0 ? 0 : 3;
      const text = addText(row, line, x(27 + indent), y(effect.baseline + index * layout.lineHeight), {
        size,
        maxWidth: x(layout.labelMaxWidth - indent),
      });
      if (index === 0 && effect.movementModifier !== undefined) text.id = `minus${Math.abs(effect.movementModifier)}MP`;
    });
    group.appendChild(row);
  });
}

/**
 * A heat data panel's heat-sink type, count ("N (2N)" for doubles, as MegaMekLab prints it) and
 * the 3×10 pip grid binders reveal up to the live count. Templates differ only in their columns.
 */
export function appendHeatSinkData(
  group: SVGGElement,
  heatSinks: { readonly count: number; readonly type: HeatSinkType },
  { x, y, font }: { readonly x: (value: number) => number; readonly y: (value: number) => number; readonly font: (value: number) => number },
  layout: { readonly rightX: number; readonly pipsX: number },
): void {
  const count = Math.max(0, heatSinks.count);
  addText(group, heatSinkCaption(heatSinks.type), x(layout.rightX), y(22), { size: font(8.44), anchor: 'end' }).id = 'hsType';
  const dissipation = heatSinkTypeDissipation(heatSinks.type);
  addText(group, dissipation === 1 ? String(count) : `${count} (${count * dissipation})`, x(layout.rightX), y(31), {
    size: font(8.44),
    anchor: 'end',
  }).id = 'hsCount';
  const pips = svgElement('g');
  pips.setAttribute('class', 'hsPips');
  for (let index = 0; index < 30; index++) {
    const pip = circle(x(layout.pipsX + Math.floor(index / 10) * 9.66), y(45.478 + (index % 10) * 9.66), font(3.478), 'pip hsPip');
    pip.setAttribute('data-loc', 'hs');
    if (index >= count) pip.style.display = 'none';
    pips.appendChild(pip);
  }
  group.appendChild(pips);
}

/**
 * The advanced movement compass: a three-line caption beside a hex with lettered facings.
 * Templates differ only in the authored frame, the caption column and the hex centre and size.
 */
export function drawAdvancedMovementCompass(
  svg: SVGSVGElement,
  box: Box,
  className: string,
  layout: {
    readonly width: number;
    readonly height: number;
    readonly captionX: number;
    readonly centerX: number;
    readonly centerY: number;
    readonly halfHeight: number;
  },
): void {
  const group = svgElement('g');
  group.setAttribute('class', className);
  group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
  const sx = box.width / layout.width;
  const sy = box.height / layout.height;
  const x = (value: number): number => value * sx;
  const y = (value: number): number => value * sy;
  const font = (value: number): number => value * Math.min(sx, sy);
  const { centerX: cx, centerY: cy, halfHeight: h } = layout;
  const r = (h * 2) / Math.sqrt(3);
  const bold = { size: font(9.35), weight: 700, anchor: 'middle' } as const;
  ['Advanced', 'Movement', 'Compass'].forEach((label, index) =>
    addText(group, label, x(layout.captionX), y(cy + 0.5 + (index - 1) * 10), bold),
  );
  const hex = svgElement('polygon');
  setAttributes(hex, {
    points: [[cx - r / 2, cy - h], [cx - r, cy], [cx - r / 2, cy + h], [cx + r / 2, cy + h], [cx + r, cy], [cx + r / 2, cy - h]]
      .map(([px, py]) => `${formatNumber(x(px))},${formatNumber(y(py))}`)
      .join(' '),
    fill: 'none',
    stroke: '#000',
    'stroke-width': font(2.9),
  });
  group.appendChild(hex);
  const facings: readonly [string, number, number][] = [
    ['A', cx, cy - h - 3], ['B', cx + r + 0.5, cy - h / 2 - 0.5], ['C', cx + r + 0.5, cy + h / 2 + 5.5],
    ['D', cx, cy + h + 9], ['E', cx - r - 0.5, cy + h / 2 + 5.5], ['F', cx - r - 0.5, cy - h / 2 - 0.5],
  ];
  facings.forEach(([label, px, py]) => addText(group, label, x(px), y(py), bold));
  svg.appendChild(group);
}

export function drawHeatScale(svg: SVGSVGElement, box: Box, family: 'mek' | 'aero'): void {
  const group = svgElement('g');
  group.id = 'heatScale';
  group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
  const sx = box.width / 19.454;
  const sy = box.height / 366;
  const fontScale = Math.min(sx, sy);
  const x = (value: number): number => value * sx;
  const y = (value: number): number => value * sy;
  const font = (value: number): number => value * fontScale;
  const heatTitle = addText(group, 'Heat', x(8.396), y(8), {
    size: font(6.76),
    weight: 700,
    anchor: 'middle',
  });
  heatTitle.setAttribute('textLength', formatNumber(x(14.126)));
  heatTitle.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  const scaleTitle = addText(group, 'Scale', x(8.396), y(16), {
    size: font(6.76),
    weight: 700,
    anchor: 'middle',
  });
  scaleTitle.setAttribute('textLength', formatNumber(x(15.791)));
  scaleTitle.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  const overflow = svgElement('path');
  overflow.setAttribute(
    'd',
    [
      `m ${formatNumber(x(-1.938))} ${formatNumber(y(26.85))}`,
      `c 0 ${formatNumber(y(-2.4))} ${formatNumber(x(1.95))} ${formatNumber(y(-4.35))} ${formatNumber(x(4.35))} ${formatNumber(y(-4.35))}`,
      `h ${formatNumber(x(11.967))}`,
      `c ${formatNumber(x(2.4))} 0 ${formatNumber(x(4.35))} ${formatNumber(y(1.95))} ${formatNumber(x(4.35))} ${formatNumber(y(4.35))}`,
      `v ${formatNumber(y(11.967))}`,
      `c 0 ${formatNumber(y(2.4))} ${formatNumber(x(-1.95))} ${formatNumber(y(4.35))} ${formatNumber(x(-4.35))} ${formatNumber(y(4.35))}`,
      `H ${formatNumber(x(2.412))}`,
      `c ${formatNumber(x(-2.4))} 0 ${formatNumber(x(-4.35))} ${formatNumber(y(-1.95))} ${formatNumber(x(-4.35))} ${formatNumber(y(-4.35))} z`,
    ].join(' '),
  );
  setAttributes(overflow, {
    fill: '#fff',
    stroke: '#000',
    'stroke-width': 1.45 * fontScale,
    'stroke-linejoin': 'round',
    class: 'overflowFrame',
  });
  const overflowButton = transparentRect(
    x(-1.938),
    y(22.5),
    x(21.117),
    y(20.317),
    'overflowButton screen-only no-autocolor',
  );
  group.appendChild(overflowButton);
  group.appendChild(overflow);
  const overflowText = addText(group, 'Overflow', x(8.396), y(28.5), {
    size: font(4.7),
    anchor: 'middle',
    class: 'overflowText',
  });
  overflowText.setAttribute('textLength', formatNumber(x(15.5)));
  overflowText.setAttribute('lengthAdjust', 'spacingAndGlyphs');

  const cellTop = 47.667;
  const cellHeight = 10.3333333333;
  const effectLevels = new Set(recordSheetHeatEffects(family, 0).map(effect => effect.heat));
  for (let index = 0; index <= 30; index++) {
    const heat = 30 - index;
    const cellY = cellTop + index * cellHeight;
    const rect = svgElement('rect');
    rect.setAttribute('class', 'heat no-autocolor');
    rect.setAttribute('heat', String(heat));
    setAttributes(rect, {
      x: 0,
      y: y(cellY),
      width: x(16.792),
      height: y(cellHeight),
      fill: '#fff',
      stroke: '#000',
      'stroke-width': 1.45 * fontScale,
    });
    group.appendChild(rect);
    addText(group, String(heat), x(8.396), y(cellY + 7.401), {
      size: font(6.76),
      weight: 700,
      anchor: 'middle',
    });
    if (effectLevels.has(heat)) {
      const marker = svgElement('polygon');
      const cy = y(cellY + 5.035);
      marker.setAttribute('points', `${x(16.792)},${cy - y(3.617)} ${x(12.659)},${cy} ${x(16.792)},${cy + y(3.616)}`);
      marker.setAttribute('class', 'heat-effect-marker');
      marker.setAttribute('pointer-events', 'none');
      group.appendChild(marker);
    }
  }
  svg.appendChild(group);
}

/** A compact block records the cluster racks its page's cluster hits table needs. */
export function setCompactClusterRacks(block: SVGSVGElement, racks: readonly number[]): void {
  block.setAttribute('data-mekbay-cluster-racks', racks.join(','));
}

/** The cluster racks a compact block recorded with `setCompactClusterRacks`. */
export function compactClusterRacks(block: SVGSVGElement | undefined): readonly number[] {
  return (block?.getAttribute('data-mekbay-cluster-racks') ?? '')
    .split(',')
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);
}

export function drawClusterHitsReference(
  svg: SVGSVGElement,
  box: Box,
  rackColumns: readonly number[],
  presentation: 'auto' | 'full-width' = 'auto',
): void {
  const profile = clusterHitsReferenceProfile(box, rackColumns.length, presentation);
  const group = addReferenceTableFrame(svg, 'CLUSTER HITS TABLE', box);
  group.setAttribute('data-mekbay-reference', 'cluster-hits');
  const table = svgElement('g');
  // Scale grid coordinates, not the text: numbers retain their physical size
  // and proportions while the frame keeps the utility's standard geometry.
  const tableTop = 22.5;
  const scaleX = box.width / profile.width;
  const scaleY = (box.height - tableTop) / (profile.height - 22.5);
  table.setAttribute('transform', `translate(${formatNumber(3 * scaleX)} ${tableTop})`);
  const safeRackCount = Math.max(1, rackColumns.length);
  const rollColumnX = profile.rollColumnX * scaleX;
  const columnWidth = (profile.width - profile.rollColumnX * 2 - 6) * scaleX / safeRackCount;
  const rowHeight = profile.rowHeight * scaleY;
  const firstShadeY = profile.firstShadeY * scaleY;
  // Readable numerals (at least the small type) whose glyphs, about 0.7 em tall, stay
  // shorter than their rows so neighbouring rows never touch.
  const fontSize = Math.min(RECORD_SHEET_FONT.body, Math.max(RECORD_SHEET_FONT.small, rowHeight * 0.82));
  addText(table, '2D6', rollColumnX, 0, {
    size: fontSize,
    weight: 700,
    anchor: 'middle',
  });
  rackColumns.forEach((rack, index) =>
    addText(table, String(rack), rollColumnX + (index + 1) * columnWidth, 0, {
      size: fontSize,
      weight: 700,
      anchor: 'middle',
      maxWidth: columnWidth - 1,
    }),
  );
  for (let roll = 2; roll <= 12; roll++) {
    const rowIndex = roll - 2;
    const baseline = firstShadeY + (rowIndex + 0.5) * rowHeight + fontSize * 0.35;
    if (rowIndex % 2 === 0) {
      addReferenceShade(table, scaleX, firstShadeY + rowIndex * rowHeight, (profile.width - 11) * scaleX, rowHeight);
    }
    addText(table, String(roll), rollColumnX, baseline, {
      size: fontSize,
      anchor: 'middle',
    });
    rackColumns.forEach((rack, index) => {
      const result = addText(
        table,
        String(clusterHits(roll, rack)),
        rollColumnX + (index + 1) * columnWidth,
        baseline,
        {
          size: fontSize,
          anchor: 'middle',
          maxWidth: columnWidth - 1,
        },
      );
      result.setAttribute('data-cluster-rack', String(rack));
      result.setAttribute('data-cluster-roll', String(roll));
    });
  }
  group.appendChild(table);
}

interface ClusterHitsReferenceProfile {
  readonly width: number;
  readonly height: number;
  readonly rollColumnX: number;
  readonly rowHeight: number;
  readonly firstShadeY: number;
}

/** MML uses three responsive geometries for its cluster table. Keeping the
 * canonical coordinates here makes the component reusable without carrying
 * over the template SVG's authoring structure. */
function clusterHitsReferenceProfile(
  box: Box,
  rackCount: number,
  presentation: 'auto' | 'full-width',
): ClusterHitsReferenceProfile {
  if (presentation === 'full-width') {
    return {
      width: 576.15,
      height: 113.7,
      rollColumnX: 157.19,
      rowHeight: 7.193,
      firstShadeY: 1.796,
    };
  }
  if (rackCount >= 15) {
    return {
      width: 576.149,
      height: 148.504,
      rollColumnX: 37.671,
      rowHeight: 9.679,
      firstShadeY: 2.906,
    };
  }
  if (box.width > 250) {
    return {
      width: 382.1,
      height: 110.7,
      rollColumnX: 39.961,
      rowHeight: 6.979,
      firstShadeY: 1.856,
    };
  }
  return {
    width: 154.6,
    height: 96.048,
    rollColumnX: 40.865,
    rowHeight: 5.932,
    firstShadeY: 1.333,
  };
}

/** Footer text and optional logo, with logo coordinates supplied in physical page space. */
export function drawGeneratedFooter(
  svg: SVGSVGElement,
  page: RecordSheetPageProfile,
  placement?: {
    readonly catalystX: number;
    readonly catalystY: number;
    readonly catalystScale?: number;
    readonly footerCenterX?: number;
  },
): void {
  const scale = page.horizontalScale;
  if (placement !== undefined) {
    const mark = svgElement('g');
    mark.setAttribute('class', 'record-sheet-catalyst-mark');
    mark.id = 'cglLogoBW';
    const markScale = placement.catalystScale ?? 1;
    mark.setAttribute(
      'transform',
      `translate(${formatNumber(placement.catalystX)} ${formatNumber(placement.catalystY)}) scale(${formatNumber(markScale)})`,
    );
    const logo = createCatalystGameLabsLogo();
    logo.removeAttribute('id');
    mark.appendChild(logo);
    svg.appendChild(mark);
  }
  const footerCenterX = placement?.footerCenterX ?? page.width / 2;
  const footerWidth = 2 * Math.min(footerCenterX - page.margin, page.width - page.margin - footerCenterX);
  const textScale = Math.min(scale, footerWidth / 547.2);
  const footer = svgElement('text');
  footer.id = 'footer';
  setAttributes(footer, {
    'font-size': 5.7 * textScale,
    transform: `translate(${formatNumber(footerCenterX)} ${formatNumber(page.height - page.margin)})`,
    'text-anchor': 'middle',
    'font-family': 'Roboto',
    'font-weight': 700,
  });
  const lines: readonly [string, number, number][] = [
    [
      "© 2026 The Topps Company, Inc. Classic BattleTech, BattleTech, 'Mech and BattleMech are trademarks of The Topps Company, Inc. All rights reserved.",
      -7 * page.verticalScale,
      547.2 * textScale,
    ],
    [
      'Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of InMediaRes Production, LLC. Permission to photocopy for personal use.',
      0,
      518.4 * textScale,
    ],
  ];
  lines.forEach(([value, y, textLength]) => {
    const line = svgElement('tspan');
    line.textContent = value;
    setAttributes(line, {
      x: 0,
      y,
      textLength,
      lengthAdjust: 'spacingAndGlyphs',
    });
    footer.appendChild(line);
  });
  svg.appendChild(footer);
}

export function drawReferencePanel(svg: SVGSVGElement, box: Box, title = 'REFERENCE TABLES'): void {
  const group = addFrame(svg, title, box, { fullWidthHeader: true });
  group.setAttribute('class', 'referenceTable');
  group.setAttribute('data-mekbay-region', 'center-panel');
  const rows: readonly (readonly [string, string])[] = title.includes('HIT LOCATION')
    ? [
        ['2D6', 'LEFT · FRONT · RIGHT · REAR'],
        ['2', 'LT · CT · RT · CT (critical)'],
        ['3', 'LL · RA · RL · LA'],
        ['4', 'LA · RA · RA · LA'],
        ['5', 'LA · RL · RA · LL'],
        ['6', 'LL · RT · RL · LT'],
        ['7', 'LT · CT · RT · CT'],
        ['8', 'CT · LT · CT · RT'],
        ['9', 'RT · LL · LT · RL'],
        ['10', 'RA · LA · LA · RA'],
        ['11', 'RL · LA · LL · RA'],
        ['12', 'HD · HD · HD · HD'],
      ]
    : title.includes('PUNCH/KICK')
      ? [
          ['D6', 'PUNCH L/R · KICK L/R'],
          ['1', 'LA / RA · LL / RL'],
          ['2', 'LT / RT · LL / RL'],
          ['3', 'CT / CT · LL / RL'],
          ['4', 'LT / RT · LL / RL'],
          ['5', 'RA / LA · LL / RL'],
          ['6', 'HD / HD · LL / RL'],
        ]
      : [
          ['MODIFIER', 'EFFECT'],
          ['Light woods', '+1'],
          ['Heavy woods', '+2'],
          ['Partial cover', '+1'],
          ['Minimum range', '+1/hex'],
          ['Attacker moved', 'varies'],
          ['Target moved', 'varies'],
        ];
  const rowStep = Math.min(17, (box.height - 27) / rows.length);
  const fontSize = Math.max(3.8, Math.min(5.8, rowStep - 1.4));
  rows.forEach(([label, value], index) => {
    const y = 25 + index * rowStep;
    addText(group, label, 8, y, {
      size: index === 0 ? Math.max(4.2, fontSize) : fontSize,
      weight: index === 0 ? 700 : 400,
      maxWidth: Math.max(18, box.width * 0.22),
    });
    addText(group, value, box.width - 8, y, {
      size: fontSize,
      weight: index === 0 ? 700 : 400,
      anchor: 'end',
      maxWidth: box.width * 0.73,
    });
    if (index > 0) addLine(group, 7, y + 3, box.width - 7, y + 3, '#ddd', 0.4);
  });
}

export function drawNotesPanel(svg: SVGSVGElement, box: Box, bottomLeftNotchWidth = 0): void {
  const group = addFrame(svg, 'NOTES', box, {
    bottomLeftNotchWidth,
    cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
  });
  for (let y = 35; y < box.height - 8; y += 17) addLine(group, 9, y, box.width - 9, y, '#bbb', 0.45);
}

const RECORD_SHEET_HEADER_WIDTHS: Readonly<Record<string, number>> = Object.freeze({
  "'MECH DATA": 75.854,
  'WARRIOR DATA': 93.635,
  'CRITICAL TABLE': 93.055,
  'HEAT DATA': 69.498,
  'GROUND MAP STRAIGHT MOVEMENT': 178.308,
});

/** Every reference table shares this frame: a compact full-width title tab. */
export function addReferenceTableFrame(svg: SVGSVGElement, title: string, box: Box): SVGGElement {
  const group = addFrame(svg, title, box, {
    fullWidthHeader: true,
    headerFontSize: RECORD_SHEET_FONT.inventory,
    // SvgFrameUtil adds 2.5 points of padding above and below an explicit height.
    headerHeight: 11.25 - 5,
    cornerAngleDegrees: 56.31,
  });
  group.setAttribute('class', 'referenceTable');
  return group;
}

export function addFrame(
  svg: SVGSVGElement,
  title: string,
  box: Box,
  options: Parameters<typeof SvgFrameUtil.createSVGFrame>[3] = {},
): SVGGElement {
  const defaults =
    Object.keys(options).length > 0
      ? options
      : { cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 } };
  const headerWidth = RECORD_SHEET_HEADER_WIDTHS[title];
  const resolvedOptions = headerWidth !== undefined
    ? {
        ...defaults,
        headerWidth,
        headerHeight: 10,
        headerFontSize: RECORD_SHEET_FONT.caption,
        headerAngleDegrees: 56.31,
      }
    : defaults;
  const frame = SvgFrameUtil.createSVGFrame(title, box.width, box.height, resolvedOptions);
  for (const decoration of frame.children) decoration.classList.add('sheet-frame-decoration');
  frame.setAttribute('data-mekbay-frame-width', formatNumber(box.width));
  frame.setAttribute('data-mekbay-frame-height', formatNumber(box.height));
  frame.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
  svg.appendChild(frame);
  return frame;
}

export function makePips(
  count: number,
  width: number,
  height: number,
  type: 'armor' | 'structure',
  location: string,
  rear = false,
): SVGGElement | null {
  const pips = GenericPipRenderer.createPips(
    count,
    width,
    height,
    {
      pipRadius: 2.8,
      minPipRadius: 0.85,
      pipGap: 0.3,
    },
    type,
    location,
  );
  if (pips) decoratePips(pips, type, location, rear);
  return pips;
}

export function makeDistributedPips(
  count: number,
  width: number,
  height: number,
  type: 'armor' | 'structure',
  location: string,
  rear = false,
): SVGGElement | null {
  const profile = createPipShapeProfile([{ x: 0, y: 0, width, height }]);
  if (!profile) return null;
  const pips = DistributedPipRenderer.createPips(
    profile,
    count,
    {
      pipRadius: 2.45,
      minPipRadius: 0.72,
      pipGap: 0.25,
      inset: 0.4,
    },
    type,
    location,
  );
  if (pips) decoratePips(pips, type, location, rear);
  return pips;
}

function decoratePips(
  group: SVGGElement,
  type: 'armor' | 'structure' | 'shield',
  location: string,
  rear = false,
): void {
  group.querySelectorAll<SVGElement>('circle, polygon, rect:not([data-pip-shadow])').forEach((pip) => {
    pip.classList.add('pip', type);
    pip.setAttribute('data-loc', location);
    if (rear) pip.setAttribute('data-rear', '');
    if (group.closest('[data-mekbay-paperdoll]')) pip.setAttribute('pointer-events', 'none');
  });
}

export function addText(
  parent: SVGElement,
  value: string,
  x: number,
  y: number,
  options: {
    readonly size?: number;
    readonly weight?: number;
    readonly fill?: string;
    readonly anchor?: 'start' | 'middle' | 'end';
    readonly class?: string;
    readonly maxWidth?: number;
    /** A template caption's exact MegaMekLab width, independent of the viewer's font metrics. */
    readonly textLength?: number;
  } = {},
): SVGTextElement {
  const text = svgElement('text');
  setAttributes(text, {
    x,
    y,
    'font-size': options.size ?? 7,
    fill: options.fill && options.fill !== '#111' ? options.fill : undefined,
    'font-weight': options.weight && options.weight !== 400 ? options.weight : undefined,
    'text-anchor': options.anchor && options.anchor !== 'start' ? options.anchor : undefined,
    class: options.class,
  });
  text.textContent = value;
  if (options.textLength !== undefined) {
    text.setAttribute('textLength', formatNumber(options.textLength));
    text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  } else if (options.maxWidth) fitRecordSheetTextLine(text, value, options.size ?? 7, options.maxWidth);
  parent.appendChild(text);
  return text;
}

/** Condenses one text line to `maxWidth` when it would overflow, and clears an outdated condensation otherwise. */
export function fitRecordSheetTextLine(
  text: SVGTextContentElement,
  value: string,
  size: number,
  maxWidth: number,
): void {
  if (textFitsWidth(value, size, maxWidth)) {
    text.removeAttribute('textLength');
    text.removeAttribute('lengthAdjust');
    return;
  }
  text.setAttribute('textLength', formatNumber(maxWidth));
  text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
}

/** Whether record-sheet text fits a width, by average glyph width rather than DOM measurement. */
export function textFitsWidth(value: string, size: number, width: number): boolean {
  return value.length * size * 0.54 <= width;
}

export function addWrappedText(
  parent: SVGElement,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  options: {
    readonly size: number;
    readonly lineHeight: number;
    readonly maxLines: number;
    readonly italic?: boolean;
  },
): void {
  wrapRecordSheetText(value, maxWidth, options.size, options.maxLines).forEach((line, index) => {
    const text = addText(parent, line, x, y + index * options.lineHeight, {
      size: options.size,
      maxWidth,
    });
    if (options.italic) text.setAttribute('font-style', 'italic');
  });
}

/** Word-wraps prose; overflow beyond `maxLines` stays on the last line, which `addText` then condenses. */
export function wrapRecordSheetText(
  value: string,
  maxWidth: number,
  size: number,
  maxLines = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (!value) return [];
  // Roboto's record-sheet prose averages notably narrower than the inventory
  // numerals; this keeps MML's quirk line breaks without measuring the DOM.
  const maxCharacters = Math.max(1, Math.floor(maxWidth / (size * 0.43)));
  const lines: string[] = [];
  for (const word of value.split(/\s+/u)) {
    const current = lines.at(-1);
    if (current === undefined || (current.length + 1 + word.length > maxCharacters && lines.length < maxLines)) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  return lines;
}

export function addLine(
  parent: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width: number,
): SVGLineElement {
  const line = svgElement('line');
  setAttributes(line, { x1, y1, x2, y2, stroke, 'stroke-width': width });
  parent.appendChild(line);
  return line;
}

/** The grey band behind alternate reference-table rows. */
export function addReferenceShade(parent: SVGElement, x: number, y: number, width: number, height: number): void {
  const shade = svgElement('rect');
  setAttributes(shade, { x, y, width, height, fill: '#bbb', class: 'tableshading' });
  parent.appendChild(shade);
}

export function circle(cx: number, cy: number, radius: number, className: string): SVGCircleElement {
  const element = svgElement('circle');
  setAttributes(element, { cx, cy, r: radius, class: className });
  return element;
}

export function transparentRect(
  x: number,
  y: number,
  width: number,
  height: number,
  className: string,
): SVGRectElement {
  const rect = svgElement('rect');
  setAttributes(rect, { x, y, width, height, class: className, fill: 'transparent', 'pointer-events': 'all' });
  return rect;
}

export function setInventoryComponentIds(row: SVGGElement, componentIds: readonly string[]): void {
  if (componentIds.length > 0) {
    row.setAttribute('data-mekbay-component-ids', componentIds.join(' '));
  }
}

function innerBox(box: Box, horizontal: number, top: number): Box {
  return {
    x: box.x + horizontal,
    y: box.y + top,
    width: Math.max(0, box.width - horizontal * 2),
    height: Math.max(0, box.height - top - 5),
  };
}

/** Maps a canonical Letter-space panel into the selected physical page. */
export function scalePageBox(page: RecordSheetPageProfile, box: Box): Box {
  return {
    x: page.margin + (box.x - 18) * page.horizontalScale,
    y: page.margin + (box.y - 18) * page.verticalScale,
    width: box.width * page.horizontalScale,
    height: box.height * page.verticalScale,
  };
}

/** Maps a compact reference layout into the block's actual generated bounds. */
export function scaleCompactBox(svg: SVGSVGElement, box: Box, referenceHeight: number): Box {
  const viewBox = readViewBox(svg);
  const horizontalScale = viewBox.width / RECORD_SHEET_CONTENT_WIDTH;
  const verticalScale = viewBox.height / referenceHeight;
  return {
    x: box.x * horizontalScale,
    y: box.y * verticalScale,
    width: box.width * horizontalScale,
    height: box.height * verticalScale,
  };
}

export function readViewBox(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } {
  const values = (svg.getAttribute('viewBox') ?? '').trim().split(/\s+/u).map(Number);
  if (values.length === 4 && values.every(Number.isFinite)) {
    return { x: values[0], y: values[1], width: values[2], height: values[3] };
  }
  return {
    x: 0,
    y: 0,
    width: Number(svg.getAttribute('width')) || RECORD_SHEET_CONTENT_WIDTH,
    height: Number(svg.getAttribute('height')) || RECORD_SHEET_CONTENT_HEIGHT,
  };
}

export function appendSheetContent(
  target: SVGElement,
  source: SVGSVGElement,
  options: {
    readonly omitVehicleChrome?: boolean;
    readonly definitionsTarget?: SVGSVGElement;
  } = {},
): void {
  for (const child of Array.from(source.childNodes)) {
    if (child instanceof Element && child.tagName.toLowerCase() === 'style') continue;
    if (child instanceof SVGElement && child.classList.contains('record-sheet-background')) continue;
    if (child instanceof Element && child.tagName.toLowerCase() === 'defs' && options.definitionsTarget !== undefined) {
      mergeSheetDefinitions(options.definitionsTarget, child);
      continue;
    }
    if (
      options.omitVehicleChrome &&
      child instanceof SVGElement &&
      child.classList.contains('compact-vehicle-unit-chrome')
    )
      continue;
    target.appendChild(document.importNode(child, true));
  }
}

function mergeSheetDefinitions(target: SVGSVGElement, source: Element): void {
  let defs = Array.from(target.children).find(
    (child): child is SVGDefsElement => child.tagName.toLowerCase() === 'defs',
  );
  if (!defs) {
    defs = svgElement('defs');
    target.insertBefore(defs, target.firstChild);
  }
  for (const definition of Array.from(source.children)) {
    if (definition.id && target.getElementById(definition.id)) continue;
    defs.appendChild(document.importNode(definition, true));
  }
}

export function formatTechBase(value: EntityTechBase, mixedTech = false): string {
  if (mixedTech) return 'Mixed';
  return value === 'IS' ? 'Inner Sphere' : value;
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

/** Small support vehicle record sheets express their construction weight in kg. */
export function formatRecordSheetTonnage(tons: number, kilograms = false): string {
  // MegaMekLab groups tonnage digits like every other printed number.
  return kilograms ? `${formatWholeNumber(Math.trunc(tons * 1000))} kg` : formatWholeNumber(tons);
}

export function formatGeometryNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1_000_000) / 1_000_000);
}

export function setAttributes(
  element: Element,
  attributes: Readonly<Record<string, string | number | undefined>>,
): void {
  Object.entries(attributes).forEach(([name, value]) => {
    if (value !== undefined) element.setAttribute(name, String(value));
  });
}

export function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

export function optimizeGeneratedSvg(svg: SVGSVGElement): SVGSVGElement {
  svg.querySelectorAll<SVGElement>('.pip').forEach((pip) => {
    pip.removeAttribute('fill');
    pip.removeAttribute('stroke');
    pip.removeAttribute('stroke-width');
  });
  svg
    .querySelectorAll<SVGElement>('[data-pip-type], [data-pip-location], [data-pip-value], [data-pip-layout]')
    .forEach((group) => {
      group.removeAttribute('data-pip-type');
      group.removeAttribute('data-pip-location');
      group.removeAttribute('data-pip-value');
      group.removeAttribute('data-pip-layout');
    });
  // This is an authoring hook on each imported paperdoll root. A sheet may
  // contain several paperdolls, so retaining it would create duplicate IDs.
  svg.querySelectorAll<SVGElement>('[id^="paperdoll-art-"]').forEach((element) => element.removeAttribute('id'));
  svg.querySelectorAll<SVGPathElement>('path').forEach((path) => {
    if (/^(?:path|polygon)/u.test(path.id)) path.removeAttribute('id');
    normalizePaperdollPathStyle(path);
  });
  return svg;
}

function normalizePaperdollPathStyle(path: SVGPathElement): void {
  const style = path.getAttribute('style');
  if (!style || style.includes('transform-')) return;
  const declarations = style
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);
  const supported = new Set(['fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linejoin']);
  const entries = declarations.map((declaration) => {
    const separator = declaration.indexOf(':');
    return separator < 0
      ? (['', ''] as const)
      : ([declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()] as const);
  });
  if (entries.some(([name]) => !supported.has(name))) return;
  path.removeAttribute('style');
  entries.forEach(([name, rawValue]) => {
    if (name === 'fill-rule' && rawValue === 'nonzero') return;
    const value = rawValue
      .replace(/^rgb\(199,\s*199,\s*199\)$/u, '#c7c7c7')
      .replace(/^white$/u, '#fff')
      .replace(/^black$/u, '#000')
      .replace(/px$/u, '');
    path.setAttribute(name, value);
  });
}
