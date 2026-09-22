type JsonBodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413 };

export async function readBoundedJson(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    // Count actual bytes: callers can omit or falsify Content-Length.
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, status: 400 };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}
