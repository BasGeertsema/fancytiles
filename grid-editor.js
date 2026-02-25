const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Dialog = imports.ui.dialog;
const Main = imports.ui.main;
const St = imports.gi.St;

const { drawLayout } = require('./drawing');
const { getUsableScreenArea } = require('./window-utils');
const { PreviewSplitOperation, ResizeOperation, MarginsOperation, PresetShortcutOperation } = require('./node_tree');

// the grid editor presents the user with a visual way of
// editing the layout tree. the user can resize layout regions (move dividers),
// split regions, add margins, and load and save presets.
class GridEditor {
    // grid properties
    #colors;
    #workArea;
    #presetTextColor;

    // the layout tree to edit
    #layoutTree;

    // the preset layouts. 0-3 are user presets, 4-7 are system presets
    #presets;

    // focused display index
    #displayIdx;

    // UI actors
    #modalBackground;
    #drawingArea;
    #infoDialog;
    #loadPresetDialog;
    #savePresetDialog;
    #presetAreas = [];

    // the callback to call when the editor is closed
    #onClose;

    // whether to show guide lines when splitting
    #showGuideLines;

    // operations on the layout tree
    #marginsOperation;
    #previewOperation;
    #resizeOperation;
    #presetShortcutOperation;

    constructor(displayIdx, layoutTree, colors, onClose, presets, showGuideLines) {
        this.#displayIdx = displayIdx;
        this.#layoutTree = layoutTree;
        this.#colors = colors;
        this.#onClose = onClose;
        this.#presets = presets;
        this.#showGuideLines = showGuideLines;

        // get the working area to occupy as a grid editor   
        // and resize the layout to fit the work area
        this.#workArea = getUsableScreenArea(this.#displayIdx);
        this.#layoutTree.calculateRects(this.#workArea.x, this.#workArea.y, this.#workArea.width, this.#workArea.height);

        // create a modal background with the drawing area as only child
        // the drawing area shows the layout tree visually
        this.#drawingArea = this.#createDrawingArea();
        this.#modalBackground = this.#createModalBackground(this.#workArea, this.#drawingArea);
        Main.pushModal(this.#modalBackground);
        Main.uiGroup.add_actor(this.#modalBackground);

        // the info dialog shows the keyboard shortcuts
        this.#infoDialog = this.#createInfoDialog();

        // the load preset dialog allows the user to load a preset
        this.#loadPresetDialog = this.#createLoadPresetDialog();
        this.#loadPresetDialog.hide();
        Main.uiGroup.add_actor(this.#loadPresetDialog);

        // the save preset dialog allows the user to save a preset
        this.#savePresetDialog = this.#createSavePresetDialog();
        this.#savePresetDialog.hide();
        Main.uiGroup.add_actor(this.#savePresetDialog);

        // get the themed color for the preset sequence number, that 
        // should give enough contrast with the themed snapping regions
        this.#presetTextColor = this.#loadPresetDialog.get_theme_node().get_foreground_color();

        // the operations to do when in the grid editor
        this.#previewOperation = new PreviewSplitOperation(this.#layoutTree, this.#workArea.width, this.#workArea.height, this.#showGuideLines);
        this.#resizeOperation = new ResizeOperation(this.#layoutTree, this.#workArea.width, this.#workArea.height);
        this.#marginsOperation = new MarginsOperation(this.#layoutTree);
        this.#presetShortcutOperation = new PresetShortcutOperation(this.#layoutTree, this.#presets, this.#usePreset.bind(this));

        this.#setupKeyBindings();
    }

    #createDrawingArea() {
        const area = new St.DrawingArea({
            reactive: true,
            can_focus: true
        });

        area.connect('repaint', (area) => { this.#onRepaint(area, this.#layoutTree); });
        area.connect('button-press-event', this.#onButtonPress.bind(this));
        area.connect('button-release-event', this.#onButtonRelease.bind(this));
        area.connect('motion-event', this.#onMotion.bind(this));
        area.connect('button-press-event', this.#onButtonPress.bind(this));

        return area;
    }

    #createModalBackground(workArea, child) {
        let background = new St.Bin({
            style_class: 'modal-background',
            reactive: true,
            can_focus: true,
            style: 'background-color: rgba(0, 0, 0, 0.5);',

            // modal behaviour with these properties
            track_hover: true,
            can_focus: true
        });

        background.set_position(workArea.x, workArea.y);
        background.set_size(workArea.width, workArea.height);
        background.connect('key-release-event', this.#onKeyRelease.bind(this));
        background.connect('key-press-event', this.#onKeyPress.bind(this));
        background.set_fill(true, true);
        background.set_child(child);

        background.connect('button-press-event', () => {
            // TODO: connect to the parent here
            // Close editor when clicking outside
            //closeEditor();
            return Clutter.EVENT_STOP;
        });

        return background;
    }

    #usePreset(layout) {
        // clone the preset and 'revert' the layout to this clone
        const currentMargin = this.#layoutTree.isLeaf() ? 0 : this.#layoutTree.children[0].margin;
        this.#layoutTree.revert(layout.clone());
        this.#layoutTree.forSelfAndDescendants((node) => node.margin = currentMargin);
        this.#layoutTree.calculateRects(this.#workArea.x, this.#workArea.y, this.#workArea.width, this.#workArea.height);
        this.#drawingArea.queue_repaint();
    }

    #createLoadPresetDialog() {
        let dialog = new St.BoxLayout({
            reactive: true,
            can_focus: true,
            style_class: 'dialog',
            vertical: true
        });

        // ensure that the ratio of the previews are roughly the same as the work area
        const ratio = this.#workArea.width / this.#workArea.height;
        const tileWidth = this.#workArea.width / 8;
        const tileHeight = tileWidth / ratio;
        const titleHeight = 100; // roughly the height of the title
        const dialogWidth = tileWidth * 4;
        const dialogHeight = tileHeight * 2 + titleHeight;

        dialog.set_size(dialogWidth, dialogHeight);
        dialog.set_position(
            this.#workArea.x + (this.#workArea.width - dialogWidth) / 2,
            this.#workArea.y + (this.#workArea.height - dialogHeight) / 2);

        dialog.add(new St.Label({
            text: 'Load Preset',
            style_class: 'confirm-dialog-title'
        }));

        // table with a 4x2 grid of drawing areas showing the preset
        let table = new St.Table({
            reactive: true,
            can_focus: true,
            style_class: 'dialog-content-box'
        });
        for (let x = 0; x < 4; x++) {
            for (let y = 0; y < 2; y++) {
                let element = new St.DrawingArea({
                    reactive: true,
                    can_focus: true
                });
                element.tree = this.#presets[y * 4 + x] || new LayoutNode(0);
                element.tree.forSelfAndDescendants((node) => node.margin = 0);
                element.presetNumber = y * 4 + x + 1;
                element.connect('repaint', (area) => { this.#onRepaintPreset(area); });
                element.connect('enter-event', (area) => { area.tree.forSelfAndDescendants((node) => node.isHighlighted = true); area.queue_repaint(); });
                element.connect('leave-event', (area) => { area.tree.forSelfAndDescendants((node) => node.isHighlighted = false); area.queue_repaint(); });
                element.connect('button-press-event', (area) => { this.#usePreset(area.tree); });
                table.add(element, { col: x, row: y });
                this.#presetAreas.push(element);
            }
        }

        dialog.add(table, { expand: true });
        return dialog;
    }

    #createSavePresetDialog() {
        let dialog = new St.BoxLayout({
            reactive: true,
            can_focus: true,
            style_class: 'dialog',
            vertical: true
        });

        const ratio = this.#workArea.width / this.#workArea.height;
        const tileWidth = this.#workArea.width / 8;
        const tileHeight = tileWidth / ratio;
        const titleHeight = 100; // roughly the height of the title
        const dialogWidth = tileWidth * 4;
        const dialogHeight = tileHeight * 1 + titleHeight;

        dialog.set_size(dialogWidth, dialogHeight);
        dialog.set_position(
            this.#workArea.x + (this.#workArea.width - dialogWidth) / 2,
            this.#workArea.y + (this.#workArea.height - dialogHeight) / 2);

        dialog.add(new St.Label({
            text: 'Save Preset',
            style_class: 'confirm-dialog-title'
        }));

        // table with a 4x1 grid of drawing areas showing the users presets to save
        let table = new St.Table({
            reactive: true,
            can_focus: true,
            style_class: 'dialog-content-box'
        });
        for (let x = 0; x < 4; x++) {
            let element = new St.DrawingArea({
                reactive: true,
                can_focus: true
            });
            element.tree = this.#presets[x] || new LayoutNode(0);
            element.tree.forSelfAndDescendants((node) => node.margin = 0);
            element.presetNumber = x + 1;
            element.connect('repaint', (area) => { this.#onRepaintPreset(area); });
            element.connect('enter-event', (area) => { area.tree.forSelfAndDescendants((node) => node.isHighlighted = true); area.queue_repaint(); });
            element.connect('leave-event', (area) => { area.tree.forSelfAndDescendants((node) => node.isHighlighted = false); area.queue_repaint(); });
            element.connect('button-press-event', (area) => {
                // clone the preset and 'revert' the layout to this clone                    
                const currentRect = area.tree.rect;
                area.tree.revert(this.#layoutTree.clone());
                area.tree.forSelfAndDescendants((node) => node.margin = 0);
                area.tree.calculateRects(currentRect.x, currentRect.y, currentRect.width, currentRect.height);
                area.queue_repaint();
            });
            table.add(element, { col: x, row: 0 });
            this.#presetAreas.push(element);
        }

        dialog.add(table, { expand: true });
        return dialog;
    }


    #createInfoDialog() {
        // Calculate center position        
        let dialogWidth = 600;
        let dialogHeight = 600;

        let dialogX = this.#workArea.x + ((this.#workArea.width - dialogWidth) / 2);  // Center horizontally
        let dialogY = this.#workArea.y + ((this.#workArea.height - dialogHeight) / 2); // Center vertically

        let dialog = new Dialog.Dialog(Main.uiGroup);
        dialog.set_position(dialogX, dialogY);
        dialog.set_size(dialogWidth, dialogHeight);
        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
            title: null,
            description:
                "<CTRL> / <SHIFT> = Divide in columns / rows\n" +
                "Drag divider to resize\nRight click = delete divider\n" +
                "<Page Up> / <Page Down> = Increase / Decrease spacing\n" +
                "<SPACE> / <ALT> = Load / save user preset\n" +
                "[1-8] = Load preset\n" +
                "<ESC> = Close editor"
        }));
        return dialog;
    }

    destroy() {
        // Pop modal mode
        Main.popModal(this.#modalBackground);

        // Remove from UI
        Main.uiGroup.remove_actor(this.#loadPresetDialog);
        Main.uiGroup.remove_actor(this.#savePresetDialog);
        Main.uiGroup.remove_actor(this.#infoDialog);
        Main.uiGroup.remove_actor(this.#modalBackground);

        this.#modalBackground = null;
        this.#drawingArea = null;
        this.#layoutTree = null;
        this.#loadPresetDialog = null;
        this.#infoDialog = null;
        this.#savePresetDialog = null;

        // Clean up key bindings
        this.#removeKeyBindings();
    }

    #setupKeyBindings() {
        Main.keybindingManager.addHotKey('fancytiles-close', 'Escape', this.#onEscapePressed.bind(this));
    }

    #removeKeyBindings() {
        Main.keybindingManager.removeHotKey('fancytiles-close');
    }

    #onEscapePressed() {
        this.#onClose(this);
    }

    #onRepaintPreset(area) {
        const cr = area.get_context();
        const tree = area.tree;

        // Clear the drawing area (make it transparent)
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        // Get the actor coordinates relative to its parent
        const buttonMargins = 10;
        const [actorX, actorY] = area.get_transformed_position();
        const [width, height] = area.get_size();
        tree.calculateRects(actorX + buttonMargins, actorY + buttonMargins, width - 2 * buttonMargins, height - 2 * buttonMargins);

        // Draw the layout
        drawLayout(
            cr,
            tree,
            { x: actorX + buttonMargins, y: actorY + buttonMargins, width: width - 2 * buttonMargins, height: height - 2 * buttonMargins },
            this.#colors,
            2);

        cr.setSourceRGBA(this.#presetTextColor.red, this.#presetTextColor.green, this.#presetTextColor.blue, this.#presetTextColor.alpha);
        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(72);
        const extents = cr.textExtents(area.presetNumber.toString());
        cr.moveTo(width * 0.9 - extents.width - buttonMargins, height * 0. + extents.height + buttonMargins + 10);
        cr.showText(area.presetNumber.toString());

        cr.$dispose();
    }

    #onRepaint(area, tree) {
        let cr = area.get_context();

        // Clear the drawing area (make it transparent)
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        // Get the actor coordinates relative to its parent
        let [actorX, actorY] = area.get_transformed_position();

        // Draw the layout
        drawLayout(cr, tree, { x: actorX, y: actorY }, this.#colors);

        // Draw split guide lines at 1/3, 1/2, and 2/3 of the region being split
        const previewNode = tree.findNode(n => n.isPreview);
        if (this.#showGuideLines && previewNode && previewNode.parent) {
            const parentRect = previewNode.splitGuideRect || previewNode.parent.rect;
            const isColumn = previewNode.isColumn();

            cr.save();
            const bc = this.#colors.border;
            cr.setSourceRGBA(bc.r, bc.g, bc.b, 0.35);
            cr.setLineWidth(1.5);
            cr.setDash([3, 6], 0);
            cr.setLineCap(Cairo.LineCap.ROUND);

            const margin = previewNode.margin;
            const px = parentRect.x - actorX;
            const py = parentRect.y - actorY;
            const pw = parentRect.width;
            const ph = parentRect.height;

            for (const frac of [1/3, 0.5, 2/3]) {
                if (isColumn) {
                    const lineX = px + pw * frac;
                    cr.moveTo(lineX, py + margin);
                    cr.lineTo(lineX, py + ph - margin);
                } else {
                    const lineY = py + ph * frac;
                    cr.moveTo(px + margin, lineY);
                    cr.lineTo(px + pw - margin, lineY);
                }
                cr.stroke();
            }

            cr.restore();
        }

        cr.$dispose();
    }

    #handleOperationResult(result) {
        if (result) {
            if (result.shouldRedraw) {
                this.#drawingArea.queue_repaint();
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    #onMotion(actor, event) {
        let [x, y, state] = global.get_pointer();

        return this.#handleOperationResult(
            this.#previewOperation.onMotion(x, y, state) ||
            this.#resizeOperation.onMotion(x, y, state)
        );
    }

    #onButtonPress(actor, event) {
        let [x, y, state] = global.get_pointer();

        return this.#handleOperationResult(
            this.#previewOperation.onButtonPress(x, y, state, event.get_button()) ||
            this.#resizeOperation.onButtonPress(x, y, state, event.get_button())
        );
    }

    #onButtonRelease(actor, event) {
        let [x, y, state] = global.get_pointer();

        return this.#handleOperationResult(
            this.#previewOperation.onButtonRelease(x, y, state, event.get_button()) ||
            this.#resizeOperation.onButtonRelease(x, y, state, event.get_button())
        );
    }

    #onKeyRelease(actor, event) {
        let [x, y] = global.get_pointer();
        const key = event.get_key_symbol();

        if (key === Clutter.KEY_space || key === Clutter.KEY_Alt_L || key === Clutter.KEY_Alt_R) {
            this.#loadPresetDialog.hide();
            this.#savePresetDialog.hide();
        }

        return this.#handleOperationResult(
            this.#previewOperation.onKeyRelease(x, y, event.get_state()) ||
            this.#resizeOperation.onKeyRelease(x, y, event.get_state())
        );
    }

    #onKeyPress(actor, event) {
        let [x, y, state] = global.get_pointer();
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_space) {
            this.#savePresetDialog.hide();
            this.#loadPresetDialog.show();
            for (let i = 0; i < this.#presetAreas.length; i++) {
                this.#presetAreas[i].queue_repaint();
            }
        }
        if (key === Clutter.KEY_Alt_L || key === Clutter.KEY_Alt_R) {
            this.#loadPresetDialog.hide();
            this.#savePresetDialog.show();
            for (let i = 0; i < this.#presetAreas.length; i++) {
                this.#presetAreas[i].queue_repaint();
            }
        }
        return this.#handleOperationResult(
            this.#previewOperation.onKeyPress(x, y, state, key) ||
            this.#resizeOperation.onKeyPress(x, y, state, key) ||
            this.#marginsOperation.onKeyPress(x, y, state, key) ||
            this.#presetShortcutOperation.onKeyPress(x, y, state, key)
        );
    }
}

module.exports = { GridEditor }; 