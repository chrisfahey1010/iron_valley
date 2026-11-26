// Iron Valley Level Editor — 2D top-down editor for public/level.json.
// Imports only world/asset metadata from src/ (scale.js, world.js constants,
// level.js helpers). No gameplay code.
import { ASSETS } from './scale.js';
import { WORLD_SIZE, HALF, PLAY_BOUND, riverCenterX, BRIDGE, RIVER_HALF_WIDTH } from './world.js';
import { loadLevel, validateLevel, defaultLevel, REGION_TYPES, ROAD_TYPES, REGION_COLORS, MENU_PITCH_MIN, MENU_PITCH_MAX } from './level.js';
import { generateForestTrees, regionArea, DEFAULT_FOREST_DENSITY } from './forest.js';

// ---------- DOM ----------
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const paletteEl = document.getElementById('palette');
const propertiesEl = document.getElementById('properties');
const statusEl = document.getElementById('status');
const statusHint = document.getElementById('status-hint');

// ---------- state ----------
let level = defaultLevel();
let camera = { x: 0, z: -350, scale: 0.9 }; // scale = px per meter
let tool = 'select';            // select | object | region | road | spawn-player | spawn-enemy
let selected = null;            // { kind, id?, index? }
let pendingPoints = [];         // in-progress region/road
let hoverVertex = null;        // { id, index } of selected-region vertex under cursor
let drag = null;                // { type:'pan'|'object'|'spawn'|'vertex', ... }
let history = [];
const MAX_HISTORY = 20;
let nextIdCounter = 1;

function uniqueObjectId(wanted, self) {
  const taken = new Set();
  for (const o of level.objects) if (o !== self) taken.add(o.id);
  let id = (wanted || 'object').trim() || 'object';
  if (!taken.has(id)) return id;
  let n = 2;
  while (taken.has(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}
function nextFreeObjectId(type) {
  const taken = new Set(level.objects.map(o => o.id));
  let n = nextIdCounter;
  while (taken.has(`${type}-${n}`)) n++;
  nextIdCounter = n + 1;
  return `${type}-${n}`;
}

const REGION_COLORS_CSS = { grasslands: '#49683a', pasture: '#8a8452', crops: '#6b7a3a', clearing: '#9a8460', forest: '#49683a' };
const ROAD_COLORS_CSS = { gravel: '#8b8578', dirt: '#7a6a4f' };
const ROAD_WIDTH_DEFAULT = { gravel: 4, dirt: 3 };

// ---------- view transform ----------
function worldToScreen(x, z) {
  return { x: (x - camera.x) * camera.scale + canvas.width / 2, y: (z - camera.z) * camera.scale + canvas.height / 2 };
}
function screenToWorld(sx, sy) {
  return { x: (sx - canvas.width / 2) / camera.scale + camera.x, z: (sy - canvas.height / 2) / camera.scale + camera.z };
}

// ---------- history ----------
function pushHistory() {
  history.push(JSON.stringify(level));
  if (history.length > MAX_HISTORY) history.shift();
}
function undo() {
  const prev = history.pop();
  if (prev == null) return;
  level = JSON.parse(prev);
  selected = null;
  pendingPoints = [];
  rebuildPaletteSelection();
  draw();
  renderProperties();
}

// ---------- helpers ----------
function regionAt(x, z) {
  for (const r of level.terrain.regions) if (pointInPolygon(x, z, r.points)) return r;
  return null;
}
function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1];
    const xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
function roadAt(x, z) {
  for (const r of level.terrain.roads) {
    const half = r.widthM / 2 + 2;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (distToSegment(x, z, r.points[i][0], r.points[i][1], r.points[i + 1][0], r.points[i + 1][1]) < half) return r;
    }
  }
  return null;
}
function objectAt(x, z) {
  // nearest first
  let best = null, bestD = Infinity;
  for (let i = 0; i < level.objects.length; i++) {
    const o = level.objects[i];
    const meta = ASSETS[o.type];
    const r = (meta?.editor?.footprintR ?? 1) * (o.scale ?? 1);
    const d = Math.hypot(x - o.x, z - o.z);
    if (d < r && d < bestD) { best = i; bestD = d; }
  }
  return best;
}
function spawnAt(x, z) {
  const p = level.spawns.player;
  if (p && Math.hypot(x - p.x, z - p.z) < 8) return { kind: 'spawn-player' };
  for (let i = 0; i < level.spawns.enemies.length; i++) {
    const e = level.spawns.enemies[i];
    if (Math.hypot(x - e.x, z - e.z) < 8) return { kind: 'spawn-enemy', index: i };
  }
  return null;
}
function vertexAt(sx, sy) {
  // check vertices of the selected region/road first (or all, if select tool)
  const tol = 10; // px
  for (const r of level.terrain.regions) {
    for (let i = 0; i < r.points.length; i++) {
      const sp = worldToScreen(r.points[i][0], r.points[i][1]);
      if (Math.hypot(sp.x - sx, sp.y - sy) < tol) return { kind: 'region-vertex', id: r.id, index: i };
    }
  }
  for (const r of level.terrain.roads) {
    for (let i = 0; i < r.points.length; i++) {
      const sp = worldToScreen(r.points[i][0], r.points[i][1]);
      if (Math.hypot(sp.x - sx, sp.y - sy) < tol) return { kind: 'road-vertex', id: r.id, index: i };
    }
  }
  return null;
}

// ---------- palette ----------
function rebuildPaletteSelection() {
  // refresh palette active class
  document.querySelectorAll('.tool-btn').forEach(b => {
    let active = false;
    if (b.dataset.tool === 'object') active = tool === 'object' && b.dataset.asset === objectToolAsset;
    else if (b.dataset.tool === 'region') active = tool === 'region' && b.dataset.region === regionToolType;
    else if (b.dataset.tool === 'road') active = tool === 'road' && b.dataset.road === roadToolType;
    else active = tool === b.dataset.tool;
    b.classList.toggle('active', active);
  });
}

let objectToolAsset = null;
let regionToolType = null;
let roadToolType = null;

function buildPalette() {
  paletteEl.innerHTML = '';
  const mk = (title, body, cls) => {
    const h = document.createElement('div');
    h.innerHTML = `<h3>${title}</h3>`;
    paletteEl.appendChild(h);
    if (body) paletteEl.appendChild(body);
  };

  // select
  {
    const b = document.createElement('button');
    b.className = 'tool-btn'; b.dataset.tool = 'select';
    b.textContent = 'Select / Move';
    b.addEventListener('click', () => setTool('select'));
    paletteEl.appendChild(b);
  }
  // spawns
  {
    const h = document.createElement('div'); h.innerHTML = '<h3>Spawns</h3>'; paletteEl.appendChild(h);
    const bp = document.createElement('button');
    bp.className = 'tool-btn'; bp.dataset.tool = 'spawn-player';
    bp.textContent = 'Place Player Spawn';
    bp.addEventListener('click', () => setTool('spawn-player'));
    const be = document.createElement('button');
    be.className = 'tool-btn'; be.dataset.tool = 'spawn-enemy';
    be.textContent = 'Place Enemy Spawn';
    be.addEventListener('click', () => setTool('spawn-enemy'));
    paletteEl.appendChild(bp); paletteEl.appendChild(be);
  }
  // terrain regions
  {
    const h = document.createElement('div'); h.innerHTML = '<h3>Terrain regions</h3>'; paletteEl.appendChild(h);
    for (const t of ['pasture', 'crops', 'clearing', 'forest']) {
      const b = document.createElement('button');
      b.className = 'tool-btn'; b.dataset.tool = 'region'; b.dataset.region = t;
      b.textContent = `Region: ${t}`;
      b.addEventListener('click', () => setTool('region', t));
      paletteEl.appendChild(b);
    }
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'Click to place first point, click to add, Enter/right-click to close polygon.';
    paletteEl.appendChild(note);
  }
  // roads
  {
    const h = document.createElement('div'); h.innerHTML = '<h3>Roads</h3>'; paletteEl.appendChild(h);
    for (const t of ROAD_TYPES) {
      const b = document.createElement('button');
      b.className = 'tool-btn'; b.dataset.tool = 'road'; b.dataset.road = t;
      b.textContent = `Road: ${t}`;
      b.addEventListener('click', () => setTool('road', t));
      paletteEl.appendChild(b);
    }
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'Click to add points; Enter finishes the road. Esc cancels.';
    paletteEl.appendChild(note);
  }
  // objects
  {
    const h = document.createElement('div'); h.innerHTML = '<h3>Objects</h3>'; paletteEl.appendChild(h);
    for (const [key, asset] of Object.entries(ASSETS)) {
      if (asset.editor?.category !== 'object') continue;
      const b = document.createElement('button');
      b.className = 'tool-btn'; b.dataset.tool = 'object'; b.dataset.asset = key;
      b.textContent = key[0].toUpperCase() + key.slice(1);
      b.addEventListener('click', () => setTool('object', key));
      paletteEl.appendChild(b);
    }
  }
}

function setTool(t, arg) {
  tool = t;
  objectToolAsset = t === 'object' ? arg : null;
  regionToolType = t === 'region' ? arg : null;
  roadToolType = t === 'road' ? arg : null;
  pendingPoints = [];
  rebuildPaletteSelection();
  draw();
  renderProperties();
}

// ---------- drawing ----------
function draw() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e1013';
  ctx.fillRect(0, 0, w, h);

  const tl = screenToWorld(0, 0), br = screenToWorld(w, h);
  // grid
  const major = 100, minor = 25;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = Math.floor(tl.x / minor) * minor; x <= br.x; x += minor) {
    const sp = worldToScreen(x, 0);
    if (Math.abs(x % major) !== 0) { ctx.beginPath(); ctx.moveTo(sp.x, 0); ctx.lineTo(sp.x, h); ctx.stroke(); }
  }
  for (let z = Math.floor(tl.z / minor) * minor; z <= br.z; z += minor) {
    const sp = worldToScreen(0, z);
    if (Math.abs(z % major) !== 0) { ctx.beginPath(); ctx.moveTo(0, sp.y); ctx.lineTo(w, sp.y); ctx.stroke(); }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  for (let x = Math.floor(tl.x / major) * major; x <= br.x; x += major) {
    const sp = worldToScreen(x, 0);
    ctx.beginPath(); ctx.moveTo(sp.x, 0); ctx.lineTo(sp.x, h); ctx.stroke();
  }
  for (let z = Math.floor(tl.z / major) * major; z <= br.z; z += major) {
    const sp = worldToScreen(0, z);
    ctx.beginPath(); ctx.moveTo(0, sp.y); ctx.lineTo(w, sp.y); ctx.stroke();
  }
  // origin crosshair
  const o = worldToScreen(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.moveTo(o.x - 12, o.y); ctx.lineTo(o.x + 12, o.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(o.x, o.y - 12); ctx.lineTo(o.x, o.y + 12); ctx.stroke();

  // playable border
  const b = worldToScreen(-PLAY_BOUND, -PLAY_BOUND);
  const b2 = worldToScreen(PLAY_BOUND, PLAY_BOUND);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(b.x, b.y, b2.x - b.x, b2.y - b.y);
  ctx.setLineDash([]);

  // regions
  for (const r of level.terrain.regions) {
    if (r.points.length < 3) continue;
    ctx.beginPath();
    r.points.forEach(([x, z], i) => { const sp = worldToScreen(x, z); i === 0 ? ctx.moveTo(sp.x, sp.y) : ctx.lineTo(sp.x, sp.y); });
    ctx.closePath();
    ctx.fillStyle = REGION_COLORS_CSS[r.type] || '#888';
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // roads
  for (const r of level.terrain.roads) {
    if (r.points.length < 2) continue;
    ctx.beginPath();
    r.points.forEach(([x, z], i) => { const sp = worldToScreen(x, z); i === 0 ? ctx.moveTo(sp.x, sp.y) : ctx.lineTo(sp.x, sp.y); });
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = r.widthM * camera.scale + 3;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = ROAD_COLORS_CSS[r.type] || '#888';
    ctx.lineWidth = r.widthM * camera.scale;
    ctx.stroke();
  }

  // river + bridge overlays
  drawRiver();

  // pending region/road
  if (pendingPoints.length) {
    ctx.beginPath();
    pendingPoints.forEach(([x, z], i) => { const sp = worldToScreen(x, z); i === 0 ? ctx.moveTo(sp.x, sp.y) : ctx.lineTo(sp.x, sp.y); });
    if (tool === 'region' && pendingPoints.length >= 3) ctx.closePath();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (tool === 'region' && pendingPoints.length >= 3) { ctx.fillStyle = 'rgba(255,209,102,0.25)'; ctx.fill(); }
    for (const [x, z] of pendingPoints) {
      const sp = worldToScreen(x, z);
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#ffd166'; ctx.fill();
    }
  }

  // objects
  for (const o of level.objects) {
    const meta = ASSETS[o.type];
    const color = meta?.editor?.color || '#999';
    const r = (meta?.editor?.footprintR ?? 1) * (o.scale ?? 1);
    const sp = worldToScreen(o.x, o.z);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, Math.max(2, r * camera.scale), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // heading tick
    if (o.rotation) {
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sp.x + Math.sin(o.rotation) * Math.max(6, r * camera.scale * 0.9), sp.y + Math.cos(o.rotation) * Math.max(6, r * camera.scale * 0.9));
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (o.type !== 'tree') {
      ctx.fillStyle = '#e8e4da';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(o.id, sp.x, sp.y + Math.max(10, r * camera.scale + 6));
    }
  }

  // spawn markers
  drawSpawns();

  // menu camera marker
  drawMenuCamera();

  // selection highlight
  if (selected && selected.kind === 'object') {
    const o = level.objects[selected.index];
    if (o) {
      const meta = ASSETS[o.type];
      const r = (meta?.editor?.footprintR ?? 1) * (o.scale ?? 1);
      const sp = worldToScreen(o.x, o.z);
      ctx.strokeStyle = '#4dd0e1';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(3, r * camera.scale + 3), 0, Math.PI * 2); ctx.stroke();
    }
  } else if (selected && selected.kind === 'spawn-player') {
    const p = level.spawns.player;
    if (p) { const sp = worldToScreen(p.x, p.z); ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2); ctx.stroke(); }
  } else if (selected && selected.kind === 'spawn-enemy') {
    const e = level.spawns.enemies[selected.index];
    if (e) { const sp = worldToScreen(e.x, e.z); ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2); ctx.stroke(); }
  } else if (selected && selected.kind === 'menuCamera') {
    const mc = level.menuCamera;
    if (mc) { const sp = worldToScreen(mc.x, mc.z); ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sp.x, sp.y, 16, 0, Math.PI * 2); ctx.stroke(); }
  } else if (selected && selected.kind === 'region') {
    const r = level.terrain.regions.find(r => r.id === selected.id);
    if (r && r.points.length >= 3) {
      ctx.beginPath();
      r.points.forEach(([x, z], i) => { const sp = worldToScreen(x, z); i === 0 ? ctx.moveTo(sp.x, sp.y) : ctx.lineTo(sp.x, sp.y); });
      ctx.closePath();
      ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 2; ctx.stroke();
      for (let i = 0; i < r.points.length; i++) {
        const sp = worldToScreen(r.points[i][0], r.points[i][1]);
        const hov = hoverVertex && hoverVertex.id === r.id && hoverVertex.index === i;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, hov ? 6 : 4, 0, Math.PI * 2); ctx.fillStyle = hov ? '#ffffff' : '#4dd0e1'; ctx.fill();
        if (hov) { ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
    }
  } else if (selected && selected.kind === 'road') {
    const r = level.terrain.roads.find(r => r.id === selected.id);
    if (r && r.points.length >= 2) {
      ctx.beginPath();
      r.points.forEach(([x, z], i) => { const sp = worldToScreen(x, z); i === 0 ? ctx.moveTo(sp.x, sp.y) : ctx.lineTo(sp.x, sp.y); });
      ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.stroke(); ctx.setLineDash([]);
      for (let i = 0; i < r.points.length; i++) {
        const sp = worldToScreen(r.points[i][0], r.points[i][1]);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#4dd0e1'; ctx.fill();
      }
    }
  }

  // cursor pos in status
  statusEl.textContent = drag ? statusEl.textContent : '';
}

function drawRiver() {
  // river ribbon
  ctx.fillStyle = '#2e5d74';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  let started = false;
  const step = 12;
  for (let z = -HALF; z <= HALF; z += step) {
    const sp = worldToScreen(riverCenterX(z) - RIVER_HALF_WIDTH, z);
    if (!started) { ctx.moveTo(sp.x, sp.y); started = true; } else ctx.lineTo(sp.x, sp.y);
  }
  for (let z = HALF; z >= -HALF; z -= step) {
    const sp = worldToScreen(riverCenterX(z) + RIVER_HALF_WIDTH, z);
    ctx.lineTo(sp.x, sp.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // bridge
  const bx = worldToScreen(BRIDGE.x, BRIDGE.z);
  const bw = BRIDGE.halfSpan * 2 * camera.scale, bh = BRIDGE.halfWidth * 2 * camera.scale;
  ctx.fillStyle = '#7a6a4f';
  ctx.fillRect(bx.x - bw / 2, bx.y - bh / 2, bw, bh);
  ctx.strokeStyle = '#5d5140';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx.x - bw / 2, bx.y - bh / 2, bw, bh);
}

function drawSpawns() {
  ctx.save();
  const p = level.spawns.player;
  if (p) {
    const sp = worldToScreen(p.x, p.z);
    drawChevron(sp.x, sp.y, p.heading, '#5be386', 14);
    ctx.fillStyle = '#5be386'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('PLAYER', sp.x, sp.y - 20);
  }
  for (const e of level.spawns.enemies) {
    const sp = worldToScreen(e.x, e.z);
    drawChevron(sp.x, sp.y, e.heading, '#e35b5b', 12);
  }
  ctx.restore();
}
function drawChevron(x, y, heading, color, s) {
  ctx.save();
  ctx.translate(x, y);
  const phi = Math.atan2(Math.cos(heading), Math.sin(heading));
  ctx.rotate(phi);
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.8, s * 0.8);
  ctx.lineTo(-s * 0.3, 0);
  ctx.lineTo(-s * 0.8, -s * 0.8);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

function drawMenuCamera() {
  const mc = level.menuCamera;
  if (!mc) return;
  const sp = worldToScreen(mc.x, mc.z);
  ctx.save();
  ctx.translate(sp.x, sp.y);
  ctx.rotate(Math.atan2(Math.cos(mc.yaw), Math.sin(mc.yaw)));
  // frustum wedge indicating facing direction
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(9, -6);
  ctx.lineTo(9, 6);
  ctx.closePath();
  ctx.fillStyle = 'rgba(77, 208, 225, 0.5)';
  ctx.fill();
  // body
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#4dd0e1';
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5; ctx.stroke();
  // lens dot
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#0e1013'; ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#4dd0e1'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('MENU CAM', sp.x, sp.y - 14);
}

function resize() {
  const vp = document.getElementById('viewport');
  canvas.width = vp.clientWidth;
  canvas.height = vp.clientHeight;
  draw();
}
window.addEventListener('resize', resize);

// ---------- degrees helpers ----------
const radToDeg = r => { const d = (r * 180 / Math.PI) % 360; return (d + 360) % 360; };
const degToRad = d => d * Math.PI / 180;
function fmtDeg(r) { return Math.round(radToDeg(r) * 10) / 10; }
function makeDialSvg(deg) {
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const a = i * 30 * Math.PI / 180;
    const big = i % 3 === 0;
    const r1 = big ? 24 : 26, r2 = 29;
    ticks.push(`<line x1="${32 + Math.sin(a) * r1}" y1="${32 + Math.cos(a) * r1}" x2="${32 + Math.sin(a) * r2}" y2="${32 + Math.cos(a) * r2}" stroke="${big ? '#c8c4b8' : '#555b66'}" stroke-width="${big ? 1.6 : 1}"/>`);
  }
  return `<svg class="deg-dial" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#252932" stroke="#343a45"/>${ticks.join('')}<g class="deg-needle" transform="rotate(${deg} 32 32)"><line x1="32" y1="32" x2="32" y2="53" stroke="#4dd0e1" stroke-width="2.5" stroke-linecap="round"/></g><circle cx="32" cy="32" r="3" fill="#e8e4da"/></svg>`;
}
function mkDegreeField(label, getRad, setRad) {
  const wrap = document.createElement('label');
  wrap.className = 'deg-field';
  wrap.textContent = label;
  const row = document.createElement('div');
  row.className = 'deg-row';
  const dial = makeDialSvg(radToDeg(getRad()));
  const dialHost = document.createElement('span');
  dialHost.innerHTML = dial;
  dialHost.firstChild && row.appendChild(dialHost.firstChild);
  const i = document.createElement('input');
  i.type = 'number'; i.step = '1'; i.min = '0'; i.max = '360';
  i.value = String(fmtDeg(getRad()));
  i.addEventListener('change', () => {
    const d = parseFloat(i.value);
    const deg = isNaN(d) ? 0 : ((d % 360) + 360) % 360;
    pushHistory();
    setRad(degToRad(deg));
    i.value = String(Math.round(deg * 10) / 10);
    row.querySelector('.deg-needle').setAttribute('transform', `rotate(${deg} 32 32)`);
    draw();
  });
  row.appendChild(i);
  wrap.appendChild(row);
  propertiesEl.appendChild(wrap);
}

// ---------- properties panel ----------
function renderProperties() {
  propertiesEl.innerHTML = '';
  const h = document.createElement('div');
  h.innerHTML = '<h3>Properties</h3>';
  propertiesEl.appendChild(h);

  if (!selected) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.innerHTML = 'Select an object, spawn, region, road or vertex to edit here.<br><br><b>Tools:</b><br>• Object — click to place<br>• Region — click to paint polygon<br>• Road — click to add points<br>• Spawns — click to place/move<br><br><b>Keys:</b> Delete · R rotate · Ctrl+Z undo · Esc cancel · Arrows nudge';
    propertiesEl.appendChild(note);
    return;
  }

  const mkField = (label, input) => {
    const l = document.createElement('label');
    l.textContent = label;
    l.appendChild(input);
    propertiesEl.appendChild(l);
  };

  if (selected.kind === 'object') {
    const o = level.objects[selected.index];
    if (!o) { selected = null; renderProperties(); return; }
    const meta = ASSETS[o.type];
    const title = document.createElement('h3');
    title.textContent = `Object · ${o.type}`;
    propertiesEl.appendChild(title);
    mkField('ID', input('text', o.id, v => { pushHistory(); o.id = uniqueObjectId(v, o); draw(); }));
    mkField('X', input('number', o.x, v => { pushHistory(); o.x = parseFloat(v) || 0; draw(); }, 0.1));
    mkField('Z', input('number', o.z, v => { pushHistory(); o.z = parseFloat(v) || 0; draw(); }, 0.1));
    mkDegreeField('Rotation (°)', () => o.rotation ?? 0, rad => { o.rotation = rad; });
    mkField('Scale', input('number', o.scale ?? 1, v => { pushHistory(); o.scale = Math.max(0.1, parseFloat(v) || 1); draw(); }, 0.05));
    const del = document.createElement('button');
    del.textContent = 'Delete object';
    del.addEventListener('click', () => { pushHistory(); level.objects.splice(selected.index, 1); selected = null; draw(); renderProperties(); });
    propertiesEl.appendChild(del);
  } else if (selected.kind === 'spawn-player') {
    const p = level.spawns.player;
    const title = document.createElement('h3');
    title.textContent = 'Player spawn';
    propertiesEl.appendChild(title);
    mkField('X', input('number', p.x, v => { pushHistory(); p.x = parseFloat(v) || 0; draw(); }, 0.1));
    mkField('Z', input('number', p.z, v => { pushHistory(); p.z = parseFloat(v) || 0; draw(); }, 0.1));
    mkDegreeField('Heading (°)', () => p.heading ?? 0, rad => { p.heading = rad; });
  } else if (selected.kind === 'menuCamera') {
    const mc = level.menuCamera;
    if (!mc) { selected = null; renderProperties(); return; }
    const title = document.createElement('h3');
    title.textContent = 'Menu camera (preview shot)';
    propertiesEl.appendChild(title);
    mkField('X', input('number', mc.x, v => { pushHistory(); mc.x = parseFloat(v) || 0; draw(); }, 0.1));
    mkField('Z', input('number', mc.z, v => { pushHistory(); mc.z = parseFloat(v) || 0; draw(); }, 0.1));
    mkField('Altitude (m)', input('number', mc.altitude, v => { pushHistory(); mc.altitude = Math.max(1, parseFloat(v) || 1); draw(); }, 1));
    mkDegreeField('Yaw (°)', () => mc.yaw ?? 0, rad => { mc.yaw = rad; });
    mkField('Pitch (°, -80…+80)', input('number', Math.round((mc.pitch ?? 0) * 180 / Math.PI * 10) / 10, v => {
      pushHistory();
      let d = parseFloat(v);
      if (isNaN(d)) d = 0;
      d = Math.max(-80, Math.min(80, d));
      mc.pitch = degToRad(d);
      draw(); renderProperties();
    }, 1));
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'Drives the main-menu preview camera only (not the in-game camera). Positive yaw/pitch = facing right/up; negative pitch looks down.';
    propertiesEl.appendChild(note);
  } else if (selected.kind === 'spawn-enemy') {
    const e = level.spawns.enemies[selected.index];
    if (!e) { selected = null; renderProperties(); return; }
    const title = document.createElement('h3');
    title.textContent = `Enemy spawn #${selected.index + 1}`;
    propertiesEl.appendChild(title);
    mkField('X', input('number', e.x, v => { pushHistory(); e.x = parseFloat(v) || 0; draw(); }, 0.1));
    mkField('Z', input('number', e.z, v => { pushHistory(); e.z = parseFloat(v) || 0; draw(); }, 0.1));
    mkDegreeField('Heading (°)', () => e.heading ?? 0, rad => { e.heading = rad; });
    const del = document.createElement('button');
    del.textContent = 'Delete enemy spawn';
    del.addEventListener('click', () => { pushHistory(); level.spawns.enemies.splice(selected.index, 1); selected = null; draw(); renderProperties(); });
    propertiesEl.appendChild(del);
  } else if (selected.kind === 'region') {
    const r = level.terrain.regions.find(r => r.id === selected.id);
    if (!r) { selected = null; renderProperties(); return; }
    const title = document.createElement('h3');
    title.textContent = 'Region';
    propertiesEl.appendChild(title);
    mkField('ID', input('text', r.id, v => { pushHistory(); r.id = v; draw(); }));
    mkField('Type', select(['pasture', 'crops', 'clearing', 'forest'], r.type, v => {
      pushHistory();
      if (r.type === 'forest' && v !== 'forest') removeGeneratedTrees(r.id);
      r.type = v;
      if (v === 'forest' && !(Number(r.density) > 0)) r.density = DEFAULT_FOREST_DENSITY;
      draw(); renderProperties();
    }));
    if (r.type === 'forest') {
      const area = regionArea(r.points);
      const existing = generatedTreesFor(r.id).length;
      const density = Number(r.density) > 0 ? Number(r.density) : DEFAULT_FOREST_DENSITY;
      const expect = Math.round(density * area / 10000);

      mkField('Density (trees / 100m×100m)', input('number', density, v => { pushHistory(); r.density = Math.max(0.5, parseFloat(v) || DEFAULT_FOREST_DENSITY); draw(); renderProperties(); }, 0.5));

      const info = document.createElement('div');
      info.className = 'empty-note';
      info.innerHTML = `Area: ~${Math.round(area)} m² &nbsp;·&nbsp; Target: ~${expect} trees &nbsp;·&nbsp; Placed: ${existing}`;
      propertiesEl.appendChild(info);

      const gen = document.createElement('button');
      gen.textContent = 'Generate trees';
      gen.addEventListener('click', () => {
        pushHistory();
        removeGeneratedTrees(r.id);
        const res = generateForestTrees(level, r);
        level.objects.push(...res.trees);
        draw(); renderProperties();
        statusHint.textContent = `Generated ${res.placed}/${res.target} trees` + (res.failed ? ` (${res.failed} blocked)` : '');
      });
      propertiesEl.appendChild(gen);

      if (existing > 0) {
        const clr = document.createElement('button');
        clr.textContent = 'Clear generated trees';
        clr.addEventListener('click', () => { pushHistory(); removeGeneratedTrees(r.id); draw(); renderProperties(); });
        propertiesEl.appendChild(clr);
      }
    }
    const rm = document.createElement('button');
    rm.textContent = 'Delete region';
    rm.addEventListener('click', () => { pushHistory(); removeGeneratedTrees(r.id); level.terrain.regions = level.terrain.regions.filter(x => x.id !== r.id); selected = null; draw(); renderProperties(); });
    propertiesEl.appendChild(rm);
  } else if (selected.kind === 'road') {
    const r = level.terrain.roads.find(r => r.id === selected.id);
    if (!r) { selected = null; renderProperties(); return; }
    const title = document.createElement('h3');
    title.textContent = 'Road';
    propertiesEl.appendChild(title);
    mkField('ID', input('text', r.id, v => { pushHistory(); r.id = v; draw(); }));
    mkField('Type', select(ROAD_TYPES, r.type, v => { pushHistory(); r.type = v; draw(); }));
    mkField('Width (m)', input('number', r.widthM, v => { pushHistory(); r.widthM = Math.max(0.5, parseFloat(v) || 3); draw(); }, 0.5));
    const rm = document.createElement('button');
    rm.textContent = 'Delete road';
    rm.addEventListener('click', () => { pushHistory(); level.terrain.roads = level.terrain.roads.filter(x => x.id !== r.id); selected = null; draw(); renderProperties(); });
    propertiesEl.appendChild(rm);
  }
}
function input(type, value, onChange, step = 1) {
  const i = document.createElement('input');
  i.type = type; i.value = value;
  if (type === 'number') i.step = String(step);
  i.addEventListener('change', () => onChange(i.value));
  return i;
}
function select(options, value, onChange) {
  const s = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    if (o === value) opt.selected = true;
    s.appendChild(opt);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

// ---------- save / reset / reload ----------
async function saveLevel() {
  statusHint.textContent = 'Saving…';
  try {
    const res = await fetch('/__level-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(level),
    });
    if (res.ok) { statusHint.textContent = 'Saved ✓'; return; }
    throw new Error('HTTP ' + res.status);
  } catch {
    // static build fallback: download
    const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'level.json';
    a.click();
    URL.revokeObjectURL(a.href);
    statusHint.textContent = 'Downloaded (static build — commit manually)';
  }
}
document.getElementById('save-btn').addEventListener('click', saveLevel);
document.getElementById('reload-btn').addEventListener('click', async () => {
  pushHistory();
  const fresh = await loadLevel('/level.json');
  level = fresh; selected = null; pendingPoints = [];
  draw(); renderProperties();
});
document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Reset the level to the default (empty grasslands)? This is undoable with Ctrl+Z.')) return;
  pushHistory();
  level = defaultLevel();
  selected = null; pendingPoints = [];
  draw(); renderProperties();
});

// ---------- input ----------
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
}

canvas.addEventListener('mousedown', e => { hoverVertex = null;
  const { sx, sy } = getPos(e);
  const w = screenToWorld(sx, sy);

  // vertex drag wins even when the click is outside the polygon — only the
  // vertex's own hit radius matters
  const v = e.button === 0 && tool === 'select' ? vertexAt(sx, sy) : null;
  if (v) {
    drag = { type: 'vertex', ...v, moved: false };
    selected = v.kind === 'region-vertex' ? { kind: 'region', id: v.id } : { kind: 'road', id: v.id };
    draw(); renderProperties();
    return;
  }

  if (e.button === 1 || (e.button === 0 && tool === 'select' && !hitTest(sx, sy, w))) {
    drag = { type: 'pan', startSx: sx, startSy: sy, camStartX: camera.x, camStartZ: camera.z };
    return;
  }
  if (e.button === 2) {
    if (tool === 'region' && pendingPoints.length >= 3) { closeRegion(); return; }
    if (tool === 'road' && pendingPoints.length >= 2) { finishRoad(); return; }
    if (pendingPoints.length) { cancelPending(); }
    return;
  }
  if (e.button !== 0) return;

  if (tool === 'region') {
    if (pendingPoints.length >= 3 && Math.hypot(pendingPoints[0][0] - w.x, pendingPoints[0][1] - w.z) < 12 / camera.scale) {
      closeRegion();
      return;
    }
    pendingPoints.push([w.x, w.z]);
    draw();
    return;
  }
  if (tool === 'road') {
    pendingPoints.push([w.x, w.z]);
    draw();
    return;
  }
  if (tool === 'object') {
    if (!objectToolAsset) return;
    pushHistory();
    const id = nextFreeObjectId(objectToolAsset);
    level.objects.push({ id, type: objectToolAsset, x: w.x, z: w.z, rotation: 0, scale: 1 });
    selected = { kind: 'object', index: level.objects.length - 1 };
    draw(); renderProperties();
    return;
  }
  if (tool === 'spawn-player') {
    pushHistory();
    level.spawns.player = { x: w.x, z: w.z, heading: level.spawns.player?.heading ?? 0 };
    selected = { kind: 'spawn-player' };
    draw(); renderProperties();
    return;
  }
  if (tool === 'spawn-enemy') {
    pushHistory();
    level.spawns.enemies.push({ x: w.x, z: w.z, heading: Math.PI });
    selected = { kind: 'spawn-enemy', index: level.spawns.enemies.length - 1 };
    draw(); renderProperties();
    return;
  }

  // select tool
  const hit = hitTest(sx, sy, w);
  if (hit) {
    selected = hit;
    if (hit.kind === 'object') {
      const o = level.objects[hit.index];
      drag = { type: 'object', index: hit.index, dx: w.x - o.x, dz: w.z - o.z };
    } else if (hit.kind === 'spawn-player') {
      const p = level.spawns.player;
      drag = { type: 'spawn-player', dx: w.x - p.x, dz: w.z - p.z };
    } else if (hit.kind === 'spawn-enemy') {
      const en = level.spawns.enemies[hit.index];
      drag = { type: 'spawn-enemy', index: hit.index, dx: w.x - en.x, dz: w.z - en.z };
    } else if (hit.kind === 'menuCamera') {
      const mc = level.menuCamera;
      drag = { type: 'menuCamera', dx: w.x - mc.x, dz: w.z - mc.z };
    } else if (hit.kind === 'region') {
      const r = level.terrain.regions.find(r => r.id === hit.id);
      if (r) drag = { type: 'region-move', id: r.id, startW: { x: w.x, z: w.z }, startPoints: r.points.map(p => [p[0], p[1]]), moved: false };
    }
  } else {
    selected = null;
  }
  draw(); renderProperties();
});

function menuCameraAt(w) {
  const mc = level.menuCamera;
  if (mc && Math.hypot(w.x - mc.x, w.z - mc.z) < 8) return { kind: 'menuCamera' };
  return null;
}

function hitTest(sx, sy, w) {
  // objects first, then spawns, then vertices, roads, regions
  const sp = spawnAt(w.x, w.z);
  if (sp) return sp;
  const mc = menuCameraAt(w);
  if (mc) return mc;
  const oi = objectAt(w.x, w.z);
  if (oi != null) return { kind: 'object', index: oi };
  const rd = roadAt(w.x, w.z);
  if (rd) return { kind: 'road', id: rd.id };
  const rg = regionAt(w.x, w.z);
  if (rg) return { kind: 'region', id: rg.id };
  return null;
}

function cancelPending() {
  pendingPoints = [];
  draw();
}

function closeRegion() {
  const type = regionToolType;
  if (!type) return;
  if (pendingPoints.length < 3) { pendingPoints = []; draw(); return; }
  pushHistory();
  const region = { id: `${type}-${Date.now().toString(36)}`, type, points: pendingPoints.slice() };
  if (type === 'forest') region.density = DEFAULT_FOREST_DENSITY;
  level.terrain.regions.push(region);
  selected = { kind: 'region', id: region.id };
  pendingPoints = [];
  draw(); renderProperties();
}

canvas.addEventListener('mousemove', e => {
  const { sx, sy } = getPos(e);
  const w = screenToWorld(sx, sy);
  statusHint.textContent = `x: ${w.x.toFixed(1)}  z: ${w.z.toFixed(1)}`;
  if (drag) {
    if (drag.type === 'pan') {
      camera.x = drag.camStartX - (sx - drag.startSx) / camera.scale;
      camera.z = drag.camStartZ - (sy - drag.startSy) / camera.scale;
      draw();
    } else if (drag.type === 'object') {
      const o = level.objects[drag.index];
      if (o) { o.x = w.x - drag.dx; o.z = w.z - drag.dz; draw(); renderProperties(); }
    } else if (drag.type === 'spawn-player') {
      const p = level.spawns.player;
      p.x = w.x - drag.dx; p.z = w.z - drag.dz; draw(); renderProperties();
    } else if (drag.type === 'spawn-enemy') {
      const en = level.spawns.enemies[drag.index];
      if (en) { en.x = w.x - drag.dx; en.z = w.z - drag.dz; draw(); renderProperties(); }
    } else if (drag.type === 'menuCamera') {
      const mc = level.menuCamera;
      if (mc) { mc.x = w.x - drag.dx; mc.z = w.z - drag.dz; draw(); renderProperties(); }
    } else if (drag.type === 'vertex') {
      if (drag.kind === 'region-vertex') {
        const r = level.terrain.regions.find(r => r.id === drag.id);
        if (r) { r.points[drag.index] = [w.x, w.z]; draw(); }
      } else {
        const r = level.terrain.roads.find(r => r.id === drag.id);
        if (r) { r.points[drag.index] = [w.x, w.z]; draw(); }
      }
    }
  } else {
    hoverVertex = null;
    if (selected && selected.kind === 'region' && tool === 'select') {
      const v = vertexAt(sx, sy);
      if (v && v.kind === 'region-vertex' && v.id === selected.id) hoverVertex = v;
    }
    draw(); // keep cursor coords visible
  }
});

window.addEventListener('mouseup', () => { hoverVertex = null;
  if (drag && drag.moved && (drag.type === 'region-move' || (drag.type === 'vertex' && drag.kind === 'region-vertex'))) {
    const id = drag.type === 'region-move' ? drag.id : drag.id;
    const r = level.terrain.regions.find(r => r.id === id);
    if (r && r.type === 'forest') regenerateForestRegion(r);
  }
  drag = null;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const { sx, sy } = getPos(e);
  const before = screenToWorld(sx, sy);
  const factor = Math.exp(-e.deltaY * 0.0012);
  camera.scale = Math.max(0.05, Math.min(30, camera.scale * factor));
  const after = screenToWorld(sx, sy);
  camera.x += before.x - after.x;
  camera.z += before.z - after.z;
  draw();
}, { passive: false });

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('dblclick', e => {
  if (tool === 'road' && pendingPoints.length >= 2) {
    finishRoad();
  }
});

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Escape') {
    if (pendingPoints.length) cancelPending();
    else selected = null, draw(), renderProperties();
  } else if (e.key === 'Enter') {
    if (tool === 'region' && pendingPoints.length >= 3) closeRegion();
    else if (tool === 'road' && pendingPoints.length >= 2) finishRoad();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault(); undo();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelected();
  } else if (e.key.toLowerCase() === 'r') {
    rotateSelected();
  } else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    nudgeSelected(e.key, e.shiftKey);
  }
});

function finishRoad() {
  const type = roadToolType;
  if (!type) { pendingPoints = []; draw(); return; }
  if (pendingPoints.length < 2) { pendingPoints = []; draw(); return; }
  pushHistory();
  level.terrain.roads.push({ id: `${type}-${Date.now().toString(36)}`, type, widthM: ROAD_WIDTH_DEFAULT[type] ?? 3, points: pendingPoints.slice() });
  pendingPoints = [];
  draw(); renderProperties();
}

function regionTreeIdPrefix(regionId) { return `${regionId}-tree-`; }
function generatedTreesFor(regionId) {
  const prefix = regionTreeIdPrefix(regionId);
  return level.objects.filter(o => o.type === 'tree' && String(o.id).startsWith(prefix));
}
function removeGeneratedTrees(regionId) {
  const prefix = regionTreeIdPrefix(regionId);
  level.objects = level.objects.filter(o => !(o.type === 'tree' && String(o.id).startsWith(prefix)));
}

function regenerateForestRegion(r) {
  const prev = generatedTreesFor(r.id).length;
  removeGeneratedTrees(r.id);
  const res = generateForestTrees(level, r);
  level.objects.push(...res.trees);
  statusHint.textContent = `Region resized — regenerated ${res.placed}/${res.target} trees (was ${prev})` + (res.failed ? `, ${res.failed} blocked` : '');
  draw(); renderProperties();
}

function deleteSelected() {
  if (!selected) return;
  if (selected.kind === 'menuCamera') { /* keep menu camera; ignore delete */ return; }
  pushHistory();
  if (selected.kind === 'object') level.objects.splice(selected.index, 1);
  else if (selected.kind === 'spawn-enemy') level.spawns.enemies.splice(selected.index, 1);
  else if (selected.kind === 'region') { removeGeneratedTrees(selected.id); level.terrain.regions = level.terrain.regions.filter(r => r.id !== selected.id); }
  else if (selected.kind === 'road') level.terrain.roads = level.terrain.roads.filter(r => r.id !== selected.id);
  else if (selected.kind === 'spawn-player') { /* keep player spawn; ignore delete */ }
  selected = null; draw(); renderProperties();
}

function rotateSelected() {
  if (!selected) return;
  if (selected.kind === 'object') {
    const o = level.objects[selected.index];
    if (!o) return;
    pushHistory();
    o.rotation = (o.rotation ?? 0) + Math.PI / 12;
    draw(); renderProperties();
  } else if (selected.kind === 'menuCamera') {
    const mc = level.menuCamera;
    if (!mc) return;
    pushHistory();
    mc.yaw = (mc.yaw ?? 0) + Math.PI / 12;
    draw(); renderProperties();
  }
}

function nudgeSelected(key, shift) {
  const step = (shift ? 10 : 1) / 1; // meters
  let d = null;
  if (key === 'ArrowUp') d = [0, -step];
  if (key === 'ArrowDown') d = [0, step];
  if (key === 'ArrowLeft') d = [-step, 0];
  if (key === 'ArrowRight') d = [step, 0];
  if (!d) return;
  pushHistory();
  if (selected?.kind === 'object') {
    const o = level.objects[selected.index];
    if (o) { o.x += d[0]; o.z += d[1]; }
  } else if (selected?.kind === 'spawn-player') {
    level.spawns.player.x += d[0]; level.spawns.player.z += d[1];
  } else if (selected?.kind === 'spawn-enemy') {
    const en = level.spawns.enemies[selected.index];
    if (en) { en.x += d[0]; en.z += d[1]; }
  } else if (selected?.kind === 'menuCamera') {
    const mc = level.menuCamera;
    if (mc) { mc.x += d[0]; mc.z += d[1]; }
  }
  draw(); renderProperties();
}

// ---------- drag history capture ----------
// patch mousedown handler via wrapping: instead, snapshot in pushHistory at drag start
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0 || tool !== 'select') return;
  const { sx, sy } = getPos(e);
  const w = screenToWorld(sx, sy);
  const v = vertexAt(sx, sy);
  const wantDrag = v || objectAt(w.x, w.z) != null || spawnAt(w.x, w.z) || menuCameraAt(w) || regionAt(w.x, w.z);
  if (wantDrag) {
    history.push(JSON.stringify(level));
    if (history.length > MAX_HISTORY) history.shift();
  }
}, true);

// ---------- init ----------
async function init() {
  level = await loadLevel('/level.json');
  const sp = level.spawns?.player;
  if (sp) { camera.x = sp.x; camera.z = sp.z; }
  // pick nextIdCounter safely: max numeric suffix across ids + 1
  let maxN = 0;
  for (const o of level.objects) {
    const m = /(\d+)$/.exec(o.id ?? '');
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  nextIdCounter = maxN + 1;
  buildPalette();
  rebuildPaletteSelection();
  resize();
  renderProperties();
}
init();
