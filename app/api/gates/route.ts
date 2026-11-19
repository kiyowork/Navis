import { NAVIS_GATES, NAVIS_GATES_PULLED_AT } from "@/lib/navis-gates";

export function GET() {
  return Response.json({
    gates: NAVIS_GATES,
    source: "navis-gate-zone",
    pulledAt: NAVIS_GATES_PULLED_AT,
  });
}
