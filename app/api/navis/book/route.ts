import { parseDisplayDate, type Priority } from "@/lib/booking";
import { bookOnNavis } from "@/lib/navis-book";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Body = {
  gate?: string;
  transaction?: string;
  container?: string;
  appointmentDate?: string;
  ranges?: { from?: string; to?: string }[];
  priority?: Priority;
  lineOperator?: string;
  truckingCompany?: string;
  truckLicense?: string;
  driverCard?: string;
  reference?: string;
  pursue?: boolean;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ status: "error", retry: false, log: ["The booking request was not readable."] }, { status: 400 });
  }

  const gate = body.gate?.trim() || "";
  const transaction = body.transaction?.trim() || "";
  const container = body.container?.trim() || "";
  const appointmentDate = body.appointmentDate?.trim() || "";
  const ranges = (body.ranges || [])
    .map((range) => ({ from: range.from?.trim() || "", to: range.to?.trim() || "" }))
    .filter((range) => range.from && range.to);
  if (!gate || !transaction || !container || !parseDisplayDate(toDisplay(appointmentDate)) || ranges.length === 0) {
    return Response.json(
      {
        status: "error",
        retry: false,
        log: ["Gate, transaction, container, appointment date, and at least one time range are required."],
      },
      { status: 400 },
    );
  }

  const result = await bookOnNavis({
    gate,
    transaction,
    container,
    appointmentDate,
    ranges,
    priority: body.priority === "latest" ? "latest" : "earliest",
    lineOperator: body.lineOperator?.trim() || "",
    truckingCompany: body.truckingCompany?.trim() || "",
    truckLicense: body.truckLicense?.trim() || "",
    driverCard: body.driverCard?.trim() || "",
    reference: body.reference?.trim() || "",
    save: true,
    pursue: body.pursue !== false,
  });
  return Response.json(result);
}

function toDisplay(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
