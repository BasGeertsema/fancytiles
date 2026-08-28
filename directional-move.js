// directional-move.js

const Meta = imports.gi.Meta;

function _ensureNormal(win) {
  // Normalize window state before moving (leave fullscreen / unmaximize)
  try {
    if (win.get_state && (win.get_state() & Meta.WindowState.FULLSCREEN)) {
      if (win.unmake_fullscreen) win.unmake_fullscreen();
    }
  } catch (e) {}

  try {
    if (win.get_maximized) {
      const m = win.get_maximized();
      if (m & (Meta.MaximizeFlags.HORIZONTAL | Meta.MaximizeFlags.VERTICAL)) {
        if (win.unmaximize) win.unmaximize(Meta.MaximizeFlags.BOTH);
      }
    } else if (win.unmaximize) {
      win.unmaximize(Meta.MaximizeFlags.BOTH);
    }
  } catch (e) {}
}

// Helpers for span mode (union of multiple tiles)
function _rectUnion(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const r = Math.max(a.x + a.width,  b.x + b.width);
  const btm = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: r - x, height: btm - y };
}

function _overlaps(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
           a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function _leavesOverlapping(leaves, rect) {
  return leaves.filter(l => _overlaps(l.rect, rect));
}

// Pick next tile to expand a spanning rectangle in a given direction
function _chooseAdjacentToSpan(leaves, spanRect, dir) {
  const c0 = _center(spanRect);
  let best = null, bestScore = Infinity;

  for (const l of leaves) {
    const r = l.rect;

    // Skip tiles fully contained in current span
    if (r.x >= spanRect.x && r.y >= spanRect.y &&
        r.x + r.width  <= spanRect.x + spanRect.width &&
        r.y + r.height <= spanRect.y + spanRect.height) {
      continue;
    }

    const c = _center(r);
    const dx = c.x - c0.x;
    const dy = c.y - c0.y;

    let ok = false;
    let ortho = 0;

    if (dir === 'left'  && c.x <  c0.x) { ok = true; ortho = _vOverlap(spanRect, r); }
    if (dir === 'right' && c.x >  c0.x) { ok = true; ortho = _vOverlap(spanRect, r); }
    if (dir === 'up'    && c.y <  c0.y) { ok = true; ortho = _hOverlap(spanRect, r); }
    if (dir === 'down'  && c.y >  c0.y) { ok = true; ortho = _hOverlap(spanRect, r); }
    if (!ok) continue;

    // Prefer strongest orthogonal overlap, then shortest distance
    const dist = Math.hypot(dx, dy);
    const score = (-ortho) * 1e6 + dist;
    if (score < bestScore) { best = l; bestScore = score; }
  }
  return best;
}

const { LayoutIO } = require('./io-utils');
const { LayoutNode } = require('./node_tree');
const { getUsableScreenArea, snapToRect } = require('./window-utils');

function _center(r) { return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }

function _hOverlap(a, b) {
  const a0 = a.x, a1 = a.x + a.width;
  const b0 = b.x, b1 = b.x + b.width;
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function _vOverlap(a, b) {
  const a0 = a.y, a1 = a.y + a.height;
  const b0 = b.y, b1 = b.y + b.height;
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function _default2x2() {
  return new LayoutNode(0, [
    new LayoutNode(0.5, [ new LayoutNode(-0.5), new LayoutNode(0) ]),
    new LayoutNode(0,   [ new LayoutNode(-0.5), new LayoutNode(0) ]),
  ]);
}

function _loadLayoutForDisplay(uuid, displayIdx) {
  try {
    const io = new LayoutIO(uuid);
    return io.loadLayoutForDisplay(displayIdx) || _default2x2().clone();
  } catch (e) {
    global.log('FancyTiles directional: loadLayoutForDisplay failed: ' + e.message);
    return _default2x2().clone();
  }
}

function _calcRectsForDisplay(layout, displayIdx) {
  const work = getUsableScreenArea(displayIdx);
  if (!work) return false;
  layout.calculateRects(work.x, work.y, work.width, work.height);
  return true;
}

function _collectLeaves(layout) {
  const leaves = [];
  layout.forSelfAndDescendants(n => { if (n.isLeaf()) leaves.push(n); });
  return leaves.filter(l => !!l.rect);
}

function _findLeafForPoint(leaves, pt) {
  return leaves.find(l => pt.x >= l.rect.x && pt.x <= l.rect.x + l.rect.width &&
                          pt.y >= l.rect.y && pt.y <= l.rect.y + l.rect.height);
}

function _nearestLeaf(leaves, pt) {
  let best = null, bestScore = Infinity;
  for (const l of leaves) {
    const c = _center(l.rect);
    const s = Math.hypot(c.x - pt.x, c.y - pt.y);
    if (s < bestScore) { best = l; bestScore = s; }
  }
  return best;
}

function _chooseAdjacent(leaves, currentRect, dir) {
  const c0 = _center(currentRect);
  let best = null, bestScore = Infinity;

  for (const l of leaves) {
    const r = l.rect;
    if (r === currentRect) continue;
    const c = _center(r);
    const dx = c.x - c0.x;
    const dy = c.y - c0.y;

    let ok = false;
    let ortho = 0;

    if (dir === 'left'  && dx < 0) { ok = true; ortho = _vOverlap(currentRect, r); }
    if (dir === 'right' && dx > 0) { ok = true; ortho = _vOverlap(currentRect, r); }
    if (dir === 'up'    && dy < 0) { ok = true; ortho = _hOverlap(currentRect, r); }
    if (dir === 'down'  && dy > 0) { ok = true; ortho = _hOverlap(currentRect, r); }
    if (!ok) continue;

    const dist = Math.hypot(dx, dy);
    const score = (-ortho) * 1e6 + dist;
    if (score < bestScore) { best = l; bestScore = score; }
  }

  return best;
}

// Choose next monitor when no adjacent tile exists in the given direction
function _pickMonitorInDirection(fromMonitor, direction) {
  const n = global.display.get_n_monitors();
  const here = global.display.get_monitor_geometry(fromMonitor);
  const hereC = _center(here);

  let chosen = fromMonitor;
  let bestScore = Infinity;

  for (let i = 0; i < n; i++) {
    if (i === fromMonitor) continue;
    const g = global.display.get_monitor_geometry(i);
    const gc = _center(g);
    const dx = gc.x - hereC.x;
    const dy = gc.y - hereC.y;

    let ok = false;
    if (direction === 'left'  && gc.x <  hereC.x && Math.abs(dy) <= g.height) ok = true;
    if (direction === 'right' && gc.x >  hereC.x && Math.abs(dy) <= g.height) ok = true;
    if (direction === 'up'    && gc.y <  hereC.y && Math.abs(dx) <= g.width ) ok = true;
    if (direction === 'down'  && gc.y >  hereC.y && Math.abs(dx) <= g.width ) ok = true;
    if (!ok) continue;

    const dist = Math.hypot(dx, dy);
    if (dist < bestScore) { bestScore = dist; chosen = i; }
  }

  return chosen;
}

// Main entry — move or span depending on options; falls back to monitor jump
function moveWindowByDirection(uuid, direction, opts = {}) {
  const win = global.display.focus_window;
  if (!win) return;

  _ensureNormal(win);

  const curMon = win.get_monitor();

  const layout = _loadLayoutForDisplay(uuid, curMon);
  if (!_calcRectsForDisplay(layout, curMon)) return;
  const leaves = _collectLeaves(layout);
  if (leaves.length === 0) return;

  const wf = win.get_frame_rect();
  const wc = { x: wf.x + wf.width / 2, y: wf.y + wf.height / 2 };

  const current = _findLeafForPoint(leaves, wc) || _nearestLeaf(leaves, wc);

  // Span mode: expand across multiple adjacent tiles in the given direction
  if (opts.span) {
    const overlapped = _leavesOverlapping(leaves, wf);
    let spanRect = overlapped.length > 0 ? overlapped[0].rect : current.rect;
    for (let i = 1; i < overlapped.length; i++) {
      spanRect = _rectUnion(spanRect, overlapped[i].rect);
    }

    const nextLeaf = _chooseAdjacentToSpan(leaves, spanRect, direction);
    if (nextLeaf) {
      const newSpan = _rectUnion(spanRect, nextLeaf.rect);
      snapToRect(win, newSpan);
      return;
    }

    // No adjacent tile to expand into; span does not jump across monitors
    return;
  }

  // Regular move: to adjacent tile if available
  const neighbor = _chooseAdjacent(leaves, current.rect, direction);
  if (neighbor) {
    snapToRect(win, neighbor.rect);
    return;
  }

  // No adjacent tile: jump to the most appropriate neighboring monitor
  const nextMon = _pickMonitorInDirection(curMon, direction);
  if (nextMon === curMon) return;

  const layout2 = _loadLayoutForDisplay(uuid, nextMon);
  if (!_calcRectsForDisplay(layout2, nextMon)) return;
  const leaves2 = _collectLeaves(layout2);
  if (leaves2.length === 0) return;

  // Choose the tile on the target monitor whose center is closest to the original window center
  const target = _nearestLeaf(leaves2, wc) || leaves2[0];
  snapToRect(win, target.rect);
}

module.exports = {
  moveWindowByDirection
};

