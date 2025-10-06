// helper utilities to build polygon paths used for drawing

// quantize floating point coordinates so we can safely use them as map keys
const COORD_PRECISION = 1e6;

function toKeyCoord(value) {
    return Math.round(value * COORD_PRECISION);
}

// collect unique finite values while preserving numeric ordering
function uniqueSorted(values) {
    const seen = new Set();
    const unique = [];
    for (const value of values) {
        if (!Number.isFinite(value)) continue;
        const key = toKeyCoord(value);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(value);
    }
    unique.sort((a, b) => a - b);
    return unique;
}

function pointKey(point) {
    return `${toKeyCoord(point.x)}:${toKeyCoord(point.y)}`;
}

function edgeKey(x1, y1, x2, y2) {
    const ax = toKeyCoord(x1);
    const ay = toKeyCoord(y1);
    const bx = toKeyCoord(x2);
    const by = toKeyCoord(y2);
    const minX = Math.min(ax, bx);
    const minY = Math.min(ay, by);
    const maxX = Math.max(ax, bx);
    const maxY = Math.max(ay, by);
    return `${minX}:${minY}:${maxX}:${maxY}`;
}

function orientedEdgeKey(edge) {
    return `${pointKey(edge.start)}->${pointKey(edge.end)}`;
}

function polygonArea(points) {
    if (!points || points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const { x: x1, y: y1 } = points[i];
        const { x: x2, y: y2 } = points[(i + 1) % points.length];
        area += x1 * y2 - x2 * y1;
    }
    return area * 0.5;
}

// return the axis-aligned portion shared by both rectangles (if any)
function computeIntersection(rect, excludedRect) {
    if (!rect || !excludedRect) return null;

    const left = Math.max(rect.x, excludedRect.x);
    const right = Math.min(rect.x + rect.width, excludedRect.x + excludedRect.width);
    const top = Math.max(rect.y, excludedRect.y);
    const bottom = Math.min(rect.y + rect.height, excludedRect.y + excludedRect.height);

    if (right <= left || bottom <= top) return null;

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
    };
}

// create a clockwise polygon for rect minus the overlapping part of excludedRect
function buildDifferencePath(rect, excludedRect) {
    if (!rect) return [];

    const rectLeft = rect.x;
    const rectRight = rect.x + rect.width;
    const rectTop = rect.y;
    const rectBottom = rect.y + rect.height;

    if (!(rectRight > rectLeft) || !(rectBottom > rectTop)) {
        return [];
    }

    const intersection = computeIntersection(rect, excludedRect);

    if (!intersection) {
        return [
            { x: rectLeft, y: rectTop },
            { x: rectRight, y: rectTop },
            { x: rectRight, y: rectBottom },
            { x: rectLeft, y: rectBottom }
        ];
    }

    // slice the area into a minimal grid defined by unique X/Y breakpoints
    const xs = uniqueSorted([rectLeft, rectRight, intersection.x, intersection.x + intersection.width]);
    const ys = uniqueSorted([rectTop, rectBottom, intersection.y, intersection.y + intersection.height]);

    const cells = [];

    for (let xi = 0; xi < xs.length - 1; xi++) {
        const x0 = xs[xi];
        const x1 = xs[xi + 1];
        if (x1 <= x0) continue;
        const cx = (x0 + x1) / 2;

        for (let yi = 0; yi < ys.length - 1; yi++) {
            const y0 = ys[yi];
            const y1 = ys[yi + 1];
            if (y1 <= y0) continue;
            const cy = (y0 + y1) / 2;

            const insideRect = cx >= rectLeft && cx <= rectRight && cy >= rectTop && cy <= rectBottom;
            const insideIntersection = cx >= intersection.x && cx <= intersection.x + intersection.width &&
                cy >= intersection.y && cy <= intersection.y + intersection.height;

            // retain cells that belong to rect but not the overlapped region
            if (insideRect && !insideIntersection) {
                cells.push({ x0, x1, y0, y1 });
            }
        }
    }

    if (cells.length === 0) {
        return [];
    }

    const edgeMap = new Map();

    // add rectangle edges, removing pairs that are shared between adjacent cells
    function addEdge(x1, y1, x2, y2) {
        if (Math.abs(x1 - x2) < 1e-7 && Math.abs(y1 - y2) < 1e-7) {
            return;
        }
        const key = edgeKey(x1, y1, x2, y2);
        if (edgeMap.has(key)) {
            edgeMap.delete(key);
        } else {
            edgeMap.set(key, {
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 }
            });
        }
    }

    for (const cell of cells) {
        addEdge(cell.x0, cell.y0, cell.x1, cell.y0);
        addEdge(cell.x1, cell.y0, cell.x1, cell.y1);
        addEdge(cell.x1, cell.y1, cell.x0, cell.y1);
        addEdge(cell.x0, cell.y1, cell.x0, cell.y0);
    }

    const edges = Array.from(edgeMap.values());
    if (edges.length === 0) {
        return [];
    }

    const edgesByStart = new Map();
    // bucket edges by start vertex so we can follow connected boundary segments
    for (const edge of edges) {
        const startKey = pointKey(edge.start);
        if (!edgesByStart.has(startKey)) {
            edgesByStart.set(startKey, []);
        }
        edgesByStart.get(startKey).push(edge);
    }

    const visited = new Set();
    let bestLoop = null;
    let bestArea = -Infinity;

    // walk every possible loop and keep the one with the largest area (outer boundary)
    for (const edge of edges) {
        const firstKey = orientedEdgeKey(edge);
        if (visited.has(firstKey)) continue;

        const loop = [];
        let currentEdge = edge;
        const loopStartKey = pointKey(edge.start);

        while (true) {
            const currentKey = orientedEdgeKey(currentEdge);
            if (visited.has(currentKey)) break;
            visited.add(currentKey);
            loop.push({ x: currentEdge.start.x, y: currentEdge.start.y });

            const nextKey = pointKey(currentEdge.end);
            if (nextKey === loopStartKey) {
                break;
            }

            const candidates = edgesByStart.get(nextKey);
            if (!candidates || candidates.length === 0) {
                loop.length = 0;
                break;
            }

            let nextEdge = null;
            for (const candidate of candidates) {
                const candidateKey = orientedEdgeKey(candidate);
                if (!visited.has(candidateKey)) {
                    nextEdge = candidate;
                    break;
                }
            }

            if (!nextEdge) {
                loop.length = 0;
                break;
            }

            currentEdge = nextEdge;
        }

        if (loop.length > 0) {
            const area = Math.abs(polygonArea(loop));
            if (area > bestArea) {
                bestArea = area;
                bestLoop = loop;
            }
        }
    }

    return bestLoop || [];
}

module.exports = {
    buildDifferencePath,
    polygonArea
};
