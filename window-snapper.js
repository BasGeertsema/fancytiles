const Cairo = imports.cairo;
const Main = imports.ui.main;
const SignalManager = imports.misc.signalManager;
const St = imports.gi.St;

const { drawLayout } = require('./drawing');
const { snapToRect, getUsableScreenArea } = require('./window-utils');
const { SnappingOperation } = require('./node_tree');

// the WindowSnapper is used to snap a window to the given layout
// when the user is dragging a window to a new position and it 
// holds any of the #enableSnappingModifiers keys down the layout region where the mouse is
// hovering over will be highlighted. when the user ends the dragging
// whilst holding any of the #enableSnappingModifiers keys down the window will be snapped
// to the layout region.
class WindowSnapper {
    // UI actor
    #container
    #drawingArea;

    // the window that is being dragged and needs to be snapped
    #window;

    // the layout to use for the snapping operation
    #layout;

    // the snapping operation
    #snappingOperation;

    // the modifier key to enable snapping
    #enableSnappingModifiers;

    // the modifier key to enable snapping to multiple areas
    #enableMultiSnappingModifiers;

    // whether to merge adjacent regions when hovering over the shared border
    #enableAdjacentMerging;

    // the radius around the mouse position used for merging
    #mergingRadius; 

    #signals = new SignalManager.SignalManager(null);

    constructor(displayIdx, layout, window, enableSnappingModifiers, enableMultiSnappingModifiers, enableAdjacentMerging, mergingRadius) {
        // the layout to use for the snapping operation
        this.#layout = layout;

        // the window that is being dragged and needs to be snapped
        this.#window = window;

        // the modifier key to enable snapping
        this.#enableSnappingModifiers = enableSnappingModifiers;

        // the modifier key to enable snapping to multiple areas
        this.#enableMultiSnappingModifiers = enableMultiSnappingModifiers;

        // whether to merge adjacent regions when hovering over the shared border
        this.#enableAdjacentMerging = enableAdjacentMerging;

        this.#mergingRadius = mergingRadius;

        // get the size of the display
        let workArea = getUsableScreenArea(displayIdx);

        // drawing area for the snapping regions
        this.#container = new St.Bin({
            reactive: false,
            can_focus: false,
        });
        this.#container.set_size(workArea.width, workArea.height);
        this.#container.set_position(workArea.x, workArea.y);

        this.#drawingArea = new St.DrawingArea({
            reactive: false,
            can_focus: false
        });
        this.#drawingArea.connect('repaint', (area) => { this.#onRepaint(area); });
        this.#container.set_fill(true, true);
        this.#container.set_child(this.#drawingArea);

        Main.uiGroup.add_actor(this.#container);

        // ensure the layout is correct for the snap area
        this.#layout.calculateRects(workArea.x, workArea.y, workArea.width, workArea.height);
        this.#snappingOperation = new SnappingOperation(this.#layout, this.#enableSnappingModifiers, this.#enableMultiSnappingModifiers, this.#enableAdjacentMerging, this.#mergingRadius);

        this.#signals.connect(this.#window, 'position-changed', this.#onWindowMoved.bind(this));
    }

    // snap if the user wants to
    finalize() {
        const snappingRect = this.#snappingOperation.currentSnapToRect();
        if (snappingRect) {
            // the user wants to snap, resize the window to the region
            snapToRect(this.#window, snappingRect);
        }

        this.#snappingOperation.cancel();
        this.#snappingOperation = null;
    }

    destroy() {
        this.#signals.disconnectAllSignals();
        this.#signals = null;

        if (this.#snappingOperation) {
            this.#snappingOperation.cancel();
            this.#snappingOperation = null;
        }

        Main.uiGroup.remove_actor(this.#container);
        this.#container = null;
        this.#drawingArea = null;
        this.#layout = null;
    }

    #onRepaint(area) {
        let cr = area.get_context();

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        // Draw the layout  
        if (this.#snappingOperation && this.#snappingOperation.showRegions) {
            let [x, y] = area.get_transformed_position();
            drawLayout(
                cr,
                this.#snappingOperation.tree,
                { x: x, y: y, width: area.get_width(), height: area.get_height() },
                this.colors);
        }

        cr.$dispose();
    }

    #onWindowMoved(actor, event) {
        if (!this.#snappingOperation) {
            return;
        }

        let [x, y, state] = global.get_pointer();

        let result = this.#snappingOperation.onMotion(x, y, state);
        if (result && result.shouldRedraw) {
            if (this.#snappingOperation.showRegions) {
                this.#container.show();
            }
            this.#drawingArea.queue_repaint();
        }
    }
}

module.exports = { WindowSnapper }; 
