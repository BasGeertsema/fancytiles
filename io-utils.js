const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// Import our modules
const NodeTree = require('./node_tree');

// IO operations for layouts
class LayoutIO {
    #uuid;

    constructor(uuid) {
        this.#uuid = uuid;
    }

    presetFileKey(presetIdx) {
        return `preset-${presetIdx}`;
    }

    displayFileKey(displayIdx) {
        return `display-${displayIdx}`;
    }

    #filePathForDisplay(displayIdx) {
        return this.#filePathForKey(this.displayFileKey(displayIdx));
    }

    #filePathForPreset(presetIdx) {
        return this.#filePathForKey(this.presetFileKey(presetIdx));
    }

    // get the path to the layout file for a specific key
    #filePathForKey(layoutKey) {
        let configDir = GLib.get_user_config_dir();
        let fancyTilesDir = Gio.File.new_for_path(configDir + '/' + this.#uuid);

        // Ensure directory exists
        if (!fancyTilesDir.query_exists(null)) {
            fancyTilesDir.make_directory_with_parents(null);
        }

        return configDir + '/' + this.#uuid + '/layout-' + layoutKey.replace(/[^0-9a-zA-Z\-_]/g, '_') + '.json';
    }


    // Save layout tree to file
    saveLayoutForDisplay(displayIdx, layout) {
        const integrityError = layout.getIntegrityError();
        if (integrityError) {
            global.logError('Invalid layout tree structure. Cannot save layout. ', integrityError);
            return false;
        }

        const filePath = this.#filePathForDisplay(displayIdx);
        return this.#saveToFile(layout, filePath);
    }

    saveLayoutForPreset(presetIdx, layout) {
        const integrityError = layout.getIntegrityError();
        if (integrityError) {
            global.logError('Invalid layout tree structure. Cannot save layout. ', integrityError);
            return false;
        }

        const filePath = this.#filePathForPreset(presetIdx);
        return this.#saveToFile(layout, filePath);
    }

    #saveToFile(layout, filePath) {
        try {
            let file = Gio.File.new_for_path(filePath);

            let jsonData = JSON.stringify(layout.toJSON(), null, 2);

            let [success, tag] = file.replace_contents(
                jsonData,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            if (!success) {
                global.logError('Failed to save layout to ' + filePath);
                return false;
            }

            return true;
        } catch (e) {
            global.logError('Error saving layout: ' + e.message);
            return false;
        }
    }

    loadLayoutForDisplay(displayIdx) {
        return this.#loadLayoutFromFile(this.#filePathForDisplay(displayIdx));
    }

    loadLayoutForPreset(presetIdx) {
        return this.#loadLayoutFromFile(this.#filePathForPreset(presetIdx));
    }

    // load layout for display from file, if any
    #loadLayoutFromFile(filePath) {
        try {
            let file = Gio.File.new_for_path(filePath);

            if (!file.query_exists(null)) {
                global.logError('no layout found for display ' + filePath);
                return null;
            }

            let [success, contents, _] = file.load_contents(null);

            if (success) {
                let jsonData = JSON.parse(contents);

                // Create and load the layout tree
                let layout = new NodeTree.LayoutNode().fromJSON(jsonData);

                const integrityError = layout.getIntegrityError();
                if (integrityError) {
                    global.logError('Invalid layout loaded from ' + filePath + ': ' + integrityError);
                    return null;
                }

                return layout;
            }
        } catch (e) {
            global.logError('Error loading layout: ' + e.message);
        }

        return null;
    }
}

// Export the module
module.exports = {
    LayoutIO
}; 