import type { Priority, RunPhase, Slot } from "@/lib/booking";

export type LiveVisit = {
  gate: string;
  transaction: string;
  container: string;
  lineOperator: string;
  truckLicense: string;
  driverCard: string;
  reference: string;
  appointmentDate: string;
  ranges: { from: string; to: string }[];
  priority: Priority;
};

export type LivePatch = {
  phase: RunPhase;
  lines: string[];
  openings?: Slot[];
  selected?: Slot | null;
  dialog?: boolean;
  quotaAdd?: number;
  stopReason?: string | null;
  dateValue?: string;
};

type BookPayload = {
  status?: string;
  retry?: boolean;
  log?: string[];
  openings?: Slot[];
  selected?: Slot | null;
  quotaCount?: number;
};

const RETRY_PAUSE_MS = 8_000;

export async function followNavis(options: {
  cancelled: () => boolean;
  visit: () => LiveVisit | null;
  organisation: () => string;
  onUpdate: (patch: LivePatch) => void;
}) {
  while (!options.cancelled()) {
    const visit = options.visit();
    if (!visit) return;
    options.onUpdate({
      phase: "check",
      lines: ["Checking Navis for this container."],
      dialog: false,
      dateValue: visit.appointmentDate,
    });
    const payload = await requestBooking(visit, options.organisation());
    if (options.cancelled()) return;
    const lines = payload.log ?? [];
    const shared = {
      openings: payload.openings,
      quotaAdd: payload.quotaCount || 0,
    };
    if (payload.status === "secured") {
      options.onUpdate({
        ...shared,
        phase: "secured",
        lines,
        selected: payload.selected ?? null,
        dialog: false,
        dateValue: visit.appointmentDate,
        stopReason: null,
      });
      return;
    }
    if (payload.status === "duplicate") {
      options.onUpdate({
        ...shared,
        phase: "stopped",
        lines,
        dialog: false,
        dateValue: visit.appointmentDate,
        stopReason: lines.at(-1) || "Navis already has an appointment for this container.",
      });
      return;
    }
    const noOpenings =
      payload.status === "no-openings" || lines.some((line) => /no appointment openings/i.test(line));
    if (noOpenings) {
      options.onUpdate({
        ...shared,
        phase: "check",
        lines,
        dialog: true,
        dateValue: visit.appointmentDate,
      });
      await sleep(900, options.cancelled);
      if (options.cancelled()) return;
      options.onUpdate({
        phase: "dismiss",
        lines: ["Dismissed \u201cNo Appointment Openings Available\u201d."],
        dialog: false,
      });
      await sleep(600, options.cancelled);
      if (options.cancelled()) return;
      options.onUpdate({
        phase: "clear",
        lines: ["Cleared the appointment date."],
        dialog: false,
        dateValue: "",
      });
      await sleep(600, options.cancelled);
      if (options.cancelled()) return;
      options.onUpdate({
        phase: "reenter",
        lines: ["Entered the date again. Refreshing Appointment Openings."],
        dialog: false,
        dateValue: visit.appointmentDate,
      });
      await sleep(400, options.cancelled);
      continue;
    }
    options.onUpdate({
      ...shared,
      phase: "check",
      lines: [...lines, "The run keeps checking until an appointment is saved."],
      dialog: false,
      dateValue: visit.appointmentDate,
    });
    await sleep(RETRY_PAUSE_MS, options.cancelled);
  }
}

async function requestBooking(visit: LiveVisit, organisation: string): Promise<BookPayload> {
  try {
    const response = await fetch("/api/navis/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...visit, truckingCompany: organisation }),
    });
    return (await response.json()) as BookPayload;
  } catch {
    return {
      status: "error",
      retry: true,
      log: ["The desk could not reach the booking service. It will check again."],
    };
  }
}

function sleep(ms: number, cancelled: () => boolean) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      clearInterval(poll);
      resolve();
    }, ms);
    const poll = setInterval(() => {
      if (!cancelled()) return;
      clearTimeout(timer);
      clearInterval(poll);
      resolve();
    }, 400);
  });
}
