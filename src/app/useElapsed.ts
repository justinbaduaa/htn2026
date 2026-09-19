import { useEffect, useState } from 'react';

/** Seconds since `since` (ISO string or ms), ticking once a second while active. Returns 0 when inactive. */
export function useElapsed(active: boolean, since?: string | number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, since]);
  if (!active) return 0;
  const start = since == null ? now : typeof since === 'string' ? Date.parse(since) : since;
  return Math.max(0, Math.round((now - start) / 1000));
}
