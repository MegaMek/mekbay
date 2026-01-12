/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

/**
 * AST-based Semantic Filter Parser with Nested Bracket Support
 * 
 * Syntax:
 *   - Simple filters: field=value, field>value, etc.
 *   - Grouping: (filter1 filter2) - filters inside are AND'd by default
 *   - Boolean operators: OR, AND (case insensitive)
 *   - Nested groups: ((type=Mek bv>1000) OR (type=Aero bv<1500)) AND (firepower>=50)
 * 
 * Default behavior:
 *   - Filters at the same level without explicit operator are AND'd together
 *   - OR/AND keywords combine adjacent groups/filters
 * 
 * Examples:
 *   type=Mek bv>1000                    -> type=Mek AND bv>1000 (implicit AND)
 *   type=Mek OR type=Aero               -> type=Mek OR type=Aero
 *   (type=Mek bv>1000) OR type=Aero     -> (type=Mek AND bv>1000) OR type=Aero
 *   ((a=1) OR (b=2)) AND (c=3)          -> (a=1 OR b=2) AND c=3
 */

import { GameSystem } from '../models/common.model';
import { ADVANCED_FILTERS, AdvFilterConfig, AdvFilterType } from '../services/unit-search-filters.service';
import { SemanticOperator, SemanticToken } from './semantic-filter.util';

// ============================================================================
// Types
// ============================================================================

/** Token types produced by the lexer */
export type LexTokenType = 
    | 'LPAREN'      // (
    | 'RPAREN'      // )
    | 'OR'          // OR keyword
    | 'AND'         // AND keyword
    | 'FILTER'      // field=value
    | 'TEXT'        // plain text (not a filter)
    | 'EOF';        // end of input

/** A lexer token with position information */
export interface LexToken {
    type: LexTokenType;
    value: string;
    start: number;  // Start position in input
    end: number;    // End position (exclusive)
    // For FILTER tokens, parsed details
    filter?: {
        field: string;
        operator: SemanticOperator;
        values: string[];
        rawValue: string;
    };
}

/** Parse error with position for highlighting */
export interface ParseError {
    message: string;
    start: number;
    end: number;
}

/** AST node types */
export type ASTNodeType = 'group' | 'filter' | 'text';

/** Base AST node */
interface BaseASTNode {
    type: ASTNodeType;
    start: number;
    end: number;
}

/** Filter AST node - represents a single filter expression */
export interface FilterASTNode extends BaseASTNode {
    type: 'filter';
    token: SemanticToken;
}

/** Text AST node - represents plain text (not a filter) */
export interface TextASTNode extends BaseASTNode {
    type: 'text';
    value: string;
}

/** Group AST node - represents a group of nodes combined with AND/OR */
export interface GroupASTNode extends BaseASTNode {
    type: 'group';
    operator: 'AND' | 'OR';
    children: ASTNode[];
}

export type ASTNode = FilterASTNode | TextASTNode | GroupASTNode;

/** Result of parsing with AST and errors */
export interface ParseResult {
    ast: GroupASTNode;      // Root is always a group
    textSearch: string;     // Extracted text portions
    tokens: SemanticToken[]; // Flat list of all filter tokens (for compatibility)
    errors: ParseError[];
}

// ============================================================================
// Virtual Semantic Keys (copied from semantic-filter.util.ts for DRY)
// ============================================================================

interface VirtualSemanticKeyConfig {
    keys: string[];
    format: 'slash';
    implicit?: string[];
}

const VIRTUAL_SEMANTIC_KEYS: Record<string, VirtualSemanticKeyConfig> = {
    'dmg': { 
        keys: ['dmgs', 'dmgm', 'dmgl', 'dmge'], 
        format: 'slash',
        implicit: ['dmge']
    }
};

// ============================================================================
// Utility Functions
// ============================================================================

/** Build a lookup map from semanticKey to config */
function buildSemanticKeyMap(gameSystem: GameSystem): Map<string, AdvFilterConfig> {
    const map = new Map<string, AdvFilterConfig>();
    for (const conf of ADVANCED_FILTERS) {
        if (conf.game && conf.game !== gameSystem) continue;
        const key = conf.semanticKey || conf.key;
        if (!map.has(key)) {
            map.set(key, conf);
        }
    }
    return map;
}

/**
 * Parse a single value string that may contain comma-separated values and quotes.
 */
function parseValues(valueStr: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuote: '"' | "'" | null = null;
    let i = 0;

    while (i < valueStr.length) {
        const char = valueStr[i];

        if (inQuote) {
            if (char === '\\' && i + 1 < valueStr.length) {
                const nextChar = valueStr[i + 1];
                if (nextChar === '"' || nextChar === "'" || nextChar === '\\') {
                    current += nextChar;
                    i += 2;
                    continue;
                }
            }
            if (char === inQuote) {
                inQuote = null;
            } else {
                current += char;
            }
        } else if (char === '"' || char === "'") {
            inQuote = char;
        } else if (char === ',') {
            if (current.trim()) {
                values.push(current.trim());
            }
            current = '';
        } else {
            current += char;
        }
        i++;
    }

    if (current.trim()) {
        values.push(current.trim());
    }

    return values;
}

// ============================================================================
// Lexer
// ============================================================================

/**
 * Tokenize input into a stream of tokens with position information.
 */
function tokenize(input: string, semanticKeyMap: Map<string, AdvFilterConfig>): LexToken[] {
    const tokens: LexToken[] = [];
    let i = 0;

    while (i < input.length) {
        // Skip whitespace (but track position)
        if (/\s/.test(input[i])) {
            i++;
            continue;
        }

        // Check for parentheses
        if (input[i] === '(') {
            tokens.push({ type: 'LPAREN', value: '(', start: i, end: i + 1 });
            i++;
            continue;
        }

        if (input[i] === ')') {
            tokens.push({ type: 'RPAREN', value: ')', start: i, end: i + 1 });
            i++;
            continue;
        }

        // Check for OR/AND keywords (case insensitive, must be followed by space or paren)
        const upperRest = input.slice(i).toUpperCase();
        if (upperRest.startsWith('OR') && (i + 2 >= input.length || /[\s()]/.test(input[i + 2]))) {
            tokens.push({ type: 'OR', value: input.slice(i, i + 2), start: i, end: i + 2 });
            i += 2;
            continue;
        }
        if (upperRest.startsWith('AND') && (i + 3 >= input.length || /[\s()]/.test(input[i + 3]))) {
            tokens.push({ type: 'AND', value: input.slice(i, i + 3), start: i, end: i + 3 });
            i += 3;
            continue;
        }

        // Try to parse a filter expression
        const filterResult = tryParseFilterToken(input, i, semanticKeyMap);
        if (filterResult) {
            tokens.push(filterResult.token);
            i = filterResult.endIndex;
            continue;
        }

        // Otherwise, it's plain text - collect until whitespace, paren, or a filter
        const textStart = i;
        let textEnd = i;
        
        while (textEnd < input.length) {
            const char = input[textEnd];
            
            // Stop at whitespace or parentheses
            if (/[\s()]/.test(char)) break;
            
            // Check if we're starting a filter (word followed by operator)
            if (textEnd > textStart && tryParseFilterToken(input, textEnd, semanticKeyMap)) {
                break;
            }
            
            textEnd++;
        }

        if (textEnd > textStart) {
            const textValue = input.slice(textStart, textEnd);
            tokens.push({ type: 'TEXT', value: textValue, start: textStart, end: textEnd });
            i = textEnd;
        } else {
            // Single character we couldn't parse - skip it
            i++;
        }
    }

    tokens.push({ type: 'EOF', value: '', start: input.length, end: input.length });
    return tokens;
}

/**
 * Try to parse a filter token at the given position.
 */
function tryParseFilterToken(
    input: string,
    start: number,
    semanticKeyMap: Map<string, AdvFilterConfig>
): { token: LexToken; endIndex: number } | null {
    let i = start;
    
    // Match field name (word characters)
    while (i < input.length && /\w/.test(input[i])) {
        i++;
    }
    
    if (i === start) return null;
    
    const field = input.slice(start, i).toLowerCase();
    
    // Check if this field exists in our semantic map OR is a virtual key
    const conf = semanticKeyMap.get(field);
    const isVirtual = field in VIRTUAL_SEMANTIC_KEYS;
    
    if (!conf && !isVirtual) return null;
    
    // Match operator
    let operator: SemanticOperator | null = null;
    if (input.slice(i, i + 2) === '!=') {
        operator = '!=';
        i += 2;
    } else if (input.slice(i, i + 2) === '&=') {
        operator = '&=';
        i += 2;
    } else if (input.slice(i, i + 2) === '>=') {
        operator = '>=';
        i += 2;
    } else if (input.slice(i, i + 2) === '<=') {
        operator = '<=';
        i += 2;
    } else if (input[i] === '=') {
        operator = '=';
        i += 1;
    } else if (input[i] === '>') {
        operator = '>';
        i += 1;
    } else if (input[i] === '<') {
        operator = '<';
        i += 1;
    }
    
    if (!operator) return null;
    
    // Validate operator for filter type
    if (conf && conf.type === AdvFilterType.DROPDOWN) {
        const validDropdownOperators: SemanticOperator[] = ['=', '!=', '&='];
        if (!validDropdownOperators.includes(operator)) {
            return null;
        }
    }
    
    if (operator === '&=' && conf && conf.type !== AdvFilterType.DROPDOWN && conf.type !== AdvFilterType.SEMANTIC) {
        return null;
    }
    
    // Parse value, respecting quotes
    const valueStart = i;
    let inQuote: '"' | "'" | null = null;
    
    while (i < input.length) {
        const char = input[i];
        
        if (inQuote) {
            if (char === '\\' && i + 1 < input.length && (input[i + 1] === inQuote || input[i + 1] === '\\')) {
                i += 2; // Skip escaped character
                continue;
            }
            if (char === inQuote) {
                inQuote = null;
            }
            i++;
        } else if (char === '"' || char === "'") {
            inQuote = char;
            i++;
        } else if (/[\s()]/.test(char)) {
            // Whitespace or parentheses end the value (unless in quotes)
            break;
        } else {
            i++;
        }
    }
    
    const rawValue = input.slice(valueStart, i);
    
    // Clean the value
    let cleanValue = rawValue;
    if ((rawValue.startsWith('"') && rawValue.endsWith('"') && !rawValue.slice(1, -1).includes('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'") && !rawValue.slice(1, -1).includes("'"))) {
        cleanValue = rawValue.slice(1, -1);
    }
    
    const values = parseValues(cleanValue).filter(v => v.trim() !== '');
    
    // Skip tokens with no valid values
    if (values.length === 0) {
        return null;
    }
    
    const token: LexToken = {
        type: 'FILTER',
        value: input.slice(start, i),
        start,
        end: i,
        filter: {
            field,
            operator,
            values,
            rawValue
        }
    };
    
    return { token, endIndex: i };
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parser state for tracking position and errors.
 */
class Parser {
    private tokens: LexToken[];
    private pos: number = 0;
    private errors: ParseError[] = [];
    private input: string;

    constructor(tokens: LexToken[], input: string) {
        this.tokens = tokens;
        this.input = input;
    }

    private current(): LexToken {
        return this.tokens[this.pos] || this.tokens[this.tokens.length - 1];
    }

    private peek(offset: number = 0): LexToken {
        return this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1];
    }

    private advance(): LexToken {
        const token = this.current();
        if (this.pos < this.tokens.length - 1) {
            this.pos++;
        }
        return token;
    }

    private match(...types: LexTokenType[]): boolean {
        return types.includes(this.current().type);
    }

    private addError(message: string, start: number, end: number): void {
        this.errors.push({ message, start, end });
    }

    /**
     * Parse the entire input and return a ParseResult.
     */
    parse(): ParseResult {
        const children: ASTNode[] = [];
        
        // Parse top-level expressions
        while (!this.match('EOF')) {
            const node = this.parseExpression();
            if (node) {
                children.push(node);
            }
        }

        // Combine children with proper operator precedence
        const ast = this.combineWithOperators(children, 0, this.input.length);
        
        // Extract text search and flat tokens
        const textParts: string[] = [];
        const flatTokens: SemanticToken[] = [];
        this.extractFromAST(ast, textParts, flatTokens);

        return {
            ast,
            textSearch: textParts.join(' ').trim(),
            tokens: flatTokens,
            errors: this.errors
        };
    }

    /**
     * Parse a single expression (group, filter, text, or operator).
     */
    private parseExpression(): ASTNode | null {
        const token = this.current();

        // Handle opening parenthesis - start a group
        if (token.type === 'LPAREN') {
            return this.parseGroup();
        }

        // Handle filter
        if (token.type === 'FILTER') {
            return this.parseFilter();
        }

        // Handle text
        if (token.type === 'TEXT') {
            const textToken = this.advance();
            return {
                type: 'text',
                value: textToken.value,
                start: textToken.start,
                end: textToken.end
            };
        }

        // Handle OR/AND at unexpected position (not between expressions)
        if (token.type === 'OR' || token.type === 'AND') {
            // Skip it and continue - the combineWithOperators will handle these
            this.advance();
            return null;
        }

        // Handle closing parenthesis without matching open
        if (token.type === 'RPAREN') {
            this.addError('Unexpected closing parenthesis', token.start, token.end);
            this.advance();
            return null;
        }

        // Unknown token - skip
        this.advance();
        return null;
    }

    /**
     * Parse a parenthesized group.
     */
    private parseGroup(): GroupASTNode {
        const openParen = this.advance(); // consume '('
        const groupStart = openParen.start;
        const children: ASTNode[] = [];

        // Parse expressions until we hit ')' or EOF
        while (!this.match('RPAREN', 'EOF')) {
            const node = this.parseExpression();
            if (node) {
                children.push(node);
            }
        }

        let groupEnd: number;
        if (this.match('RPAREN')) {
            const closeParen = this.advance();
            groupEnd = closeParen.end;
        } else {
            // Missing closing parenthesis
            this.addError('Missing closing parenthesis', groupStart, groupStart + 1);
            groupEnd = this.current().end;
        }

        return this.combineWithOperators(children, groupStart, groupEnd);
    }

    /**
     * Parse a filter token into an AST node.
     */
    private parseFilter(): FilterASTNode | null {
        const token = this.advance();
        
        if (!token.filter) {
            return null;
        }

        const semanticToken: SemanticToken = {
            field: token.filter.field,
            operator: token.filter.operator,
            values: token.filter.values,
            rawText: token.value
        };

        return {
            type: 'filter',
            token: semanticToken,
            start: token.start,
            end: token.end
        };
    }

    /**
     * Combine a list of nodes with OR/AND operators.
     * Handles operator precedence: AND binds tighter than OR.
     */
    private combineWithOperators(nodes: ASTNode[], groupStart: number, groupEnd: number): GroupASTNode {
        if (nodes.length === 0) {
            return { type: 'group', operator: 'AND', children: [], start: groupStart, end: groupEnd };
        }

        // Find OR operators in the token stream within this range
        const orPositions: number[] = [];
        for (let i = 0; i < this.tokens.length; i++) {
            const t = this.tokens[i];
            if (t.type === 'OR' && t.start >= groupStart && t.end <= groupEnd) {
                orPositions.push(t.start);
            }
        }

        // If no OR operators, everything is AND'd together
        if (orPositions.length === 0) {
            return {
                type: 'group',
                operator: 'AND',
                children: nodes,
                start: groupStart,
                end: groupEnd
            };
        }

        // Split nodes by OR positions
        const orGroups: ASTNode[][] = [];
        let currentGroup: ASTNode[] = [];

        for (const node of nodes) {
            // Check if there's an OR between the last node and this one
            const lastEnd = currentGroup.length > 0 
                ? currentGroup[currentGroup.length - 1].end 
                : groupStart;
            
            const hasOrBetween = orPositions.some(pos => pos > lastEnd && pos < node.start);
            
            if (hasOrBetween && currentGroup.length > 0) {
                orGroups.push(currentGroup);
                currentGroup = [];
            }
            
            currentGroup.push(node);
        }
        
        if (currentGroup.length > 0) {
            orGroups.push(currentGroup);
        }

        // If only one group, return as AND group
        if (orGroups.length === 1) {
            return {
                type: 'group',
                operator: 'AND',
                children: orGroups[0],
                start: groupStart,
                end: groupEnd
            };
        }

        // Create AND groups for each segment, then combine with OR
        const andGroups: ASTNode[] = orGroups.map(group => {
            if (group.length === 1) {
                return group[0];
            }
            const start = group[0].start;
            const end = group[group.length - 1].end;
            return {
                type: 'group' as const,
                operator: 'AND' as const,
                children: group,
                start,
                end
            };
        });

        return {
            type: 'group',
            operator: 'OR',
            children: andGroups,
            start: groupStart,
            end: groupEnd
        };
    }

    /**
     * Extract text parts and flat filter tokens from AST.
     */
    private extractFromAST(node: ASTNode, textParts: string[], tokens: SemanticToken[]): void {
        if (node.type === 'text') {
            textParts.push(node.value);
        } else if (node.type === 'filter') {
            tokens.push(node.token);
        } else if (node.type === 'group') {
            for (const child of node.children) {
                this.extractFromAST(child, textParts, tokens);
            }
        }
    }

    getErrors(): ParseError[] {
        return this.errors;
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse semantic query with support for nested brackets and boolean operators.
 * Returns an AST along with errors for validation display.
 */
export function parseSemanticQueryAST(input: string, gameSystem: GameSystem): ParseResult {
    const semanticKeyMap = buildSemanticKeyMap(gameSystem);
    const tokens = tokenize(input, semanticKeyMap);
    const parser = new Parser(tokens, input);
    return parser.parse();
}

/**
 * Validate a semantic query and return errors for highlighting.
 * Returns an array of errors with positions for UI highlighting.
 */
export function validateSemanticQuery(input: string, gameSystem: GameSystem): ParseError[] {
    const result = parseSemanticQueryAST(input, gameSystem);
    return result.errors;
}

/**
 * Get error ranges for highlighting in UI.
 * Returns array of [start, end] positions that should be colored red.
 */
export function getErrorRanges(input: string, gameSystem: GameSystem): [number, number][] {
    const errors = validateSemanticQuery(input, gameSystem);
    return errors.map(e => [e.start, e.end]);
}

/**
 * Check if AST contains any OR operators (needs special evaluation).
 */
export function hasOrOperators(ast: GroupASTNode): boolean {
    if (ast.operator === 'OR') return true;
    for (const child of ast.children) {
        if (child.type === 'group' && hasOrOperators(child)) {
            return true;
        }
    }
    return false;
}

/**
 * Check if the query uses nested brackets (has groups with groups inside).
 */
export function hasNestedGroups(ast: GroupASTNode): boolean {
    for (const child of ast.children) {
        if (child.type === 'group') {
            // Has a nested group
            if (child.children.some(c => c.type === 'group')) {
                return true;
            }
            if (hasNestedGroups(child)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Check if the query is too complex to represent in flat UI filters.
 * Complex queries include: OR operators, nested brackets, etc.
 */
export function isComplexQuery(ast: GroupASTNode): boolean {
    return hasOrOperators(ast) || hasNestedGroups(ast);
}

// ============================================================================
// AST Evaluator
// ============================================================================

/**
 * Context for evaluating filters against a unit.
 * Contains helper functions for getting property values.
 */
export interface EvaluatorContext {
    /** Get a property value from a unit by key path (e.g., 'as.PV', 'bv') */
    getProperty: (unit: any, key: string) => any;
    /** Get adjusted BV for a unit (with pilot skill modifiers) */
    getAdjustedBV?: (unit: any) => number;
    /** Get adjusted PV for a unit (with pilot skill modifiers) */
    getAdjustedPV?: (unit: any) => number;
    /** Total ranges for numeric filters */
    totalRanges: Record<string, [number, number]>;
    /** Current game system */
    gameSystem: GameSystem;
    /** Match text against a unit's searchable text (chassis, model, etc.) */
    matchesText?: (unit: any, text: string) => boolean;
}

/**
 * Evaluate a single filter against a unit.
 * Returns true if the unit matches the filter.
 */
function evaluateFilter(
    filter: SemanticToken,
    unit: any,
    context: EvaluatorContext
): boolean {
    const conf = ADVANCED_FILTERS.find(f => 
        (f.semanticKey || f.key) === filter.field &&
        (!f.game || f.game === context.gameSystem)
    );
    
    if (!conf) return true; // Unknown filter - pass through
    
    const { operator, values } = filter;
    
    // Get unit value for this filter
    let unitValue: any;
    if (conf.key === 'bv' && context.getAdjustedBV) {
        unitValue = context.getAdjustedBV(unit);
    } else if (conf.key === 'as.PV' && context.getAdjustedPV) {
        unitValue = context.getAdjustedPV(unit);
    } else {
        unitValue = context.getProperty(unit, conf.key);
    }
    
    // Handle different filter types
    if (conf.type === AdvFilterType.RANGE) {
        return evaluateRangeFilter(unitValue, operator, values, conf);
    } else if (conf.type === AdvFilterType.DROPDOWN) {
        return evaluateDropdownFilter(unitValue, operator, values, conf);
    } else if (conf.type === AdvFilterType.SEMANTIC) {
        return evaluateSemanticFilter(unitValue, operator, values);
    }
    
    return true;
}

/**
 * Evaluate a range filter (numeric comparison).
 */
function evaluateRangeFilter(
    unitValue: any,
    operator: SemanticOperator,
    values: string[],
    conf: AdvFilterConfig
): boolean {
    if (unitValue == null) return false;
    
    const numValue = typeof unitValue === 'number' ? unitValue : parseFloat(unitValue);
    if (isNaN(numValue)) return false;
    
    // Handle ignored values
    if (conf.ignoreValues && conf.ignoreValues.includes(unitValue)) {
        return true; // Pass through ignored values
    }
    
    // Parse the filter value(s)
    for (const val of values) {
        // Check for range syntax (e.g., "100-200")
        const rangeMatch = val.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
        if (rangeMatch) {
            const min = parseFloat(rangeMatch[1]);
            const max = parseFloat(rangeMatch[2]);
            const inRange = numValue >= min && numValue <= max;
            
            if (operator === '!=') {
                if (inRange) return false; // Exclude if in range
            } else if (operator === '=') {
                if (inRange) return true; // Include if in range
            }
            continue;
        }
        
        // Single numeric value
        const filterNum = parseFloat(val);
        if (isNaN(filterNum)) continue;
        
        switch (operator) {
            case '=':
                if (numValue === filterNum) return true;
                break;
            case '!=':
                if (numValue === filterNum) return false;
                break;
            case '>':
                if (numValue <= filterNum) return false;
                break;
            case '>=':
                if (numValue < filterNum) return false;
                break;
            case '<':
                if (numValue >= filterNum) return false;
                break;
            case '<=':
                if (numValue > filterNum) return false;
                break;
        }
    }
    
    // For = operator with no match, return false; for != return true
    return operator === '!=' || operator === '>' || operator === '>=' || operator === '<' || operator === '<=';
}

/**
 * Evaluate a dropdown filter (string matching).
 */
function evaluateDropdownFilter(
    unitValue: any,
    operator: SemanticOperator,
    values: string[],
    conf: AdvFilterConfig
): boolean {
    if (unitValue == null) return operator === '!=';
    
    // Normalize unit value(s) to array
    const unitValues = Array.isArray(unitValue) ? unitValue : [unitValue];
    const unitStrings = unitValues.map(v => String(v).toLowerCase());
    
    // Check each filter value
    for (const val of values) {
        const lowerVal = val.toLowerCase();
        const isWildcard = val.includes('*');
        
        let matches = false;
        if (isWildcard) {
            const regex = wildcardToRegex(val);
            matches = unitStrings.some(uv => regex.test(uv));
        } else {
            matches = unitStrings.some(uv => uv === lowerVal);
        }
        
        if (operator === '!=') {
            if (matches) return false; // Exclude if any value matches
        } else if (operator === '=' || operator === '&=') {
            if (matches) return true; // Include if any value matches
        }
    }
    
    // For = operator, return false if no match; for != return true
    return operator === '!=';
}

/**
 * Evaluate a semantic filter (exact text match with wildcards).
 */
function evaluateSemanticFilter(
    unitValue: any,
    operator: SemanticOperator,
    values: string[]
): boolean {
    if (unitValue == null) return operator === '!=';
    
    const unitStr = String(unitValue).toLowerCase();
    
    for (const val of values) {
        const isWildcard = val.includes('*');
        let matches = false;
        
        if (isWildcard) {
            const regex = wildcardToRegex(val);
            matches = regex.test(unitStr);
        } else {
            matches = unitStr === val.toLowerCase();
        }
        
        if (operator === '!=') {
            if (matches) return false;
        } else if (operator === '=' || operator === '&=') {
            if (matches) return true;
        }
    }
    
    return operator === '!=';
}

/**
 * Convert a wildcard pattern to a RegExp.
 */
function wildcardToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr, 'i');
}

/**
 * Evaluate an AST node against a unit.
 * Returns true if the unit matches the node's criteria.
 */
export function evaluateASTNode(
    node: ASTNode,
    unit: any,
    context: EvaluatorContext
): boolean {
    switch (node.type) {
        case 'text':
            // Text nodes filter by matching against unit's searchable text
            if (context.matchesText) {
                return context.matchesText(unit, node.value);
            }
            // If no text matcher provided, pass through
            return true;
            
        case 'filter':
            return evaluateFilter(node.token, unit, context);
            
        case 'group':
            return evaluateGroup(node, unit, context);
            
        default:
            return true;
    }
}

/**
 * Evaluate a group node against a unit.
 */
function evaluateGroup(
    group: GroupASTNode,
    unit: any,
    context: EvaluatorContext
): boolean {
    if (group.children.length === 0) return true;
    
    if (group.operator === 'AND') {
        // All children must match
        return group.children.every(child => evaluateASTNode(child, unit, context));
    } else {
        // OR: At least one child must match
        return group.children.some(child => evaluateASTNode(child, unit, context));
    }
}

/**
 * Filter units using an AST.
 * This is the main entry point for AST-based filtering.
 */
export function filterUnitsWithAST(
    units: any[],
    ast: GroupASTNode,
    context: EvaluatorContext
): any[] {
    // If AST has no children, return all units
    if (ast.children.length === 0) return units;
    
    // Check if AST has any meaningful nodes (filters or text when matcher is provided)
    const hasFilters = hasFilterNodes(ast);
    const hasText = context.matchesText && hasTextNodes(ast);
    if (!hasFilters && !hasText) return units;
    
    return units.filter(unit => evaluateASTNode(ast, unit, context));
}

/**
 * Check if AST contains any filter nodes.
 */
function hasFilterNodes(node: ASTNode): boolean {
    if (node.type === 'filter') return true;
    if (node.type === 'group') {
        return node.children.some(child => hasFilterNodes(child));
    }
    return false;
}

/**
 * Check if AST contains any text nodes.
 */
function hasTextNodes(node: ASTNode): boolean {
    if (node.type === 'text') return true;
    if (node.type === 'group') {
        return node.children.some(child => hasTextNodes(child));
    }
    return false;
}

/**
 * Extract text nodes from AST that would match a unit.
 * For OR groups, returns only the text from the matching branch.
 * This is used for relevance scoring with complex queries.
 */
export function getMatchingTextForUnit(
    ast: GroupASTNode,
    unit: any,
    context: EvaluatorContext
): string[] {
    return collectMatchingText(ast, unit, context);
}

function collectMatchingText(
    node: ASTNode,
    unit: any,
    context: EvaluatorContext
): string[] {
    if (node.type === 'text') {
        // Check if this text node matches the unit
        if (context.matchesText && context.matchesText(unit, node.value)) {
            return [node.value];
        }
        return [];
    }
    
    if (node.type === 'filter') {
        return [];
    }
    
    if (node.type === 'group') {
        if (node.operator === 'AND') {
            // For AND, collect all matching text from all children
            const texts: string[] = [];
            for (const child of node.children) {
                texts.push(...collectMatchingText(child, unit, context));
            }
            return texts;
        } else {
            // For OR, find the first matching child and return its text
            for (const child of node.children) {
                if (evaluateASTNode(child, unit, context)) {
                    return collectMatchingText(child, unit, context);
                }
            }
            return [];
        }
    }
    
    return [];
}
