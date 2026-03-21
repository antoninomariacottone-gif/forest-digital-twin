export function deepClone<T>(value: T): T {
  // structuredClone is widely supported in modern browsers, but keep a safe fallback.
  const sc = (globalThis as any).structuredClone as undefined | ((v: any) => any)
  if (typeof sc === 'function') return sc(value)
  return JSON.parse(JSON.stringify(value)) as T
}

