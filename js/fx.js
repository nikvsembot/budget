// Exchange rates for showing one total in your main currency (free Frankfurter API, refreshed twice a day).
const KEY = 'budget.fx';
let cache = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
const listeners = new Set();
let loading = null;

export const onRates = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// rates[c] = how many c for 1 unit of the base currency
export function getRates(base) {
  if (cache?.base === base && Date.now() - cache.t < 12 * 3600e3) return cache;
  if (!loading && navigator.onLine !== false) {
    loading = fetch(`https://api.frankfurter.dev/v2/rates?base=${base}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(list => {
        const rates = {};
        for (const x of list) if (x.quote && x.rate) rates[x.quote] = x.rate;
        cache = { base, t: Date.now(), date: list[0]?.date, rates };
        localStorage.setItem(KEY, JSON.stringify(cache));
        for (const fn of listeners) fn(cache);
      })
      .catch(() => {})
      .finally(() => { loading = null; });
  }
  return cache?.base === base ? cache : null;
}

// Amount in the base currency, or null when there is no rate for it yet.
export function convert(amount, cur, base, fx) {
  if (cur === base) return amount;
  const r = fx?.rates?.[cur];
  return r ? amount / r : null;
}
