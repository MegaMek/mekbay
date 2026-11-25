// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment } from '../../equipment.model';
import { createTestEquipmentRegistry } from '../testing/test-equipment-registry';
import { BuildingBlock } from './building-block';
import { parseBlkBA } from './blk-ba-parser';
import { ParseContext } from './parse-context';

describe('BLK battle armor parser', () => {
  const jumpJet = new MiscEquipment({
    id: 'BAJumpJet',
    name: 'BA Jump Jet',
    type: 'misc',
  });
  const registry = createTestEquipmentRegistry({ [jumpJet.id]: jumpJet });

  it('treats Leg movement with propulsion MP as Jump movement', () => {
    const entity = parse('<motion_type>\nLeg\n</motion_type>\n<jumpingMP>\n2\n</jumpingMP>');

    expect(entity.propulsionMP()).toBe(2);
    expect(entity.motiveType()).toBe('Jump');
  });

  it('keeps Leg movement when propulsion MP is zero', () => {
    const entity = parse('<motion_type>\nLeg\n</motion_type>\n<jumpingMP>\n0\n</jumpingMP>');

    expect(entity.motiveType()).toBe('Leg');
  });

  it('does not replace another movement type when propulsion MP is positive', () => {
    const entity = parse('<motion_type>\nUMU\n</motion_type>\n<jumpingMP>\n2\n</jumpingMP>');

    expect(entity.motiveType()).toBe('UMU');
  });

  function parse(content: string) {
    return parseBlkBA(new BuildingBlock(content), new ParseContext('battle-armor.blk', registry));
  }
});
