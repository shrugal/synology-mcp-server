/**
 * Shared mapper: converts a raw SynoCalEvent to the MCP event shape (ISO 8601).
 * Imported by list-events and get-event to avoid duplication.
 *
 * DSM returns iCal-style datetime strings rather than Unix seconds, optionally
 * carrying their own zone: "20251218", "20251008T160000", or
 * "TZID=Europe/Berlin:20251008T160000". The zone is reported separately in
 * `timezone` instead of being resolved to an offset, so no instant is invented
 * for a zone the server may not share.
 */

import type { SynoCalEvent, SynoAttendee } from '../../clients/calendar-client.js';

const ATTENDEE_STATUS_MAP: Record<string, 'accepted' | 'declined' | 'tentative' | 'needs-action'> =
  {
    accepted: 'accepted',
    declined: 'declined',
    tentative: 'tentative',
    'needs-action': 'needs-action',
  };

function mapAttendeeStatus(
  raw: string | undefined,
): 'accepted' | 'declined' | 'tentative' | 'needs-action' {
  if (raw === undefined) return 'needs-action';
  return ATTENDEE_STATUS_MAP[raw.toLowerCase()] ?? 'needs-action';
}

function mapAttendee(a: SynoAttendee): {
  name: string;
  email: string;
  status: 'accepted' | 'declined' | 'tentative' | 'needs-action';
} {
  return {
    name: a.name,
    email: a.email,
    status: mapAttendeeStatus(a.status),
  };
}

/** Splits "TZID=Europe/Berlin:20251008T160000" into its zone and timestamp. */
function splitZone(value: string): { zone: string | null; stamp: string } {
  const match = /^TZID=([^:]+):(.*)$/.exec(value);
  if (match === null) return { zone: null, stamp: value };
  return { zone: match[1] ?? null, stamp: match[2] ?? '' };
}

/** "20251008T160000" → "2025-10-08T16:00:00"; "20251218" → "2025-12-18". */
function toIso(stamp: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(stamp);
  if (match === null) return stamp; // unrecognised — pass through untouched
  const [, year, month, day, hour, minute, second, utc] = match;
  if (hour === undefined) return `${year}-${month}-${day}`;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${utc ?? ''}`;
}

/** MCP-shaped event output. */
export interface MappedEvent {
  id: string;
  calendar_id: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  /** IANA zone the start/end are expressed in, or null when floating. */
  timezone: string | null;
  all_day: boolean;
  recurring: boolean;
  recurrence: string | null;
  owner: string | null;
  attendees: Array<{
    name: string;
    email: string;
    status: 'accepted' | 'declined' | 'tentative' | 'needs-action';
  }>;
}

/**
 * Convert a raw Synology event to the MCP output shape (ISO 8601).
 *
 * @param e - Raw Synology event from the API.
 * @param calendarId - Owning calendar; the list response carries it as the
 *   grouping key rather than as a field on the event itself.
 * @returns MCP-shaped event with ISO 8601 start/end.
 */
export function mapEvent(e: SynoCalEvent, calendarId: string): MappedEvent {
  const start = splitZone(e.dtstart ?? '');
  const end = splitZone(e.dtend ?? '');
  const rule = e.evt_repeat_setting?.repeat_rule;

  return {
    id: String(e.evt_id),
    calendar_id: calendarId,
    title: e.summary ?? '',
    description: e.description ?? '',
    location: e.location ?? '',
    start: toIso(start.stamp),
    end: toIso(end.stamp),
    timezone: start.zone ?? e.tz_id ?? null,
    all_day: e.is_all_day === true,
    recurring: e.is_repeat_evt === true,
    recurrence: rule !== undefined && rule !== null && rule !== '' ? rule : null,
    owner: e.owner_name ?? null,
    attendees: (e.attendee ?? []).map(mapAttendee),
  };
}
