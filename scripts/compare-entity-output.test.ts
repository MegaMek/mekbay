import assert from 'node:assert/strict';
import { nativeEntityComparisonRows } from './lib/native-entity-comparison';

assert.deepEqual(nativeEntityComparisonRows([
    '# ignored',
    'generator:ignored',
    'overview:  prose with source padding  ',
    'walkmp: 4 ',
].join('\n')), [
    'overview:prose with source padding',
    'walkmp: 4 ',
]);

assert.deepEqual(nativeEntityComparisonRows([
    '<overview>',
    '  first lore row  ',
    ' second lore row ',
    '</overview>',
    '<walkmp>',
    ' 4 ',
    '</walkmp>',
].join('\n')), [
    '<overview>',
    'first lore row',
    'second lore row',
    '</overview>',
    '<walkmp>',
    ' 4 ',
    '</walkmp>',
]);

assert.deepEqual(nativeEntityComparisonRows(' # still significant\n generator:still significant'), [
    ' # still significant',
    ' generator:still significant',
]);

console.log('compare-entity-output tests passed');
