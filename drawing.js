// this module contains functionality to draw the layout of a node tree
// on a given Cairo context

const TAU = Math.PI * 2;

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

function drawRoundedRect(cr, rect, radius, fillColor, strokeColor) {
    let { x, y, width, height } = rect;

    let drawPath = function () {
        // Start a new path for the rounded rectangle
        cr.newPath();

        // Move to starting point
        cr.moveTo(x + radius, y);

        // Top edge and top-right corner
        cr.lineTo(x + width - radius, y);
        cr.arc(x + width - radius, y + radius, radius, -TAU / 4, 0);

        // Right edge and bottom-right corner 
        cr.lineTo(x + width, y + height - radius);
        cr.arc(x + width - radius, y + height - radius, radius, 0, TAU / 4);

        // Bottom edge and bottom-left corner
        cr.lineTo(x + radius, y + height);
        cr.arc(x + radius, y + height - radius, radius, TAU / 4, TAU / 2);

        // Left edge and top-left corner
        cr.lineTo(x, y + radius);
        cr.arc(x + radius, y + radius, radius, TAU / 2, TAU * 3 / 4);

        cr.closePath();
    }

    // fill the region
    cr.setSourceRGBA(fillColor.r, fillColor.g, fillColor.b, fillColor.a);
    drawPath();
    cr.fill();

    // draw the border
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

function drawLayout(cr, node, displayRect, colors = DefaultColors, cornerRadius = 10, zoneCounter = { count: 0 }) {
    if (!node) return;

    // Draw current node
    let rect = node.rect;

    // Offset by monitor displayRect
    let x = rect.x - displayRect.x;
    let y = rect.y - displayRect.y;
    let width = rect.width;
    let height = rect.height;

    // draw the region of a leaf node
    if (node.isLeaf()) {
        let c = colors.background;
        if (node.isHighlighted) {
            // highlighted regions have a more active color
            c = colors.highlight;
        }
        cr.setSourceRGBA(c.r, c.g, c.b, c.a);

        let regionRect = addMargins({ x, y, width, height }, node.margin);
        drawRoundedRect(cr, regionRect, cornerRadius, c, colors.border);

        // Increment and draw zone number with size
        zoneCounter.count++;
        const zoneNumber = zoneCounter.count;

        // Draw zone number and size (width x height in pixels) - use regionRect for live updates
        const sizeText = `${Math.round(regionRect.width)}x${Math.round(regionRect.height)}`;

        // Standard uniform font sizes - scale down only if zone is too small
        const baseNumberSize = 72;  // doubled for 4K visibility
        const baseSizeTextSize = 36; // doubled for 4K visibility
        const minDimension = Math.min(regionRect.width, regionRect.height);
        const scaleFactor = Math.min(1, minDimension / 200); // scale down if smaller than 200px

        const numberFontSize = baseNumberSize * scaleFactor;
        const sizeFontSize = baseSizeTextSize * scaleFactor;

        cr.setSourceRGBA(colors.border.r, colors.border.g, colors.border.b, 1);
        cr.selectFontFace('Sans', 0, 1); // Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD

        // Measure text to center it
        cr.setFontSize(numberFontSize);
        const numberExtents = cr.textExtents(zoneNumber.toString());

        cr.setFontSize(sizeFontSize);
        const sizeExtents = cr.textExtents(sizeText);

        // Calculate center position
        const centerX = regionRect.x + regionRect.width / 2;
        const centerY = regionRect.y + regionRect.height / 2;
        const totalHeight = numberExtents.height + sizeExtents.height + 15; // 15px spacing (increased)

        // Draw zone number with shadow for readability (centered, larger)
        cr.setFontSize(numberFontSize);
        const numberX = centerX - numberExtents.width / 2;
        const numberY = centerY - totalHeight / 2 + numberExtents.height;

        // Shadow/outline for zone number
        cr.setSourceRGBA(0, 0, 0, 0.8); // dark shadow
        cr.moveTo(numberX + 2, numberY + 2);
        cr.showText(zoneNumber.toString());

        // Main zone number text
        cr.setSourceRGBA(colors.border.r, colors.border.g, colors.border.b, 1);
        cr.moveTo(numberX, numberY);
        cr.showText(zoneNumber.toString());

        // Draw size with shadow for readability (centered, smaller, below number)
        cr.setFontSize(sizeFontSize);
        const sizeX = centerX - sizeExtents.width / 2;
        const sizeY = centerY + totalHeight / 2;

        // Shadow/outline for size text
        cr.setSourceRGBA(0, 0, 0, 0.8); // dark shadow
        cr.moveTo(sizeX + 2, sizeY + 2);
        cr.showText(sizeText);

        // Main size text
        cr.setSourceRGBA(colors.border.r, colors.border.g, colors.border.b, 1);
        cr.moveTo(sizeX, sizeY);
        cr.showText(sizeText);
    }

    for (let child of node.children) {
        drawLayout(cr, child, displayRect, colors, cornerRadius, zoneCounter);
    }
}

module.exports = {
    drawLayout,
    DefaultColors
};