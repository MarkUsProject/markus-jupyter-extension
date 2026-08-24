"""Local-only JupyterHub config, portable across Windows/macOS/Linux.

Not part of the published extension -- see the "Install the extension for development" section of README.md.
"""

import pathlib

from jupyterhub.spawner import LocalProcessSpawner

# DummyAuthenticator accepts any username with any password.
# Leaving `password` unset (rather than "") means no
# password check happens at all.
c.JupyterHub.authenticator_class = "dummy"


class PortableLocalProcessSpawner(LocalProcessSpawner):
    """LocalProcessSpawner assumes a POSIX multi-user host: it looks up each
    Hub user's home directory/shell via the stdlib `pwd` module, and drops
    subprocess privileges to that user's OS account via a `preexec_fn`
    passed to Popen. `pwd` doesn't exist on Windows at all, and Windows'
    process-creation API has no fork/preexec_fn equivalent (Popen raises
    ValueError for a non-None preexec_fn there, regardless of what the
    function does) -- so unconditionally overriding both here is required
    for Windows, not just an option.

    On macOS/Linux this override isn't strictly necessary (both work fine
    natively there), but it's also harmless: since this is a single-desktop
    dev setup (DummyAuthenticator, not real per-user OS accounts), there's
    nothing meaningful to drop privileges to on any platform -- every
    spawned single-user server just runs as whichever user is already
    running the Hub. Applying the same override unconditionally, rather
    than branching per-OS, keeps this simple and matches that intent.
    """

    def make_preexec_fn(self, name):
        return None

    def user_env(self, env):
        env["USER"] = self.user.name
        return env


# Spawner.env_keep defaults to a near-empty allowlist (deliberately, so
# secrets like CONFIGPROXY_AUTH_TOKEN in the Hub's own environment don't leak
# into spawned servers) -- but that also strips variables the OS itself
# needs for basic process behavior: SystemRoot on Windows (WSAStartup,
# underneath asyncio's own _overlapped extension, fails without it -- the
# spawned single-user server crashes on startup with "OSError: [WinError
# 10106] The requested service provider could not be loaded or initialized"
# before it even gets to running any Jupyter code) and HOME on macOS/Linux
# (relied on pervasively -- shell/tooling config resolution, `~/.jupyter`,
# `~/.local`, etc.). Listing a variable that doesn't exist in the current
# process's own environment is a harmless no-op (jupyterhub's own
# `get_env()` only copies keys that are actually present), so one combined
# list covering every platform's essentials is safe -- no OS branching
# needed.
c.Spawner.env_keep = [
    # Common / POSIX (macOS, Linux)
    "HOME",
    "LANG",
    "LC_ALL",
    "SHELL",
    "LOGNAME",
    # Windows
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    # Needed on every platform
    "PATH",
    "TEMP",
    "TMP",
]


# Spawns each user's single-user server as a local OS process -- no Docker/
# Kubernetes required. Run this config via `uv run jupyterhub` (not bare
# `jupyterhub`) so the spawned `jupyterhub-singleuser` process inherits the
# same PATH uv sets up, and so it resolves to this project's own .venv
# (where both `jupyterlab` and `jupyterlab_markus_extension` are installed)
# rather than some other Python on the system.
c.JupyterHub.spawner_class = PortableLocalProcessSpawner

# Matches config/settings/development.yml's `jupyter_server.hosts` /
# `api_origin` on the MarkUs side.
c.JupyterHub.ip = "127.0.0.1"
c.JupyterHub.port = 8888

# JupyterHub launches its proxy (configurable-http-proxy, a Node package) via
# Python's subprocess machinery. On Windows this can't directly execute the
# `.CMD` wrapper pnpm generates for it (Popen requires a shell to interpret
# a .CMD/.bat file, and JupyterHub launches it without one) -- pointing
# straight at the real Node script sidesteps that entirely. On macOS/Linux,
# pnpm generates a plain executable shebang script instead (no .CMD
# involved), so this isn't fixing anything there, but invoking it the exact
# same way -- `node <script.js>` -- works identically and needs no
# platform branching either.
_chp_script = next(
    (pathlib.Path(__file__).parent / "node_modules" / ".pnpm").glob(
        "configurable-http-proxy@*/node_modules/configurable-http-proxy/bin/configurable-http-proxy"
    )
)
c.ConfigurableHTTPProxy.command = ["node", str(_chp_script)]
