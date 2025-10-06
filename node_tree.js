// A layout is a tree data structure that represents the layout of snapping regions
// on a display. Each node in the tree represents a region.
// The internal nodes represent a partitioning (either row or column oriented) and 
// the leaf nodes represent the region for a single window to snap into.
//
// The internal nodes, that partition the cell into multiple rows or columns,
// can contain two or more child nodes. These child nodes can either be
// another internal node or a leaf node.
// 
// Each node holds a percentage value that represents the bottom edge (y-value) or 
// right edge (x-value) of the cell as a fraction of the display width (dw) or display height (dh)
// The percentages are NOT a fraction of the width or height of the parent node. Percentages are 
// used instead of absolute pixel values to allow the same layout to be used on displays with 
// different resolutions.
//
// NEGATIVE percentages are defined as going along the y-axis (row partitioning) and 
// POSITIVE percentages are defined as going along the x-axis (column partitioning).
// Another perspective on this is that the x axis is positive to the right and the 
// y axis is negative downwards. By having this convention, we can don´t have to store 
// the partition type in the node.
//
// For example, for a cell that has row partitioning, a value of -0.25 means that the 
// y-coordinate, the bottom edge of the cell, is 25% of the display height (0.25dh). For a cell that
// has column partitioning, a value of 0.45 means that the x-coordinate, the right edge 
// of the cell, is 45% of the screen width (0.45dw). Percentages are floating point numbers.
//
// The LAST child of an internal node does not have a percentage value as the right edge or
// bottom edge is defined by the parent node. I.e. it fills the remaining space.
//
// The calculateRects method calculates the rectangles for all the nodes in the tree in 
// absolute screen coordinates.
//

const Clutter = imports.gi.Clutter;

// The sentinel values for last row and last column
const AxisX = 0;
const AxisY = 1;

const LastNodeXPercentage = Number.POSITIVE_INFINITY;
const LastNodeYPercentage = Number.NEGATIVE_INFINITY;
const LastNodePercentages = [LastNodeXPercentage, LastNodeYPercentage];

// map to/from these values for JSON serialization as INFINITY is not serializable
const LastNodeXPercentageJson = 99999;
const LastNodeYPercentageJson = -99999;

// A node in the tree layout structure
class LayoutNode {
    // percentage of screen width (positive) or height (negative). 
    // Always INFINITY or NEGATIVE INFINITY for the last child.
    percentage;

    // reference to the parent
    parent = null;

    // the children of the node
    children = [];

    // the on-screen rectangle covering the region of the node
    rect = { x: 0, y: 0, width: 0, height: 0 };

    // the inset node is a fixed node that is used as a cutout for this node
    // and its descendants when drawing. in the resulting cutout, the node is drawn.
    // this functionality is used to draw the cutout for multi-snapping.
    insetNode = null;

    // isResizing indicates if the divider belonging to this node is being moved by the user
    isResizing = false;

    // isPreview indicates that this node is part of a preview split    
    isPreview = false;

    // isHighlighted indicates that this node is visually highlighted
    isHighlighted = false;

    // originalRect is the rectangle of the node before it was resized
    originalRect = null;

    // isSnappingDestination indicates that this node is a snapping destination
    isSnappingDestination = false;

    // margins surrounding the region, also referred to as spacing
    margin = 0;

    constructor(percentage, children = []) {
        this.percentage = percentage;

        this.children = children;
        for (let child of this.children) {
            child.parent = this;
        }

        // ensure that last child is always the expanding node
        if (this.children.length >= 2) {
            const axis = this.children[0].axis();
            const fillerPercentage = axis === AxisX ? LastNodeXPercentage : LastNodeYPercentage;
            this.children[this.children.length - 1].percentage = fillerPercentage;
        }
    }

    // create a deep clone of the node, useful to revert changes
    clone() {
        let clone = new LayoutNode(this.percentage, this.children.map(child => child.clone()));
        clone.rect = this.rect;
        clone.isResizing = this.isResizing;
        clone.isPreview = this.isPreview;
        clone.margin = this.margin;
        return clone;
    }

    // revert the node to the state of the snapshotRootNode, often used 
    // on the root node to revert the whole layout to a previous state
    revert(snapshotRootNode) {
        this.percentage = snapshotRootNode.percentage;
        this.rect = snapshotRootNode.rect;
        this.isResizing = snapshotRootNode.isResizing;
        this.isPreview = snapshotRootNode.isPreview;
        this.margin = snapshotRootNode.margin;
        this.children = snapshotRootNode.children;
    }

    isLeaf() {
        return this.children.length === 0;
    }

    isRoot() {
        return this.parent == null;
    }

    isRow() {
        return this.percentage <= -0;
    }

    isColumn() {
        return this.percentage >= 0;
    }

    snapRect() {
        return {
            x: this.rect.x + this.margin,
            y: this.rect.y + this.margin,
            width: this.rect.width - this.margin * 2,
            height: this.rect.height - this.margin * 2
        }
    }

    getIntegrityError() {
        if (this.children.length == 1) {
            return 'broken invariant: children has 1 element';
        }

        // Check that all children except the last one have a percentage
        if (this.children
            .slice(0, this.children.length - 1)
            .some(c => c.percentage === null || c.percentage < -1 || c.percentage > 1)) {
            return 'broken invariant: percentage not in [-1,1]';
        }

        // Check that the last child has a last node percentage
        if (this.children
            .slice(-1)
            .some(c => ![Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].includes(c.percentage))) {
            return 'broken invariant: last child invalid percentage';
        }

        return this.children.reduce((found, child) => found || child.getIntegrityError(), null);
    }

    // the axis along which the leading edge (right or bottom edge) of the node is positioned
    axis() {
        return this.isColumn() ? AxisX : AxisY;
    }

    // Calculates the rectangles for each node based on the display dimensions
    // the input parameters are the dimensions set by the parent node, or the
    // display dimensions if the node is the root node
    calculateRects(x, y, width, height, display) {
        if (x === undefined) {
            // no rectangle specified, use the current rectangle
            x = this.rect.x;
            y = this.rect.y;
            width = this.rect.width;
            height = this.rect.height;
        }

        this.rect = {
            x: x,
            y: y,
            width: width,
            height: height
        };

        if (this.isLeaf()) {
            return;
        }

        // calculate the sizes of children for internal nodes
        display = display || { x: x, y: y, width: width, height: height };

        // position of the last edge along the x (0) and y (1) axes
        let previousPosOnAxis = [x, y];
        let displayOnAxis = [display.x, display.y];
        let screenLength = [display.width, display.height];

        // Calculate rectangles for all children except the last one
        for (let i = 0; i < this.children.length - 1; i++) {
            let child = this.children[i];

            // get the axis on which the child is positioned
            let axis = child.axis();

            // calculate the position of the edge along the axis
            let posOnAxis = displayOnAxis[axis] + Math.round(Math.abs(screenLength[axis] * child.percentage) / 10) * 10;

            if (axis === AxisX) {
                // child is a column node
                child.calculateRects(
                    previousPosOnAxis[axis], y,
                    posOnAxis - previousPosOnAxis[axis], height,
                    display);

            } else {
                // child is a row node
                child.calculateRects(
                    x, previousPosOnAxis[axis],
                    width, posOnAxis - previousPosOnAxis[axis],
                    display);
            }

            // use the new edge as previous edge for the next child
            previousPosOnAxis[axis] = posOnAxis;
        }

        // Calculate rectangle for the last child (fills remaining space along the axis)
        let lastChild = this.children[this.children.length - 1];
        let axis = lastChild.axis();
        if (axis === AxisX) {
            lastChild.calculateRects(
                previousPosOnAxis[axis], y,
                (x + width - previousPosOnAxis[axis]), height,
                display);
        } else {
            lastChild.calculateRects(
                x, previousPosOnAxis[axis],
                width, (y + height - previousPosOnAxis[axis]),
                display);
        }
    }

    // validate the calculated rectangles for the node and its descendants
    validateRects() {
        // we constrain the mnimum size to a reasonable 100 pixels 
        // as smaller is likely not what the user wants 
        if (this.rect.width <= 100 || this.rect.height <= 100) {
            return false;
        }
        return this.children.every(child => child.validateRects());
    }

    // apply the given function to the node and all its descendants
    forSelfAndDescendants(func) {
        func(this);
        this.children.forEach(c => c.forSelfAndDescendants(func));
    }

    // apply the given function to all descendants of the node
    forDescendants(func) {
        this.children.forEach(c => c.forSelfAndDescendants(func));
    }

    // insert a child node into the tree, takes into account the ordering based on the percentage
    insertChild(child) {
        if (this.children.indexOf(child) !== -1) {
            global.logError('Child already in children collection');
            return;
        }

        if (child.percentage === LastNodeXPercentage || child.percentage === LastNodeYPercentage) {
            global.logError('Child has invalid percentage');
            return;
        }

        child.parent = this;

        // insert the child at the correct position/index 
        // to maintain the sorted invariant        
        this.children.splice(
            this.children.findIndex(c => Math.abs(c.percentage) > Math.abs(child.percentage)),
            0,
            child);
    }

    // find a node in the tree that matches the given predicate
    findNode(predicate) {
        if (predicate(this)) {
            return this;
        }
        return this.children.reduce((found, child) => found || child.findNode(predicate), null);
    }

    // find all node in the tree that matches the given predicate and return them in flat list
    findAllNodes(predicate) {
        let result = [];

        this.forSelfAndDescendants((n) => {
            if(predicate(n)) {
                result.push(n);
            }
        })

        return result;
    }

    // delete the given node in the tree if found
    delete(node) {
        let index = this.children.indexOf(node);
        if (index !== -1) {
            if (this.children.length === 2) {
                // this becomes a leaf node after deletion
                this.children = [];
            }
            else {
                // delete the node
                this.children.splice(index, 1);
            }
            return true;
        }

        return this.children.reduce((deleted, child) => deleted || child.delete(node), false);
    }

    // find the leaf node in the tree that contains the given coordinates
    findNodeAtPosition(x, y) {
        // check if point is within this node's rectangle
        if (x >= this.rect.x
            && x <= this.rect.x + this.rect.width
            && y >= this.rect.y
            && y <= this.rect.y + this.rect.height
            && this.isLeaf()) {
            return this;
        }

        // find in descendants
        return this.children.reduce((found, child) => found || child.findNodeAtPosition(x, y), null);
    }

    // get the rectangle of the divider for this node, useful for grabbing and moving the divider
    getDividerRect(dividerWidth) {
        dividerWidth = Math.max(dividerWidth, 2 * this.margin);
        return this.axis() === AxisX ?
            // right edge is leading edge (divider edge)
            {
                x: this.rect.x + this.rect.width - dividerWidth / 2,
                y: this.rect.y,
                width: dividerWidth,
                height: this.rect.height
            } :
            this.axis() === AxisY ?
                // bottom edge is leading edge (divider edge)
                {
                    x: this.rect.x,
                    y: this.rect.y + this.rect.height - dividerWidth / 2,
                    width: this.rect.width,
                    height: dividerWidth
                } :
                // root node has no divider
                {
                    x: -1, y: -1, width: 0, height: 0,
                };
    }

    // find the node with its leading edge (divider) at the given position
    findDividerAtPosition(x, y, dividerWidth) {
        // calculate the rectangle of the divider corresponding to this node
        var dividerRect = this.getDividerRect(dividerWidth);

        if (x >= dividerRect.x
            && x <= dividerRect.x + dividerRect.width
            && y >= dividerRect.y
            && y <= dividerRect.y + dividerRect.height) {
            return this;
        }

        return this.children.reduce((found, child) => found || child.findDividerAtPosition(x, y, dividerWidth), null);
    }

    // convert the node to a JSON object for saving
    toJSON() {
        let json = {};

        if (this.children.length > 0) {
            json.children = this.children.map(child => child.toJSON());
        }

        if (this.percentage !== null) {
            if (this.percentage === LastNodeXPercentage) {
                json.percentage = LastNodeXPercentageJson;
            } else if (this.percentage === LastNodeYPercentage) {
                json.percentage = LastNodeYPercentageJson;
            } else {
                json.percentage = this.percentage;
            }
        }

        // Add margin to JSON if it's non-zero
        if (this.margin !== 0) {
            json.margin = this.margin;
        }

        return json;
    }

    // load the node from a JSON object
    fromJSON(json) {
        this.percentage = json.percentage;
        if (this.percentage === LastNodeXPercentageJson) {
            this.percentage = LastNodeXPercentage;
        } else if (this.percentage === LastNodeYPercentageJson) {
            this.percentage = LastNodeYPercentage;
        }

        // Load margin if present in JSON
        if (json.margin !== undefined) {
            this.margin = json.margin;
        }

        if (json.children && json.children.length > 0) {
            this.children = json.children.map(childJson => {
                let child = new LayoutNode();
                child.parent = this;
                child.fromJSON(childJson);
                return child;
            });
        }
        return this;
    }
}

// the result of an operation, either handled or not,
// and indicates whether the layout should be redrawn
class OperationResult {
    handled = false;
    shouldRedraw = false;

    constructor(handled = false, shouldRedraw = false) {
        this.handled = handled;
        this.shouldRedraw = shouldRedraw;
    }

    static handled() {
        return new OperationResult(true, false);
    }

    static handledAndRedraw() {
        return new OperationResult(true, true);
    }

    static notHandled() {
        // just use null for easier propagating using ||
        return null;
    }
}

// a layout operation, i.e. a user action that changes the layout
class LayoutOperation {
    tree;

    constructor(tree) {
        this.tree = tree;
    }

    onButtonPress(x, y, state, button) {
        return OperationResult.notHandled();
    }

    onButtonRelease(x, y, state, button) {
        return OperationResult.notHandled();
    }

    onMotion(x, y, state) {
        return OperationResult.notHandled();
    }

    cancel() {
        return OperationResult.notHandled();
    }

    onKeyPress(x, y, state, key) {
        return OperationResult.notHandled();
    }

    onKeyRelease(x, y, state) {
        return OperationResult.notHandled();
    }
}

// the user can drag the divider of a node to resize it
class ResizeOperation extends LayoutOperation {
    dividerWidth = 20;

    constructor(tree) {
        super(tree);
    }

    onButtonPress(x, y, state, button) {
        let resizeNode = this.tree.findNode(c => c.isResizing === true);

        if (!resizeNode && button === Clutter.BUTTON_SECONDARY) {
            let nodeWithDivider = this.tree.findDividerAtPosition(x, y, this.dividerWidth);
            if (nodeWithDivider) {
                // delete the node with the selected divider
                this.tree.delete(nodeWithDivider);
                this.tree.calculateRects();
                return OperationResult.handledAndRedraw();
            }
        }

        if (resizeNode && button === Clutter.BUTTON_PRIMARY) {
            // this should not happen as the button is continously pressed, but just reset here
            this._stopResizing();
            return OperationResult.handledAndRedraw();
        }
        else if (resizeNode && button === Clutter.BUTTON_SECONDARY) {
            // user is trying to stop the resizing, TODO: better to restore original state
            this._stopResizing();
            return OperationResult.handledAndRedraw();
        }
        else if (button === Clutter.BUTTON_PRIMARY) {
            // Check if clicking on a divider to start resizing
            let nodeToResize = this.tree.findDividerAtPosition(x, y, this.dividerWidth);
            if (nodeToResize) {
                this._startResizing(nodeToResize);
                return OperationResult.handledAndRedraw();
            }
        }

        return OperationResult.notHandled();
    }

    onButtonRelease(x, y, state, button) {
        if (button === Clutter.BUTTON_PRIMARY
            && this.tree.findNode(n => n.isResizing)) {
            this._stopResizing();
            return OperationResult.handledAndRedraw();
        }
        return OperationResult.notHandled();
    }

    onMotion(x, y, state) {
        return this._handleResizing(x, y);
    }

    _startResizing(nodeToResize) {
        nodeToResize.isResizing = true;

        // this is just a simple trick to highlight all the nodes that are affected by resizing
        // we just 'wiggle' the resizing node a bit and test which nodes are affected
        const originalPercentage = nodeToResize.percentage;
        this.tree.forSelfAndDescendants(n =>
            n.originalRect = { x: n.rect.x, y: n.rect.y, width: n.rect.width, height: n.rect.height });

        // resize a little bit
        nodeToResize.percentage = nodeToResize.percentage * 0.95;
        this.tree.calculateRects();

        // highlight all nodes that are affected by resizing
        this.tree.forSelfAndDescendants(n => n.isHighlighted = (n.originalRect.x != n.rect.x || n.originalRect.y != n.rect.y || n.originalRect.width != n.rect.width || n.originalRect.height != n.rect.height));

        // revert to the original layout
        nodeToResize.percentage = originalPercentage;
        this.tree.calculateRects();
    }

    _stopResizing() {
        this.tree.forSelfAndDescendants(n => { n.isResizing = false; n.originalRect = null; n.isHighlighted = false; });
    }

    _handleResizing(x, y) {
        let resizingNode = this.tree.findNode(n => n.isResizing === true);
        if (!resizingNode) {
            return OperationResult.notHandled();
        }

        // calculate new position of divider as a percentage of screen size
        let newPercentage = resizingNode.isColumn() ? (x - this.tree.rect.x) / this.tree.rect.width : -((y - this.tree.rect.y) / this.tree.rect.height);

        // udate the percentage for the node with this divider
        let oldPercentage = resizingNode.percentage;
        resizingNode.percentage = newPercentage;

        // Recalculate layout
        this.tree.calculateRects();

        // Validate and revert if invalid
        if (!this.tree.validateRects()) {
            resizingNode.percentage = oldPercentage;
            this.tree.calculateRects();
        }

        return OperationResult.handledAndRedraw();
    }
}

// the user can preview a split in the layout
class PreviewSplitOperation extends LayoutOperation {
    prePreviewSnapshot = null;

    constructor(tree) {
        super(tree);
    }

    onMotion(x, y, state) {
        return this._handlePreview(x, y, state);
    }

    onKeyPress(x, y, state, key) {
        return this._handlePreview(x, y, state);
    }

    onKeyRelease(x, y, state) {
        let ctrlPressed = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        let shiftPressed = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (ctrlPressed || shiftPressed) {
            // cancel any preview
            this._cancel();
            return OperationResult.handledAndRedraw();
        }
        return OperationResult.notHandled();
    }

    onButtonPress(x, y, state, button) {
        let previewNode = this.tree.findNode(n => n.isPreview);
        if (previewNode && button === Clutter.BUTTON_PRIMARY) {
            // finalize the preview and redraw
            this._finalizePreview();
            return OperationResult.handledAndRedraw();
        }
        return this._handlePreview(x, y, state);
    }

    _cancel() {
        if (this.prePreviewSnapshot) {
            this.tree.revert(this.prePreviewSnapshot);
            this.prePreviewSnapshot = null;
        }
    }

    _handlePreview(x, y, state) {
        // Check for preview partition creation    
        let ctrlPressed = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        let shiftPressed = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        let previewModeEnabled = ctrlPressed || shiftPressed;

        let node = this.tree.findNodeAtPosition(x, y);
        let previewNode = this.tree.findNode(n => n.isPreview);

        let result = OperationResult.notHandled();

        // cancel the preview if going out of bounds
        if (previewNode
            && (node && node.parent != previewNode.parent || !previewModeEnabled)) {
            // restore the preview snapshot
            this._cancel();

            this.tree.calculateRects();

            previewNode = null;

            result = OperationResult.handledAndRedraw();
        }

        // start a new preview if 
        // 1) there is no preview yet and 
        // 2) we are moving over a cell and 
        // 3) ctrl or shift is pressed (preview mode)
        if (!previewNode
            && node && node.isLeaf()
            && previewModeEnabled) {
            // create a snapshot of the current layout tree to revert to if the preview is cancelled
            this.prePreviewSnapshot = this.tree.clone();
            // Create new preview split, with the current mouse position used for the percentage
            let isColumn = ctrlPressed;
            let percentage = isColumn ? ((x - this.tree.rect.x) / this.tree.rect.width) : -((y - this.tree.rect.y) / this.tree.rect.height);
            previewNode = this._startPreview(node, percentage);

            // check whether the initial split is valid at all, if not revert
            this.tree.calculateRects();
            if (!this.tree.validateRects()) {
                this._cancel();
            }

            result = OperationResult.handledAndRedraw();
        }

        // move around the divider on a resizing (preview)node
        if (previewNode) {
            // calculate the percentages  
            let percentage = previewNode.isColumn() ? ((x - this.tree.rect.x) / this.tree.rect.width) : -((y - this.tree.rect.y) / this.tree.rect.height);

            let oldPercentage = previewNode.percentage;
            previewNode.percentage = percentage;

            // Recalculate layout
            this.tree.calculateRects();

            // Validate and cancel if invalid
            if (!this.tree.validateRects()) {
                previewNode.percentage = oldPercentage;
                this.tree.calculateRects();
            }

            result = OperationResult.handledAndRedraw();
        }

        return result;
    }

    _startPreview(splittingNode, percentage) {
        // Split a leaf node into two nodes, with the given percentage as starting point           
        let previewNode = new LayoutNode(percentage);
        previewNode.isPreview = true;
        previewNode.isHighlighted = true;
        previewNode.margin = splittingNode.margin;

        if (previewNode.axis() === splittingNode.axis() && splittingNode.parent) {
            // request the parent to insert a new node
            splittingNode.parent.insertChild(previewNode);
            splittingNode.isHighlighted = true;
        } else {
            // moving from column to row or vice versa
            // make this an internal node and add two children
            var lastChild = new LayoutNode(LastNodePercentages[previewNode.axis()]);
            lastChild.isHighlighted = true;
            lastChild.parent = splittingNode;
            lastChild.margin = splittingNode.margin;
            previewNode.parent = splittingNode;
            splittingNode.children = [previewNode, lastChild];
        }
        return previewNode;
    }

    _finalizePreview() {
        if (this.tree.validateRects()) {
            this.prePreviewSnapshot = null;
            this.tree.forSelfAndDescendants(n => {
                n.isPreview = false;
                n.originalRect = null;
            });
        }
    }
}

// the user can drag and snap a window into place
class SnappingOperation extends LayoutOperation {
    showRegions = false;
    #enableSnappingModifiers;
    #enableMultiSnappingModifiers;
    #enableAdjacentMerging;
    
    constructor(tree, enableSnappingModifiers, enableMultiSnappingModifiers, enableAdjacentMerging) {
        super(tree);
        this.#enableSnappingModifiers = enableSnappingModifiers;
        this.#enableMultiSnappingModifiers = enableMultiSnappingModifiers;
        this.#enableAdjacentMerging = enableAdjacentMerging;
    }

    onMotion(x, y, state) {
        var snappingEnabled = this.#enableSnappingModifiers.length == 0 || this.#enableSnappingModifiers.some((e) => (state & e));

        if (!snappingEnabled) {
            return this.cancel();
        }

        const multiSnapEnabled = this.#enableMultiSnappingModifiers.some((e) => (state & e));

        // Find node at mouse position
        let node = this.tree.findNodeAtPosition(x, y);
        if (!node) {
            if(!multiSnapEnabled){
                return this.cancel();
            }

            return OperationResult.notHandled();
        }

        // activate the region to snap into
        this.showRegions = true;

        if(!multiSnapEnabled) {
            this.tree.forSelfAndDescendants(n => {
                n.isSnappingDestination = false;
                n.isHighlighted = false;
            });
            this.tree.insetNode = null;
        } else {
            const multisnapRect = this.multisnapRect();
            if(!this.tree.insetNode){
                this.tree.insetNode = new LayoutNode(0);
                this.tree.insetNode.parent = this.tree;            
                this.tree.insetNode.margin = node.margin;
                this.tree.insetNode.isSnappingDestination = true;
                this.tree.insetNode.isHighlighted = true;
            }            
            this.tree.insetNode.rect = multisnapRect;
        }

        node.isSnappingDestination = true;
        node.isHighlighted = true;

        return OperationResult.handledAndRedraw();
    }

    multisnapRect() {
        let snapToNodes = this.tree.findAllNodes(n => n.isSnappingDestination);

        if (snapToNodes.length == 0) {
            return null;
        }

        return snapToNodes
            .map((n) => n.rect)
            .reduce((rect_a, rect_b) => {
                let min_x = Math.min(rect_a.x, rect_b.x);
                let min_y = Math.min(rect_a.y, rect_b.y);
                let max_x = Math.max(
                    rect_a.x + rect_a.width,
                    rect_b.x + rect_b.width,
                );
                let max_y = Math.max(
                    rect_a.y + rect_a.height,
                    rect_b.y + rect_b.height,
                );

                return {
                    x: min_x,
                    y: min_y,
                    width: max_x - min_x,
                    height: max_y - min_y,
                };
            });
    }

    currentSnapToRect() {        
        if(this.tree.insetNode){
            return this.tree.insetNode.snapRect();
        }

        const snapToNode = this.tree.findNode(n => n.isSnappingDestination);
        if (!snapToNode) {
            return null;
        }
        return snapToNode.snapRect();
    }

    cancel() {
        this.tree.insetNode = null;

        if (this.showRegions) {
            this.showRegions = false;
            this.tree.forSelfAndDescendants(n => {
                n.isSnappingDestination = false;
                n.isHighlighted = false;
            });

            return OperationResult.handledAndRedraw();
        }

        return OperationResult.notHandled();
    }
}


// the user can increase the spacings between the layoutregions
class MarginsOperation extends LayoutOperation {
    _marginMin = 0;
    _marginMax = 20;

    constructor(tree) {
        super(tree);
    }

    onKeyPress(x, y, state, key) {

        if (key === Clutter.KEY_Page_Up) {
            this.tree.forDescendants(n => {
                n.margin = Math.max(Math.min(n.margin + 1, this._marginMax), this._marginMin);
            });
            this.tree.calculateRects();
            return OperationResult.handledAndRedraw();
        }
        if (key === Clutter.KEY_Page_Down) {
            this.tree.forDescendants(n => {
                n.margin = Math.max(Math.min(n.margin - 1, this._marginMax), this._marginMin);
            });
            this.tree.calculateRects();
            return OperationResult.handledAndRedraw();
        }
        return OperationResult.notHandled();
    }
}

// the user can press a preset number to quickly apply a layout
class PresetShortcutOperation extends LayoutOperation {
    #presets;
    #onUsePreset;

    constructor(tree, presets, onUsePreset) {
        super(tree);
        this.#presets = presets;
        this.#onUsePreset = onUsePreset;
    }

    onKeyPress(x, y, state, key) {
        if (key === Clutter.KEY_1) {
            this.#onUsePreset(this.#presets[0]);
        } else if (key === Clutter.KEY_2) {
            this.#onUsePreset(this.#presets[1]);
        } else if (key === Clutter.KEY_3) {
            this.#onUsePreset(this.#presets[2]);
        } else if (key === Clutter.KEY_4) {
            this.#onUsePreset(this.#presets[3]);
        } else if (key === Clutter.KEY_5) {
            this.#onUsePreset(this.#presets[4]);
        } else if (key === Clutter.KEY_6) {
            this.#onUsePreset(this.#presets[5]);
        } else if (key === Clutter.KEY_7) {
            this.#onUsePreset(this.#presets[6]);
        } else if (key === Clutter.KEY_8) {
            this.#onUsePreset(this.#presets[7]);
        } else {
            return OperationResult.notHandled();
        }
        return OperationResult.handledAndRedraw();
    }
}

// Export the module
module.exports = {
    LayoutNode,
    LayoutOperation,
    ResizeOperation,
    PreviewSplitOperation,
    SnappingOperation,
    MarginsOperation,
    PresetShortcutOperation
}; 
