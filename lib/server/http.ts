import "server-only";

import { NextResponse } from "next/server";

export function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
