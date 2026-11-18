"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DeskScreen, type DeskWindow, type Visit } from "@/components/desk-screen";
import {
  formatDisplayDate,
  parseDisplayDate,
  initialRun,
  instantForRelease,
  nextRelease,
  startRun,
  terminalParts,
  tick,
  wakeRun,
  type Priority,
  type RunPhase,
} from "@/lib/booking";

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

function newId() {
  return crypto.randomUUID();
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

export function Desk() {
  const [session, setSession] = useState<{ organisation: string; name: string } | null>(null);
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
  const securedCount = useMemo(
    () => windows.filter((window) => window.run.phase === "secured").length,
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
    if (
      visit.ranges.some(
        (range) =>
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(range.from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(range.to),
      )
    ) {
      setFormError("Enter each range as 24-hour times, for example 06:00 to 06:19.");
      return;
    }
    setFormError("");
    setWindows((current) =>
      current.map((item) =>
        item.id === deskWindow.id ? { ...item, run: startRun(item.run), log: [...item.log, "Start."] } : item,
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

  return (
    <DeskScreen
      session={session}
      organisation={organisation}
      name={name}
      onOrganisation={setOrganisation}
      onName={setName}
      onSignIn={signIn}
      terminal={terminal}
      upcoming={upcoming}
      windows={windows}
      active={active}
      onSelectWindow={setActiveId}
      securedCount={securedCount}
      quotaTotal={quotaTotal}
      onAdvance={advanceClock}
      onSignOut={() => setSession(null)}
      formError={formError}
      logRef={logRef}
      onUpdateVisit={updateVisit}
      onAddWindow={addWindow}
      onStart={start}
      onStop={stop}
    />
  );
}
