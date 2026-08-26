// ============================================================================
// LSE Custom Indicator: Formula Expression Engine
// Tokenizer -> Parser -> AST -> Evaluator
// ============================================================================

import {
    calculateRSI, calculateEMA, calculateSMA, calculateSMMA, calculateMACD,
    calculateBollingerBands, calculateATR, calculateStochastic, calculateWilliamsR,
    calculateCCI, calculateADX, calculateROC, calculateVWAP,
    calculateDEMA, calculateTEMA, calculateHMA, calculateWMA,
    calculateMomentum, calculateAwesomeOscillator, calculateMFI, calculateTSI,
    calculateTRIX, calculateUltimateOscillator, calculateDPO, calculateKST,
    calculateStochRSI, calculateBBPercent, calculateBBWidth,
    calculateHistoricalVolatility, calculateChaikinVolatility, calculateStdDev,
    calculateOBV, calculateCMF, calculateADL, calculateForceIndex, calculateEOM,
    calculateCorrelation, calculateCoppock,
    calculateSupertrend, calculateDonchian, calculateEnvelopes, calculateAroon,
    calculateKeltnerChannels,
} from './indicators';

// ─── TYPES ─────────────────────────────────────────────────────────────────

export type TokenType = 'NUMBER' | 'IDENTIFIER' | 'OPERATOR' | 'COMPARISON' | 'LPAREN' | 'RPAREN' | 'COMMA';

export interface Token {
    type: TokenType;
    value: string;
    position: number;
}

export type ASTNode =
    | { type: 'number'; value: number }
    | { type: 'price'; field: 'open' | 'high' | 'low' | 'close' | 'volume' }
    | { type: 'call'; name: string; args: ASTNode[] }
    | { type: 'binary'; op: string; left: ASTNode; right: ASTNode }
    | { type: 'unary'; op: '-'; operand: ASTNode };

export interface EvalContext {
    closes: number[];
    highs: number[];
    lows: number[];
    opens: number[];
    volumes: number[];
    timestamps: number[];
}

export interface FormulaResult {
    data: number[];
    errors: string[];
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    ast?: ASTNode;
}

// Built-in function metadata (for autocomplete)
export interface FunctionMeta {
    name: string;
    description: string;
    signature: string;
    category: 'price' | 'ma' | 'oscillator' | 'trend' | 'volatility' | 'volume' | 'math' | 'logic';
}

export const FORMULA_FUNCTIONS: FunctionMeta[] = [
    // Price
    { name: 'CLOSE', description: 'Close price', signature: 'CLOSE', category: 'price' },
    { name: 'OPEN', description: 'Open price', signature: 'OPEN', category: 'price' },
    { name: 'HIGH', description: 'High price', signature: 'HIGH', category: 'price' },
    { name: 'LOW', description: 'Low price', signature: 'LOW', category: 'price' },
    { name: 'VOLUME', description: 'Volume', signature: 'VOLUME', category: 'price' },
    // Moving Averages
    { name: 'SMA', description: 'Simple Moving Average', signature: 'SMA(period)', category: 'ma' },
    { name: 'EMA', description: 'Exponential Moving Average', signature: 'EMA(period)', category: 'ma' },
    { name: 'DEMA', description: 'Double EMA', signature: 'DEMA(period)', category: 'ma' },
    { name: 'TEMA', description: 'Triple EMA', signature: 'TEMA(period)', category: 'ma' },
    { name: 'HMA', description: 'Hull Moving Average', signature: 'HMA(period)', category: 'ma' },
    { name: 'SMMA', description: 'Smoothed Moving Average', signature: 'SMMA(period)', category: 'ma' },
    { name: 'WMA', description: 'Weighted Moving Average', signature: 'WMA(period)', category: 'ma' },
    // Oscillators
    { name: 'RSI', description: 'Relative Strength Index', signature: 'RSI(period)', category: 'oscillator' },
    { name: 'CCI', description: 'Commodity Channel Index', signature: 'CCI(period)', category: 'oscillator' },
    { name: 'ROC', description: 'Rate of Change', signature: 'ROC(period)', category: 'oscillator' },
    { name: 'MOM', description: 'Momentum', signature: 'MOM(period)', category: 'oscillator' },
    { name: 'MFI', description: 'Money Flow Index', signature: 'MFI(period)', category: 'oscillator' },
    { name: 'WILLIAMS_R', description: 'Williams %R', signature: 'WILLIAMS_R(period)', category: 'oscillator' },
    { name: 'STOCH_K', description: 'Stochastic %K', signature: 'STOCH_K(k_period, d_period)', category: 'oscillator' },
    { name: 'STOCH_D', description: 'Stochastic %D', signature: 'STOCH_D(k_period, d_period)', category: 'oscillator' },
    { name: 'AO', description: 'Awesome Oscillator', signature: 'AO', category: 'oscillator' },
    { name: 'DPO', description: 'Detrended Price Oscillator', signature: 'DPO(period)', category: 'oscillator' },
    { name: 'COPPOCK', description: 'Coppock Curve', signature: 'COPPOCK(longROC, shortROC, wma)', category: 'oscillator' },
    // Trend
    { name: 'MACD', description: 'MACD Line', signature: 'MACD(fast, slow, signal)', category: 'trend' },
    { name: 'MACD_SIGNAL', description: 'MACD Signal Line', signature: 'MACD_SIGNAL(fast, slow, signal)', category: 'trend' },
    { name: 'MACD_HIST', description: 'MACD Histogram', signature: 'MACD_HIST(fast, slow, signal)', category: 'trend' },
    { name: 'ADX', description: 'Average Directional Index', signature: 'ADX(period)', category: 'trend' },
    { name: 'PLUS_DI', description: 'Positive Directional Indicator', signature: 'PLUS_DI(period)', category: 'trend' },
    { name: 'MINUS_DI', description: 'Negative Directional Indicator', signature: 'MINUS_DI(period)', category: 'trend' },
    { name: 'SUPERTREND', description: 'Supertrend value', signature: 'SUPERTREND(period, multiplier)', category: 'trend' },
    { name: 'AROON_UP', description: 'Aroon Up', signature: 'AROON_UP(period)', category: 'trend' },
    { name: 'AROON_DOWN', description: 'Aroon Down', signature: 'AROON_DOWN(period)', category: 'trend' },
    // Volatility
    { name: 'ATR', description: 'Average True Range', signature: 'ATR(period)', category: 'volatility' },
    { name: 'STDDEV', description: 'Standard Deviation', signature: 'STDDEV(period)', category: 'volatility' },
    { name: 'BB_UPPER', description: 'Bollinger Upper Band', signature: 'BB_UPPER(period, stddev)', category: 'volatility' },
    { name: 'BB_LOWER', description: 'Bollinger Lower Band', signature: 'BB_LOWER(period, stddev)', category: 'volatility' },
    { name: 'BB_MIDDLE', description: 'Bollinger Middle Band', signature: 'BB_MIDDLE(period, stddev)', category: 'volatility' },
    { name: 'BB_PERCENT', description: 'Bollinger %B', signature: 'BB_PERCENT(period, stddev)', category: 'volatility' },
    { name: 'BB_WIDTH', description: 'Bollinger Bandwidth', signature: 'BB_WIDTH(period, stddev)', category: 'volatility' },
    { name: 'KELTNER_UPPER', description: 'Keltner Upper', signature: 'KELTNER_UPPER(ema, atr, mult)', category: 'volatility' },
    { name: 'KELTNER_LOWER', description: 'Keltner Lower', signature: 'KELTNER_LOWER(ema, atr, mult)', category: 'volatility' },
    { name: 'HIST_VOL', description: 'Historical Volatility', signature: 'HIST_VOL(period)', category: 'volatility' },
    // Volume
    { name: 'OBV', description: 'On Balance Volume', signature: 'OBV', category: 'volume' },
    { name: 'CMF', description: 'Chaikin Money Flow', signature: 'CMF(period)', category: 'volume' },
    { name: 'ADL', description: 'Accumulation/Distribution', signature: 'ADL', category: 'volume' },
    { name: 'FORCE', description: 'Force Index', signature: 'FORCE(period)', category: 'volume' },
    { name: 'EOM', description: 'Ease of Movement', signature: 'EOM(period)', category: 'volume' },
    { name: 'VWAP', description: 'Volume Weighted Avg Price', signature: 'VWAP', category: 'volume' },
    // Math
    { name: 'ABS', description: 'Absolute value', signature: 'ABS(expr)', category: 'math' },
    { name: 'MAX', description: 'Maximum of two values', signature: 'MAX(a, b)', category: 'math' },
    { name: 'MIN', description: 'Minimum of two values', signature: 'MIN(a, b)', category: 'math' },
    { name: 'SQRT', description: 'Square root', signature: 'SQRT(expr)', category: 'math' },
    { name: 'LOG', description: 'Natural logarithm', signature: 'LOG(expr)', category: 'math' },
    { name: 'POW', description: 'Power', signature: 'POW(base, exp)', category: 'math' },
    { name: 'ROUND', description: 'Round to decimals', signature: 'ROUND(expr, decimals)', category: 'math' },
    { name: 'PREV', description: 'Value N bars ago', signature: 'PREV(expr, n)', category: 'math' },
    { name: 'HIGHEST', description: 'Highest value over period', signature: 'HIGHEST(expr, period)', category: 'math' },
    { name: 'LOWEST', description: 'Lowest value over period', signature: 'LOWEST(expr, period)', category: 'math' },
    { name: 'SUM_OF', description: 'Sum over period', signature: 'SUM_OF(expr, period)', category: 'math' },
    { name: 'AVG', description: 'Average over period', signature: 'AVG(expr, period)', category: 'math' },
    // Logic
    { name: 'IF', description: 'Conditional', signature: 'IF(cond, then, else)', category: 'logic' },
    { name: 'CROSS_ABOVE', description: 'Crossover detection', signature: 'CROSS_ABOVE(a, b)', category: 'logic' },
    { name: 'CROSS_BELOW', description: 'Crossunder detection', signature: 'CROSS_BELOW(a, b)', category: 'logic' },
];

// Price field identifiers
const PRICE_FIELDS = new Set(['CLOSE', 'OPEN', 'HIGH', 'LOW', 'VOLUME']);

// ─── TOKENIZER ─────────────────────────────────────────────────────────────

export function tokenize(formula: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < formula.length) {
        // Skip whitespace
        if (/\s/.test(formula[i])) { i++; continue; }

        // Number (int or float)
        if (/[0-9.]/.test(formula[i])) {
            let num = '';
            const pos = i;
            let hasDot = false;
            while (i < formula.length && (/[0-9]/.test(formula[i]) || (formula[i] === '.' && !hasDot))) {
                if (formula[i] === '.') hasDot = true;
                num += formula[i++];
            }
            tokens.push({ type: 'NUMBER', value: num, position: pos });
            continue;
        }

        // Identifier (function name or price field)
        if (/[A-Za-z_]/.test(formula[i])) {
            let id = '';
            const pos = i;
            while (i < formula.length && /[A-Za-z0-9_]/.test(formula[i])) {
                id += formula[i++];
            }
            tokens.push({ type: 'IDENTIFIER', value: id.toUpperCase(), position: pos });
            continue;
        }

        // Comparisons (>=, <=, >, <, ==, !=)
        if (formula[i] === '>' || formula[i] === '<' || formula[i] === '!' || formula[i] === '=') {
            const pos = i;
            let op = formula[i++];
            if (i < formula.length && formula[i] === '=') { op += formula[i++]; }
            if (op === '=' || op === '!') {
                throw new FormulaError(`Unexpected character '${op}' at position ${pos}`, pos);
            }
            tokens.push({ type: 'COMPARISON', value: op, position: pos });
            continue;
        }

        // Operators
        if ('+-*/'.includes(formula[i])) {
            tokens.push({ type: 'OPERATOR', value: formula[i], position: i });
            i++;
            continue;
        }

        // Parens
        if (formula[i] === '(') { tokens.push({ type: 'LPAREN', value: '(', position: i }); i++; continue; }
        if (formula[i] === ')') { tokens.push({ type: 'RPAREN', value: ')', position: i }); i++; continue; }

        // Comma
        if (formula[i] === ',') { tokens.push({ type: 'COMMA', value: ',', position: i }); i++; continue; }

        throw new FormulaError(`Unexpected character '${formula[i]}' at position ${i}`, i);
    }

    return tokens;
}

// ─── PARSER (Recursive Descent) ────────────────────────────────────────────

export class FormulaError extends Error {
    position: number;
    constructor(message: string, position: number = -1) {
        super(message);
        this.position = position;
        this.name = 'FormulaError';
    }
}

export function parse(tokens: Token[]): ASTNode {
    let pos = 0;

    function peek(): Token | null { return pos < tokens.length ? tokens[pos] : null; }
    function advance(): Token {
        if (pos >= tokens.length) throw new FormulaError('Unexpected end of formula');
        return tokens[pos++];
    }
    function expect(type: TokenType, value?: string): Token {
        const t = advance();
        if (t.type !== type || (value !== undefined && t.value !== value)) {
            throw new FormulaError(
                `Expected ${value || type} but got '${t.value}'`,
                t.position
            );
        }
        return t;
    }

    // expr -> comparison
    function parseExpression(): ASTNode {
        return parseComparison();
    }

    // comparison -> addSub ((> | < | >= | <= | == | !=) addSub)?
    function parseComparison(): ASTNode {
        let left = parseAddSub();
        const t = peek();
        if (t && t.type === 'COMPARISON') {
            advance();
            const right = parseAddSub();
            left = { type: 'binary', op: t.value, left, right };
        }
        return left;
    }

    // addSub -> mulDiv ((+ | -) mulDiv)*
    function parseAddSub(): ASTNode {
        let left = parseMulDiv();
        while (peek() && peek()!.type === 'OPERATOR' && (peek()!.value === '+' || peek()!.value === '-')) {
            const op = advance().value;
            const right = parseMulDiv();
            left = { type: 'binary', op, left, right };
        }
        return left;
    }

    // mulDiv -> unary ((* | /) unary)*
    function parseMulDiv(): ASTNode {
        let left = parseUnary();
        while (peek() && peek()!.type === 'OPERATOR' && (peek()!.value === '*' || peek()!.value === '/')) {
            const op = advance().value;
            const right = parseUnary();
            left = { type: 'binary', op, left, right };
        }
        return left;
    }

    // unary -> -unary | primary
    function parseUnary(): ASTNode {
        if (peek() && peek()!.type === 'OPERATOR' && peek()!.value === '-') {
            advance();
            const operand = parseUnary();
            // Optimize: -number folds to a negated literal
            if (operand.type === 'number') {
                return { type: 'number', value: -operand.value };
            }
            return { type: 'unary', op: '-', operand };
        }
        return parsePrimary();
    }

    // primary -> NUMBER | IDENTIFIER | IDENTIFIER(args) | (expr)
    function parsePrimary(): ASTNode {
        const t = peek();
        if (!t) throw new FormulaError('Unexpected end of formula');

        // Grouped expression
        if (t.type === 'LPAREN') {
            advance(); // consume (
            const expr = parseExpression();
            expect('RPAREN');
            return expr;
        }

        // Number literal
        if (t.type === 'NUMBER') {
            advance();
            return { type: 'number', value: parseFloat(t.value) };
        }

        // Identifier: price field or function call
        if (t.type === 'IDENTIFIER') {
            advance();
            const name = t.value;

            // Check if it's a function call (identifier followed by parenthesis)
            if (peek() && peek()!.type === 'LPAREN') {
                advance(); // consume (
                const args: ASTNode[] = [];

                // Parse arguments
                if (peek() && peek()!.type !== 'RPAREN') {
                    args.push(parseExpression());
                    while (peek() && peek()!.type === 'COMMA') {
                        advance(); // consume ,
                        args.push(parseExpression());
                    }
                }

                expect('RPAREN');
                return { type: 'call', name, args };
            }

            // Price field or no-arg function
            if (PRICE_FIELDS.has(name)) {
                return { type: 'price', field: name.toLowerCase() as 'open' | 'high' | 'low' | 'close' | 'volume' };
            }

            // Zero-arg indicator functions (OBV, ADL, VWAP, AO)
            const ZERO_ARG_FUNCS = new Set(['OBV', 'ADL', 'VWAP', 'AO']);
            if (ZERO_ARG_FUNCS.has(name)) {
                return { type: 'call', name, args: [] };
            }

            // Check if it's a known function being used without parens
            const allFuncNames = FORMULA_FUNCTIONS.map(f => f.name);
            if (allFuncNames.includes(name)) {
                throw new FormulaError(
                    `'${name}' is a function — use ${name}(...) with parentheses`,
                    t.position
                );
            }

            throw new FormulaError(`Unknown identifier '${name}'`, t.position);
        }

        throw new FormulaError(`Unexpected token '${t.value}'`, t.position);
    }

    const ast = parseExpression();

    // Ensure we consumed everything
    if (pos < tokens.length) {
        throw new FormulaError(
            `Unexpected token '${tokens[pos].value}' after end of expression`,
            tokens[pos].position
        );
    }

    return ast;
}

// ─── EVALUATOR ─────────────────────────────────────────────────────────────

function makeConstArray(length: number, value: number): number[] {
    return new Array(length).fill(value);
}

function elementWise(left: number[], right: number[], op: string): number[] {
    const len = Math.max(left.length, right.length);
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
        const l = i < left.length ? left[i] : NaN;
        const r = i < right.length ? right[i] : NaN;
        switch (op) {
            case '+': result[i] = l + r; break;
            case '-': result[i] = l - r; break;
            case '*': result[i] = l * r; break;
            case '/': result[i] = r !== 0 ? l / r : NaN; break;
            case '>': result[i] = l > r ? 1 : 0; break;
            case '<': result[i] = l < r ? 1 : 0; break;
            case '>=': result[i] = l >= r ? 1 : 0; break;
            case '<=': result[i] = l <= r ? 1 : 0; break;
            case '==': result[i] = l === r ? 1 : 0; break;
            case '!=': result[i] = l !== r ? 1 : 0; break;
            default: result[i] = NaN;
        }
    }
    return result;
}

// Shift array N bars back (for PREV function)
function shiftArray(data: number[], n: number): number[] {
    const result = new Array(data.length).fill(NaN);
    for (let i = n; i < data.length; i++) {
        result[i] = data[i - n];
    }
    return result;
}

// Rolling max/min/sum
function rollingMax(data: number[], period: number): number[] {
    const result = new Array(data.length).fill(NaN);
    for (let i = period - 1; i < data.length; i++) {
        let max = -Infinity;
        for (let j = i - period + 1; j <= i; j++) {
            if (!isNaN(data[j]) && data[j] > max) max = data[j];
        }
        result[i] = max === -Infinity ? NaN : max;
    }
    return result;
}

function rollingMin(data: number[], period: number): number[] {
    const result = new Array(data.length).fill(NaN);
    for (let i = period - 1; i < data.length; i++) {
        let min = Infinity;
        for (let j = i - period + 1; j <= i; j++) {
            if (!isNaN(data[j]) && data[j] < min) min = data[j];
        }
        result[i] = min === Infinity ? NaN : min;
    }
    return result;
}

function rollingSum(data: number[], period: number): number[] {
    const result = new Array(data.length).fill(NaN);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = i - period + 1; j <= i; j++) {
            if (!isNaN(data[j])) { sum += data[j]; count++; }
        }
        result[i] = count > 0 ? sum : NaN;
    }
    return result;
}

function rollingAvg(data: number[], period: number): number[] {
    const result = new Array(data.length).fill(NaN);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = i - period + 1; j <= i; j++) {
            if (!isNaN(data[j])) { sum += data[j]; count++; }
        }
        result[i] = count > 0 ? sum / count : NaN;
    }
    return result;
}

function crossAbove(a: number[], b: number[]): number[] {
    const result = new Array(a.length).fill(0);
    for (let i = 1; i < a.length; i++) {
        if (a[i] > b[i] && a[i - 1] <= b[i - 1]) result[i] = 1;
    }
    return result;
}

function crossBelow(a: number[], b: number[]): number[] {
    const result = new Array(a.length).fill(0);
    for (let i = 1; i < a.length; i++) {
        if (a[i] < b[i] && a[i - 1] >= b[i - 1]) result[i] = 1;
    }
    return result;
}

// Resolve a single argument that should be a number
function resolveNumber(node: ASTNode, ctx: EvalContext, depth: number = 0): number {
    if (node.type === 'number') return node.value;
    // Evaluate and take the last non-NaN value (for computed args)
    const arr = evaluate(node, ctx, depth);
    // If it's a constant array, return the first value
    const first = arr.find(v => !isNaN(v) && isFinite(v));
    return first !== undefined ? first : NaN;
}

// Main evaluate function, recursively walks the AST
const MAX_EVAL_DEPTH = 50;
export function evaluate(ast: ASTNode, ctx: EvalContext, depth: number = 0): number[] {
    if (depth > MAX_EVAL_DEPTH) {
        throw new FormulaError('Formula too deeply nested (max 50 levels)');
    }
    const len = ctx.closes.length;

    switch (ast.type) {
        case 'number':
            return makeConstArray(len, ast.value);

        case 'price':
            switch (ast.field) {
                case 'close': return [...ctx.closes];
                case 'open': return [...ctx.opens];
                case 'high': return [...ctx.highs];
                case 'low': return [...ctx.lows];
                case 'volume': return [...ctx.volumes];
            }
            break; // unreachable but satisfies TS

        case 'binary':
            return elementWise(evaluate(ast.left, ctx, depth + 1), evaluate(ast.right, ctx, depth + 1), ast.op);

        case 'unary':
            return evaluate(ast.operand, ctx, depth + 1).map(v => -v);

        case 'call':
            return evaluateCall(ast.name, ast.args, ctx, depth + 1);
    }

    return makeConstArray(len, NaN);
}

// ─── FUNCTION REGISTRY ─────────────────────────────────────────────────────
// Each function takes AST args, resolves them, and calls the real indicator fn

function evaluateCall(name: string, args: ASTNode[], ctx: EvalContext, depth: number = 0): number[] {
    const len = ctx.closes.length;

    // Helper: get numeric arg value
    const num = (idx: number, defaultVal?: number): number => {
        if (idx >= args.length) {
            if (defaultVal !== undefined) return defaultVal;
            throw new FormulaError(`${name}() requires at least ${idx + 1} argument(s)`);
        }
        return resolveNumber(args[idx], ctx, depth);
    };

    // Helper: get array arg (evaluate sub-expression)
    const arr = (idx: number): number[] => {
        if (idx >= args.length) throw new FormulaError(`${name}() requires at least ${idx + 1} argument(s)`);
        return evaluate(args[idx], ctx, depth);
    };

    switch (name) {
        // ─── Moving Averages ─────────────────────────────────────
        case 'SMA': {
            const source = args.length > 1 ? arr(0) : ctx.closes;
            const period = args.length > 1 ? num(1) : num(0);
            return calculateSMA(source, period);
        }
        case 'EMA': {
            const source = args.length > 1 ? arr(0) : ctx.closes;
            const period = args.length > 1 ? num(1) : num(0);
            return calculateEMA(source, period);
        }
        case 'DEMA': return calculateDEMA(ctx.closes, num(0, 21));
        case 'TEMA': return calculateTEMA(ctx.closes, num(0, 21));
        case 'HMA': return calculateHMA(ctx.closes, num(0, 9));
        case 'SMMA': return calculateSMMA(ctx.closes, num(0, 20));
        case 'WMA': return calculateWMA(ctx.closes, num(0, 20));

        // ─── Oscillators ─────────────────────────────────────────
        case 'RSI': return calculateRSI(ctx.closes, num(0, 14));
        case 'CCI': return calculateCCI(ctx.highs, ctx.lows, ctx.closes, num(0, 20));
        case 'ROC': return calculateROC(ctx.closes, num(0, 12));
        case 'MOM': return calculateMomentum(ctx.closes, num(0, 10));
        case 'MFI': return calculateMFI(ctx.highs, ctx.lows, ctx.closes, ctx.volumes, num(0, 14));
        case 'WILLIAMS_R': return calculateWilliamsR(ctx.highs, ctx.lows, ctx.closes, num(0, 14));
        case 'AO': return calculateAwesomeOscillator(ctx.highs, ctx.lows);
        case 'DPO': return calculateDPO(ctx.closes, num(0, 21));
        case 'COPPOCK': return calculateCoppock(ctx.closes, num(0, 14), num(1, 11), num(2, 10));

        case 'STOCH_K': {
            const result = calculateStochastic(ctx.highs, ctx.lows, ctx.closes, num(0, 14), num(1, 3));
            return result.k;
        }
        case 'STOCH_D': {
            const result = calculateStochastic(ctx.highs, ctx.lows, ctx.closes, num(0, 14), num(1, 3));
            return result.d;
        }
        case 'STOCHRSI_K': {
            const result = calculateStochRSI(ctx.closes, num(0, 14), num(1, 14), num(2, 3));
            return result.k;
        }
        case 'STOCHRSI_D': {
            const result = calculateStochRSI(ctx.closes, num(0, 14), num(1, 14), num(2, 3));
            return result.d;
        }
        case 'TSI': {
            const result = calculateTSI(ctx.closes, num(0, 25), num(1, 13), num(2, 13));
            return result.tsi;
        }
        case 'TSI_SIGNAL': {
            const result = calculateTSI(ctx.closes, num(0, 25), num(1, 13), num(2, 13));
            return result.signal;
        }
        case 'TRIX': {
            const result = calculateTRIX(ctx.closes, num(0, 15), num(1, 9));
            return result.trix;
        }
        case 'TRIX_SIGNAL': {
            const result = calculateTRIX(ctx.closes, num(0, 15), num(1, 9));
            return result.signal;
        }
        case 'ULT_OSC': return calculateUltimateOscillator(ctx.highs, ctx.lows, ctx.closes, num(0, 7), num(1, 14), num(2, 28));
        case 'KST': {
            const result = calculateKST(ctx.closes);
            return result.kst;
        }
        case 'KST_SIGNAL': {
            const result = calculateKST(ctx.closes);
            return result.signal;
        }

        // ─── Trend ───────────────────────────────────────────────
        case 'MACD': {
            const result = calculateMACD(ctx.closes, num(0, 12), num(1, 26), num(2, 9));
            return result.macd;
        }
        case 'MACD_SIGNAL': {
            const result = calculateMACD(ctx.closes, num(0, 12), num(1, 26), num(2, 9));
            return result.signal;
        }
        case 'MACD_HIST': {
            const result = calculateMACD(ctx.closes, num(0, 12), num(1, 26), num(2, 9));
            return result.histogram;
        }
        case 'ADX': {
            const result = calculateADX(ctx.highs, ctx.lows, ctx.closes, num(0, 14));
            return result.adx;
        }
        case 'PLUS_DI': {
            const result = calculateADX(ctx.highs, ctx.lows, ctx.closes, num(0, 14));
            return result.plusDI;
        }
        case 'MINUS_DI': {
            const result = calculateADX(ctx.highs, ctx.lows, ctx.closes, num(0, 14));
            return result.minusDI;
        }
        case 'SUPERTREND': {
            const result = calculateSupertrend(ctx.highs, ctx.lows, ctx.closes, num(0, 10), num(1, 3));
            return result.supertrend;
        }
        case 'AROON_UP': {
            const result = calculateAroon(ctx.highs, ctx.lows, num(0, 25));
            return result.up;
        }
        case 'AROON_DOWN': {
            const result = calculateAroon(ctx.highs, ctx.lows, num(0, 25));
            return result.down;
        }
        case 'AROON_OSC': {
            const result = calculateAroon(ctx.highs, ctx.lows, num(0, 25));
            return result.oscillator;
        }

        // ─── Volatility ──────────────────────────────────────────
        case 'ATR': return calculateATR(ctx.highs, ctx.lows, ctx.closes, num(0, 14));
        case 'STDDEV': return calculateStdDev(ctx.closes, num(0, 20));
        case 'BB_UPPER': {
            const result = calculateBollingerBands(ctx.closes, num(0, 20), num(1, 2));
            return result.upper;
        }
        case 'BB_LOWER': {
            const result = calculateBollingerBands(ctx.closes, num(0, 20), num(1, 2));
            return result.lower;
        }
        case 'BB_MIDDLE': {
            const result = calculateBollingerBands(ctx.closes, num(0, 20), num(1, 2));
            return result.middle;
        }
        case 'BB_PERCENT': return calculateBBPercent(ctx.closes, num(0, 20), num(1, 2));
        case 'BB_WIDTH': return calculateBBWidth(ctx.closes, num(0, 20), num(1, 2));
        case 'KELTNER_UPPER': {
            const result = calculateKeltnerChannels(ctx.highs, ctx.lows, ctx.closes, num(0, 20), num(1, 10), num(2, 2));
            return result.upper;
        }
        case 'KELTNER_LOWER': {
            const result = calculateKeltnerChannels(ctx.highs, ctx.lows, ctx.closes, num(0, 20), num(1, 10), num(2, 2));
            return result.lower;
        }
        case 'KELTNER_MIDDLE': {
            const result = calculateKeltnerChannels(ctx.highs, ctx.lows, ctx.closes, num(0, 20), num(1, 10), num(2, 2));
            return result.middle;
        }
        case 'HIST_VOL': return calculateHistoricalVolatility(ctx.closes, num(0, 20));
        case 'CHAIKIN_VOL': return calculateChaikinVolatility(ctx.highs, ctx.lows, num(0, 10), num(1, 10));
        case 'DONCHIAN_UPPER': {
            const result = calculateDonchian(ctx.highs, ctx.lows, num(0, 20));
            return result.upper;
        }
        case 'DONCHIAN_LOWER': {
            const result = calculateDonchian(ctx.highs, ctx.lows, num(0, 20));
            return result.lower;
        }
        case 'DONCHIAN_MIDDLE': {
            const result = calculateDonchian(ctx.highs, ctx.lows, num(0, 20));
            return result.middle;
        }
        case 'ENV_UPPER': {
            const result = calculateEnvelopes(ctx.closes, num(0, 20), num(1, 2.5));
            return result.upper;
        }
        case 'ENV_LOWER': {
            const result = calculateEnvelopes(ctx.closes, num(0, 20), num(1, 2.5));
            return result.lower;
        }

        // ─── Volume ──────────────────────────────────────────────
        case 'OBV': return calculateOBV(ctx.closes, ctx.volumes);
        case 'CMF': return calculateCMF(ctx.highs, ctx.lows, ctx.closes, ctx.volumes, num(0, 20));
        case 'ADL': return calculateADL(ctx.highs, ctx.lows, ctx.closes, ctx.volumes);
        case 'FORCE': return calculateForceIndex(ctx.closes, ctx.volumes, num(0, 13));
        case 'EOM': return calculateEOM(ctx.highs, ctx.lows, ctx.volumes, num(0, 14));
        case 'VWAP': return calculateVWAP(ctx.highs, ctx.lows, ctx.closes, ctx.volumes, ctx.timestamps);
        case 'CORRELATION': return calculateCorrelation(ctx.closes, ctx.volumes, num(0, 20));

        // ─── Math Helpers ────────────────────────────────────────
        case 'ABS': return arr(0).map(v => Math.abs(v));
        case 'SQRT': return arr(0).map(v => v >= 0 ? Math.sqrt(v) : NaN);
        case 'LOG': return arr(0).map(v => v > 0 ? Math.log(v) : NaN);
        case 'POW': {
            const base = arr(0);
            const exp = num(1);
            return base.map(v => Math.pow(v, exp));
        }
        case 'ROUND': {
            const data = arr(0);
            const decimals = num(1, 2);
            const mult = Math.pow(10, decimals);
            return data.map(v => Math.round(v * mult) / mult);
        }
        case 'MAX': {
            const a = arr(0);
            const b = arr(1);
            return a.map((v, i) => Math.max(v, b[i]));
        }
        case 'MIN': {
            const a = arr(0);
            const b = arr(1);
            return a.map((v, i) => Math.min(v, b[i]));
        }
        case 'PREV': {
            const data = arr(0);
            const n = num(1, 1);
            return shiftArray(data, Math.round(n));
        }
        case 'HIGHEST': {
            const data = arr(0);
            const period = num(1);
            return rollingMax(data, Math.round(period));
        }
        case 'LOWEST': {
            const data = arr(0);
            const period = num(1);
            return rollingMin(data, Math.round(period));
        }
        case 'SUM_OF': {
            const data = arr(0);
            const period = num(1);
            return rollingSum(data, Math.round(period));
        }
        case 'AVG': {
            const data = arr(0);
            const period = num(1);
            return rollingAvg(data, Math.round(period));
        }

        // ─── Conditional/Logic ───────────────────────────────────
        case 'IF': {
            const cond = arr(0);
            const then = arr(1);
            const els = arr(2);
            return cond.map((v, i) => (v && !isNaN(v)) ? then[i] : els[i]);
        }
        case 'CROSS_ABOVE': return crossAbove(arr(0), arr(1));
        case 'CROSS_BELOW': return crossBelow(arr(0), arr(1));

        default:
            throw new FormulaError(`Unknown function '${name}'. Type to see available functions.`);
    }
}

// ─── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * Validate a formula string without evaluating it
 */
export function validateFormula(formula: string): ValidationResult {
    if (!formula.trim()) {
        return { valid: false, errors: ['Formula cannot be empty'] };
    }

    try {
        const tokens = tokenize(formula);
        const ast = parse(tokens);
        return { valid: true, errors: [], ast };
    } catch (e) {
        if (e instanceof FormulaError) {
            return { valid: false, errors: [e.message] };
        }
        return { valid: false, errors: [`Parse error: ${(e as Error).message}`] };
    }
}

/**
 * Evaluate a formula string against candle data
 */
export function evaluateFormula(formula: string, ctx: EvalContext): FormulaResult {
    try {
        const tokens = tokenize(formula);
        const ast = parse(tokens);
        const data = evaluate(ast, ctx);
        return { data, errors: [] };
    } catch (e) {
        if (e instanceof FormulaError) {
            return { data: [], errors: [e.message] };
        }
        return { data: [], errors: [`Evaluation error: ${(e as Error).message}`] };
    }
}

/**
 * Get autocomplete suggestions based on partial input
 */
export function getAutocompleteSuggestions(partial: string): FunctionMeta[] {
    if (!partial) return FORMULA_FUNCTIONS;
    const upper = partial.toUpperCase();
    return FORMULA_FUNCTIONS.filter(f =>
        f.name.startsWith(upper) || f.description.toUpperCase().includes(upper)
    );
}

// ─── CUSTOM INDICATOR TYPE ─────────────────────────────────────────────────

export interface CustomIndicator {
    id: string;
    name: string;
    expression: string;
    enabled: boolean;
    display: 'overlay' | 'subplot';
    color: string;
    lineWidth: number;
    zeroLine: boolean;
}

export function createCustomIndicator(name: string, expression: string): CustomIndicator {
    return {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        expression,
        enabled: true,
        display: 'subplot',
        color: '#FFD700',
        lineWidth: 2,
        zeroLine: false,
    };
}
