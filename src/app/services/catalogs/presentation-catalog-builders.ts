// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { FluffImageCatalog } from '../../models/presentation-catalog.model';
import type { UnitProviderId } from '../unit-catalog/unit-catalog.types';
import { parseFluffImageCatalog, type FluffImageCatalogValidationOptions } from '../../utils/fluff-image-resolver';

interface CatalogInput {
  readonly provider: UnitProviderId;
  readonly baseUrl: string;
  readonly wireJson: string;
}

export interface BuildFluffImageCatalogInput extends CatalogInput {
  readonly validation?: FluffImageCatalogValidationOptions;
}

export function buildFluffImageCatalog(input: BuildFluffImageCatalogInput): FluffImageCatalog {
  return Object.freeze({
    provider: input.provider,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    paths: parseFluffImageCatalog(parseJson(input.wireJson), input.validation),
  });
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(`Invalid presentation catalog JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
    throw new Error('Provider asset URL must be uncredentialed HTTP(S)');
  }
  if (parsed.search || parsed.hash) throw new Error('Provider asset URL cannot contain a query or fragment');
  const pathname = parsed.pathname.replace(/\/+$/gu, '');
  return `${parsed.origin}${pathname === '/' ? '' : pathname}`;
}
