import { crmBaseUrl, isZohoConfigured } from "@/lib/zoho";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/zoho/status -> whether Zoho credentials are present, so the UI can
// explain what to set up instead of failing on the first push.
export async function GET() {
  return Response.json({
    configured: isZohoConfigured(),
    leadSource: process.env.ZOHO_LEAD_SOURCE?.trim() || "Vizitka.ai",
    crmBaseUrl: crmBaseUrl(),
  });
}
