"use client";

import type { RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDisplayDate, parseDisplayDate, RELEASE_TIMES, slotLabel, type Priority, type RunState, type TerminalParts } from "@/lib/booking";

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
function newId() {
  return crypto.randomUUID();
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
  const { session, organisation, name, onOrganisation, onName, onSignIn, terminal, upcoming, windows, active, onSelectWindow, securedCount, quotaTotal, onAdvance, onSignOut, formError, logRef, onUpdateVisit, onAddWindow, onStart, onStop } = props;
  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
        <p className="text-sm text-muted-foreground">Tej Automation</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Sign in to the terminal desk</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">The trucking company list follows the organisation on this login. The desk then runs one appointment in each window.</p>
        <form onSubmit={onSignIn} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="organisation">Organisation</Label>
            <Input id="organisation" value={organisation} onChange={(event) => onOrganisation(event.target.value)} autoComplete="organization" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" value={name} onChange={(event) => onName(event.target.value)} autoComplete="name" />
          </div>
          <Button type="submit" disabled={!organisation.trim() || !name.trim()}>Open the desk</Button>
        </form>
      </main>
    );
  }
  if (!terminal || !active) return <main className="p-8 text-sm text-muted-foreground">Opening the desk…</main>;
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
            <Button type="button" onClick={onAdvance} disabled={!upcoming}>{upcoming ? `Advance to ${upcoming.time}` : "No further release"}</Button>
            <Button type="button" variant="ghost" onClick={onSignOut}>Sign out</Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-4">
        <p className="mb-4 text-sm leading-6 text-muted-foreground">This desk runs the booking rules on a stand-in of the Navis Add Appointment screen. A live Navis address is not connected. Advance the terminal clock to a release, then the open window checks, refreshes once if nothing is listed, and saves the earliest or latest interval inside the ranges.</p>
        <div className="mb-4 flex gap-2 overflow-x-auto">
          {windows.map((deskWindow, index) => (
            <Button key={deskWindow.id} type="button" variant={deskWindow.id === active.id ? "default" : "outline"} onClick={() => onSelectWindow(deskWindow.id)}>
              Window {index + 1}{deskWindow.visit.container ? ` · ${deskWindow.visit.container}` : ""}<span className="text-xs opacity-80">{statusLabel(deskWindow.run.phase)}</span>
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
              <Input id="appointment-date" inputMode="numeric" placeholder="30/07/2026" value={active.visit.dateText} disabled={locked} className="bg-zinc-900 text-zinc-50" onChange={(event) => {
                const dateText = event.target.value;
                const parsed = parseDisplayDate(dateText);
                onUpdateVisit(active.id, parsed ? { dateText, appointmentDate: parsed } : { dateText });
              }} />
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-sm text-zinc-200">Time preference</p>
              {active.visit.ranges.map((range, index) => (
                <div key={range.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input aria-label={`From range ${index + 1}`} inputMode="numeric" placeholder="06:00" value={range.from} disabled={locked} className="bg-zinc-900 text-zinc-50" onChange={(event) => onUpdateVisit(active.id, { ranges: active.visit.ranges.map((item) => item.id === range.id ? { ...item, from: event.target.value } : item) })} />
                  <Input aria-label={`To range ${index + 1}`} inputMode="numeric" placeholder="06:19" value={range.to} disabled={locked} className="bg-zinc-900 text-zinc-50" onChange={(event) => onUpdateVisit(active.id, { ranges: active.visit.ranges.map((item) => item.id === range.id ? { ...item, to: event.target.value } : item) })} />
                  <Button type="button" variant="ghost" className="text-zinc-200" disabled={locked || active.visit.ranges.length === 1} onClick={() => onUpdateVisit(active.id, { ranges: active.visit.ranges.filter((item) => item.id !== range.id) })}>Remove</Button>
                </div>
              ))}
              <Button type="button" variant="secondary" disabled={locked} onClick={() => onUpdateVisit(active.id, { ranges: [...active.visit.ranges, { id: newId(), from: "14:00", to: "14:30" }] })}>Add another range</Button>
            </div>
            <RadioGroup className="mt-4" value={active.visit.priority} disabled={locked} onValueChange={(value) => onUpdateVisit(active.id, { priority: value as Priority })}>
              <div className="flex items-center gap-2"><RadioGroupItem id="earliest" value="earliest" /><Label htmlFor="earliest" className="text-zinc-100">Earliest</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem id="latest" value="latest" /><Label htmlFor="latest" className="text-zinc-100">Latest</Label></div>
            </RadioGroup>
            <div className="mt-4 flex gap-2">
              <Button type="button" onClick={() => onStart(active)} disabled={running || active.run.phase === "secured"}>Start bot</Button>
              <Button type="button" variant="secondary" onClick={() => onStop(active.id)} disabled={!running && active.run.phase !== "monitoring"}>Stop</Button>
            </div>
            {formError ? <p className="mt-3 text-sm text-rose-300">{formError}</p> : null}
            <p className="mt-4 text-xs text-zinc-400">{statusLabel(active.run.phase)}{active.run.securedSlot ? ` · ${slotLabel(active.run.securedSlot)}` : ""}{active.run.stopReason ? ` · ${active.run.stopReason}` : ""}</p>
            <p className="text-xs text-zinc-400">Quota replies in this window: {active.run.quotaCount}</p>
            <ol ref={logRef} className="mt-3 max-h-64 space-y-1 overflow-auto text-xs leading-5 text-zinc-300">
              {active.log.length === 0 ? <li>The run log appears here after Start.</li> : null}
              {active.log.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
            </ol>
          </section>
          <section className="overflow-hidden rounded-xl border bg-white text-zinc-900 shadow-sm">
            <div className="bg-sky-100 px-4 py-2 text-sm font-semibold">Add Appointment</div>
            <div className="space-y-6 p-4">
              <fieldset className="grid gap-3 md:grid-cols-2">
                <legend className="mb-2 text-sm font-semibold">Basics</legend>
                <Field label="Gate/Zone" required empty={!active.visit.gate}>
                  <Select key={`${active.id}-gate`} value={active.visit.gate} disabled={locked} onValueChange={(gate) => onUpdateVisit(active.id, { gate })}>
                    <SelectTrigger className={fieldTone(!active.visit.gate)}><SelectValue placeholder="Select a gate" /></SelectTrigger>
                    <SelectContent>{GATES.map((gate) => <SelectItem key={gate} value={gate}>{gate}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Transaction Type" required empty={!active.visit.transaction}>
                  <Select key={`${active.id}-transaction`} value={active.visit.transaction} disabled={locked} onValueChange={(transaction) => onUpdateVisit(active.id, { transaction })}>
                    <SelectTrigger className={fieldTone(!active.visit.transaction)}><SelectValue placeholder="Select a type" /></SelectTrigger>
                    <SelectContent>{TRANSACTIONS.map((transaction) => <SelectItem key={transaction} value={transaction}>{transaction}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Line Operator"><Input value={active.visit.lineOperator} disabled={locked} onChange={(event) => onUpdateVisit(active.id, { lineOperator: event.target.value })} /></Field>
                <Field label="Trucking Company"><Input value={session.organisation} readOnly /></Field>
                <Field label="Truck License Nbr"><Input value={active.visit.truckLicense} disabled={locked} onChange={(event) => onUpdateVisit(active.id, { truckLicense: event.target.value })} /></Field>
                <Field label="Driver Card Id"><Input value={active.visit.driverCard} disabled={locked} onChange={(event) => onUpdateVisit(active.id, { driverCard: event.target.value })} /></Field>
                <div className="md:col-span-2"><Field label="Reference Nbr"><Input value={active.visit.reference} disabled={locked} onChange={(event) => onUpdateVisit(active.id, { reference: event.target.value })} /></Field></div>
              </fieldset>
              <fieldset className="grid gap-3 md:grid-cols-2">
                <legend className="mb-2 text-sm font-semibold">Unit Information</legend>
                <Field label="Container Id" required empty={!active.visit.container.trim()}>
                  <Input value={active.visit.container} disabled={locked} className={fieldTone(!active.visit.container.trim())} onChange={(event) => onUpdateVisit(active.id, { container: event.target.value.toUpperCase() })} />
                </Field>
                <Field label="GIR Code or BL Nbr"><Input value={active.visit.container.trim() ? billOfLading(active.visit.container) : ""} readOnly /></Field>
              </fieldset>
              <fieldset className="relative grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                <legend className="mb-2 text-sm font-semibold">Appointment Time</legend>
                <Field label="Requested Date"><Input value={active.run.dateValue ? formatDisplayDate(active.run.dateValue) : ""} placeholder="dd/mm/yyyy" readOnly className={fieldTone(!active.run.dateValue)} /></Field>
                <Field label="Appointment Openings" required empty={active.run.openings.length === 0}>
                  <div className={`min-h-24 rounded-md border p-2 text-sm ${active.run.openings.length === 0 ? "bg-rose-100" : "bg-white"}`}>
                    {active.run.openings.length === 0 ? <p className="text-zinc-500">No intervals listed.</p> : (
                      <ul>{active.run.openings.map((slot) => <li key={slot.id} className={slot.id === active.run.selectedId ? "rounded bg-sky-100 px-1 font-medium" : "px-1"}>{slotLabel(slot)}</li>)}</ul>
                    )}
                  </div>
                </Field>
                {active.run.dialog ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 p-4">
                    <div className="max-w-md rounded-md border border-sky-300 bg-sky-50 p-4 shadow-sm">
                      <h3 className="font-semibold">No Appointment Openings Available</h3>
                      <p className="mt-2 text-sm leading-6">There are no appointment openings available for the entered date: Either the appointment creation window for the entered date has not been reached yet/has passed, or all available openings are already booked. Please try to make an appointment for a different day.</p>
                      <p className="mt-3 text-xs text-zinc-500">The run dismisses this, clears the date, and enters it again.</p>
                    </div>
                  </div>
                ) : null}
              </fieldset>
              <div className="flex gap-2"><Button type="button" disabled>Save</Button><Button type="button" variant="outline" disabled>Cancel</Button></div>
              <p className="text-xs text-zinc-500">Releases {RELEASE_TIMES.join(", ")}. The 13:00 interval in this stand-in answers that the quota is reached, so a range covering 13:00 and 14:00 shows the run moving on. A second window with the same container stops on a duplicate.</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Field({ label, children, required = false, empty = false }: { label: string; children: React.ReactNode; required?: boolean; empty?: boolean }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}{required && empty ? <span className="text-rose-700"> *</span> : null}</span>
      {children}
    </label>
  );
}
function fieldTone(empty: boolean) {
  return empty ? "bg-rose-100" : "bg-white";
}
