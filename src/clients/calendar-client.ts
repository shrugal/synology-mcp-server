/**
 * Synology Calendar API client.
 * Wraps SYNO.Cal.Cal (calendar management) and SYNO.Cal.Event (event CRUD).
 * All datetime fields are Unix seconds on the wire; callers pass/receive ISO 8601.
 * Per spec §7.4.
 */

import { BaseClient } from './base-client.js';
import type { AuthManager } from '../auth/auth-manager.js';
import type { SynologyConfig } from '../types/index.js';

const ENTRY = '/webapi/entry.cgi';

// ---------------------------------------------------------------------------
// Wire-level shapes (Synology API)
// ---------------------------------------------------------------------------

/** Calendar entry as returned by SYNO.Cal.Cal list */
export interface SynoCalendar {
  cal_id: string;
  cal_displayname: string;
  cal_color: string;
  cal_description: string;
  /** "RW" or "RO" — this account's access to the calendar. */
  cal_privilege: string;
  /** Differs from cal_id when another user shared this calendar in. */
  original_cal_id?: string;
}

/** Attendee as stored in the Synology event */
export interface SynoAttendee {
  email: string;
  name: string;
  status?: string;
}

/**
 * Event as returned by SYNO.Cal.Event (list and get).
 *
 * Datetimes are iCal-style strings, not Unix seconds: "20251218",
 * "20251008T160000", or "TZID=Europe/Berlin:20251008T160000". The `get`
 * method additionally returns `dtstart_utc`/`dtend_utc` in Unix seconds;
 * `list` does not, so the string form is the only field both share.
 */
export interface SynoCalEvent {
  evt_id: number;
  summary: string;
  description: string;
  location: string;
  dtstart: string;
  dtend: string;
  tz_id?: string | null;
  is_all_day: boolean;
  is_repeat_evt?: boolean;
  evt_repeat_setting?: { repeat_rule?: string | null };
  /** Differs from the owning calendar id when the calendar is shared in. */
  original_cal_id?: string;
  owner_name?: string;
  attendee?: SynoAttendee[];
}

/**
 * SYNO.Cal.Event list returns events grouped by calendar id, not a flat
 * array — e.g. `{ "/mcp/home/": [ ...events ] }`. Calendars with no events
 * in range are omitted entirely.
 */
export type SynoEventListResponse = Record<string, SynoCalEvent[]>;

/** Raw create/update response from SYNO.Cal.Event */
interface SynoEventMutateResponse {
  evt_id: string;
  cal_id: string;
}

/** Raw create response from SYNO.Cal.Cal create */
interface SynoCalCreateResponse {
  cal_id: string;
}

// ---------------------------------------------------------------------------
// Input option types (exposed to tool layer)
// ---------------------------------------------------------------------------

/** Options for listEvents */
export interface ListEventsOpts {
  calendar_id?: string | undefined;
  start_unix: number;
  end_unix: number;
  limit?: number | undefined;
}

/** Options for createEvent */
export interface CreateEventOpts {
  calendar_id: string;
  title: string;
  dtstart: number;
  dtend: number;
  is_all_day: boolean;
  description?: string | undefined;
  location?: string | undefined;
  attendees?: Array<{ email: string; name?: string | undefined }> | undefined;
  recurrence?: string | undefined;
  reminder_minutes?: number | undefined;
}

/** Options for updateEvent */
export interface UpdateEventOpts {
  event_id: string;
  calendar_id: string;
  title?: string | undefined;
  dtstart?: number | undefined;
  dtend?: number | undefined;
  description?: string | undefined;
  location?: string | undefined;
}

/** Options for createCalendar */
export interface CreateCalendarOpts {
  name: string;
  color?: string | undefined;
  description?: string | undefined;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Wraps all SYNO.Cal.Cal and SYNO.Cal.Event operations.
 * Datetime values are in Unix seconds on the wire.
 */
export class CalendarClient extends BaseClient {
  constructor(config: SynologyConfig, authManager: AuthManager) {
    super(config, authManager);
  }

  /**
   * List all calendars accessible to the authenticated user.
   *
   * @returns Array of calendar entries.
   */
  listCalendars(): Promise<SynoCalendar[]> {
    return this.request<SynoCalendar[]>({
      endpoint: ENTRY,
      method: 'GET',
      params: { api: 'SYNO.Cal.Cal', version: 1, method: 'list' },
    });
  }

  /**
   * List events within a Unix-second time range.
   *
   * @param opts - Query options including optional calendar_id, start/end, limit.
   */
  async listEvents(opts: ListEventsOpts): Promise<SynoEventListResponse> {
    // DSM requires cal_id_list — a JSON array of calendar ids. A bare `cal_id`,
    // or omitting the filter entirely, fails with error 117. "All calendars"
    // therefore means enumerating them first.
    const calendarIds =
      opts.calendar_id !== undefined
        ? [opts.calendar_id]
        : (await this.listCalendars()).map((c) => c.cal_id);

    if (calendarIds.length === 0) {
      return {};
    }

    const params: Record<string, string | number | boolean> = {
      api: 'SYNO.Cal.Event',
      version: 1,
      method: 'list',
      start: opts.start_unix,
      end: opts.end_unix,
      limit: opts.limit ?? 100,
      cal_id_list: JSON.stringify(calendarIds),
    };

    return this.request<SynoEventListResponse>({ endpoint: ENTRY, method: 'GET', params });
  }

  /**
   * Fetch a single event by ID.
   *
   * @param event_id - Event identifier.
   * @param calendar_id - Owning calendar identifier.
   */
  getEvent(event_id: string, calendar_id: string): Promise<SynoCalEvent> {
    return this.request<SynoCalEvent>({
      endpoint: ENTRY,
      method: 'GET',
      params: {
        api: 'SYNO.Cal.Event',
        version: 1,
        method: 'get',
        evt_id: event_id,
        cal_id: calendar_id,
      },
    });
  }

  /**
   * Create a new calendar event.
   *
   * @param opts - Event properties with datetimes as Unix seconds.
   */
  createEvent(opts: CreateEventOpts): Promise<SynoEventMutateResponse> {
    const body = new URLSearchParams();
    body.set('title', opts.title);
    body.set('dtstart', String(opts.dtstart));
    body.set('dtend', String(opts.dtend));
    body.set('is_all_day', String(opts.is_all_day));
    if (opts.description !== undefined) body.set('desc', opts.description);
    if (opts.location !== undefined) body.set('location', opts.location);
    if (opts.recurrence !== undefined) body.set('rrule', opts.recurrence);
    if (opts.reminder_minutes !== undefined)
      body.set('reminder_minutes', String(opts.reminder_minutes));
    if (opts.attendees !== undefined) body.set('attendee', JSON.stringify(opts.attendees));

    return this.request<SynoEventMutateResponse>({
      endpoint: ENTRY,
      method: 'POST',
      params: { api: 'SYNO.Cal.Event', version: 1, method: 'create', cal_id: opts.calendar_id },
      body,
    });
  }

  /**
   * Update an existing calendar event. Only supplied fields are changed.
   *
   * @param opts - Partial event properties plus required event_id/calendar_id.
   */
  updateEvent(opts: UpdateEventOpts): Promise<SynoEventMutateResponse> {
    const body = new URLSearchParams();
    if (opts.title !== undefined) body.set('title', opts.title);
    if (opts.dtstart !== undefined) body.set('dtstart', String(opts.dtstart));
    if (opts.dtend !== undefined) body.set('dtend', String(opts.dtend));
    if (opts.description !== undefined) body.set('desc', opts.description);
    if (opts.location !== undefined) body.set('location', opts.location);

    return this.request<SynoEventMutateResponse>({
      endpoint: ENTRY,
      method: 'POST',
      params: {
        api: 'SYNO.Cal.Event',
        version: 1,
        method: 'edit',
        evt_id: opts.event_id,
        cal_id: opts.calendar_id,
      },
      body,
    });
  }

  /**
   * Delete an event.
   *
   * @param event_id - Event to delete.
   * @param calendar_id - Owning calendar.
   */
  deleteEvent(event_id: string, calendar_id: string): Promise<Record<string, never>> {
    const body = new URLSearchParams();
    body.set('evt_id', event_id);
    body.set('cal_id', calendar_id);

    return this.request<Record<string, never>>({
      endpoint: ENTRY,
      method: 'POST',
      params: { api: 'SYNO.Cal.Event', version: 1, method: 'delete' },
      body,
    });
  }

  /**
   * Create a new calendar.
   *
   * @param opts - Calendar name, optional color and description.
   */
  createCalendar(opts: CreateCalendarOpts): Promise<SynoCalCreateResponse> {
    const body = new URLSearchParams();
    body.set('name', opts.name);
    if (opts.color !== undefined) body.set('color', opts.color);
    if (opts.description !== undefined) body.set('description', opts.description);

    return this.request<SynoCalCreateResponse>({
      endpoint: ENTRY,
      method: 'POST',
      params: { api: 'SYNO.Cal.Cal', version: 1, method: 'create' },
      body,
    });
  }
}
