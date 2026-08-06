// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  areMekSplitLocationsAdjacent,
  BIPED_TOPOLOGY,
  getMekLocationLabel,
  getMekLocationParent,
  getMekSplitPrimaryLocation,
  getTopologyFor,
  MEK_SIDE_TORSO_LOCATIONS,
  MEK_TORSO_LOCATIONS,
  QUAD_TOPOLOGY,
  TRIPOD_TOPOLOGY,
} from './mek';

describe('Mek location helpers', () => {
  it('labels every canonical Mek location', () => {
    expect([
      'HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL',
      'CL', 'FLL', 'FRL', 'RLL', 'RRL',
    ].map(location => getMekLocationLabel(location))).toEqual([
      'Head', 'Center Torso', 'Left Torso', 'Right Torso',
      'Left Arm', 'Right Arm', 'Left Leg', 'Right Leg',
      'Center Leg', 'Front Left Leg', 'Front Right Leg',
      'Rear Left Leg', 'Rear Right Leg',
    ]);
  });

  it('rejects missing and non-Mek locations', () => {
    expect(getMekLocationLabel(undefined)).toBeNull();
    expect(getMekLocationLabel('Body')).toBeNull();
  });

  it('defines canonical torso groups', () => {
    expect([...MEK_TORSO_LOCATIONS]).toEqual(['CT', 'LT', 'RT']);
    expect(MEK_SIDE_TORSO_LOCATIONS).toEqual(['LT', 'RT']);
  });

  it('defines only locations belonging to each topology', () => {
    expect(Object.keys(BIPED_TOPOLOGY)).toEqual([
      'HD', 'CT', 'RT', 'LT', 'RA', 'LA', 'RL', 'LL',
    ]);
    expect(Object.keys(TRIPOD_TOPOLOGY)).toEqual([
      'HD', 'CT', 'RT', 'LT', 'RA', 'LA', 'RL', 'LL', 'CL',
    ]);
    expect(Object.keys(QUAD_TOPOLOGY)).toEqual([
      'HD', 'CT', 'RT', 'LT', 'FRL', 'FLL', 'RRL', 'RLL',
    ]);
  });

  it('selects topology from the available locations', () => {
    expect(getTopologyFor(['CT', 'LA', 'LL'])).toBe(BIPED_TOPOLOGY);
    expect(getTopologyFor(['CT', 'LA', 'LL', 'CL'])).toBe(TRIPOD_TOPOLOGY);
    expect(getTopologyFor(['CT', 'FLL', 'RLL'])).toBe(QUAD_TOPOLOGY);
  });

  it('resolves only attached dependents from the active Mek topology', () => {
    const bipedLocations = ['CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'];
    expect(getMekLocationParent(bipedLocations, 'LA')).toBe('LT');
    expect(getMekLocationParent(bipedLocations, 'RA')).toBe('RT');
    expect(getMekLocationParent(bipedLocations, 'LL')).toBeNull();

    const quadLocations = ['CT', 'LT', 'RT', 'FLL', 'FRL', 'RLL', 'RRL'];
    expect(getMekLocationParent(quadLocations, 'FLL')).toBe('LT');
    expect(getMekLocationParent(quadLocations, 'FRL')).toBe('RT');
    expect(getMekLocationParent(quadLocations, 'RLL')).toBeNull();
    expect(getMekLocationParent(quadLocations, 'RRL')).toBeNull();
    expect(getMekLocationParent(quadLocations, 'Body')).toBeNull();
  });

  it('identifies legal split-equipment location pairs in either order', () => {
    expect(areMekSplitLocationsAdjacent('LA', 'LT')).toBeTrue();
    expect(areMekSplitLocationsAdjacent('LT', 'LA')).toBeTrue();
    expect(areMekSplitLocationsAdjacent('LT', 'CT')).toBeTrue();
    expect(areMekSplitLocationsAdjacent('CT', 'RT')).toBeTrue();
    expect(areMekSplitLocationsAdjacent('LA', 'CT')).toBeFalse();
    expect(areMekSplitLocationsAdjacent('LL', 'LT')).toBeFalse();
    expect(areMekSplitLocationsAdjacent('Body', 'CT')).toBeFalse();
  });

  it('selects the split location with the more restrictive firing arc', () => {
    expect(getMekSplitPrimaryLocation('LA', 'LT')).toBe('LT');
    expect(getMekSplitPrimaryLocation('RT', 'RA')).toBe('RT');
    expect(getMekSplitPrimaryLocation('LT', 'CT')).toBe('CT');
    expect(getMekSplitPrimaryLocation('CT', 'RT')).toBe('CT');
  });
});