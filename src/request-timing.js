const requestStartedAtByRequest = new WeakMap();

export function captureRequestStartedAt(request) {
  const existing = requestStartedAtByRequest.get(request);
  if (Number.isFinite(existing)) return existing;

  const startedAt = Date.now();
  requestStartedAtByRequest.set(request, startedAt);
  return startedAt;
}
