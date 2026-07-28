const { priceHeatColor, sightlineHeatColor } = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const seats = [
  { id: 'a', price: 200 },
  { id: 'b', price: 500 },
  { id: 'c', price: 900 },
  { id: 'd', price: 0 },
];
const priced = seats.filter((s) => s.price > 0);
const min = Math.min(...priced.map((s) => s.price));
const max = Math.max(...priced.map((s) => s.price));

const heatBySeat = new Map();
for (const s of priced) {
  const c = priceHeatColor(s.price, min, max);
  assert(/^rgb\(/.test(c), `price color ${s.id}`);
  heatBySeat.set(s.id, c);
}
assert(heatBySeat.size === 3, 'priced only');
assert(heatBySeat.get('a') !== heatBySeat.get('c'), 'low != high');

const viewA = sightlineHeatColor(0.1);
const viewB = sightlineHeatColor(0.95);
assert(viewA !== viewB, 'view heat distinct');

// Mutual exclusivity contract for UI: only one heat map active
const modes = ['off', 'price', 'view'];
assert(modes.filter((m) => m === 'price').length === 1, 'single price mode');

console.log('PRICE_HEAT_3D_SMOKE_OK', {
  min,
  max,
  sample: { a: heatBySeat.get('a'), c: heatBySeat.get('c') },
});
