import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/server/notebook-repository";
import { apiError } from "@/lib/server/http";

export async function GET() {
  try {
    const workspace = await getWorkspace(createSupabaseAdminClient());
    return NextResponse.json(workspace);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load workspace.", 503);
  }
}
