import { instantForRelease, nextRelease, terminalParts, type Priority, type Slot } from "@/lib/booking";

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

export async function followNavis(options: {
  cancelled: () => boolean;
  visit: () => LiveVisit | null;
  organisation: () => string;
  onUpdate: (patch: LivePatch) => void;
}) {
  while (!options.cancelled()) {
    const visit = options.visit();
    if (!visit) return;
    options.onUpdate({ phase: "check", lines: ["Checking Navis for this container."], dialog: false });
    const payload = await requestBooking(visit, options.organisation());
    if (options.cancelled()) return;
    const lines = payload.log ?? [];
    const shared = {
      openings: payload.openings,
      dialog: payload.status === "no-openings",
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
    if (!payload.retry) {
      options.onUpdate({
        ...shared,
        phase: "stopped",
        lines,
        stopReason: lines.at(-1) || "Navis stopped this window.",
      });
      return;
    }
    const release = nextRelease(terminalParts(new Date()));
    const wait = release
      ? Math.max(20_000, instantForRelease(release.iso, release.time).getTime() - Date.now())
      : 60_000;
    const when = release
      ? `Next check at ${release.time} on ${release.iso.slice(8, 10)}/${release.iso.slice(5, 7)}/${release.iso.slice(0, 4)}.`
      : "The next check is in a minute.";
    options.onUpdate({ ...shared, phase: "monitoring", lines: [...lines, when] });
    await sleep(wait, options.cancelled);
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
      log: ["The desk could not reach the booking service. It will try again at the next release."],
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
