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

See [LICENSE](LICENSE) for the full text of the licence.
