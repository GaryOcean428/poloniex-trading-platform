export function normalizeFuturesSymbol(sym) {
    if (!sym)
        return sym;
    return sym.replace(/-/g, '').toUpperCase();
}
