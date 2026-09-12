// Fancy Tiles is a Cinnamon extension that allows you to snap windows
// to regions in a very flexible layout. In particular, the layout does
// not have to be a regular grid where horizontal and vertical splits are
// always across the whole display.

const { Application } = require('./application');

// Cinnamon calls init(meta) before enable() (which itself takes no arguments), so the uuid
// -- and with it, the per-installation config directory in LayoutIO -- must be captured here
// rather than hardcoded. Cinnamon enforces meta.uuid === the extension's own directory name,
// so this also transparently supports running a differently-named fork (e.g. for testing)
// side by side with the original install, each keeping its own separate saved state.
let uuid = null;
let application = null;

//
// Cinnamon extensions lifecycle functions
//

function init(meta) {
    uuid = meta.uuid;
}

function enable() {
    application = new Application(uuid);
}

function disable() {
    if (application) {
        application.destroy();
        application = null;
    }
}
