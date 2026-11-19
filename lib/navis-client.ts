import type { Priority, Slot } from "@/lib/booking";

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
  phase: "check" | "monitoring" | "secured" | "stopped";
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
  let showDialog = false;
  while (!options.cancelled()) {
    const visit = options.visit();
    if (!visit) return;
    options.onUpdate({
      phase: "check",
      lines: ["Checking Navis for this container."],
      dialog: showDialog,
      dateValue: visit.appointmentDate,
    });
    const payload = await requestBooking(visit, options.organisation());
    if (options.cancelled()) return;
    const lines = payload.log ?? [];
    showDialog = payload.status === "no-openings" || lines.some((line) => /no appointment openings/i.test(line));
    const shared = {
      openings: payload.openings,
      dialog: showDialog,
      quotaAdd: payload.quotaCount || 0,
      dateValue: visit.appointmentDate,
    };
    if (payload.status === "secured") {
      options.onUpdate({
        ...shared,
        phase: "secured",
        lines,
        selected: payload.selected ?? null,
        dialog: false,
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
        stopReason: lines.at(-1) || "Navis already has an appointment for this container.",
      });
      return;
    }
    const again = showDialog
      ? "No Appointment Openings Available. The run keeps checking until one can be saved."
      : "The run keeps checking until an appointment is saved.";
    options.onUpdate({ ...shared, phase: "check", lines: [...lines, again] });
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
