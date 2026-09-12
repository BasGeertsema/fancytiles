const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Settings = imports.ui.settings;
const SignalManager = imports.misc.signalManager;
const St = imports.gi.St;

const { DefaultColors } = require('./drawing');
const { DragSession } = require('./drag-session');
const { GridEditor } = require('./grid-editor');
const { LayoutIO } = require('./io-utils');
const { LayoutNode } = require('./node_tree');

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

    // the display the active grid editor was opened for, or null when none is open
    #openEditorDisplayIdx = null;

    // the desktop that was active when the editor was opened, so closing it can restore that
    // desktop even if the user browsed to others via the edge-hover switcher in the meantime
    #openEditorDesktopIdx = null;

    // the active drag session, if any (null between drags)
    #dragSession = null;

    #layoutIO;

    // the layout trees for each display: { [displayIdx]: { default: LayoutNode, instances: { [desktopIdx]: LayoutNode } } }
    // 'default' is the desktop-agnostic layout used when the active desktop has no instance of
    // its own yet. 'instances' holds per-(display, desktop) layouts, created by editing that
    // desktop directly (including loading a preset onto it).
    #layouts = {};

    // the layout trees for each preset
    #presets = null;

    #signals = new SignalManager.SignalManager(null);

    #settings;

    #colors = DefaultColors;

    constructor(uuid) {
        this.#layoutIO = new LayoutIO(uuid);
        this.#connectWindowGrabs();
        this.#connectWorkspaceSwitch();

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

        if (this.#dragSession) {
            this.#dragSession.finish();
            this.#dragSession = null;
        }
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
        for (let displayIdx in this.#layouts) {
            const displayLayouts = this.#layouts[displayIdx];
            if (displayLayouts.default) {
                this.#layoutIO.saveLayoutForDisplay(displayIdx, displayLayouts.default);
            }
            for (let desktopIdx in displayLayouts.instances) {
                this.#layoutIO.saveLayoutForInstance(displayIdx, desktopIdx, displayLayouts.instances[desktopIdx]);
            }
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

        const desktopIdx = this.#getActiveDesktopIndex();
        let layout = this.#readOrCreateLayoutForDisplay(displayIdx);

        if (!this.#presets || this.#presets.length === 0) {
            this.#loadPresets();
        }

        const showGuideLines = this.#settings.settingsData.showGuideLines.value;

        this.#openEditorDisplayIdx = displayIdx;
        this.#openEditorDesktopIdx = desktopIdx;
        this.#gridEditor = new GridEditor(
            displayIdx,
            layout,
            this.#colors,
            this.#closeEditor.bind(this),
            this.#presets,
            showGuideLines,
            (direction) => this.#switchDesktop(direction)
        );
    }

    // Switch to the adjacent desktop (direction -1/+1), triggered by the editor's edge-hover
    // arrow. This goes through Cinnamon's normal workspace activation, so #onWorkspaceSwitched
    // picks it up the same way it would an external hotkey and refreshes the open editor.
    #switchDesktop(direction) {
        const wm = global.workspace_manager;
        const targetIdx = wm.get_active_workspace_index() + direction;
        if (targetIdx < 0 || targetIdx >= wm.get_n_workspaces()) return;

        wm.get_workspace_by_index(targetIdx).activate(global.get_current_time());
    }

    #closeEditor() {
        if (this.#gridEditor) {
            const openedOnDesktopIdx = this.#openEditorDesktopIdx;

            this.#openEditorDisplayIdx = null;
            this.#openEditorDesktopIdx = null;
            this.#gridEditor.destroy();
            this.#gridEditor = null;
            this.#saveLayouts();

            // Restore the desktop that was active when the editor was opened -- browsing to
            // other desktops via the edge-hover switcher (or an external hotkey) while editing
            // is just a peek, it shouldn't leave the user on a different desktop afterwards.
            if (typeof openedOnDesktopIdx === 'number' && openedOnDesktopIdx !== this.#getActiveDesktopIndex()) {
                const wm = global.workspace_manager;
                wm.get_workspace_by_index(openedOnDesktopIdx)?.activate(global.get_current_time());
            }
        }
    }

    // Cinnamon workspaces have no stable identity beyond their numeric index.
    #getActiveDesktopIndex() {
        return global.workspace_manager.get_active_workspace_index();
    }

    // ensure the { default, instances } container exists for a display and return it
    #getDisplayLayouts(displayIdx) {
        if (!this.#layouts[displayIdx]) {
            this.#layouts[displayIdx] = { default: null, instances: {} };
        }
        return this.#layouts[displayIdx];
    }

    // Resolve (and lazily load) the shared, desktop-agnostic layout for a display.
    #resolveDefaultLayout(displayIdx, displayLayouts, defaultLayout) {
        if (!displayLayouts.default) {
            displayLayouts.default = this.#layoutIO.loadLayoutForDisplay(displayIdx) || defaultLayout.clone();
        }
        return displayLayouts.default;
    }

    // read the layout for the given display, creating one if none exists yet.
    //
    // With per-desktop layouts disabled (the default -- matches the original, pre-desktop-aware
    // behaviour), this is just the one shared layout per display, regardless of desktop.
    //
    // With it enabled, resolution is per (display, desktop):
    //   1) an instance already cached/loaded for this (display, desktop)
    //   2) otherwise, this is the first time this desktop is resolved: clone the shared default
    //      as this desktop's own independent instance, so it diverges from here on instead of
    //      aliasing (and silently being mutated through) the same shared object as every other
    //      not-yet-customised desktop.
    #readOrCreateLayoutForDisplay(displayIdx, defaultLayout = LayoutOf2x2) {
        const displayLayouts = this.#getDisplayLayouts(displayIdx);

        if (!this.#settings.settingsData.enablePerDesktopLayouts.value) {
            return this.#resolveDefaultLayout(displayIdx, displayLayouts, defaultLayout);
        }

        const desktopIdx = this.#getActiveDesktopIndex();

        if (displayLayouts.instances[desktopIdx]) {
            return displayLayouts.instances[desktopIdx];
        }

        let instance = this.#layoutIO.loadLayoutForInstance(displayIdx, desktopIdx);
        if (instance) {
            displayLayouts.instances[desktopIdx] = instance;
            return instance;
        }

        instance = this.#resolveDefaultLayout(displayIdx, displayLayouts, defaultLayout).clone();
        displayLayouts.instances[desktopIdx] = instance;
        return instance;
    }

    #connectWindowGrabs() {
        this.#signals.connect(global.display, 'grab-op-begin',
            (display, screen, window, op) => this.#onGrabBegin(window, op));
        this.#signals.connect(global.display, 'grab-op-end',
            (display, screen, window, op) => this.#onGrabEnd(window, op));
    }

    #connectWorkspaceSwitch() {
        this.#signals.connect(global.workspace_manager, 'workspace-switched',
            () => this.#onWorkspaceSwitched());
    }

    // Keep an already-open grid editor in sync with the active desktop, so switching desktops
    // (via the user's own workspace hotkey) shows that desktop's layout immediately instead of
    // requiring a close/switch/reopen round-trip. The editor's modal overlay lives in
    // Main.uiGroup, not on any one desktop, so it simply stays on screen across the switch.
    #onWorkspaceSwitched() {
        if (!this.#gridEditor || typeof this.#openEditorDisplayIdx !== 'number') return;

        const layout = this.#readOrCreateLayoutForDisplay(this.#openEditorDisplayIdx);
        this.#gridEditor.switchToLayout(layout);
    }

    #onGrabBegin(window, op) {
        if (op !== Meta.GrabOp.MOVING || window.window_type !== Meta.WindowType.NORMAL) return;

        // A grab-begin while a session is alive is our own restart landing.
        if (this.#dragSession) {
            this.#dragSession.onGrabRestart(window);
            return;
        }

        // Fresh drag.
        this.#loadThemeColors();
        this.#dragSession = new DragSession({
            window,
            layoutFor: (i) => this.#readOrCreateLayoutForDisplay(i, LayoutOf2x2.clone()),
            options: this.#snapshotDragOptions(),
        });
    }

    #onGrabEnd(window, op) {
        if (!this.#dragSession) return;
        if (op !== Meta.GrabOp.MOVING || window.window_type !== Meta.WindowType.NORMAL) return;

        if (this.#dragSession.tryRestart()) return;  // session continues

        this.#dragSession.finish();
        this.#dragSession = null;
    }

    #snapshotDragOptions() {
        const s = this.#settings.settingsData;
        return {
            enableSnappingModifiers: mapModifierSettingToModifierType(s.enableSnappingModifiers.value),
            enableMultiSnappingModifiers: mapModifierSettingToModifierType(s.enableMultiSnappingModifiers.value),
            mergeAdjacentOnHover: s.mergeAdjacentOnHover.value,
            mergingRadius: s.mergingRadius.value,
            activateWithNonPrimaryButton: s.activateWithNonPrimaryButton.value,
            autoStartSnapping: s.autoStartSnapping.value,
        };
    }
}

module.exports = { Application, LayoutOf2x2 };
