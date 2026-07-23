import { calculateProtoMekEngineWeight } from './protomek-weight';

describe('ProtoMek construction weight', () => {
  it('exports the ProtoMek-specific engine calculator', () => {
    expect(calculateProtoMekEngineWeight).toBeDefined();
  });
});