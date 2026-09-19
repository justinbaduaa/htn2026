import { api } from '../shared/api';
import type { Project, Run } from '../shared/types';
import { Viewer } from './Viewer';
import { useElapsed } from './useElapsed';

export function RunPanel({ project, run, onAcceptNeeds }: { project: Project; run: Run; onAcceptNeeds: () => void }) {
  const url = (f: string) => api.fileUrl(project.id, 'runs', String(run.n), f);
  const elapsed = useElapsed(run.status === 'running', run.started);
  return (
    <section className="flex flex-col gap-3 border-t border-neutral-800 pt-3">
      <div className="flex items-baseline gap-3"><span>Run {run.n + 1}</span><span className="text-neutral-400">{run.status === 'running' ? `running, ${elapsed} s. Usually 30 to 90 s, up to 8 min.` : run.status}</span></div>
      {run.status === 'needs_dimensions' && run.needs && (
        <div>
          <p>The model needs {run.needs.length} more measurement{run.needs.length > 1 ? 's' : ''}:</p>
          <ul className="list-disc pl-5">{run.needs.map(d => <li key={d.id}>{d.name}. {d.why}</li>)}</ul>
          <button onClick={onAcceptNeeds} className="mt-2 bg-white px-3 py-1 text-black">Add them to the form</button>
        </div>
      )}
      {run.status === 'failed' && (
        <div className="text-red-400">
          <p>{run.error}</p>
          {run.check?.parts.flatMap(p => p.reasons).map((r, i) => <p key={i}>{r}</p>)}
        </div>
      )}
      {run.status === 'done' && (
        <>
          <Viewer urls={run.files.map(f => url(f.stl))} />
          <table className="w-full">
            <thead><tr className="text-left text-neutral-400"><th>Part</th><th>Print</th><th>Files</th></tr></thead>
            <tbody>
              {run.files.map(f => (
                <tr key={f.part} className="border-t border-neutral-800">
                  <td className="py-1">{f.part}</td>
                  <td>{f.minutes != null ? `${Math.round(f.minutes)} min, Ender 3 V2, 0.2 mm PLA` : 'slicer unavailable'}</td>
                  <td className="flex gap-3">
                    <a className="underline" href={url(f.step)} download>STEP</a>
                    <a className="underline" href={url(f.stl)} download>STL</a>
                    {f.gcode && <a className="underline" href={url(f.gcode)} download>G-code</a>}
                  </td>
                </tr>
              ))}
              {project.plan?.parts.filter(p => !p.printed).map(p => (
                <tr key={p.name} className="border-t border-neutral-800 text-neutral-400"><td className="py-1">{p.name}</td><td colSpan={2}>not printed. {p.purpose}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-neutral-400">Print order: as listed. Each part is oriented with its flat face on the bed. Copy the G-code to the SD card.</p>
        </>
      )}
    </section>
  );
}
