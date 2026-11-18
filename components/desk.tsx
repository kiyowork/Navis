"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatDisplayDate,
  parseDisplayDate,
  initialRun,
  instantForRelease,
  nextRelease,
  RELEASE_TIMES,
  slotLabel,
  startRun,
  terminalParts,
  tick,
  wakeRun,
  type Priority,
  type RunPhase,
  type RunState,
} from "@/lib/booking";

const GATES = ["109 (ITZ 109)", "203 (ITZ 203 Virtual Gate)"];
const TRANSACTIONS = ["Drop Off Export", "Drop Off Empty", "Pick Up Import"];
const ACTIVE = new Set<RunPhase>([
  "click",
  "enter",
  "commit",
  "check",
  "dismiss",
  "clear",
  "refresh-click",
  "reenter",
  "recommit",
  "choose",
  "select",
  "save",
]);

type RangeRow = { id: string; from: string; to: string };
type Visit = {
  gate: string;
  transaction: string;
  container: string;
  lineOperator: string;
  truckLicense: string;
  driverCard: string;
  reference: string;
  appointmentDate: string;
  dateText: string;
  ranges: RangeRow[];
  priority: Priority;
};
type DeskWindow = { id: string; visit: Visit; run: RunState; log: string[] };
type Session = { organisation: string; name: string };

function newId() {
  return crypto.randomUUID();
}

function billOfLading(container: string) {
  const digits = container.replace(/\D/g, "");
  return (digits + "275810946").replace(/\D/g, "").slice(0, 9).padEnd(9, "0");
}

function blankVisit(today: string): Visit {
  return {
    gate: "",
    transaction: "",
    container: "",
    lineOperator: "",
    truckLicense: "",
    driverCard: "",
    reference: "",
    appointmentDate: today,
    dateText: formatDisplayDate(today),
    ranges: [{ id: newId(), from: "10:00", to: "10:19" }],
    priority: "earliest",
  };
}

function blankWindow(today: string): DeskWindow {
  return { id: newId(), visit: blankVisit(today), run: initialRun(), log: [] };
}

function statusLabel(phase: RunPhase) {
  if (phase === "secured") return "Booked";
  if (phase === "stopped") return "Stopped";
  if (phase === "monitoring") return "Monitoring";
  if (phase === "idle") return "Ready";
  return "Running";
}

export function Desk() {
  const [session, setSession] = useState<Session | null>(null);
  const [organisation, setOrganisation] = useState("Maison Corp");
  const [name, setName] = useState("");
  const [clock, setClock] = useState<Date | null>(null);
  const [windows, setWindows] = useState<DeskWindow[]>([]);
  const [activeId, setActiveId] = useState("");
  const [formError, setFormError] = useState("");
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const now = new Date();
    const today = terminalParts(now).iso;
    const first = blankWindow(today);
    setClock(now);
    setWindows([first]);
    setActiveId(first.id);
  }, []);

  const terminal = clock ? terminalParts(clock) : null;
  const upcoming = terminal ? nextRelease(terminal) : null;
  const active = windows.find((window) => window.id === activeId) ?? windows[0];
  const securedContainers = useMemo(
    () => windows.filter((window) => window.run.phase === "secured").map((window) => window.visit.container),
    [windows],
  );
  const quotaTotal = windows.reduce((sum, window) => sum + window.run.quotaCount, 0);
  const busy = windows.some((window) => ACTIVE.has(window.run.phase));

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [active?.log.length, active?.id]);

  useEffect(() => {
    if (!clock || !busy) return;
    const timer = window.setTimeout(() => {
      setWindows((current) =>
        current.map((deskWindow) => {
          if (!ACTIVE.has(deskWindow.run.phase)) return deskWindow;
          const next = tick({
            run: deskWindow.run,
            ranges: deskWindow.visit.ranges.map(({ from, to }) => ({ from, to })),
            priority: deskWindow.visit.priority,
            container: deskWindow.visit.container,
            appointmentDate: deskWindow.visit.appointmentDate,
            securedContainers: current
              .filter((other) => other.id !== deskWindow.id && other.run.phase === "secured")
              .map((other) => other.visit.container),
            terminal: terminalParts(clock),
          });
          return {
            ...deskWindow,
            run: next.run,
            log: next.log ? [...deskWindow.log, next.log] : deskWindow.log,
          };
        }),
      );
    }, 650);
    return () => window.clearTimeout(timer);
  }, [busy, clock, windows]);

  function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!organisation.trim() || !name.trim()) return;
    setSession({ organisation: organisation.trim(), name: name.trim() });
  }

  function updateVisit(id: string, patch: Partial<Visit>) {
    setWindows((current) =>
      current.map((deskWindow) =>
        deskWindow.id === id ? { ...deskWindow, visit: { ...deskWindow.visit, ...patch } } : deskWindow,
      ),
    );
  }

  function addWindow() {
    if (!terminal) return;
    const created = blankWindow(terminal.iso);
    setWindows((current) => [...current, created]);
    setActiveId(created.id);
    setFormError("");
  }

  function advanceClock() {
    if (!terminal || !upcoming) return;
    setClock(instantForRelease(upcoming.iso, upcoming.time));
    setWindows((current) =>
      current.map((deskWindow) => {
        if (deskWindow.run.phase !== "monitoring") return deskWindow;
        return {
          ...deskWindow,
          run: wakeRun(deskWindow.run),
          log: [...deskWindow.log, `Release ${upcoming.time} on ${formatDisplayDate(upcoming.iso)}.`],
        };
      }),
    );
  }

  function start(deskWindow: DeskWindow) {
    const visit = deskWindow.visit;
    if (!visit.gate || !visit.transaction || !visit.container.trim()) {
      setFormError("Fill the gate, transaction type, and container number before Start.");
      return;
    }
    if (!parseDisplayDate(visit.dateText)) {
      setFormError("Enter the appointment date as day/month/year, for example 30/07/2026.");
      return;
    }
    if (visit.ranges.some((range) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(range.from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(range.to))) {
      setFormError("Enter each range as 24-hour times, for example 06:00 to 06:19.");
      return;
    }
    setFormError("");
    setWindows((current) =>
      current.map((item) =>
        item.id === deskWindow.id
          ? { ...item, run: startRun(item.run), log: [...item.log, "Start."] }
          : item,
      ),
    );
  }

  function stop(id: string) {
    setWindows((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              run: { ...item.run, phase: "stopped", stopReason: "Stopped from the desk." },
              log: [...item.log, "Stopped from the desk."],
            }
          : item,
      ),
    );
  }

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
        <p className="text-sm text-muted-foreground">Tej Automation</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Sign in to the terminal desk</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The trucking company list follows the organisation on this login. The desk then runs one appointment in each window.
        </p>
        <form onSubmit={signIn} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="organisation">Organisation</Label>
            <Input
              id="organisation"
              value={organisation}
              onChange={(event) => setOrganisation(event.target.value)}
              autoComplete="organization"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </div>
          <Button type="submit" disabled={!organisation.trim() || !name.trim()}>
            Open the desk
          </Button>
        </form>
      </main>
    );
  }

  if (!terminal || !active) {
    return <main className="p-8 text-sm text-muted-foreground">Opening the desk\u2026</main>;
  }

  const running = ACTIVE.has(active.run.phase);
  const locked = running || active.run.phase === "secured";

  return (
    <main className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tej Automation</p>
            <h1 className="text-2xl font-semibold">NAVIS AUTOMATION</h1>
            <p className="text-sm text-muted-foreground">
              {session.name} \u00b7 {session.organisation}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Terminal time, Johannesburg</p>
              <p className="font-mono text-lg">{formatDisplayDate(terminal.iso)} {terminal.hm}</p>
            </div>
            <Badge variant="secondary">{securedContainers.length} secured</Badge>
            <Badge variant="outline">{quotaTotal} quota</Badge>
            <Button type="button" onClick={advanceClock} disabled={!upcoming}>
              {upcoming ? `Advance to ${upcoming.time}` : "No further release"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSession(null)}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-4">
        <p className="mb-4 text-sm leading-6 text-muted-foreground">
          This desk runs the booking rules on a stand-in of the Navis Add Appointment screen. A live Navis address is not connected. Advance the terminal clock to a release, then the open window checks, refreshes once if nothing is listed, and saves the earliest or latest interval inside the ranges.
        </p>
        <p className="text-sm">Window controls and the Add Appointment form are in this file.</p>
      </div>
    </main>
  );
}
