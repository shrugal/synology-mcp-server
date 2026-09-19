/**
 * MCP tool: calendar_list_calendars
 * Lists all calendars accessible to the authenticated user.
 * Per spec §7.4.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../types.js';
import { toMcpError } from '../types.js';
import type { SynoCalendar } from '../../clients/calendar-client.js';

const inputSchema = z.object({});

/**
 * Map a raw Synology calendar to the MCP output shape.
 *
 * DSM names these fields `cal_displayname` / `cal_color` / `cal_description`,
 * and reports sharing through `original_cal_id`: a calendar shared in from
 * another account keeps its source id there (e.g. cal_id "/mcp/niko--home/"
 * with original_cal_id "/niko/home/").
 */
function mapCalendar(c: SynoCalendar): {
  id: string;
  name: string;
  color: string;
  is_owner: boolean;
  is_shared: boolean;
  writable: boolean;
  description: string;
} {
  const originalId = c.original_cal_id ?? c.cal_id;
  return {
    id: c.cal_id,
    name: c.cal_displayname,
    color: c.cal_color,
    is_owner: originalId === c.cal_id,
    is_shared: originalId !== c.cal_id,
    writable: (c.cal_privilege ?? '').toUpperCase().includes('W'),
    description: c.cal_description,
  };
}

/** calendar_list_calendars tool definition */
export const calendarListCalendarsTool: ToolDefinition<typeof inputSchema> = {
  name: 'calendar_list_calendars',
  description: 'List all Synology Calendar calendars accessible to the authenticated user.',
  inputSchema,
  async handler(_input: z.infer<typeof inputSchema>, ctx: ToolContext) {
    try {
      const calendars = await ctx.calendarClient.listCalendars();
      return { calendars: calendars.map(mapCalendar) };
    } catch (err) {
      return toMcpError(err);
    }
  },
};
