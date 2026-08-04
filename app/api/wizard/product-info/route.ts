import { NextResponse } from "next/server";
import { z } from "zod";
import { saveProductInfo } from "@/lib/db/reports";
import { PRODUCT_INFO_FIELD_LABELS, type ProductInfo } from "@/lib/productInfo/types";

// app/api/chat/route.ts의 saveProductInfoTool 본문을 그대로 옮긴 것 — AI 해석 없이 그대로
// 저장만 하므로(사용자가 직접 입력했거나 이미 승인한 값만 전달됨) 채팅 없이도 안전하다.
const FIELD_KEYS = Object.keys(PRODUCT_INFO_FIELD_LABELS) as (keyof ProductInfo)[];
const ProductInfoSchema = z.object(
  Object.fromEntries(FIELD_KEYS.map((key) => [key, z.string().optional()])) as Record<
    keyof ProductInfo,
    z.ZodOptional<z.ZodString>
  >,
);
const BodySchema = z.object({ fileUrl: z.string().url() }).and(ProductInfoSchema).refine(
  (value) => Boolean(value.companyName?.trim() && value.serviceName?.trim()),
  { message: "기업명과 서비스/제품명은 필수입니다." },
);

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const { fileUrl, ...productInfo } = body.data;
  await saveProductInfo({ fileUrl, productInfo });
  return NextResponse.json({ ok: true, saved: productInfo });
}
