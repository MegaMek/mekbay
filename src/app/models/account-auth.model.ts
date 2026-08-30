// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake


export type OAuthProvider = 'google' | 'apple' | 'discord';

export interface AvailableAuthProvider {
    provider: OAuthProvider;
    label: string;
    enabled: boolean;
}

export interface LinkedOAuthProvider {
    provider: OAuthProvider;
    email?: string;
    emailVerified?: boolean;
    displayName?: string;
    avatarUrl?: string;
    linkedAt: string;
    lastLoginAt?: string;
}

export interface UserStateSnapshot {
    publicId?: string | null;
    displayName?: string | null;
    hasOAuth?: boolean;
    oauthProviderCount?: number;
    oauthProviders?: LinkedOAuthProvider[];
    availableAuthProviders?: AvailableAuthProvider[];
    accountProtectionPromptDismissed?: boolean;
}

export interface OAuthFlowResult {
    source: 'mekbay-oauth';
    ok: boolean;
    mode?: 'link' | 'login';
    provider?: OAuthProvider;
    uuid?: string;
    conflict?: 'provider-linked-to-another-account';
    error?: string;
    replaceExisting?: boolean;
    userState?: UserStateSnapshot;
}

export type OAuthPopupResult = OAuthFlowResult;
