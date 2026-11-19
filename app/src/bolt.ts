const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let layer: CanvasRenderingContext2D | null = null;
let wizard: HTMLElement | null = null;

export function mountBolts(origin: HTMLElement): void {
  wizard = origin;
  const canvas = document.createElement("canvas");
  canvas.id = "bolt-layer";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  layer = ctx;
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  window.addEventListener("resize", fit);

  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".bolt-source")) return;
      const from = tip(origin);
      if (REDUCE) {
        const button = target.closest(".bolt-source");
        button?.classList.add("soft-flash");
        window.setTimeout(() => button?.classList.remove("soft-flash"), 220);
        return;
      }
      strike(ctx, from.x, from.y, event.clientX, event.clientY);
    },
    true,
  );
}

export function setWizardCharging(on: boolean): void {
  document.querySelector(".wizard")?.classList.toggle("charging", on);
}

export function finishCharge(): void {
  setWizardCharging(false);
  if (!wizard || !layer || REDUCE) return;
  const balance = document.querySelector("#balance")?.getBoundingClientRect();
  if (!balance) return;
  const from = tip(wizard);
  strike(layer, from.x, from.y, balance.left + balance.width / 2, balance.top + 24);
}

function tip(origin: HTMLElement): { x: number; y: number } {
  const mark = origin.querySelector(".wizard-tip");
  const rect = (mark ?? origin).getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function strike(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const bolts = [path(x0, y0, x1, y1, 26), path(x0, y0, x1, y1, 14)];
  const started = performance.now();
  const duration = 420;
  const frame = (now: number) => {
    const t = Math.min(1, (now - started) / duration);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.shadowColor = "#3DFFA8";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "#d9ffe9";
    ctx.lineWidth = 2.4;
    for (const bolt of bolts) {
      ctx.beginPath();
      bolt.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    const spark = 10 * (1 - t);
    ctx.beginPath();
    ctx.arc(x1, y1, spark, 0, Math.PI * 2);
    ctx.fill();
    if (t < 1) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };
  requestAnimationFrame(frame);
}

function path(x0: number, y0: number, x1: number, y1: number, jitter: number): Array<[number, number]> {
  const points: Array<[number, number]> = [[x0, y0]];
  const steps = 7;
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    points.push([
      x0 + (x1 - x0) * t + (Math.random() - 0.5) * jitter,
      y0 + (y1 - y0) * t + (Math.random() - 0.5) * jitter * 0.8,
    ]);
  }
  points.push([x1, y1]);
  return points;
}
