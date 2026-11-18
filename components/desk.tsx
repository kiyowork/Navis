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

export function Desk() {
  return null;
}
