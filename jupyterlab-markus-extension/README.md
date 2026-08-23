# JupyterLab MarkUs Extension

This JupyterLab extension adds a **Submit to MarkUs** button to the notebook toolbar. When clicked, it asks MarkUs to fetch the currently open notebook from JupyterHub/Jupyter Server and submit it to the correct MarkUs assignment.

## Overview

The extension reads MarkUs submission metadata from the notebook, saves the notebook, and sends a request to MarkUs at:

```text
POST /jupyter/submit
```

MarkUs then uses the Jupyter token and notebook path to fetch the file from JupyterHub/Jupyter Server and store it as a submitted file.

## Requirements

This extension requires:

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) for managing the Python environment
- Node.js and [pnpm](https://pnpm.io/) for building the JavaScript/TypeScript source
- A running MarkUs instance with the Jupyter submission endpoint enabled
- A notebook containing valid MarkUs metadata

## Install the extension for development

From the root of this extension project, sync the Python environment (this pulls in JupyterLab and the build tooling, declared as a `dev` dependency group, which `uv sync` includes by default):

```bash
uv sync
```

Then install the JavaScript dependencies:

```bash
pnpm install
```

Build the extension:

```bash
uv run jupyter-builder build --development True .
```

If you are actively developing the TypeScript source, you can watch and recompile it on save in one terminal:

```bash
pnpm run watch
```

Note that `pnpm run watch` only recompiles `lib/`; it does not re-run the webpack/rspack bundling step, so after a source change you still need to re-run the `jupyter-builder build` command above (or the `pnpm run build` script, which does the same thing) before the browser will see it.

Next, tell JupyterLab where to find the built extension. This only needs to be done once per fresh `uv sync`/virtual environment:

```bash
uv run jupyter-builder develop . --overwrite
```

> **Windows note:** this command creates a symlink, which requires either [Developer Mode](https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development) to be enabled or an elevated (admin) shell. Without either, it fails with an `OSError` about symlink permissions. If you can't enable Developer Mode, use the underlying function directly with `symlink=False` (copies the files instead of linking them — you'll need to re-run it after every rebuild since it won't pick up changes automatically):
>
> ```bash
> uv run python -c "from jupyter_builder.federated_extensions import develop_labextension_py; develop_labextension_py('.', sys_prefix=True, overwrite=True, symlink=False)"
> ```

In another terminal, run JupyterLab:

```bash
uv run jupyter lab
```

If JupyterLab is already running, restart it after rebuilding the extension.

## Verify the extension is installed

Run:

```bash
uv run jupyter labextension list
```

You should see an extension named:

```text
jupyterlab-markus-extension
```

listed as `enabled ok`.

## Trusted MarkUs origins

Submitting a notebook sends the user's Jupyter API token to the MarkUs URL from the notebook's `markus` metadata. The extension setting `trustedOrigins` specifies a list of trusted MarkUs origins (default `["https://markus.teach.cs.toronto.edu"]`)

To override it for a single user, open **Settings > Settings Editor > Submit to MarkUs** in JupyterLab and set the MarkUs origin(s), for example:

```json
{
  "trustedOrigins": ["https://markus.example.com"]
}
```

To override it deployment-wide (recommended for a real deployment, so every user gets it automatically), add an `overrides.json` to JupyterLab's settings directory:

```json
{
  "jupyterlab-markus-extension:plugin": {
    "trustedOrigins": ["https://markus.example.com"]
  }
}
```

See the [JupyterLab documentation on settings overrides](https://jupyterlab.readthedocs.io/en/stable/user/directories.html#overridesjson) for where `overrides.json` should live.

An origin is the scheme, host, and port only (no path). A notebook's `markus.url` must resolve to one of the trusted origins, or the submission is rejected with an error naming the untrusted origin.

**Development only**: `http://localhost:3000` is also trusted, as this is the default MarkUs development origin (see [Local development with MarkUs](#local-development-with-markus)).

## Notebook metadata

Each notebook that should be submitted to MarkUs must include top-level notebook metadata named `markus`.

The metadata must include:

- `url`: the base URL of the MarkUs server
- either `course_id` or `course`
- either `assignment_id` or `assignment`

The meaning of each field is:

| Field              | Meaning                                    |
| ------------------ | ------------------------------------------ |
| `url`              | Base URL of the MarkUs server              |
| `course_id`        | MarkUs `Course.id`                         |
| `course`           | MarkUs `Course.name`                       |
| `assignment_id`    | MarkUs `Assignment.id`                     |
| `assignment`       | MarkUs assignment `short_identifier`       |
| `destination_path` | Optional submitted filename/path in MarkUs |

Use either the ID form or the name/identifier form, but not both for the same item.

### Example using IDs

```json
{
  "markus": {
    "url": "http://localhost:3000/",
    "course_id": 1,
    "assignment_id": 2,
    "destination_path": "assignment1.ipynb"
  }
}
```

### Example using course name and assignment short identifier

```json
{
  "markus": {
    "url": "http://localhost:3000/",
    "course": "csc108",
    "assignment": "a1",
    "destination_path": "assignment1.ipynb"
  }
}
```

If `destination_path` is not provided, the extension sends the current notebook name as the submitted filename.

## MarkUs backend route

The MarkUs backend should define the Jupyter submission route under the `jupyter` namespace, not the `api` namespace.

In `config/routes.rb`:

```ruby
namespace :jupyter do
  post 'submit', to: 'submissions#submit'
end
```

This maps to:

```text
POST /jupyter/submit
```

and should be handled by:

```text
app/controllers/jupyter/submissions_controller.rb
```

with:

```ruby
module Jupyter
  class SubmissionsController < ApplicationController
    def submit
      # ...
    end
  end
end
```

## MarkUs Jupyter settings

MarkUs should use application settings for JupyterHub/Jupyter Server configuration instead of hardcoded environment variables.

Add a `jupyter_server` namespace to the MarkUs settings file, for example:

```yml
jupyter_server:
  api_origin:
  dev_username:
```

For local development, this may look like:

```yml
jupyter_server:
  api_origin: "http://localhost:8888"
  dev_username: "student_user_name"
```

`api_origin` should point to the JupyterHub/Jupyter Server origin used by MarkUs to fetch user identity and notebook content.

`dev_username` is only for local development when running standalone JupyterLab without a real JupyterHub identity endpoint.

## Local development with MarkUs

A typical local setup is:

1. Start MarkUs.
2. Start JupyterLab.
3. Open a notebook.
4. Add the required `markus` metadata.
5. Click **Submit to MarkUs** in the notebook toolbar.

Example:

```bash
# Terminal 1: MarkUs
bin/rails server
```

```bash
# Terminal 2: JupyterLab
uv run jupyter lab
```

The notebook metadata `url` should point to your MarkUs server, for example:

```json
{
  "markus": {
    "url": "http://localhost:3000/",
    "course": "csc108",
    "assignment": "a1"
  }
}
```

If your MarkUs instance runs under a relative URL root, include that in the MarkUs URL metadata, for example:

```json
{
  "markus": {
    "url": "http://localhost:3000/csc108/",
    "course": "csc108",
    "assignment": "a1"
  }
}
```

The extension uses this value as a base URL and sends the request to:

```text
jupyter/submit
```

relative to that base URL.

## Build commands

Build the TypeScript package and labextension (development mode):

```bash
pnpm run build
```

Build for production:

```bash
pnpm run build:prod
```

Clean generated files:

```bash
pnpm run clean
```

Clean all generated files, including the labextension output:

```bash
pnpm run clean:all
```

## Uninstall

To remove the extension from a JupyterLab environment, delete the labextension symlink (or copy) that `jupyter-builder develop` created under the virtual environment's `share` directory:

```bash
rm -rf .venv/share/jupyter/labextensions/jupyterlab-markus-extension
```

Alternatively, just remove the project's `.venv` and re-sync without it, or start from a fresh virtual environment.

## Troubleshooting

### The Submit to MarkUs button does not appear

Run:

```bash
uv run jupyter labextension list
```

Confirm that `jupyterlab-markus-extension` appears in the list as `enabled ok`.

If it's missing entirely, JupyterLab likely doesn't know where to find the built extension yet — run the develop step (see [Install the extension for development](#install-the-extension-for-development)):

```bash
uv run jupyter-builder develop . --overwrite
```

If it's listed but stale, rebuild the extension:

```bash
uv run jupyter-builder build --development True .
```

Then restart JupyterLab.

### Missing notebook metadata error

Make sure the notebook has top-level metadata named `markus`.

The metadata must include:

```json
{
  "markus": {
    "url": "http://localhost:3000/",
    "course": "csc108",
    "assignment": "a1"
  }
}
```

or:

```json
{
  "markus": {
    "url": "http://localhost:3000/",
    "course_id": 1,
    "assignment_id": 2
  }
}
```

### MarkUs server error

Check that MarkUs has the Jupyter route:

```text
POST /jupyter/submit
```

Also confirm that the MarkUs URL in the notebook metadata is correct.

### Jupyter token error

The extension uses `PageConfig.getToken()` to provide a Jupyter token to MarkUs. If the Jupyter environment uses cookie or OAuth authentication without a token, token-based fetching may not work without additional backend support.

### "MarkUs origin is not trusted" / "No trusted MarkUs origins are configured"

The notebook's `markus.url` doesn't match any origin in the [trusted MarkUs origins](#trusted-markus-origins) setting. This is expected if you're submitting to a MarkUs deployment other than the standard one this extension defaults to (or someone has overridden `trustedOrigins` to an empty list). Add the MarkUs origin (scheme + host + port, no path) to the `trustedOrigins` setting for `jupyterlab-markus-extension:plugin`, then retry.

### User not found in MarkUs

The JupyterHub username must match a MarkUs `user_name`.

For local development, configure:

```yml
jupyter_server:
  dev_username: "student_user_name"
```

where `student_user_name` is an existing MarkUs user enrolled as a student in the selected course.

### Course or assignment not found

Check the notebook metadata.

Use either:

```json
"course_id": 1
```

or:

```json
"course": "csc108"
```

For assignments, use either:

```json
"assignment_id": 2
```

or:

```json
"assignment": "a1"
```

Do not use `assessment_id`; the extension uses `assignment_id` or `assignment`.

## Project naming

The extension package name is:

```text
jupyterlab-markus-extension
```

The Python package directory is:

```text
jupyterlab_markus_extension
```
