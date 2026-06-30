import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { storageBucket } from "@/lib/server/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { fileName?: string; contentType?: string };
    if (!body.fileName || !body.fileName.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "PDF fileName is required" }, { status: 400 });
    }
    const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const sourcePath = `uploads/${crypto.randomUUID()}-${safeName}`;
    const { data, error } = await getSupabaseAdmin().storage.from(storageBucket()).createSignedUploadUrl(sourcePath);
    if (error) throw error;
    return NextResponse.json(
      {
        sourcePath,
        signedUrl: data.signedUrl,
        token: data.token
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
