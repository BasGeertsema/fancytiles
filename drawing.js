// this module contains functionality to draw the layout of a node tree
// on a given Cairo context

// blueish default / fallback colors
const DefaultColors = {
    background: {
        r: 12 / 255,
        g: 117 / 255,
        b: 222 / 255,
        a: 0.3
    },
    highlight: {
        r: 12 / 255,
        g: 117 / 255,
        b: 222 / 255,
        a: 0.6
    },
    border: {
        r: 12 / 255,
        g: 117 / 255,
        b: 222 / 255,
        a: 1
    }
}

const { buildDifferencePath, polygonArea } = require('./shapes');

function drawRoundedRect(cr, rect, radius, fillColor, strokeColor, excludedRect) {
    const pathPoints = buildDifferencePath(rect, excludedRect);
    if (!pathPoints || pathPoints.length < 3) {
        return;
    }

    const drawPath = function () {
        cr.newPath();

        let polygon = pathPoints.slice();
        if (polygonArea(polygon) < 0) {
            polygon = polygon.reverse();
        }

        const pointCount = polygon.length;
        const cornerRadiusInput = Math.max(0, radius);

        for (let i = 0; i < pointCount; i++) {
            const prev = polygon[(i - 1 + pointCount) % pointCount];
            const current = polygon[i];
            const next = polygon[(i + 1) % pointCount];

            let dirIn = { x: current.x - prev.x, y: current.y - prev.y };
            let dirOut = { x: next.x - current.x, y: next.y - current.y };

            const lenIn = Math.hypot(dirIn.x, dirIn.y);
            const lenOut = Math.hypot(dirOut.x, dirOut.y);

            if (lenIn === 0 || lenOut === 0) {
                continue;
            }

            dirIn = { x: dirIn.x / lenIn, y: dirIn.y / lenIn };
            dirOut = { x: dirOut.x / lenOut, y: dirOut.y / lenOut };

            const cornerRadius = Math.min(cornerRadiusInput, lenIn / 2, lenOut / 2);
            // trim the straight segments so the arc touches correct tangents
            const startPoint = {
                x: current.x - dirIn.x * cornerRadius,
                y: current.y - dirIn.y * cornerRadius
            };
            const endPoint = {
                x: current.x + dirOut.x * cornerRadius,
                y: current.y + dirOut.y * cornerRadius
            };

            if (i === 0) {
                cr.moveTo(startPoint.x, startPoint.y);
            } else {
                cr.lineTo(startPoint.x, startPoint.y);
            }

            const turn = dirIn.x * dirOut.y - dirIn.y * dirOut.x;

            if (cornerRadius > 1e-6 && Math.abs(turn) > 1e-6) {
                // center sits in the quadrant spanned by dirIn/dirOut; sign of turn decides arc direction
                const center = {
                    x: current.x - dirIn.x * cornerRadius + dirOut.x * cornerRadius,
                    y: current.y - dirIn.y * cornerRadius + dirOut.y * cornerRadius
                };
                const startAngle = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
                const endAngle = Math.atan2(endPoint.y - center.y, endPoint.x - center.x);

                if (turn > 0) {
                    cr.arc(center.x, center.y, cornerRadius, startAngle, endAngle);
                } else {
                    cr.arcNegative(center.x, center.y, cornerRadius, startAngle, endAngle);
                }
            } else {
                // no curved corner here; continue with straight run
                cr.lineTo(endPoint.x, endPoint.y);
            }
        }

        cr.closePath();
    };

    cr.setSourceRGBA(fillColor.r, fillColor.g, fillColor.b, fillColor.a);
    drawPath();
    cr.fill();

    cr.setSourceRGBA(strokeColor.r, strokeColor.g, strokeColor.b, strokeColor.a);
    drawPath();
    cr.stroke();
}

function addMargins(rect, margin) {
    return {
        x: rect.x + margin,
        y: rect.y + margin,
        width: rect.width - margin * 2,
        height: rect.height - margin * 2
    }
}

function drawLayout(cr, node, displayRect, colors = DefaultColors, cornerRadius = 10, cutoutRect = null) {
    if (!node) return;

    // Draw current node
    let rect = node.rect;    

    // Offset by monitor displayRect
    let x = rect.x - displayRect.x;
    let y = rect.y - displayRect.y;
    let width = rect.width;
    let height = rect.height;

    // do we have a cutout for all children?
    if(node.insetNode && !cutoutRect){        
        cutoutRect = addMargins({
            x: node.insetNode.rect.x - displayRect.x,
            y: node.insetNode.rect.y - displayRect.y,
            width: node.insetNode.rect.width,
            height: node.insetNode.rect.height
        }, -node.insetNode.margin);
    }

    // draw the region of a leaf node
    if (node.isLeaf()) {
        let c = colors.background;
        if (node.isHighlighted) {
            // highlighted regions have a more active color
            c = colors.highlight;
        }
        cr.setSourceRGBA(c.r, c.g, c.b, c.a);

        let regionRect = addMargins({ x, y, width, height }, node.margin);        
        drawRoundedRect(cr, regionRect, cornerRadius, c, colors.border, cutoutRect);
    }

    for (let child of node.children) {
        drawLayout(cr, child, displayRect, colors, cornerRadius, cutoutRect);
    }    

    // draw the cutout once here
    if (node.insetNode) {
        drawLayout(cr, node.insetNode, displayRect, colors, cornerRadius, null);
    }
}

module.exports = {
    drawLayout,
    DefaultColors
};
