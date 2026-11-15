import { FONT, prepare, type Theme } from './canvas';

export interface RoadViewState {
  /** m along the road */
  position: number;
  /** radians, positive = uphill ahead */
  slope: number;
  wheelRadius: number;
  brakeLights: boolean;
  handbrake: boolean;
}

/** Side view: the car stays centred, the road and its distance posts scroll past. */
export function drawRoad(canvas: HTMLCanvasElement, theme: Theme, s: RoadViewState): void {
  const { ctx, w, h } = prepare(canvas);
  const scale = Math.min(46, w / 11); // px per metre
  const groundY = h * 0.72;

  ctx.save();
  ctx.translate(w / 2, groundY);
  // Canvas y is down, so uphill-ahead is a negative rotation.
  ctx.rotate(-s.slope);

  const span = w / scale + 4; // metres visible, with margin for rotation

  // Road surface.
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo((-span / 2) * scale, 0);
  ctx.lineTo((span / 2) * scale, 0);
  ctx.stroke();

  // Distance posts every metre, labelled every 5 m; the start line at 0.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `11px ${FONT}`;
  const first = Math.floor(s.position - span / 2);
  const last = Math.ceil(s.position + span / 2);
  for (let m = first; m <= last; m++) {
    const x = (m - s.position) * scale;
    const isStart = m === 0;
    const five = m % 5 === 0;
    ctx.strokeStyle = isStart ? theme.series[0] : five ? theme.muted : theme.grid;
    ctx.lineWidth = isStart ? 3 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, isStart ? -h : five ? 9 : 5);
    ctx.stroke();
    if (five || isStart) {
      ctx.fillStyle = isStart ? theme.text : theme.muted;
      ctx.fillText(isStart ? 'start' : `${m} m`, x, 12);
    }
  }

  // Car (4.1 m long, facing right), drawn in metres.
  const R = s.wheelRadius;
  const m = (v: number) => v * scale;
  const rear = -2.05;
  ctx.fillStyle = theme.car;
  ctx.strokeStyle = theme.text2;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const body: [number, number][] = [
    [rear, 0.28],
    [rear, 0.78],
    [rear + 0.25, 0.95],
    [rear + 0.9, 1.0],
    [rear + 1.3, 1.42],
    [rear + 2.6, 1.42],
    [rear + 3.25, 0.98],
    [rear + 3.95, 0.86],
    [rear + 4.1, 0.6],
    [rear + 4.1, 0.28],
  ];
  body.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(m(x), -m(y)) : ctx.lineTo(m(x), -m(y))));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Windows.
  ctx.fillStyle = theme.page;
  ctx.beginPath();
  [
    [rear + 1.05, 1.0],
    [rear + 1.38, 1.34],
    [rear + 2.55, 1.34],
    [rear + 3.08, 1.0],
  ].forEach(([x, y], i) => (i === 0 ? ctx.moveTo(m(x!), -m(y!)) : ctx.lineTo(m(x!), -m(y!))));
  ctx.closePath();
  ctx.fill();

  // Brake light.
  if (s.brakeLights) {
    ctx.fillStyle = theme.critical;
    ctx.fillRect(m(rear) - 1, -m(0.86), 5, m(0.16));
  }

  // Wheels, with a spoke so rotation (and rollback) is visible.
  const spin = s.position / R;
  for (const wx of [rear + 0.78, rear + 3.3]) {
    ctx.fillStyle = theme.tyre;
    ctx.beginPath();
    ctx.arc(m(wx), -m(R), m(R), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.muted;
    ctx.beginPath();
    ctx.arc(m(wx), -m(R), m(R * 0.55), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.tyre;
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const a = spin + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(m(wx), -m(R));
      ctx.lineTo(m(wx) + Math.cos(a) * m(R * 0.55), -m(R) + Math.sin(a) * m(R * 0.55));
      ctx.stroke();
    }
  }
  ctx.restore();

  // Fixed captions.
  ctx.fillStyle = theme.text2;
  ctx.font = `12px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const grade = Math.tan(s.slope) * 100;
  const gradeText =
    Math.abs(grade) < 0.05 ? 'Flat road' : `${Math.abs(grade).toFixed(1)}% ${grade > 0 ? 'uphill' : 'downhill'}`;
  ctx.fillText(gradeText, 4, 2);
  ctx.textAlign = 'right';
  ctx.fillText(`${s.position.toFixed(2)} m from start`, w - 4, 2);
  if (s.handbrake) {
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.muted;
    ctx.fillText('Handbrake on', 4, 20);
  }
}
