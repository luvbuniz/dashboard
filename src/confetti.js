// ── Tiny dependency-free confetti burst 🎉 ─────────────────────────────────
const COLORS = ["#ffd60a", "#30d158", "#ff453a", "#64d2ff", "#a78bfa", "#ffffff"];

export function confettiBurst(durationMs = 2600) {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = "block";

  const pieces = Array.from({ length: 160 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    vy: 2 + Math.random() * 3.5,
    vx: -1.5 + Math.random() * 3,
    rot: Math.random() * Math.PI,
    vr: -0.1 + Math.random() * 0.2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));

  const start = performance.now();
  function frame(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - elapsed / durationMs);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = "none";
    }
  }
  requestAnimationFrame(frame);
}
