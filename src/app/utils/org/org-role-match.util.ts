import type { GroupFacts, OrgChildRoleSpec } from './org-types';

export function groupMatchesChildRole(
    group: Pick<GroupFacts, 'type' | 'countsAsType' | 'unitTypeCounts' | 'unitTagCounts' | 'tag'>,
    role: OrgChildRoleSpec,
): boolean {
    const groupType = group.type;
    const countsAsType = group.countsAsType;
    const matchesType = (groupType !== null && role.matches.includes(groupType))
        || (countsAsType !== null && role.matches.includes(countsAsType));
    if (!matchesType) {
        return false;
    }

    if (role.onlyUnitTypes && role.onlyUnitTypes.length > 0) {
        for (const [unitType, count] of group.unitTypeCounts.entries()) {
            if (count > 0 && !role.onlyUnitTypes.includes(unitType)) {
                return false;
            }
        }
    }

    if (role.requiredUnitTagsAny && role.requiredUnitTagsAny.length > 0) {
        const hasAny = role.requiredUnitTagsAny.some((tag) => (group.unitTagCounts.get(tag) ?? 0) > 0);
        if (!hasAny) {
            return false;
        }
    }

    if (role.requiredUnitTagsAll && role.requiredUnitTagsAll.length > 0) {
        const hasAll = role.requiredUnitTagsAll.every((tag) => (group.unitTagCounts.get(tag) ?? 0) > 0);
        if (!hasAll) {
            return false;
        }
    }

    if (role.requiredTagsAny && role.requiredTagsAny.length > 0) {
        if (!group.tag || !role.requiredTagsAny.includes(group.tag)) {
            return false;
        }
    }

    if (role.requiredTagsAll && role.requiredTagsAll.length > 0) {
        if (!group.tag || !role.requiredTagsAll.every((tag) => tag === group.tag)) {
            return false;
        }
    }

    return true;
}