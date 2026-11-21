import { useCasePdfBase64 } from "@/lib/use-case-pdf";

export const dynamic = "force-static";

export function GET() {
  const bytes = Buffer.from(useCasePdfBase64, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="tej-automation-use-case.pdf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
