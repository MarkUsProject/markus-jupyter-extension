"""Custom hatchling build hook -- not part of the built extension itself,
just a packaging-time fixup. Registered via
`[tool.hatch.build.hooks.custom]` in pyproject.toml.
"""

from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CleanStaleInstallJsonHook(BuildHookInterface):
    """Remove any install.json accidentally written into the labextension
    build output.

    `jupyter-builder develop --overwrite` symlinks
    `<env>/share/jupyter/labextensions/jupyterlab-markus-extension` directly
    at `jupyterlab_markus_extension/labextension/`. Any later editable
    install that writes the `install.json` shared-data file through that
    symlink plants a stray copy inside the source tree, which then collides
    with the top-level `install.json` mapped to the same wheel destination
    on the next build:

        ValueError: A second file is being added to the wheel archive at
        the same path: .../labextensions/jupyterlab-markus-extension/install.json

    Clearing it here, before hatchling's file selection runs, keeps builds
    reproducible regardless of what a previous dev install left behind.
    """

    def initialize(self, _version, _build_data):
        stray = Path(self.root) / "jupyterlab_markus_extension" / "labextension" / "install.json"
        stray.unlink(missing_ok=True)
