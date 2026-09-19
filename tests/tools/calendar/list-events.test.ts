/**
 * Tests for calendar_list_events tool.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { allHandlers } from '../../mocks/synology-handlers.js';
import { createTestContext } from '../../mocks/test-client-factory.js';
import { calendarListEventsTool } from '../../../src/tools/calendar/list-events.js';

const server = setupServer(...allHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE_INPUT = {
  start_date: '2024-01-01',
  end_date: '2024-01-31',
  limit: 100,
};

describe('calendar_list_events', () => {
  it('returns total and events with ISO 8601 start/end', async () => {
    const ctx = createTestContext();
    const result = (await calendarListEventsTool.handler(BASE_INPUT, ctx)) as Record<
      string,
      unknown
    >;
    expect(typeof result['total']).toBe('number');
    const events = result['events'] as Array<Record<string, unknown>>;
    expect(Array.isArray(events)).toBe(true);
    expect(typeof events[0]?.['start']).toBe('string');
    expect(events[0]?.['start']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof events[0]?.['end']).toBe('string');
  });

  it('maps all event fields correctly', async () => {
    const ctx = createTestContext();
    const result = (await calendarListEventsTool.handler(BASE_INPUT, ctx)) as Record<
      string,
      unknown
    >;
    const events = result['events'] as Array<Record<string, unknown>>;
    expect(events[0]).toMatchObject({
      id: '1001',
      calendar_id: 'cal-001',
      title: 'Team Meeting',
      description: 'Weekly sync',
      start: '2024-01-15T10:00:00',
      end: '2024-01-15T11:00:00',
      timezone: 'Europe/Berlin',
      all_day: false,
      recurring: false,
      recurrence: null,
      owner: 'testuser',
    });
  });

  // DSM groups events by calendar id, so a missing calendar_id must fan out
  // across every calendar rather than omitting the (mandatory) filter.
  it('merges events from every calendar when no filter is given', async () => {
    const ctx = createTestContext();
    const result = (await calendarListEventsTool.handler(BASE_INPUT, ctx)) as Record<
      string,
      unknown
    >;
    const events = result['events'] as Array<Record<string, unknown>>;
    expect(events).toHaveLength(2);
    expect(events.map((e) => e['calendar_id'])).toEqual(['cal-001', 'cal-002']);
    expect(result['total']).toBe(2);
  });

  it('maps an all-day event to date-only stamps with no timezone', async () => {
    const ctx = createTestContext();
    const result = (await calendarListEventsTool.handler(
      { ...BASE_INPUT, calendar_id: 'cal-002' },
      ctx,
    )) as Record<string, unknown>;
    const events = result['events'] as Array<Record<string, unknown>>;
    expect(events[0]).toMatchObject({
      id: '1002',
      title: 'Urlaub',
      start: '2024-01-20',
      end: '2024-01-23',
      timezone: null,
      all_day: true,
    });
  });

  it('accepts optional calendar_id filter', async () => {
    const ctx = createTestContext();
    const result = (await calendarListEventsTool.handler(
      { ...BASE_INPUT, calendar_id: 'cal-001' },
      ctx,
    )) as Record<string, unknown>;
    const events = result['events'] as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]?.['calendar_id']).toBe('cal-001');
  });

  it('applies the caller limit after merging calendars', async () => {
    const ctx = createTestContext();
    const result = (await calendarListEventsTool.handler(
      { ...BASE_INPUT, limit: 1 },
      ctx,
    )) as Record<string, unknown>;
    expect((result['events'] as unknown[])).toHaveLength(1);
    expect(result['total']).toBe(2);
  });

  it('accepts full ISO datetime range', async () => {
    const ctx = createTestContext();
    const result = (await calendarListEventsTool.handler(
      { start_date: '2024-01-01T00:00:00Z', end_date: '2024-01-31T23:59:59Z', limit: 100 },
      ctx,
    )) as Record<string, unknown>;
    expect(result['error']).toBeUndefined();
  });

  it('returns error response on API failure', async () => {
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.get('http://nas.local:5000/webapi/entry.cgi', () =>
        HttpResponse.json({ success: false, error: { code: 100 } }),
      ),
    );
    const ctx = createTestContext();
    const result = (await calendarListEventsTool.handler(BASE_INPUT, ctx)) as Record<
      string,
      unknown
    >;
    expect(result['error']).toBe(true);
  });
});
