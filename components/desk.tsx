"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DeskScreen, type DeskWindow, type Visit } from "@/components/desk-screen";
import {
  formatDisplayDate,
  parseDisplayDate,
  initialRun,
  instantForRelease,
  nextRelease,
  terminalParts,
  tick,
  wakeRun,
  type RunPhase,
} from "@/lib/booking";
import { followNavis, type LivePatch } from "@/lib/navis-client";

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
  const windowsRef = useRef(windows);
  const sessionRef = useRef(session);
  const liveToken = useRef<Record<string, number>>({});
  const liveMode = useRef<Set<string>>(new Set());
  windowsRef.current = windows;
  sessionRef.current = session;

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
  const busy = windows.some((window) => ACTIVE.has(window.run.phase) && !liveMode.current.has(window.id));
  const awaitingRelease = windows.some(
    (window) => window.run.phase === "monitoring" && !liveMode.current.has(window.id),
  );

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [active?.log.length, active?.id]);

  useEffect(() => {
    if (!clock || !busy) return;
    const timer = window.setTimeout(() => {
      setWindows((current) =>
        current.map((deskWindow) => {
          if (liveMode.current.has(deskWindow.id) || !ACTIVE.has(deskWindow.run.phase)) return deskWindow;
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

  useEffect(() => {
    if (!clock || !terminal || !upcoming || busy || !awaitingRelease) return;
    const release = upcoming;
    const timer = window.setTimeout(() => {
      setClock(instantForRelease(release.iso, release.time));
      setWindows((current) =>
        current.map((deskWindow) => {
          if (liveMode.current.has(deskWindow.id) || deskWindow.run.phase !== "monitoring") return deskWindow;
          return {
            ...deskWindow,
            run: wakeRun(deskWindow.run),
            log: [
              ...deskWindow.log,
              `Release ${release.time} on ${formatDisplayDate(release.iso)}. The run continues.`,
            ],
          };
        }),
      );
    }, 650);
    return () => window.clearTimeout(timer);
  }, [awaitingRelease, busy, clock, terminal, upcoming]);

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
        if (liveMode.current.has(deskWindow.id) || deskWindow.run.phase !== "monitoring") return deskWindow;
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
    const token = (liveToken.current[deskWindow.id] ?? 0) + 1;
    liveToken.current[deskWindow.id] = token;
    liveMode.current.add(deskWindow.id);
    setWindows((current) =>
      current.map((item) =>
        item.id === deskWindow.id
          ? {
              ...item,
              run: { ...item.run, phase: "check", stopReason: null },
              log: [...item.log, "Start. This window will save on Navis when an interval matches."],
            }
          : item,
      ),
    );
    void followNavis({
      cancelled: () => liveToken.current[deskWindow.id] !== token,
      visit: () => {
        const current = windowsRef.current.find((item) => item.id === deskWindow.id);
        if (!current) return null;
        return {
          gate: current.visit.gate,
          transaction: current.visit.transaction,
          container: current.visit.container,
          lineOperator: current.visit.lineOperator,
          truckLicense: current.visit.truckLicense,
          driverCard: current.visit.driverCard,
          reference: current.visit.reference,
          appointmentDate: current.visit.appointmentDate,
          ranges: current.visit.ranges.map(({ from, to }) => ({ from, to })),
          priority: current.visit.priority,
        };
      },
      organisation: () => sessionRef.current?.organisation || "",
      onUpdate: (patch) => applyLive(deskWindow.id, token, patch),
    });
  }

  function applyLive(id: string, token: number, patch: LivePatch) {
    if (liveToken.current[id] !== token) return;
    setWindows((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          run: {
            ...item.run,
            phase: patch.phase,
            openings: patch.openings ?? item.run.openings,
            selectedId: patch.selected?.id ?? item.run.selectedId,
            securedSlot: patch.phase === "secured" ? (patch.selected ?? item.run.securedSlot) : item.run.securedSlot,
            dialog: patch.dialog ?? item.run.dialog,
            quotaCount: item.run.quotaCount + (patch.quotaAdd || 0),
            stopReason: patch.stopReason === undefined ? item.run.stopReason : patch.stopReason,
            dateValue: patch.dateValue ?? item.run.dateValue,
          },
          log: [...item.log, ...patch.lines],
        };
      }),
    );
  }

  function stop(id: string) {
    liveToken.current[id] = (liveToken.current[id] ?? 0) + 1;
    liveMode.current.delete(id);
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
