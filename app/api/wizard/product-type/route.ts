import { NextResponse } from "next/server";
import { z } from "zod";
import { saveProductType } from "@/lib/db/reports";

// 마법사 1단계(제품유형 선택)에서 파일이 확정된 뒤(2단계, validate 성공) 호출한다.
// fileUrl이 있어야 report 행에 upsert할 수 있으므로, 1단계 선택값은 브라우저 상태로 들고
// 있다가 여기서 함께 저장한다.
const BodySchema = z.object({
  fileUrl: z.string().url(),
  productType: z.enum(["sw", "physical"]),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  await saveProductType(body.data.fileUrl, body.data.productType);
  return NextResponse.json({ ok: true });
}
