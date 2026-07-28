/**
 * Pure helper mirror of interactive status mapping (no Nest/DB).
 * Keeps API contract: blocked visibility beats ticket status.
 */
function buildStatusBySeat(map, ticketMap) {
  const statusBySeat = {};
  for (const sec of map.sections ?? []) {
    for (const s of sec.seats ?? []) {
      const raw = ticketMap.get(s.id) ?? 'available';
      statusBySeat[s.id] = s.visibility?.blocked ? 'blocked' : raw;
    }
  }
  return statusBySeat;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = {
  version: 3,
  sections: [
    {
      id: 's1',
      name: 'A',
      slug: 'a',
      color: '#5b9fd4',
      seats: [
        { id: 'a1', label: 'A1', x: 10, y: 10 },
        { id: 'a2', label: 'A2', x: 20, y: 10, visibility: { blocked: true } },
      ],
    },
  ],
};

const tickets = new Map([
  ['a1', 'sold'],
  ['a2', 'available'],
]);

const status = buildStatusBySeat(map, tickets);
assert(status.a1 === 'sold', 'sold');
assert(status.a2 === 'blocked', 'blocked wins over ticket');

console.log('INTERACTIVE_STATUS_SMOKE_OK', status);
