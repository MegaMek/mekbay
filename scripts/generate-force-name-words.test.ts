/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    parseCsvRows,
    parseWeight,
    compactPilotNameCatalog,
    readCallsigns,
    readFactionMatrices,
    readMulFactionNameGenerators,
    readWeightedNames,
    readBloodnameData,
    buildPilotFactionProfiles,
} from './generate-force-name-words';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-pilot-names-'));

try {
    assert.deepEqual(
        parseCsvRows('Name,Weight\r\n"Alpha, One",2\r\n"Quote ""Ace""",1\r\n'),
        [['Name', 'Weight'], ['Alpha, One', '2'], ['Quote "Ace"', '1']],
        'CSV parsing should support quoted commas, escaped quotes, and CRLF',
    );
    assert.throws(() => parseCsvRows('"unfinished'), /inside a quoted value/);
    assert.equal(parseWeight(' 42 ', 'fixture.csv', 2), 42);
    assert.throws(() => parseWeight('-1', 'fixture.csv', 2), /invalid Weight/);

    const namesPath = path.join(tempDirectory, 'names.csv');
    fs.writeFileSync(namesPath, 'Ethnic Code,Name,Weight\n1,Ada,2\n1,Ada,5\n1,Zero,0\n2,Bo,1\n');
    assert.deepEqual(readWeightedNames(namesPath), {
        1: [{ value: 'Ada', weight: 5 }],
        2: [{ value: 'Bo', weight: 1 }],
    }, 'duplicate names should use the last weight and zero weights should be omitted');
    fs.writeFileSync(namesPath, 'Ethnic Code,Name,Weight\n1,Missing Weight,\n');
    assert.throws(() => readWeightedNames(namesPath), /must contain Ethnic Code, Name, and Weight/);
    fs.writeFileSync(namesPath, 'Ethnic Code,Name,Weight\n1,,1\n1,Ada,1\n');
    assert.deepEqual(readWeightedNames(namesPath), { 1: [{ value: 'Ada', weight: 1 }] });

    const callsignsPath = path.join(tempDirectory, 'callsigns.csv');
    fs.writeFileSync(callsignsPath, 'Callsign,Weight\nAlpha, One,2\nDuplicate,1\nDuplicate,3\nZero,0\n');
    assert.deepEqual(readCallsigns(callsignsPath), [
        { value: 'Alpha, One', weight: 2 },
        { value: 'Duplicate', weight: 3 },
    ], 'callsigns should split on the last comma and use last-write-wins semantics');
    fs.writeFileSync(callsignsPath, 'Callsign,Weight\nMalformed\n');
    assert.throws(() => readCallsigns(callsignsPath), /must contain Callsign and Weight/);

    const factionDirectory = path.join(tempDirectory, 'factions');
    fs.mkdirSync(factionDirectory);
    fs.writeFileSync(path.join(factionDirectory, 'General.csv'), 'Ethnic Code,Name,Surname,Given 1,Given 2\n1,One,1,1,0\n2,Two,0,0,1\n');
    const nameGroups = {
        maleGivenNames: { 1: [{ value: 'John', weight: 1 }], 2: [{ value: 'Bo', weight: 1 }] },
        femaleGivenNames: { 1: [{ value: 'Jane', weight: 1 }], 2: [{ value: 'Ada', weight: 1 }] },
        surnames: { 1: [{ value: 'Smith', weight: 1 }] },
    };
    assert.equal(readFactionMatrices(factionDirectory, 2, nameGroups).General.surnameEthnicities[0].value, 1);
    fs.writeFileSync(path.join(factionDirectory, 'General.csv'), 'Ethnic Code,Name,Surname,Given 1,Given 2\n3,Three,1,1,0\n');
    assert.throws(() => readFactionMatrices(factionDirectory, 2, nameGroups), /out-of-range ethnicity code/);
    fs.writeFileSync(path.join(factionDirectory, 'General.csv'), 'Ethnic Code,Name,Surname,Given 1,Given 2\n1,One,1,1,0\n1,One Again,1,1,0\n');
    assert.throws(() => readFactionMatrices(factionDirectory, 2, nameGroups), /duplicates ethnicity code/);

    const mmDataRoot = path.join(tempDirectory, 'mm-data');
    const universeFactions = path.join(mmDataRoot, 'data', 'universe', 'factions');
    fs.mkdirSync(universeFactions, { recursive: true });
    fs.writeFileSync(path.join(universeFactions, 'a.yml'), 'key: A\nnameGenerator: General\n');
    fs.writeFileSync(path.join(universeFactions, 'b.yml'), 'key: B\nnameGenerator: Clan\n');
    const mappingPath = path.join(tempDirectory, 'mapping.csv');
    fs.writeFileSync(mappingPath, 'id,mul_id\nA,1\nB,1\n');
    assert.throws(() => readMulFactionNameGenerators(mmDataRoot, mappingPath, {}), /conflicting name generators/);
    assert.deepEqual(readMulFactionNameGenerators(mmDataRoot, mappingPath, { 1: 'Clan' }), { 1: 'Clan' });

    const bloodnameDirectory = path.join(tempDirectory, 'bloodnames');
    fs.mkdirSync(bloodnameDirectory);
    const validClansXml = '<clans><clan code="CW"><fullName>Clan Wolf</fullName><rivals start="3000">CJF,CSJ</rivals><homeClan/></clan><clan code="CJF"/><clan code="CSJ"/><clan code="CWE" start="3142"><generateAsIf>CW</generateAsIf></clan></clans>';
    fs.writeFileSync(path.join(bloodnameDirectory, 'clans.xml'), validClansXml);
    fs.writeFileSync(path.join(bloodnameDirectory, 'bloodnames.xml'), `<bloodnames>
        <bloodname><name>Kerensky</name><clan>CW</clan><phenotype>MEKWARRIOR</phenotype><limited/><created>3000</created><dormant>3050</dormant><reactivated>3075</reactivated><shared date="3020">CJF,CSJ</shared></bloodname>
        <bloodname><name>Aero</name><clan>CW</clan><phenotype>AEROSPACE</phenotype></bloodname>
        <bloodname><name>Elemental</name><clan>CW</clan><phenotype>ELEMENTAL</phenotype></bloodname>
        <bloodname><name>Proto</name><clan>CW</clan><phenotype>PROTOMEK</phenotype></bloodname>
        <bloodname><name>Naval</name><clan>CW</clan><phenotype>NAVAL</phenotype></bloodname>
        <bloodname><name>General</name><clan>CW</clan></bloodname>
    </bloodnames>`);
    const bloodnameData = readBloodnameData(bloodnameDirectory);
    assert.equal(bloodnameData.clans.CWE.generationCode, 'CW');
    assert.deepEqual(bloodnameData.clans.CW.rivals.map((rival) => rival.code), ['CJF', 'CSJ']);
    assert.deepEqual(bloodnameData.bloodnames.map((bloodname) => bloodname.phenotype), ['Mek', 'Aero', 'BA', 'ProtoMek', 'Naval', '*']);
    assert.deepEqual(bloodnameData.bloodnames[0], {
        name: 'Kerensky', clan: 'CW', phenotype: 'Mek', exclusive: false, limited: true,
        start: 3020, inactive: 3060, abjured: 0, reactivated: 3095, postReaving: [],
        acquired: [{ clan: 'CJF', year: 3020 }, { clan: 'CSJ', year: 3020 }], absorbed: undefined,
    });
    fs.writeFileSync(path.join(bloodnameDirectory, 'bloodnames.xml'), '<bloodnames><bloodname><name>Invalid</name><clan>CW</clan><phenotype>UNKNOWN</phenotype></bloodname></bloodnames>');
    assert.throws(() => readBloodnameData(bloodnameDirectory), /unsupported phenotype UNKNOWN/);
    fs.writeFileSync(path.join(bloodnameDirectory, 'bloodnames.xml'), '<bloodnames><bloodname><name>Invalid</name><clan>CW</clan><shared>CJF</shared></bloodname></bloodnames>');
    assert.throws(() => readBloodnameData(bloodnameDirectory), /sharing is missing its date/);
    fs.writeFileSync(path.join(bloodnameDirectory, 'clans.xml'), '<clans><clan code="CW"/><clan code="CW"/></clans>');
    assert.throws(() => readBloodnameData(bloodnameDirectory), /Duplicate Bloodname Clan CW/);
    fs.writeFileSync(path.join(bloodnameDirectory, 'clans.xml'), '<clans><clan code="CW"><generateAsIf>UNKNOWN</generateAsIf></clan></clans>');
    assert.throws(() => readBloodnameData(bloodnameDirectory), /unknown generation Clan UNKNOWN/);
    fs.writeFileSync(path.join(bloodnameDirectory, 'clans.xml'), validClansXml);

    const mulFactionsPath = path.join(tempDirectory, 'mulfactions.csv');
    fs.writeFileSync(mulFactionsPath, 'id,name,group\n1,Clan Wolf,HW Clan\n2,General,Inner Sphere\n91,Scorpion Empire,Periphery\n92,Escorpión Imperio,Periphery\n');
    fs.writeFileSync(mappingPath, 'id,mul_id\nCW,1\nA,2\n');
    assert.deepEqual(buildPilotFactionProfiles({ 1: 'Clan', 2: 'General', 91: 'Clan', 92: 'Clan' }, mappingPath, mulFactionsPath, new Set(['CW', 'CGS'])), {
        1: { generator: 'Clan', isClan: true, bloodnameClan: 'CW' },
        2: { generator: 'General', isClan: false },
        91: { generator: 'Clan', isClan: true, bloodnameClan: 'CGS' },
        92: { generator: 'Clan', isClan: true, bloodnameClan: 'CGS' },
    });

    assert.deepEqual(compactPilotNameCatalog({
        maleGivenNames: { 1: [{ value: 'John', weight: 1 }, { value: 'Jack', weight: 2 }] },
        femaleGivenNames: { 1: [{ value: 'Jane', weight: 1 }] },
        surnames: { 1: [{ value: 'Smith', weight: 1 }] },
        factions: {
            General: {
                surnameEthnicities: [{ value: 1, weight: 1 }],
                givenNameEthnicities: { 1: [{ value: 1, weight: 1 }] },
            },
        },
        factionProfiles: { 27: { generator: 'General', isClan: false } },
        callsigns: [{ value: 'Ace', weight: 1 }, { value: 'Specter', weight: 3 }],
        bloodnameClans: {},
        bloodnames: [],
    }, 1), {
        v: 1,
        n: [[['John', ['Jack', 2]]], [['Jane']], [['Smith']]],
        c: ['Ace', ['Specter', 3]],
        f: [['General', [1], [[1]]]],
        m: [[27, 0, 0]],
        bc: [],
        b: [],
    });

    console.log('generate-force-name-words tests passed');
} finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
}
