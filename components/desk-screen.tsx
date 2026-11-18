"use client";

import type { RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  formatDisplayDate,
  RELEASE_TIMES,
  slotLabel,
  type Priority,
  type RunState,
  type TerminalParts,
} from "@/lib/booking";

const GATES = ["109 (ITZ 109)", "203 (ITZ 203 Virtual Gate)"];
const TRANSACTIONS = ["Drop Off Export", "Drop Off Empty", "Pick Up Import"];

export type RangeRow = { id: string; from: string; to: string };
export type Visit = {
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
export type DeskWindow = { id: string; visit: Visit; run: RunState; log: string[] };

function billOfLading(container: string) {
  const digits = container.replace(/\D/g, "");
  return (digits + "275810946").replace(/\D/g, "").slice(0, 9).padEnd(9, "0");
}

function statusLabel(phase: RunState["phase"]) {
  if (phase === "secured") return "Booked";
  if (phase === "stopped") return "Stopped";
  if (phase === "monitoring") return "Monitoring";
  if (phase === "idle") return "Ready";
  return "Running";
}

export function DeskScreen(props: {
  session: { organisation: string; name: string } | null;
  organisation: string;
  name: string;
  onOrganisation: (value: string) => void;
  onName: (value: string) => void;
  onSignIn: (event: React.FormEvent) => void;
  terminal: TerminalParts | null;
  upcoming: { iso: string; time: string } | null;
  windows: DeskWindow[];
  active: DeskWindow | undefined;
  onSelectWindow: (id: string) => void;
  securedCount: number;
  quotaTotal: number;
  onAdvance: () => void;
  onSignOut: () => void;
  formError: string;
  logRef: RefObject<HTMLOListElement | null>;
  onUpdateVisit: (id: string, patch: Partial<Visit>) => void;
  onAddWindow: () => void;
  onStart: (deskWindow: DeskWindow) => void;
  onStop: (id: string) => void;
}) {
  const {
    session,
    organisation,
    name,
    onOrganisation,
    onName,
    onSignIn,
    terminal,
    upcoming,
    windows,
    active,
    onSelectWindow,
    securedCount,
    quotaTotal,
    onAdvance,
    onSignOut,
    formError,
    logRef,
    onUpdateVisit,
    onAddWindow,
    onStart,
    onStop,
  } = props;

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
        <p className="text-sm text-muted-foreground">Tej Automation</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Sign in to the terminal desk</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The trucking company list follows the organisation on this login. The desk then runs one appointment in each window.
        </p>
        <form onSubmit={onSignIn} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="organisation">Organisation</Label>
            <Input id="organisation" value={organisation} onChange={(event) => onOrganisation(event.target.value)} autoComplete="organization" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" value={name} onChange={(event) => onName(event.target.value)} autoComplete="name" />
          </div>
          <Button type="submit" disabled={!organisation.trim() || !name.trim()}>
            Open the desk
          </Button>
        </form>
      </main>
    );
  }

  if (!terminal || !active) {
    return <main className="p-8 text-sm text-muted-foreground">Opening the desk…</main>;
  }

  const running = active.run.phase !== "idle" && active.run.phase !== "monitoring" && active.run.phase !== "secured" && active.run.phase !== "stopped";
  const locked = running || active.run.phase === "secured";

  return (
    <main className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tej Automation</p>
            <h1 className="text-2xl font-semibold">NAVIS AUTOMATION</h1>
            <p className="text-sm text-muted-foreground">{session.name} · {session.organisation}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Terminal time, Johannesburg</p>
              <p className="font-mono text-lg">{formatDisplayDate(terminal.iso)} {terminal.hm}</p>
            </div>
            <Badge variant="secondary">{securedCount} secured</Badge>
            <Badge variant="outline">{quotaTotal} quota</Badge>
            <Button type="button" onClick={onAdvance} disabled={!upcoming}>
              {upcoming ? `Advance to ${upcoming.time}` : "No further release"}
            </Button>
            <Button type="button" variant="ghost" onClick={onSignOut}>Sign out</Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-4">
        <p className="mb-4 text-sm leading-6 text-muted-foreground">
          This desk runs the booking rules on a stand-in of the Navis Add Appointment screen. A live Navis address is not connected. Advance the terminal clock to a release, then the open window checks, refreshes once if nothing is listed, and saves the earliest or latest interval inside the ranges.
        </p>
        <div className="mb-4 flex gap-2 overflow-x-auto">
          {windows.map((deskWindow, index) => (
            <Button key={deskWindow.id} type="button" variant={deskWindow.id === active.id ? "default" : "outline"} onClick={() => onSelectWindow(deskWindow.id)}>
              Window {index + 1}
              {deskWindow.visit.container ? ` · ${deskWindow.visit.container}` : ""}
              <span className="text-xs opacity-80">{statusLabel(deskWindow.run.phase)}</span>
            </Button>
          ))}
          <Button type="button" variant="secondary" onClick={onAddWindow}>Add window</Button>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <section className="rounded-xl bg-zinc-950 p-4 text-zinc-50">
            <h2 className="text-sm font-semibold tracking-wide">NAVIS AUTOMATION</h2>
            <p className="mt-1 text-xs text-zinc-400">Date {formatDisplayDate(active.visit.appointmentDate)}</p>
            <div className="mt-4 space-y-2">
              <Label htmlFor="appointment-date" className="text-zinc-200">Date</Label>
              <Input id="appointment-date" inputMode="numeric" placeholder="30/07/2026" value={active.visit.dateText} disabled={locked} onChange={(event) => {
                const dateText = event.target.value;
                const parsed = requireDate(dateText);
                onUpdateVisit(active.id, parsed ? { dateText, appointmentDate: parsed } : { dateText });
              }} className="bg-zinc-900 text-zinc-50" />
            </div>
            <p className="mt-4 text-sm text-zinc-200">Time ranges, earliest or latest, Start, and the Add Appointment form follow in this screen.</p>
          </section>
        </div>
      </div>
    </main>
  );
}

function requireDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}
