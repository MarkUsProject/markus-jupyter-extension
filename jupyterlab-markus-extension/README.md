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

* Python 3.8+
* Node.js / npm or jlpm
* A running MarkUs instance with the Jupyter submission endpoint enabled
* A notebook containing valid MarkUs metadata

## Install the extension for development

From the root of this extension project, install the package in editable mode:

```bash
pip install -e .
```

Then install the JavaScript dependencies:

```bash
jlpm install
```

Build the extension:

```bash
jlpm build
```

If you are actively developing the extension, you can also use:

```bash
jlpm watch
```

In another terminal, run JupyterLab:

```bash
jupyter lab
```

If JupyterLab is already running, restart it after building the extension.

## Verify the extension is installed

Run:

```bash
jupyter labextension list
```

You should see an extension named:

```text
jupyterlab-markus-extension
```

## Notebook metadata

Each notebook that should be submitted to MarkUs must include top-level notebook metadata named `markus`.

The metadata must include:

* `url`: the base URL of the MarkUs server
* either `course_id` or `course`
* either `assignment_id` or `assignment`

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
jupyter lab
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

If your MarkUs instance runs under a relative URL root, include that in the MarkUs URL metadata and make sure it ends with a slash, for example:

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

Build the TypeScript package and labextension:

```bash
jlpm build
```

Build for production:

```bash
jlpm build:prod
```

Clean generated files:

```bash
jlpm clean
```

Clean all generated files, including the labextension output:

```bash
jlpm clean:all
```

## Uninstall

To uninstall the editable Python package:

```bash
pip uninstall jupyterlab-markus-extension
```

Then rebuild or restart JupyterLab as needed.

## Troubleshooting

### The Submit to MarkUs button does not appear

Run:

```bash
jupyter labextension list
```

Confirm that `jupyterlab-markus-extension` appears in the list.

If it does not, rebuild the extension:

```bash
jlpm build
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