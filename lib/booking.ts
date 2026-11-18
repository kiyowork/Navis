export const TERMINAL_ZONE = "Africa/Johannesburg";

export const RELEASE_TIMES = ["01:30", "06:30", "09:30", "13:30", "18:30", "21:30"] as const;
export type ReleaseTime = (typeof RELEASE_TIMES)[number];

export type Priority = "earliest" | "latest";

export type Range = { from: string; to: string };

export type Slot = {
  id: string;
  date: string;
  start: string;
  end: string;
  openings: number;
  quotaBlocked: boolean;
};

export type TerminalParts = {
  iso: string;
  hm: string;
  minutes: number;
};

const DAY_CATALOGUE: Omit<Slot, "id" | "date">[] = [
  { start: "00:00", end: "00:59", openings: 6, quotaBlocked: false },
  { start: "01:00", end: "01:59", openings: 4, quotaBlocked: false },
  { start: "06:00", end: "06:59", openings: 5, quotaBlocked: false },
  { start: "08:00", end: "08:59", openings: 3, quotaBlocked: false },
  { start: "10:00", end: "10:59", openings: 14, quotaBlocked: false },
  { start: "13:00", end: "13:59", openings: 2, quotaBlocked: true },
  { start: "14:00", end: "14:59", openings: 8, quotaBlocked: false },
  { start: "18:00", end: "18:59", openings: 4, quotaBlocked: false },
  { start: "21:00", end: "21:59", openings: 3, quotaBlocked: false },
  { start: "22:00", end: "22:59", openings: 2, quotaBlocked: false },
  { start: "23:00", end: "23:59", openings: 1, quotaBlocked: false },
];

export function terminalParts(instant: Date): TerminalParts {
  const bag = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TERMINAL_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const hm = `${bag.hour}:${bag.minute}`;
  return {
    iso: `${bag.year}-${bag.month}-${bag.day}`,
    hm,
    minutes: toMinutes(hm),
  };
}

export function isClosedDay(iso: string): boolean {
  const [, month, day] = iso.split("-").map(Number);
  return (month === 12 && day === 25) || (month === 1 && day === 1);
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toMinutes(hm: string): number {
  const [hour, minute] = hm.split(":").map(Number);
  return hour * 60 + minute;
}

export function formatDisplayDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function parseDisplayDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    return null;
  }
  return iso;
}

export function releaseAt(minutes: number): ReleaseTime | null {
  const hm = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return RELEASE_TIMES.find((time) => time === hm) ?? null;
}

export function nextRelease(parts: TerminalParts): { iso: string; time: ReleaseTime } | null {
  let iso = parts.iso;
  let minutes = parts.minutes;
  for (let guard = 0; guard < 4; guard += 1) {
    if (!isClosedDay(iso)) {
      const upcoming = RELEASE_TIMES.find((time) => toMinutes(time) > minutes);
      if (upcoming) return { iso, time: upcoming };
    }
    iso = addDays(iso, 1);
    minutes = -1;
  }
  return null;
}

export function slotsForRelease(iso: string, release: ReleaseTime): Slot[] {
  if (isClosedDay(iso)) return [];
  if (release === "21:30") {
    const tonight = DAY_CATALOGUE.filter((slot) => toMinutes(slot.start) >= toMinutes("21:00")).map((slot) =>
      materialise(iso, slot),
    );
    const next = addDays(iso, 1);
    const morning = isClosedDay(next)
      ? []
      : DAY_CATALOGUE.filter((slot) => toMinutes(slot.start) <= toMinutes("02:00")).map((slot) => materialise(next, slot));
    return [...tonight, ...morning];
  }
  return DAY_CATALOGUE.map((slot) => materialise(iso, slot));
}

function materialise(date: string, slot: Omit<Slot, "id" | "date">): Slot {
  return { ...slot, date, id: `${date}T${slot.start}` };
}

export function slotInRange(slot: Slot, range: Range): boolean {
  const start = toMinutes(slot.start);
  const from = toMinutes(range.from);
  const to = toMinutes(range.to);
  if (Number.isNaN(start) || Number.isNaN(from) || Number.isNaN(to)) return false;
  if (from <= to) return start >= from && start <= to;
  return start >= from || start <= to;
}

export function filterSlots(slots: Slot[], ranges: Range[], skipped: string[]): Slot[] {
  return slots.filter(
    (slot) => !skipped.includes(slot.id) && ranges.some((range) => slotInRange(slot, range)),
  );
}

export function pickSlot(slots: Slot[], priority: Priority): Slot | null {
  if (slots.length === 0) return null;
  const ordered = [...slots].sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  return priority === "earliest" ? ordered[0] : ordered[ordered.length - 1];
}

export function slotLabel(slot: Slot): string {
  return `${slot.start}-${slot.end} (Current Openings: ${slot.openings})`;
}

export type SaveResult = "secured" | "quota" | "duplicate";

export function saveResult(slot: Slot, container: string, securedContainers: string[]): SaveResult {
  if (securedContainers.some((booked) => booked.toUpperCase() === container.trim().toUpperCase())) {
    return "duplicate";
  }
  if (slot.quotaBlocked) return "quota";
  return "secured";
}

export type RunPhase =
  | "idle"
  | "click"
  | "enter"
  | "commit"
  | "check"
  | "dismiss"
  | "clear"
  | "refresh-click"
  | "reenter"
  | "recommit"
  | "choose"
  | "select"
  | "save"
  | "monitoring"
  | "secured"
  | "stopped";

export type RunState = {
  phase: RunPhase;
  dateValue: string;
  canTypeDate: boolean;
  dialog: boolean;
  openings: Slot[];
  selectedId: string | null;
  skipped: string[];
  quotaCount: number;
  stopReason: string | null;
  securedSlot: Slot | null;
  refreshedOnce: boolean;
};

export function initialRun(): RunState {
  return {
    phase: "idle",
    dateValue: "",
    canTypeDate: false,
    dialog: false,
    openings: [],
    selectedId: null,
    skipped: [],
    quotaCount: 0,
    stopReason: null,
    securedSlot: null,
    refreshedOnce: false,
  };
}

export type TickInput = {
  run: RunState;
  ranges: Range[];
  priority: Priority;
  container: string;
  appointmentDate: string;
  securedContainers: string[];
  terminal: TerminalParts;
};

export type TickOutput = {
  run: RunState;
  log: string | null;
};

export function startRun(run: RunState): RunState {
  return { ...initialRun(), phase: "click", quotaCount: run.quotaCount || 0 };
}

export function wakeRun(run: RunState): RunState {
  if (run.phase !== "monitoring") return run;
  return { ...run, phase: "check", dialog: false, refreshedOnce: false };
}

export function tick(input: TickInput): TickOutput {
  const { run, terminal } = input;
  if (run.phase === "idle" || run.phase === "monitoring" || run.phase === "secured" || run.phase === "stopped") {
    return { run, log: null };
  }

  const release = releaseAt(terminal.minutes);
  const closed = isClosedDay(terminal.iso);

  switch (run.phase) {
    case "click":
      return {
        run: { ...run, canTypeDate: true, phase: "enter" },
        log: "Clicked anywhere on the screen so the date can be entered.",
      };
    case "enter":
      return {
        run: { ...run, dateValue: input.appointmentDate, phase: "commit" },
        log: `Entered ${formatDisplayDate(input.appointmentDate)} for this release.`,
      };
    case "commit":
      return { run: { ...run, phase: "check" }, log: "Committed the date with T, then Tab." };
    case "check": {
      if (closed || !release) {
        if (run.refreshedOnce) {
          return {
            run: { ...run, openings: [], dialog: false, phase: "monitoring" },
            log: closed
              ? "Still no release on this closed day. Monitoring continues."
              : "Still no openings. Monitoring until the next release.",
          };
        }
        return {
          run: { ...run, openings: [], dialog: true, selectedId: null, phase: "dismiss" },
          log: closed
            ? "No release on 25 December or 1 January."
            : "Checked Appointment Openings. None are released at this minute.",
        };
      }
      const openings = slotsForRelease(terminal.iso, release).filter(
        (slot) => slot.date === input.appointmentDate,
      );
      if (openings.length === 0) {
        if (run.refreshedOnce) {
          return {
            run: { ...run, openings: [], dialog: false, phase: "monitoring" },
            log: "Still no openings. Monitoring until the next release.",
          };
        }
        return {
          run: { ...run, openings: [], dialog: true, selectedId: null, phase: "dismiss" },
          log: "Checked Appointment Openings. The list is empty.",
        };
      }
      return {
        run: { ...run, openings, dialog: false, phase: "choose" },
        log: `Appointment Openings lists ${openings.length} intervals.`,
      };
    }
    case "dismiss":
      return {
        run: { ...run, dialog: false, phase: "clear" },
        log: "Dismissed \u201cNo Appointment Openings Available\u201d.",
      };
    case "clear":
      return {
        run: { ...run, dateValue: "", canTypeDate: false, selectedId: null, phase: "refresh-click" },
        log: "Cleared the appointment date.",
      };
    case "refresh-click":
      return {
        run: { ...run, canTypeDate: true, phase: "reenter" },
        log: "Clicked anywhere on the screen.",
      };
    case "reenter":
      return {
        run: { ...run, dateValue: input.appointmentDate, phase: "recommit" },
        log: `Entered ${formatDisplayDate(input.appointmentDate)} for this release again.`,
      };
    case "recommit":
      return { run: { ...run, phase: "check", refreshedOnce: true }, log: "Committed the date with T, then Tab." };
    case "choose": {
      const matches = filterSlots(run.openings, input.ranges, run.skipped);
      const chosen = pickSlot(matches, input.priority);
      if (!chosen) {
        return {
          run: { ...run, phase: "monitoring", selectedId: null },
          log:
            run.openings.length === 0
              ? "Still no openings. Monitoring until the next release."
              : "Openings are listed, and none fall inside the ranges. Monitoring continues.",
        };
      }
      return { run: { ...run, selectedId: chosen.id, phase: "select" }, log: null };
    }
    case "select": {
      const chosen = run.openings.find((slot) => slot.id === run.selectedId);
      return {
        run: { ...run, phase: "save" },
        log: chosen ? `Selected ${slotLabel(chosen)}.` : "Selected an interval.",
      };
    }
    case "save": {
      const chosen = run.openings.find((slot) => slot.id === run.selectedId);
      if (!chosen) return { run: { ...run, phase: "choose" }, log: null };
      const result = saveResult(chosen, input.container, input.securedContainers);
      if (result === "duplicate") {
        return {
          run: {
            ...run,
            phase: "stopped",
            stopReason: "A duplicate appointment already exists for this container.",
          },
          log: "Save reported a duplicate appointment for this container. The window has stopped.",
        };
      }
      if (result === "quota") {
        return {
          run: {
            ...run,
            phase: "choose",
            selectedId: null,
            skipped: [...run.skipped, chosen.id],
            quotaCount: run.quotaCount + 1,
          },
          log: `Save reported the quota is reached for ${chosen.start}-${chosen.end}. The run continues.`,
        };
      }
      return {
        run: { ...run, phase: "secured", securedSlot: chosen },
        log: "Navis confirmed the booking. This window is finished.",
      };
    }
    default:
      return { run, log: null };
  }
}

export function instantForRelease(iso: string, time: ReleaseTime): Date {
  const [year, month, day] = iso.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  // Johannesburg is UTC+2 all year. Build the UTC instant for that wall time.
  return new Date(Date.UTC(year, month - 1, day, hour - 2, minute, 0));
}
