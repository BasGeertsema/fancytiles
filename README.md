# Fancy Tiles

Fancy Tiles is a [Cinnamon](https://github.com/linuxmint/Cinnamon) Extension that snaps your windows to regions in a very flexible layout. This layout does not have to be a typical grid where horizontal and vertical lines span the screen and columns and rows do not have to be evenly distributed. This is inspired by the way [Fancy Zones](https://learn.microsoft.com/en-us/windows/powertoys/fancyzones) work in Windows.


## Install

Download the code in this repository and place it in the directory `~/.local/share/cinnamon/extensions/fancytiles@basgeertsema` . Or use the one-liner below to download and install directly.

```bash
mkdir ~/.local/share/cinnamon/extensions/fancytiles@basgeertsema && (curl -s -L https://github.com/BasGeertsema/fancytiles/archive/refs/heads/main.tar.gz | tar xvz -C ~/.local/share/cinnamon/extensions/fancytiles@basgeertsema --strip-components=1)
```

Open Cinnamon Extensions, click on the Fancy Tiles extension and click the '+' button to enable Fancy Tiles.

![Enable extensions](docs/enable-extensions.png)


## Quick start

After enabling the extension, press `<SUPER>+G` to open the layout editor. It will start with a 2x2 grid layout. Click and drag the dividers (the lines between regions) to resize the regions. If you want to split a region, press `<SHIFT>` or `<CTRL>` while hovering over the region to split the region horizontally or vertically. The dotted guide lines are located at 1/3, 1/2 and 2/3 along the axis. Use the `right mouse button` to remove dividers. Use `<Page Up>` and `<Page Down>` to increase or decrease the spacing between the regions.

After you have crafted your desired layout, exit the editor using `<SUPER>+G` or `<ESC>`.

![Layout editor](docs/layout-editor.png)

Now, start dragging a window and press the `<CTRL>` key. The layout will become visible. Hover your mouse over the region you want the window to snap to and release the mouse button. The window will now be snapped into place. When the mouse hovers over the border between two regions, these regions are merged into a single region into which the window will snap. In the settings you can change the modifier key or enable your secondary mouse button to show the layout.

If you want to make the snapping region even larger you can hold the `<ALT>` key and hover over adjacent regions to merge them all into a single large snapping region.

![Layout editor](docs/window-snapping.png)

## Loading and saving presets

There are 8 slots to hold layout presets. Presets 4-8 are read only _system presets_ and 1-4 are your _user presets_. When the layout editor is opened, press `<SPACE>` to view the presets, and click the preset you want to load. Similarly, press the `<ALT>` key to open the save preset dialog and select one of the four user slots that you want to save the current layout to.

## Per-desktop layouts

Disabled by default — enable "Use a different layout per virtual desktop" in the extension settings. Once enabled, each virtual desktop keeps its own layout, independent per display. Open the layout editor on the desktop you want to customize and pick a preset (or just edit the grid) — it's saved for that specific desktop as soon as you close the editor. With the setting disabled, all desktops share the single display layout, exactly as before.

The editor stays open across a desktop switch, so you don't need to close and reopen it to set up another desktop. Move the mouse to the left or right screen edge to reveal an arrow button that switches to the adjacent desktop; the editor immediately shows that desktop's layout. Switching with your own workspace hotkey while the editor is open works too, as long as it doesn't rely on the same keys the editor itself uses (`<CTRL>`/`<SHIFT>` for splitting). Closing the editor returns you to whichever desktop you started on, even if you browsed to others in the meantime.

Tip: you can quickly load presets by opening the layout editor and immediately press the slot number of your desired preset (1-8).