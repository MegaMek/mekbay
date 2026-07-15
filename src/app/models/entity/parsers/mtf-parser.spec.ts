import { ParseContext } from './parse-context';
import { parseMtf } from './mtf-parser';

describe('MTF parser identity', () => {
  it('preserves an existing UUID', () => {
    const uuid = '019f6767-0dcb-7bb8-992f-aef08202f5e1';
    const entity = parseMtf(minimalMtf(`uuid:${uuid}\n`), new ParseContext('test.mtf', {}));

    expect(entity.uuid()).toBe(uuid);
  });

  it('generates a UUID when the file does not provide one', () => {
    const entity = parseMtf(minimalMtf(), new ParseContext('test.mtf', {}));

    expect(entity.uuid()).toBeTruthy();
  });
});

function minimalMtf(identity = ''): string {
  return `${identity}chassis:Test
model:TST-1
Config:Biped
mass:20
engine:100 Fusion Engine
heat sinks:10 Single
walk mp:5
jump mp:0
armor:Standard(Inner Sphere)
`;
}