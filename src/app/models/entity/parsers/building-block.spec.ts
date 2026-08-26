// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  BuildingBlock,
  BuildingBlockLimitError,
  BuildingBlockSyntaxError,
} from './building-block';

describe('BuildingBlock', () => {
  it('retains order, duplicate occurrences, comments, raw text, BOM, and EOL', () => {
    const raw = '\uFEFF# header\r\n<Name>\r\nFirst\r\n</Name>\r\n<Name>\r\nSecond\r\n</Name>\r\n';
    const block = new BuildingBlock(raw);

    expect(block.getFirstString('name')).toBe('Second');
    expect(block.getOccurrences('NAME').map(item => item.values[0])).toEqual(['First', 'Second']);
    expect(block.sourceDocument.rawText).toBe(raw);
    expect(block.sourceDocument.hasBom).toBeTrue();
    expect(block.sourceDocument.eol).toBe('\r\n');
    expect(block.sourceDocument.nodes[0]).toEqual(jasmine.objectContaining({ kind: 'comment' }));
  });

  it('preserves mismatched HTML closing tags as fluff values', () => {
    const block = new BuildingBlock('<overview>\n<p>text</p>\n</overview>');

    expect(block.getDataAsString('overview')).toEqual(['<p>text</p>']);
  });

  it('rejects junk-suffix numerics instead of silently truncating them', () => {
    const block = new BuildingBlock('<year>\n3025junk\n</year>\n<mass>\n20.5tons\n</mass>');

    expect(block.getFirstInt('year')).toBeNaN();
    expect(block.getFirstDouble('mass')).toBeNaN();
  });

  it('fails closed on unclosed blocks and resource ceilings', () => {
    expect(() => new BuildingBlock('<Name>\nUnclosed')).toThrowError(BuildingBlockSyntaxError);
    expect(() => new BuildingBlock('<Name>\nA\n</Name>', { maxBytes: 4 }))
      .toThrowError(BuildingBlockLimitError);
  });
});
