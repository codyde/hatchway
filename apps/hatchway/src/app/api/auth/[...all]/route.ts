import { getAuth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Handler is created lazily on first request
let _handler: ReturnType<typeof toNextJsHandler> | null = null;

function getHandler() {
  if (!_handler) {
    _handler = toNextJsHandler(getAuth());
  }
  return _handler;
}

export async function GET(request: Request) {
  try {
    return await getHandler().GET(request);
  } catch (error) {
    console.error("[Auth GET] Full error:", error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    return await getHandler().POST(request);
  } catch (error) {
    console.error("[Auth POST] Full error:", error);
    throw error;
  }
}
