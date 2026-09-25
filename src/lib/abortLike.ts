/** True for fetch aborts / network drops caused by backgrounding the app. */
export function isAbortLike(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string; context?: unknown };
  const text = `${e.name ?? ''} ${e.message ?? ''} ${String((e.context as { message?: string })?.message ?? '')}`;
  return /AbortError|aborted|FunctionsFetchError|Failed to send a request|Load failed|NetworkError|Failed to fetch/i.test(text);
}

/** Resolve or reject within ms; never hang forever. */
export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { const e = new Error('The operation was aborted (timeout)'); e.name = 'AbortError'; reject(e); }, ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
