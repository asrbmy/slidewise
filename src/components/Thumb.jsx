import React, { useEffect, useRef } from 'react';
import { drawSlide } from '../render/canvasRender.js';

// Small slide thumbnail drawn on a canvas. Re-draws only when the slide/theme/size objects change.
export default function Thumb({ deck, slide, width = 160, className = '' }) {
  const ref = useRef(null);
  const h = Math.round(width * deck.size.h / deck.size.w);
  useEffect(() => {
    let dead = false, raf = 0;
    const paint = () => {
      const c = ref.current; if (!c || dead) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(width * dpr); c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d'); const k = c.width / deck.size.w;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawSlide(ctx, deck, slide, { onImage: () => { if (!dead) raf = requestAnimationFrame(paint); } });
    };
    raf = requestAnimationFrame(paint);
    return () => { dead = true; cancelAnimationFrame(raf); };
  }, [deck.theme, deck.size, deck.assets, slide, width, h]);
  return <canvas ref={ref} className={'thumb ' + className} style={{ width, height: h }} aria-hidden="true" />;
}
