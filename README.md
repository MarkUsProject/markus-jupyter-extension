# markus-jupyter-extension

A Jupyter extension to support integration with [MarkUs](https://github.com/MarkUsProject/Wiki).

## Installation

This extension is available as a Python package.
To install it:

```console
$ pip install markus-jupyter-extension
```

Then install and enable the extension:

```console
$ jupyter nbextension install --py --user markus-jupyter-extension
$ jupyter nbextension enable --py --user markus-jupyter-extension
```

Ensure that the MarkUs instances that this extension will integrate with have included the host name of the server that is running your Jupyter instance.

For example, if you are installing this extension to a Jupyter instance running at www.my_jupyter.com, then make sure that 'my_jupyter.com' is included in the [`jupyter_server.hosts` settings](https://github.com/MarkUsProject/Wiki/blob/release/Configuration.md#markus-settings) on MarkUs.

## Development

To begin development on the extension, first clone this repository:

```console
$ git clone https://github.com/MarkUsProject/markus-jupyter-extension.git
```

Then go into the cloned repository and install the contained Python package in editable mode:

```console
$ pip install -e .
```

You'll also need to install Jupyter notebook:

```console
$ pip install notebook
```

### Check setup using `examples`

To test whether your extension is working properly:

1. Start the MarkUs server (see [MarkUs development instructions](https://github.com/MarkUsProject/Wiki/blob/master/Developer-Guide--Set-Up-With-Docker.md) for details).
2. Login as a student in MarkUs and go to the "Account Settings" page using the dropdown at the top-right of the website.
3. Copy the API key for the student.
4. Run the Jupyter notebook server from the `examples` directory:

   ```console
   $ cd examples
   $ jupyter notebook
   ```

5. The Jupyter front-end client should launch automatically in your web browser.
6. Create a new file called `markus-api-key.txt` and save the API key you copied in step 3.
7. Open the demo notebook. Optionally, you can run the notebook cell to see the notebook's metadata (including the `"markus"` metadata)
8. Click on the MarkUs icon button in the toolbar, which will submit the file to MarkUs.
9. If you then go back to MarkUs as the student, you should see the file submitted to the specified assignment.

## References

- [Jupyter notebook documentation: Custom front-end extensions](https://jupyter-notebook.readthedocs.io/en/stable/extending/frontend_extensions.html)
