import type { Slot } from "@/lib/booking";

export function parseOpening(raw: string, appointmentDate: string): Slot | null {
  const text = raw.replace(/\s+/g, " ").trim();
  const ranged = /(\d{2}:\d{2})\s*[-\u2013]\s*(\d{2}:\d{2})/.exec(text);
  if (ranged) {
    const count = /openings:\s*(\d+)/i.exec(text);
    return {
      id: text,
      date: appointmentDate,
      start: ranged[1],
      end: ranged[2],
      openings: count ? Number(count[1]) : 0,
      quotaBlocked: false,
    };
  }
  const compact = /(\d{2})(\d{2})\s*[-\u2013]\s*(\d{2})(\d{2})/.exec(text);
  if (!compact) return null;
  const count = /openings:\s*(\d+)/i.exec(text);
  return {
    id: text,
    date: appointmentDate,
    start: `${compact[1]}:${compact[2]}`,
    end: `${compact[3]}:${compact[4]}`,
    openings: count ? Number(count[1]) : 0,
    quotaBlocked: false,
  };
}
