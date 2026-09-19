import type { RequestedDimension } from '../shared/types';

type Props = { src: string; dimensions: RequestedDimension[]; active: string | null; onPick: (id: string) => void };

/** Photo with one SVG box per dimension. Boxes are normalized 0..1 so the SVG viewBox is 0 0 1 1 stretched over the image. */
export function PhotoCallouts({ src, dimensions, active, onPick }: Props) {
  return (
    <div className="relative">
      <img src={src} className="block w-full" alt="" />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {dimensions.map(d => (
          <rect key={d.id} onClick={() => onPick(d.id)} className="cursor-pointer"
            x={d.box.x} y={d.box.y} width={d.box.w} height={d.box.h}
            fill={active === d.id ? 'rgba(255,255,255,0.15)' : 'transparent'}
            stroke={d.critical ? '#fff' : '#888'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {dimensions.map(d => (
        <span key={d.id} onClick={() => onPick(d.id)} className="absolute cursor-pointer bg-black/70 px-1 text-xs"
          style={{ left: `${d.box.x * 100}%`, top: `${Math.min(d.box.y + d.box.h, 0.96) * 100}%` }}>{d.name}</span>
      ))}
    </div>
  );
}
