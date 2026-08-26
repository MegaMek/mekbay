// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '..');
const appRoot = join(repositoryRoot, 'src', 'app');
const runtimeRoot = join(appRoot, 'models', 'runtime');
const handlersRoot = join(appRoot, 'equipment-handlers');
const equipmentDialogRoot = join(appRoot, 'components', 'equipment-dialog');
const kernelPath = join(runtimeRoot, 'equipment-status-kernel.ts');
const sharedStatusPath = join(appRoot, 'models', 'equipment-status.model.ts');
const equipmentRegistryPath = join(appRoot, 'services', 'equipment-interaction-registry.service.ts');
const equipmentBehaviorsPath = join(runtimeRoot, 'equipment-behaviors.ts');
const componentModeRulesPath = join(runtimeRoot, 'mek-component-rules.ts');
const modelsRoot = join(appRoot, 'models');
const equipmentFlagsTypePath = join(modelsRoot, 'equipment-flags.type.ts');

function filesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return filesBelow(path);
    return extname(path) === '.ts' ? [path] : [];
  });
}

function isProduction(path: string): boolean {
  return !path.endsWith('.spec.ts') && !path.split(/[\\/]/u).includes('testing');
}

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function display(path: string): string {
  return relative(repositoryRoot, path).replaceAll('\\', '/');
}

const production = filesBelow(appRoot).filter(isProduction);
const facadeFiles = production.filter(path => /(?:^|[-_.])facade(?:[-_.]|$)/iu.test(basename(path)));
assert.deepEqual(facadeFiles.map(display), [], 'equipment runtime facades must stay deleted');
const discardedRuntimeImport = /(?:from\s+['"][^'"]*(?:mounted-equipment|cbt-force-unit|legacy-component-mode-adapter|legacy-equipment-dialog-context|[-/]facade)|import\s*\(\s*['"][^'"]*(?:mounted-equipment|cbt-force-unit|legacy-component-mode-adapter|legacy-equipment-dialog-context|[-/]facade))/u;

const deletedPaths = [
  join(appRoot, 'models', 'cbt-force-unit.model.ts'),
  join(appRoot, 'models', 'legacy-component-mode-adapter.ts'),
  join(appRoot, 'utils', 'ammo-interaction.util.ts'),
  join(equipmentDialogRoot, 'legacy-equipment-dialog-context.adapter.ts'),
];
for (const path of deletedPaths) {
  assert.equal(existsSync(path), false, `${display(path)} must stay deleted`);
}

const componentModules = production.filter(path => (
  path.startsWith(runtimeRoot) && basename(path).startsWith('component-')
));
assert.ok(componentModules.length > 0, 'direct component runtime modules are missing');
for (const path of componentModules) {
  assert.doesNotMatch(
    source(path),
    /(?:@angular\/|document\.|querySelector|SVGElement|HTMLElement)/u,
    `${display(path)} must stay independent of Angular, the DOM, facades, and the discarded mounted graph`,
  );
  assert.doesNotMatch(source(path), discardedRuntimeImport);
}

const registry = source(equipmentRegistryPath);
assert.doesNotMatch(
  registry,
  /(?:models\/runtime\/component-|\bF_[A-Z0-9_]+\b|switch\s*\()/u,
  'the generic interaction registry must not know named equipment, flags, or interaction kinds',
);
assert.ok(
  registry.split(/\r?\n/u).length < 350,
  'the generic interaction registry has grown back into a feature god class',
);
assert.doesNotMatch(
  registry,
  discardedRuntimeImport,
  'the equipment registry must use direct component definitions only',
);

assert.deepEqual(
  filesBelow(handlersRoot).filter(isProduction).map(display),
  [],
  'production equipment handlers must stay co-located with their equipment-owned runtime modules',
);

const behaviors = source(equipmentBehaviorsPath);
assert.doesNotMatch(behaviors, /(?:switch\s*\(|\.hasFlag\(|\bF_[A-Z0-9_]+\b)/u);
const concreteInteractionClasses = componentModules.flatMap(path => [...source(path).matchAll(
  /export\s+class\s+([A-Za-z0-9_]+)\s+extends\s+(?:EquipmentInteractionHandler|ComponentModeHandler|ToggleHandler|EscalatingFailureHandler)/gu,
)].map(match => ({ name: match[1], path })));
for (const handler of concreteInteractionClasses.filter(candidate => candidate.name !== 'EscalatingFailureHandler')) {
  assert.match(
    behaviors,
    new RegExp(`\\bnew\\s+${handler.name}\\s*\\(`, 'u'),
    `${display(handler.path)} exports ${handler.name}, but the sole behavior composition root does not register it`,
  );
}

const componentModeRules = source(componentModeRulesPath);
assert.doesNotMatch(
  componentModeRules,
  /(?:\.has(?:All|Any)?Flag\(|\bF_[A-Z0-9_]+\b)/u,
  'generic component-mode orchestration must delegate every named equipment rule',
);
for (const match of componentModeRules.matchAll(/from\s+['"]\.\/(component-[^'"]+)['"]/gu)) {
  const ownerPath = join(runtimeRoot, `${match[1]}.ts`);
  assert.doesNotMatch(
    source(ownerPath),
    /from\s+['"]\.\/component-mode['"]/u,
    `${display(ownerPath)} creates a component-mode dependency cycle`,
  );
}

const equipmentFlagPattern = /\b[FS]_[A-Z0-9_]+\b/gu;
const equipmentFlagDeclarations = new Set(source(equipmentFlagsTypePath).match(equipmentFlagPattern) ?? []);
const equipmentFlagOwners = new Map<string, string[]>();
for (const path of production.filter(candidate => candidate !== equipmentFlagsTypePath)) {
  for (const flag of new Set(source(path).match(equipmentFlagPattern) ?? [])) {
    const owners = equipmentFlagOwners.get(flag) ?? [];
    owners.push(path);
    equipmentFlagOwners.set(flag, owners);
  }
}
assert.ok(equipmentFlagOwners.size > 250, 'the equipment ownership audit unexpectedly covers too little of the catalog');
for (const [flag, owners] of equipmentFlagOwners) {
  assert.ok(equipmentFlagDeclarations.has(flag), `${flag} is used but absent from EquipmentFlag`);
  assert.deepEqual(
    owners.map(display),
    [display(owners[0])],
    `${flag} has more than one raw production owner:\n${owners.map(display).join('\n')}`,
  );
}

const focusedNestedOwners = new Set([
  join(modelsRoot, 'entity', 'utils', 'fire-control.ts'),
  join(modelsRoot, 'entity', 'utils', 'physical-weapon-kernel.ts'),
  join(modelsRoot, 'entity', 'utils', 'targeting-computer.ts'),
]);
const misplacedEquipmentOwners = [...new Set([...equipmentFlagOwners.values()].flat())]
  .filter(path => dirname(path) !== modelsRoot && !focusedNestedOwners.has(path));
assert.deepEqual(
  misplacedEquipmentOwners.map(display),
  [],
  'raw equipment flags must stay in focused model owners, never entities, calculators, runtimes, or presentation code',
);

const rawFlagImport = /import\s*\{[^}]*\b[A-Z0-9_]+_FLAGS?\b[^}]*\}\s*from/u;
const genericFlagConstantConsumers = production.filter(path => (
  path !== join(modelsRoot, 'c3-network.model.ts')
  && !path.startsWith(runtimeRoot)
  && rawFlagImport.test(source(path))
));
assert.deepEqual(
  genericFlagConstantConsumers.map(display),
  [],
  'generic production code must consume equipment semantics instead of exported flag constants',
);

for (const path of filesBelow(equipmentDialogRoot).filter(isProduction)) {
  assert.doesNotMatch(
    source(path),
    discardedRuntimeImport,
    `${display(path)} must consume the ComponentId dialog boundary`,
  );
}

const kernel = source(kernelPath);
assert.match(kernel, /from '\.\.\/equipment-status\.model'/u);
assert.match(kernel, /from '\.\.\/cbt-ruleset\.model'/u);
assert.doesNotMatch(
  kernel,
  /(?:@angular\/|document\.|querySelector|equipment-handlers|services\/)/u,
);
assert.doesNotMatch(kernel, discardedRuntimeImport);

const composerDefinitions = production.filter(path => (
  /function\s+combineEquipmentStatuses\s*\(/u.test(source(path))
));
assert.deepEqual(
  composerDefinitions.map(display),
  ['src/app/models/equipment-status.model.ts'],
  'equipment status severity composition must have one definition',
);

const kernelConsumers = production.filter(path => (
  path !== kernelPath && /equipment-status-kernel/u.test(source(path))
));
assert.ok(
  kernelConsumers.every(path => path.startsWith(runtimeRoot)),
  `only runtime modules may import the status kernel:\n${kernelConsumers.map(display).join('\n')}`,
);

assert.doesNotMatch(source(sharedStatusPath), /^import\s+(?!type\b)/mu);

console.log(
  `Equipment architecture guard passed: ${equipmentFlagOwners.size} behavior flags have one focused owner; `
    + `${componentModules.length} co-located runtime modules, one generic registry, no facades.`,
);
