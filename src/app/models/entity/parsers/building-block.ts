// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Hard resource ceilings for untrusted BLK text. */
export interface BuildingBlockLimits {
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly maxLineLength: number;
  readonly maxBlocks: number;
  readonly maxValuesPerBlock: number;
  readonly maxTotalValues: number;
  readonly maxTagLength: number;
}

export const DEFAULT_BUILDING_BLOCK_LIMITS: BuildingBlockLimits = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxLines: 100_000,
  maxLineLength: 2 * 1024 * 1024,
  maxBlocks: 10_000,
  maxValuesPerBlock: 20_000,
  maxTotalValues: 100_000,
  maxTagLength: 256,
});

export class BuildingBlockLimitError extends Error {
  readonly code = 'NATIVE_SOURCE_LIMIT' as const;

  constructor(readonly limit: keyof BuildingBlockLimits, message: string) {
    super(message);
    this.name = 'BuildingBlockLimitError';
  }
}

export class BuildingBlockSyntaxError extends Error {
  readonly code = 'BLK_SYNTAX' as const;

  constructor(readonly line: number, message: string) {
    super(`BLK line ${line}: ${message}`);
    this.name = 'BuildingBlockSyntaxError';
  }
}

export interface BlkSourceBlockOccurrence {
  readonly kind: 'block';
  readonly tag: string;
  readonly normalizedTag: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly values: readonly string[];
  readonly rawLines: readonly string[];
}

export interface BlkSourceLineNode {
  readonly kind: 'blank' | 'comment' | 'opaque';
  readonly line: number;
  readonly raw: string;
}

export type BlkSourceNode = BlkSourceBlockOccurrence | BlkSourceLineNode;

/** Minimal ordered source document. `rawText` is the byte-patching authority. */
export interface BlkSourceDocument {
  readonly rawText: string;
  readonly hasBom: boolean;
  readonly eol: '\n' | '\r\n' | '\r' | 'mixed' | 'none';
  readonly nodes: readonly BlkSourceNode[];
  readonly blocks: readonly BlkSourceBlockOccurrence[];
}

/**
 * Bounded BLK reader with indexed tag lookup and an ordered source
 * document. Tags are case-insensitive; duplicate occurrences remain visible in
 * `sourceDocument` while legacy lookup intentionally observes the last one.
 */
export class BuildingBlock {
  private readonly blocks = new Map<string, string[]>();
  readonly sourceDocument: BlkSourceDocument;

  constructor(content: string, limits: Partial<BuildingBlockLimits> = {}) {
    const effectiveLimits = validateLimits({ ...DEFAULT_BUILDING_BLOCK_LIMITS, ...limits });
    this.sourceDocument = this.parse(content, effectiveLimits);
  }

  exists(key: string): boolean {
    return this.blocks.has(key.toLowerCase());
  }

  getDataAsString(key: string): string[] {
    return this.blocks.get(key.toLowerCase()) ?? [];
  }

  getFirstString(key: string): string {
    return this.getDataAsString(key)[0] ?? '';
  }

  getDataAsInt(key: string): number[] {
    return this.getDataAsString(key).map(parseExactInteger);
  }

  getFirstInt(key: string): number {
    const value = this.getDataAsString(key)[0];
    return value === undefined ? NaN : parseExactInteger(value);
  }

  getDataAsDouble(key: string): number[] {
    return this.getDataAsString(key).map(parseExactFiniteNumber);
  }

  getFirstDouble(key: string): number {
    const value = this.getDataAsString(key)[0];
    return value === undefined ? NaN : parseExactFiniteNumber(value);
  }

  getTagNames(): string[] {
    return [...this.blocks.keys()];
  }

  getOccurrences(key: string): readonly BlkSourceBlockOccurrence[] {
    const normalized = key.toLowerCase();
    return this.sourceDocument.blocks.filter(block => block.normalizedTag === normalized);
  }

  private parse(content: string, limits: BuildingBlockLimits): BlkSourceDocument {
    const byteLength = new TextEncoder().encode(content).byteLength;
    assertWithin('maxBytes', byteLength, limits.maxBytes);

    const rawLines = content.split(/\r\n|\n|\r/u);
    assertWithin('maxLines', rawLines.length, limits.maxLines);

    const nodes: BlkSourceNode[] = [];
    const blockOccurrences: BlkSourceBlockOccurrence[] = [];
    let currentTag: { raw: string; normalized: string; startLine: number } | null = null;
    let currentValues: string[] = [];
    let currentRawLines: string[] = [];
    let totalValues = 0;

    for (let index = 0; index < rawLines.length; index++) {
      let rawLine = rawLines[index];
      if (index === 0 && rawLine.startsWith('\uFEFF')) rawLine = rawLine.slice(1);
      assertWithin('maxLineLength', rawLine.length, limits.maxLineLength);
      const lineNumber = index + 1;
      const trimmed = rawLine.trim();

      if (currentTag === null) {
        if (trimmed.length === 0) {
          nodes.push({ kind: 'blank', line: lineNumber, raw: rawLine });
          continue;
        }
        if (trimmed.startsWith('#')) {
          nodes.push({ kind: 'comment', line: lineNumber, raw: rawLine });
          continue;
        }
        const opening = parseOpeningTag(trimmed, limits.maxTagLength);
        if (opening) {
          assertWithin('maxBlocks', blockOccurrences.length + 1, limits.maxBlocks);
          currentTag = { raw: opening, normalized: opening.toLowerCase(), startLine: lineNumber };
          currentValues = [];
          currentRawLines = [rawLine];
          continue;
        }
        nodes.push({ kind: 'opaque', line: lineNumber, raw: rawLine });
        continue;
      }

      currentRawLines.push(rawLine);
      const closing = parseClosingTag(trimmed, limits.maxTagLength);
      if (closing !== undefined && closing.toLowerCase() === currentTag.normalized) {
        const occurrence: BlkSourceBlockOccurrence = Object.freeze({
          kind: 'block',
          tag: currentTag.raw,
          normalizedTag: currentTag.normalized,
          startLine: currentTag.startLine,
          endLine: lineNumber,
          values: Object.freeze([...currentValues]),
          rawLines: Object.freeze([...currentRawLines]),
        });
        blockOccurrences.push(occurrence);
        nodes.push(occurrence);
        this.blocks.set(currentTag.normalized, [...currentValues]);
        currentTag = null;
        currentValues = [];
        currentRawLines = [];
        continue;
      }

      // A mismatched HTML-style closing tag is data, not silently discarded.
      currentValues.push(trimmed);
      totalValues++;
      assertWithin('maxValuesPerBlock', currentValues.length, limits.maxValuesPerBlock);
      assertWithin('maxTotalValues', totalValues, limits.maxTotalValues);
    }

    if (currentTag !== null) {
      throw new BuildingBlockSyntaxError(currentTag.startLine, `Unclosed <${currentTag.raw}> block`);
    }

    return Object.freeze({
      rawText: content,
      hasBom: content.startsWith('\uFEFF'),
      eol: detectEol(content),
      nodes: Object.freeze(nodes),
      blocks: Object.freeze(blockOccurrences),
    });
  }
}

export function parseExactInteger(value: string): number {
  if (!/^[+-]?\d+$/u.test(value)) return NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : NaN;
}

export function parseExactFiniteNumber(value: string): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)) return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseOpeningTag(line: string, maxTagLength: number): string | undefined {
  if (line.length <= 2 || line[0] !== '<' || line[1] === '/' || !line.endsWith('>')) return undefined;
  const tag = line.slice(1, -1);
  if (!tag || tag.length > maxTagLength || /[<>\u0000-\u001f\u007f]/u.test(tag)) {
    throw new BuildingBlockSyntaxError(0, 'Invalid opening tag');
  }
  return tag;
}

function parseClosingTag(line: string, maxTagLength: number): string | undefined {
  if (line.length <= 3 || !line.startsWith('</') || !line.endsWith('>')) return undefined;
  const tag = line.slice(2, -1);
  if (!tag || tag.length > maxTagLength || /[<>\u0000-\u001f\u007f]/u.test(tag)) return undefined;
  return tag;
}

function validateLimits(limits: BuildingBlockLimits): BuildingBlockLimits {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name} source limit`);
  }
  return limits;
}

function assertWithin(name: keyof BuildingBlockLimits, value: number, maximum: number): void {
  if (value > maximum) {
    throw new BuildingBlockLimitError(name, `BLK ${name} exceeded: ${value} > ${maximum}`);
  }
}

function detectEol(content: string): BlkSourceDocument['eol'] {
  const hasCrLf = content.includes('\r\n');
  const withoutCrLf = content.replace(/\r\n/gu, '');
  const hasLf = withoutCrLf.includes('\n');
  const hasCr = withoutCrLf.includes('\r');
  const count = Number(hasCrLf) + Number(hasLf) + Number(hasCr);
  if (count > 1) return 'mixed';
  if (hasCrLf) return '\r\n';
  if (hasLf) return '\n';
  if (hasCr) return '\r';
  return 'none';
}
