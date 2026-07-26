import { AlphaStrikeSpecialAbilityCollector } from './special-ability-collector';

describe('AlphaStrikeSpecialAbilityCollector', () => {
  it('deduplicates plain abilities and returns deterministic ordering', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();

    collector.add('TAG');
    collector.add('AMS');
    collector.add('TAG');

    expect(collector.toArray()).toEqual(['AMS', 'TAG']);
  });

  it('aggregates numeric abilities without inspecting serialized values', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();

    collector.addNumeric('MHQ', 2);
    collector.addNumeric('MHQ', 3);
    collector.addNumeric('TSEMP', 1);

    expect(collector.toArray()).toEqual(['MHQ5', 'TSEMP1']);
  });

  it('aggregates artillery-style hyphenated counts independently', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();

    collector.addHyphenatedCount('ARTS');
    collector.addHyphenatedCount('ARTS', 2);
    collector.addHyphenatedCount('ARTLT');

    expect(collector.toArray()).toEqual(['ARTLT-1', 'ARTS-3']);
  });

  it('keeps plain, numeric, and hyphenated forms separate', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();

    collector.add('ARTS');
    collector.addNumeric('ARTS', 2);
    collector.addHyphenatedCount('ARTS', 3);

    expect(collector.toArray()).toEqual(['ARTS', 'ARTS-3', 'ARTS2']);
  });

  it('supports membership checks and removal of plain abilities', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();
    collector.addAll(['CASE', 'CASEII']);

    expect(collector.has('CASE')).toBeTrue();
    collector.delete('CASE');

    expect(collector.has('CASE')).toBeFalse();
    expect(collector.toArray()).toEqual(['CASEII']);
  });
});
