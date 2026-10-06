import { NextResponse } from "next/server";
import { listSurveys } from "@/lib/db/surveys";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, surveys: await listSurveys() });
}
