import { expect, test } from '../support/fixtures';
import { jsonObject } from '../support/api';
import {
  assertDiscoveryEventCard,
  isUnknownArray,
  requireArray,
  requireNumber,
  requireObject,
  requireString,
} from './_lib/guards';
import { apiUrl, requireApiHealthy, seedEvents } from './_lib/helpers';

test.describe('API contracts — /discovery/*', () => {
  test.beforeEach(async ({ request }) => {
    await requireApiHealthy(request);
  });

  test('GET /discovery/events returns array of event cards', async ({ request }) => {
    const response = await request.get(apiUrl('/discovery/events?limit=20'));
    expect(response.status(), await response.text()).toBe(200);
    const body: unknown = await response.json();
    expect(isUnknownArray(body), 'discovery.events must be array').toBe(true);
    if (!isUnknownArray(body)) throw new Error('not array');
    expect(body.length, 'seed must expose scheduled events').toBeGreaterThan(0);
    for (const [i, row] of body.entries()) {
      assertDiscoveryEventCard(row, `discovery.events[${i}]`);
    }
  });

  test('GET /discovery/events/:slug returns concierto-demo-2026 by slug', async ({
    request,
  }) => {
    const response = await request.get(
      apiUrl(`/discovery/events/${seedEvents.conciertoDemo.slug}`),
    );
    expect(response.status(), await response.text()).toBe(200);
    const body = await jsonObject(response);
    assertDiscoveryEventCard(body, 'discovery.event.detail');
    expect(body.slug).toBe(seedEvents.conciertoDemo.slug);
    expect(body.id).toBe(seedEvents.conciertoDemo.id);
    const org = requireObject(body.organization, 'organization');
    requireString(org, 'slug');
    expect(org.slug).toBe('boletera-plataforma');
  });

  test('GET /discovery/events/:slug returns 404 for unknown slug', async ({ request }) => {
    const response = await request.get(
      apiUrl('/discovery/events/evento-que-no-existe-contracts-xyz'),
    );
    expect(response.status(), await response.text()).toBe(404);
    const body = await jsonObject(response);
    expect(typeof body.statusCode).toBe('number');
    expect(body.statusCode).toBe(404);
  });

  test('GET /discovery/facets returns cities and categories arrays', async ({ request }) => {
    const response = await request.get(apiUrl('/discovery/facets'));
    expect(response.status(), await response.text()).toBe(200);
    const body = await jsonObject(response);
    const cities = requireArray(body, 'cities');
    const categories = requireArray(body, 'categories');
    for (const [i, city] of cities.entries()) {
      const c = requireObject(city, `cities[${i}]`);
      requireString(c, 'name');
      requireNumber(c, 'count');
    }
    for (const [i, cat] of categories.entries()) {
      const c = requireObject(cat, `categories[${i}]`);
      requireString(c, 'key');
      requireNumber(c, 'count');
    }
  });

  test('GET /discovery/suggest returns [] for short query and rows for match', async ({
    request,
  }) => {
    const short = await request.get(apiUrl('/discovery/suggest?q=a'));
    expect(short.status(), await short.text()).toBe(200);
    const shortBody: unknown = await short.json();
    expect(shortBody).toEqual([]);

    const match = await request.get(apiUrl('/discovery/suggest?q=concierto&limit=5'));
    expect(match.status(), await match.text()).toBe(200);
    const rows: unknown = await match.json();
    expect(isUnknownArray(rows)).toBe(true);
    if (!isUnknownArray(rows)) throw new Error('suggest not array');
    expect(rows.length).toBeGreaterThan(0);
    const hit = rows
      .map((row, i) => requireObject(row, `suggest[${i}]`))
      .find((row) => row.slug === seedEvents.conciertoDemo.slug);
    expect(hit, 'suggest must include concierto-demo-2026').toBeTruthy();
    if (!hit) throw new Error('missing suggest hit');
    requireString(hit, 'id');
    requireString(hit, 'title');
    requireString(hit, 'slug');
  });

  test('GET /discovery/venues returns venue list with eventCount', async ({ request }) => {
    const response = await request.get(apiUrl('/discovery/venues?limit=10'));
    expect(response.status(), await response.text()).toBe(200);
    const body: unknown = await response.json();
    expect(isUnknownArray(body)).toBe(true);
    if (!isUnknownArray(body)) throw new Error('venues not array');
    for (const [i, row] of body.entries()) {
      const v = requireObject(row, `venues[${i}]`);
      requireString(v, 'id');
      requireString(v, 'slug');
      requireString(v, 'name');
      requireNumber(v, 'eventCount');
    }
  });

  test('GET /discovery/events?category=INVALID is rejected or ignored safely', async ({
    request,
  }) => {
    const response = await request.get(apiUrl('/discovery/events?category=NOT_A_CATEGORY'));
    // Controller does not wire DiscoveryEventsQueryDto; invalid category is ignored (200 + array).
    // If validation is later enabled, 400 is also correct — never 5xx.
    expect([200, 400], await response.text()).toContain(response.status());
    if (response.status() === 200) {
      const body: unknown = await response.json();
      expect(isUnknownArray(body)).toBe(true);
    } else {
      const body = await jsonObject(response);
      expect(body.statusCode).toBe(400);
    }
  });
});
