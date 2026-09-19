export function Generating({ title, elapsed, detail }: { title: string; elapsed: number; detail: string }) {
  return <div className="generating" role="status"><div className="generation-orbit" aria-hidden="true"><i /><i /><i /></div><div><strong>{title}<span className="loading-dots">…</span></strong><p>{detail}</p><small>{elapsed}s elapsed</small></div></div>;
}
