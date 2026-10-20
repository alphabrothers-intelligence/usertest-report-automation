import { NextResponse } from "next/server";
import { listPlans } from "@/lib/db/surveys";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, plans: await listPlans() });
}
