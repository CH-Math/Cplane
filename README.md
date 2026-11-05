# Cplane

Cplane allows the user to see planar vector fields.

Cplane visualises a given vector field, and can draw orbits, search for
equilibria and cycles. It runs client-side in a browser, and can be run
locally just by pointing the browser at the local HTML file.

The JavaScript engine has no dependencies: everything is coded from scratch
by hand.

The tool is for quick visualisation and easy deployment: one HTML page, one
script, one stylesheet and one background image — no build step, no server,
nothing to install.

## Saving systems

A system can be saved in the browser and given a name, and the saved ones are
listed in a drop-down. They live in the browser's local storage for the page,
which means two things: they are not visible from another browser or another
computer, and some browsers refuse to store anything for a page opened from
disk.

Both are handled by **export**: `export this system` writes the system in the
form to a `.json` file, and `import file` reads such a file back. A file holds
either one system or a whole collection, and it is ordinary JSON — readable,
diffable, and safe to edit by hand.

## Accuracy

Equilibria are classified from a numerical Jacobian, and cycles are found by
numerical search. That is enough to see what a system does, but Cplane is not
a computer algebra system. Results near degenerate or nearly tangent cases,
and any conclusion that rests on a close call, should be checked by hand.

## Licence

Cplane is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
A PARTICULAR PURPOSE.

The background image, `hearts3.png`, is original work by the author and is
covered by the same licence.

See [LICENSE](LICENSE) for the full text of the licence.
