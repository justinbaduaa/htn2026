import { useLayoutEffect, useRef, useState } from 'react';
import type { RequestedDimension } from '../shared/types';

type Props = { src: string; dimension: RequestedDimension | null; onClick?: () => void };

/**
 * Photo with one callout, the focused dimension, drawn in pixel space so line ticks and circles keep their shape.
 * Drawing all callouts at once was unreadable: extents cover the whole object and labels stack.
 */
export function PhotoCallouts({ src, dimension, onClick }: Props) {
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

  const d = dimension;
  const b = d ? { x: d.box.x * size.w, y: d.box.y * size.h, w: d.box.w * size.w, h: d.box.h * size.h } : null;
  const stroke = '#fff', tick = 6;
  const labelAt = b ? { x: Math.max(4, Math.min(b.x, size.w - 240)), y: Math.max(4, b.y - 22) } : null;

  return (
    <div className="relative" onClick={onClick}>
      <img ref={ref} src={src} className="block w-full" alt="" />
      {b && d && d.shape !== 'none' && size.w > 0 && (
        <svg width={size.w} height={size.h} className="pointer-events-none absolute inset-0">
          {d.shape === 'box' && <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="rgba(255,255,255,0.12)" stroke={stroke} strokeWidth={2} />}
          {d.shape === 'circle' && <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={Math.max(b.w / 2, 6)} ry={Math.max(b.h / 2, 6)} fill="none" stroke={stroke} strokeWidth={2} />}
          {d.shape === 'line' && (() => {
            const x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
            const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / len * tick, ny = (x2 - x1) / len * tick;
            return (
              <g stroke={stroke} strokeWidth={2}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} />
                <line x1={x1 - nx} y1={y1 - ny} x2={x1 + nx} y2={y1 + ny} />
                <line x1={x2 - nx} y1={y2 - ny} x2={x2 + nx} y2={y2 + ny} />
              </g>
            );
          })()}
          {labelAt && <foreignObject x={labelAt.x} y={labelAt.y} width={240} height={20}>
            <span className="inline-block max-w-[240px] truncate bg-black/80 px-1 text-xs text-white">{d.name}</span>
          </foreignObject>}
        </svg>
      )}
      {d?.shape === 'none' && <p className="absolute bottom-2 left-2 bg-black/80 px-2 py-1 text-xs">{d.name}: not visible in this photo. {d.why}</p>}
      {!d && <p className="absolute bottom-2 left-2 bg-black/80 px-2 py-1 text-xs text-neutral-400">Click a measurement to see where to put the calipers.</p>}
    </div>
  );
}
