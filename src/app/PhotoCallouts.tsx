import { useLayoutEffect, useRef, useState } from 'react';
import type { RequestedDimension } from '../shared/types';

type Props = {
  src: string;
  dimensions: RequestedDimension[];   // the ones on this photo
  active: string | null;              // focused field: drawn fully with its label
  hovered: string | null;             // hovered field or callout: drawn fully with its label
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
};

/**
 * Photo with every callout drawn faintly, and the focused or hovered one drawn fully with its label.
 * Pixel-space SVG so line ticks and circles keep their shape.
 */
export function PhotoCallouts({ src, dimensions, active, hovered, onHover, onPick }: Props) {
  const ref = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const img = ref.current!;
    const update = () => setSize({ w: img.clientWidth, h: img.clientHeight });
    update();
    const ro = new ResizeObserver(update); ro.observe(img);
    img.addEventListener('load', update);
    return () => { ro.disconnect(); img.removeEventListener('load', update); };
  }, [src]);

  const lit = hovered ?? active;
  const drawable = dimensions.filter(d => d.shape !== 'none');
  const litDim = dimensions.find(d => d.id === lit) ?? null;
  const px = (d: RequestedDimension) => ({ x: d.box.x * size.w, y: d.box.y * size.h, w: d.box.w * size.w, h: d.box.h * size.h });

  const shape = (d: RequestedDimension, full: boolean) => {
    const b = px(d), tick = 6;
    const common = { stroke: '#fff', strokeWidth: full ? 2 : 1, opacity: full ? 1 : 0.28, fill: 'none', className: 'cursor-pointer',
      onMouseEnter: () => onHover(d.id), onMouseLeave: () => onHover(null), onClick: () => onPick(d.id), style: { pointerEvents: 'stroke' as const } };
    if (d.shape === 'circle') return <ellipse key={d.id} cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={Math.max(b.w / 2, 6)} ry={Math.max(b.h / 2, 6)} {...common} />;
    if (d.shape === 'line') {
      const x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / len * tick, ny = (x2 - x1) / len * tick;
      return (
        <g key={d.id} {...common}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} />
          <line x1={x1 - nx} y1={y1 - ny} x2={x1 + nx} y2={y1 + ny} />
          <line x1={x2 - nx} y1={y2 - ny} x2={x2 + nx} y2={y2 + ny} />
        </g>
      );
    }
    return <rect key={d.id} x={b.x} y={b.y} width={b.w} height={b.h} {...common} fill={full ? 'rgba(255,255,255,0.12)' : 'none'} style={{ pointerEvents: 'all' }} />;
  };

  const label = litDim && litDim.shape !== 'none' ? (() => {
    const b = px(litDim);
    return { x: Math.max(4, Math.min(b.x, size.w - 260)), y: Math.max(4, b.y - 22) };
  })() : null;

  return (
    <div className="relative">
      <img ref={ref} src={src} className="block w-full" alt="" />
      {size.w > 0 && (
        <svg width={size.w} height={size.h} className="absolute inset-0" style={{ pointerEvents: 'none' }}>
          {drawable.filter(d => d.id !== lit).map(d => shape(d, false))}
          {litDim && litDim.shape !== 'none' && shape(litDim, true)}
          {label && litDim && (
            <foreignObject x={label.x} y={label.y} width={260} height={20} style={{ pointerEvents: 'none' }}>
              <span className="inline-block max-w-[260px] truncate bg-black/80 px-1 text-xs text-white">{litDim.name}</span>
            </foreignObject>
          )}
        </svg>
      )}
      {litDim?.shape === 'none' && <p className="absolute bottom-2 left-2 bg-black/80 px-2 py-1 text-xs">{litDim.name}: not visible in this photo. {litDim.why}</p>}
    </div>
  );
}
