import type { HistorySample, HistorySeries } from '../worker/protocol';

export interface SeriesSpec {
  key: HistorySeries;
  label: string;
  color: string;
}

export interface ChartSpec {
  title: string;
  unit: string;
  series: SeriesSpec[];
  /** Fixed range, or undefined to autoscale. */
  min?: number;
  max?: number;
  digits?: number;
}

const WINDOW = 3 * 86400; // seconds of sim time shown

/** Minimal line chart on a 2D canvas: last three simulated days, midnight gridlines. */
export class Chart {
  private ctx: CanvasRenderingContext2D;
  constructor(
    private canvas: HTMLCanvasElement,
    private spec: ChartSpec,
    private startHour: number,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(history: HistorySample[]): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(this.canvas);
    const muted = css.getPropertyValue('--muted').trim() || '#8a93a0';
    const grid = css.getPropertyValue('--grid').trim() || 'rgba(255,255,255,0.08)';
    const fg = css.getPropertyValue('--fg').trim() || '#e8ecf1';

    const padL = 34;
    const padR = 6;
    const padT = 18;
    const padB = 14;
    const pw = w - padL - padR;
    const ph = h - padT - padB;
    if (history.length === 0 || pw <= 0 || ph <= 0) return;
    const tEnd = history[history.length - 1].t;
    const tStart = Math.max(tEnd - WINDOW, history[0].t);
    const span = Math.max(tEnd - tStart, 3600);
    const visible = history.filter((s) => s.t >= tStart);

    let lo = this.spec.min ?? Infinity;
    let hi = this.spec.max ?? -Infinity;
    if (this.spec.min === undefined || this.spec.max === undefined) {
      for (const s of visible)
        for (const ser of this.spec.series) {
          const v = s.values[ser.key];
          if (this.spec.min === undefined) lo = Math.min(lo, v);
          if (this.spec.max === undefined) hi = Math.max(hi, v);
        }
      const span = Math.max(hi - lo, 1e-6);
      if (this.spec.min === undefined) lo -= span * 0.08;
      if (this.spec.max === undefined) hi += span * 0.08;
    }
    const X = (t: number) => padL + ((t - tStart) / span) * pw;
    const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * ph;

    g.font = '11px system-ui, sans-serif';
    g.fillStyle = fg;
    g.fillText(`${this.spec.title}`, padL, 12);
    let lx = padL + g.measureText(this.spec.title).width + 10;
    for (const ser of this.spec.series) {
      const last = visible.length ? visible[visible.length - 1].values[ser.key] : NaN;
      const txt = `${ser.label} ${last.toFixed(this.spec.digits ?? 1)}${this.spec.unit}`;
      g.fillStyle = ser.color;
      g.fillRect(lx, 6, 8, 3);
      g.fillStyle = muted;
      g.fillText(txt, lx + 11, 12);
      lx += g.measureText(txt).width + 22;
    }

    // Grid: horizontal ticks + midnight markers.
    g.strokeStyle = grid;
    g.lineWidth = 1;
    g.fillStyle = muted;
    g.font = '10px system-ui, sans-serif';
    for (let i = 0; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 3;
      const y = Y(v);
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(w - padR, y);
      g.stroke();
      g.fillText(v.toFixed(Math.abs(hi - lo) < 5 ? 1 : 0), 2, y + 3);
    }
    const offset = this.startHour * 3600;
    const firstMidnight = Math.ceil((tStart + offset) / 86400) * 86400 - offset;
    for (let t = firstMidnight; t <= tEnd; t += 86400) {
      const x = X(t);
      g.beginPath();
      g.moveTo(x, padT);
      g.lineTo(x, padT + ph);
      g.stroke();
      g.fillText(`${Math.round((t + offset) / 86400) + 1}일`, x + 3, h - 2);
    }

    for (const ser of this.spec.series) {
      g.strokeStyle = ser.color;
      g.lineWidth = 1.6;
      g.beginPath();
      visible.forEach((s, i) => {
        const x = X(s.t);
        const y = Y(Math.min(hi, Math.max(lo, s.values[ser.key])));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    }
  }
}
