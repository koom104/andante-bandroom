const mutationPaths = new Set([
  "/api/admin/reset-password",
  "/api/auth/complete-password-reset",
  "/api/push/booking-event",
  "/api/push/subscribe",
  "/api/push/test",
]);

export function rejectUnsupportedRequest(request: Request): Response | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // No PHP interpreter, development server, or private project files are served.
  if (/\.(?:php\d*|phtml|phar)(?:\/|$)/i.test(path) ||
      /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.svn|\.vite|node_modules)(?:\/|$)/i.test(path) ||
      /^\/(?:@vite|@id|@fs|__open-in-editor)(?:\/|$)/i.test(path)) {
    return new Response("Not Found", { status: 404 });
  }

  if (request.method === "GET" || request.method === "HEAD") return null;

  // This application uses explicit JSON APIs, not React Server Actions or forms.
  if (request.method !== "POST" || !mutationPaths.has(path) ||
      request.headers.has("next-action") || request.headers.has("x-rsc-action")) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: mutationPaths.has(path) ? "POST" : "GET, HEAD" },
    });
  }
  return null;
}
