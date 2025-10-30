// Fancy Tiles is a Cinnamon extension that allows you to snap windows
// to regions in a very flexible layout. In particular, the layout does
// not have to be a regular grid where horizontal and vertical splits are
// always across the whole display.

const { Application } = require('./application');
const Main = imports.ui.main; // needed for Hotkey-Movement

const UUID = 'fancytiles@basgeertsema';
let application = null;

// Cinnamon extensions lifecycle functions

function init() {
}

function enable() {
    application = new Application(UUID);

    // Directional hotkeys (Super + Arrow Keys) to move the active window across Fancy Tiles regions; if no neighbor exists, move to the next monitor.
    const { moveWindowByDirection } = require('./directional-move');

    Main.keybindingManager.addHotKey('fancytiles-move-up', '<Super>up', () => moveWindowByDirection(UUID, 'up'));
    Main.keybindingManager.addHotKey('fancytiles-move-down', '<Super>down', () => moveWindowByDirection(UUID, 'down'));
    Main.keybindingManager.addHotKey('fancytiles-move-left', '<Super>left', () => moveWindowByDirection(UUID, 'left'));
    Main.keybindingManager.addHotKey('fancytiles-move-right', '<Super>right', () => moveWindowByDirection(UUID, 'right'));

    // Span mode (Super + Alt + Arrow Keys) to expand the window across multiple adjacent tiles in the given direction. Repeated presses extend further.
    Main.keybindingManager.addHotKey('fancytiles-span-up', '<Super><Alt>up', () => moveWindowByDirection(UUID, 'up',   { span: true }));
    Main.keybindingManager.addHotKey('fancytiles-span-down', '<Super><Alt>down', () => moveWindowByDirection(UUID, 'down', { span: true }));
    Main.keybindingManager.addHotKey('fancytiles-span-left', '<Super><Alt>left', () => moveWindowByDirection(UUID, 'left', { span: true }));
    Main.keybindingManager.addHotKey('fancytiles-span-right', '<Super><Alt>right', () => moveWindowByDirection(UUID, 'right',{ span: true }));
}

function disable() {
    // Remove added hotkeys
    Main.keybindingManager.removeHotKey('fancytiles-move-up');
    Main.keybindingManager.removeHotKey('fancytiles-move-down');
    Main.keybindingManager.removeHotKey('fancytiles-move-left');
    Main.keybindingManager.removeHotKey('fancytiles-move-right');
    Main.keybindingManager.removeHotKey('fancytiles-span-up');
    Main.keybindingManager.removeHotKey('fancytiles-span-down');
    Main.keybindingManager.removeHotKey('fancytiles-span-left');
    Main.keybindingManager.removeHotKey('fancytiles-span-right');

    if (application) {
        application.destroy();
        application = null;
    }
}

