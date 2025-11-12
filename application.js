const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Settings = imports.ui.settings;
const SignalManager = imports.misc.signalManager;
const St = imports.gi.St;

const { DefaultColors } = require('./drawing');
const { GridEditor } = require('./grid-editor');
const { LayoutIO } = require('./io-utils');
const { LayoutNode } = require('./node_tree');
const { WindowSnapper } = require('./window-snapper');

// a hardcoded layout for 2x2 layout as default
const LayoutOf2x2 = new LayoutNode(0, [
    new LayoutNode(0.5, [
        new LayoutNode(-0.5), new LayoutNode(0)
    ]),
    new LayoutNode(0, [
        new LayoutNode(-0.5), new LayoutNode(0)
    ])
]);

const LayoutOf3x2 = new LayoutNode(0, [
    new LayoutNode(1 / 3, [
        new LayoutNode(-0.5), new LayoutNode(0)
    ]),
    new LayoutNode(2 / 3, [
        new LayoutNode(-0.5), new LayoutNode(0)
    ]),
    new LayoutNode(0, [
        new LayoutNode(-0.5), new LayoutNode(0)
    ])
]);

const LayoutOf3x3 = new LayoutNode(0, [
    new LayoutNode(1 / 3, [
        new LayoutNode(-1 / 3), new LayoutNode(-2 / 3), new LayoutNode(0)
    ]),
    new LayoutNode(2 / 3, [
        new LayoutNode(-1 / 3), new LayoutNode(-2 / 3), new LayoutNode(0)
    ]),
    new LayoutNode(0, [
        new LayoutNode(-1 / 3), new LayoutNode(-2 / 3), new LayoutNode(0)
    ])
]);

const LayoutOf2x3 = new LayoutNode(0, [
    new LayoutNode(0.5, [
        new LayoutNode(-1 / 3), new LayoutNode(-2 / 3), new LayoutNode(0)
    ]),
    new LayoutNode(0, [
        new LayoutNode(-1 / 3), new LayoutNode(-2 / 3), new LayoutNode(0)
    ])
]);

function getFocusedDisplay() {
    let focusWindow = global.display.focus_window;
    if (!focusWindow) {
        global.logError('No focused window');
        return;
    }

    // Get the display index instead of monitor
    return focusWindow.get_monitor();
}

function mapModifierSettingToModifierType(modifierSetting) {
    switch(modifierSetting) {
        case 'CTRL':
            return [Clutter.ModifierType.CONTROL_MASK];
        case 'ALT':
            return [Clutter.ModifierType.MOD1_MASK, Clutter.ModifierType.MOD5_MASK];
        case 'SUPER':
            return [Clutter.ModifierType.SUPER_MASK, Clutter.ModifierType.MOD4_MASK];
        case 'SHIFT':
            return [Clutter.ModifierType.SHIFT_MASK];
        default:
            return [];
    }
}

// The application class is only constructed once and is the main entry
// of the extension.
class Application {
    // the active grid editor
    #gridEditor = null;

    // the active window snappers for each monitor
    #windowSnappers = [];

    #layoutIO;

    // the layout trees for each display
    #layouts = {};

    // the layout trees for each preset
    #presets = null;

    #signals = new SignalManager.SignalManager(null);

    #settings;

    #colors = DefaultColors;

    constructor(uuid) {
        this.#layoutIO = new LayoutIO(uuid);
        this.#connectWindowGrabs();

        this.#settings = new Settings.ExtensionSettings(this, uuid);
        this.#settings.bindProperty(Settings.BindingDirection.IN, 'hotkey', 'hotkey', this.#enableHotkey);

        this.#loadThemeColors();
        this.#enableHotkey();
    }

    destroy() {
        this.#disableHotkey();
        this.#signals.disconnectAllSignals();
        this.#signals = null;

        if (this.#gridEditor) {
            this.#gridEditor.destroy();
            this.#gridEditor = null;
        }

        // Destroy all window snappers
        for (let snapper of this.#windowSnappers) {
            snapper.destroy();
        }
        this.#windowSnappers = [];
    }

    #loadThemeColors() {
        // hidden element to fetch the styling
        let stylingActor = new St.DrawingArea({
            style_class: 'tile-preview tile-hud',
            visible: false
        });
        global.stage.add_actor(stylingActor);

        let bgColor = stylingActor.get_theme_node().get_background_color();
        if (bgColor) {
            this.#colors.background = {
                r: bgColor.red / 255,
                g: bgColor.green / 255,
                b: bgColor.blue / 255,
                a: bgColor.alpha / 255
            };
        }

        let borderColor = stylingActor.get_theme_node().get_border_color(St.Side.TOP);
        if (borderColor) {
            this.#colors.border = {
                r: borderColor.red / 128,
                g: borderColor.green / 128,
                b: borderColor.blue / 128,
                a: borderColor.alpha / 128
            };
        }

        // add the snap style class to get the highlighted colors
        stylingActor.add_style_class_name('snap');

        let highlightColor = stylingActor.get_theme_node().get_background_color();
        if (highlightColor) {
            this.#colors.highlight = {
                r: highlightColor.red / 255,
                g: highlightColor.green / 255,
                b: highlightColor.blue / 255,
                a: highlightColor.alpha / 255
            };
        }

        stylingActor.remove_style_class_name('snap');

        global.stage.remove_actor(stylingActor);
    }

    #disableHotkey() {
        Main.keybindingManager.removeHotKey('fancytiles');
    }

    #enableHotkey() {
        this.#disableHotkey();
        Main.keybindingManager.addHotKey('fancytiles', this.#settings.settingsData.hotkey.value, this.#toggleEditor.bind(this));
    }

    #saveLayouts() {
        for (let key in this.#layouts) {
            this.#layoutIO.saveLayoutForDisplay(key, this.#layouts[key]);
        }
        // save user presets
        for (let i = 0; i < 4; i++) {
            this.#layoutIO.saveLayoutForPreset(i, this.#presets[i]);
        }
    }

    #toggleEditor() {
        if (this.#gridEditor) {
            this.#closeEditor();
        } else {
            this.#openEditor();
        }
    }

    #loadPresets() {
        // load all user presets
        let userPresets = [];
        for (let i = 0; i < 4; i++) {
            const preset = this.#layoutIO.loadLayoutForPreset(i) || new LayoutNode(0);
            userPresets.push(preset);
        }

        // load the system preset
        this.#presets = [
            ...userPresets,
            LayoutOf2x2.clone(),
            LayoutOf3x2.clone(),
            LayoutOf2x3.clone(),
            LayoutOf3x3.clone()
        ];
    }

    #openEditor() {
        const displayIdx = getFocusedDisplay();
        if (typeof displayIdx !== 'number') {
            global.logError('No focused display');
            return;
        }

        let layout = this.#readOrCreateLayoutForDisplay(displayIdx);

        if (!this.#presets || this.#presets.length === 0) {
            this.#loadPresets();
        }

        this.#gridEditor = new GridEditor(
            displayIdx,
            layout,
            this.#colors,
            this.#closeEditor.bind(this),
            this.#presets
        );
    }

    #closeEditor() {
        if (this.#gridEditor) {
            this.#gridEditor.destroy();
            this.#gridEditor = null;
            this.#saveLayouts();
        }
    }

    // read the layout from the configuration file, or set the default
    #readOrCreateLayoutForDisplay(displayIdx, defaultLayout = LayoutOf2x2.clone()) {
        if (this.#layouts[displayIdx]) {
            return this.#layouts[displayIdx];
        }

        let tree = this.#layoutIO.loadLayoutForDisplay(displayIdx);
        if (!tree) {
            tree = defaultLayout;
        }
        this.#layouts[displayIdx] = tree;
        return tree;
    }

    #connectWindowGrabs() {
        // start snapping when the user starts moving a window
        this.#signals.connect(global.display, 'grab-op-begin', (display, screen, window, op) => {
            if (op === Meta.GrabOp.MOVING && window.window_type === Meta.WindowType.NORMAL) {
                // reload styling
                this.#loadThemeColors();
                const enableSnappingModifiers = mapModifierSettingToModifierType(this.#settings.settingsData.enableSnappingModifiers.value);
                const enableMultiSnappingModifiers = mapModifierSettingToModifierType(this.#settings.settingsData.enableMultiSnappingModifiers.value);
                const enableMergeAdjacentOnHover = this.#settings.settingsData.mergeAdjacentOnHover.value;
                const mergingRadius = this.#settings.settingsData.mergingRadius.value;
                const activateWithNonPrimaryButton = this.#settings.settingsData.activateWithNonPrimaryButton.value;

                // Create WindowSnapper for each monitor
                const nMonitors = global.display.get_n_monitors();
                for (let i = 0; i < nMonitors; i++) {
                    const layout = this.#readOrCreateLayoutForDisplay(i, LayoutOf2x2);
                    const snapper = new WindowSnapper(i, layout, window, enableSnappingModifiers, enableMultiSnappingModifiers, enableMergeAdjacentOnHover, mergingRadius, activateWithNonPrimaryButton);
                    this.#windowSnappers.push(snapper);
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // stop snapping when the user stops moving a window
        this.#signals.connect(global.display, 'grab-op-end', (display, screen, window, op) => {
            if (op === Meta.GrabOp.MOVING && window.window_type === Meta.WindowType.NORMAL) {
                // Finalize and destroy all window snappers
                for (let snapper of this.#windowSnappers) {
                    snapper.finalize();
                    snapper.destroy();
                }
                this.#windowSnappers = [];
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }
}

module.exports = { Application, LayoutOf2x2 };
