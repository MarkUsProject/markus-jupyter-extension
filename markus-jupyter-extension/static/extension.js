define(["require", "base/js/namespace", "base/js/dialog"], function (
  requirejs,
  Jupyter,
  dialog
) {
  const ACTION_PREFIX = "markus";
  const ACTION_NAME = "markus_submit";
  const SUBMIT_LABEL = "Submit to MarkUs";
  const DEFAULT_API_KEY_PATH = "markus-api-key.txt";

  /**
   * Initialize this extension. This creates a new button in the Jupyter toolbar for
   * triggering a submission to MarkUs.
   */
  function initialize() {
    const action = {
      icon: "fa-markus",
      label: SUBMIT_LABEL,
      help: SUBMIT_LABEL,
      help_index: "zz",
      handler: submitToMarkus,
    };

    const full_action_name = Jupyter.actions.register(
      action,
      ACTION_NAME,
      ACTION_PREFIX
    );
    const new_group = Jupyter.toolbar.add_buttons_group([full_action_name])[0];
    const logo = document.createElement("img");
    logo.src = requirejs.toUrl("./assets/markus.ico");
    logo.style = "vertical-align: top;";
    logo.width = "16";
    new_group.firstChild.prepend(logo);
  }

  /**
   * Submit the currently open file to MarkUs. Relies on the following notebook metadata:
   * "markus": {
   *   "url": url for MarkUs,
   *   "course_id": the id of the course in MarkUs,
   *   "assessment_id": the id of the assessment in MarkUs
   * }
   */
  function submitToMarkus() {
    // Construct URL from MarkUs metadata
    const markus_metadata = Jupyter.notebook.metadata.markus;
    let submitUrl;
    try {
      submitUrl = getSubmitUrl(markus_metadata);
    } catch (e) {
      report_error(e);
      return;
    }

    // Get API key from file
    const api_key_path = markus_metadata.api_key_path || DEFAULT_API_KEY_PATH;

    fetchApiKey(api_key_path).then(
      (apiKey) => submitFile(submitUrl, apiKey),
      report_error
    );
  }

  /**
   * Returns a promise that resolves to the user's MarkUs API key.
   * First checks the current directory, and then (if not found) checks
   * the Jupyter home directory.
   *
   * @param {string} api_key_path
   * @returns {Promise}
   */
  function fetchApiKey(api_key_path) {
    return fetch(`files/${api_key_path}?download=1`)
      .then((response) => {
        if (response.ok) {
          return response.text();
        } else if (response.status === 404) {
          throw Error(
            `Could not find MarkUs API key file ${api_key_path} in current directory.`
          );
        } else {
          throw Error(
            `Encountered unexpected error (${response.statusText}) when loading MarkUs API key file ${api_key_path} in current directory.`
          );
        }
      })
      .catch((e) => {
        console.info(`markus-jupyter-extension: ${e.message}`);
        console.info(
          `markus-jupyter-extension: Searching for MarkUs API key in home directory.`
        );
        return fetch(`/files/${api_key_path}?download=1`).then((response) => {
          if (response.ok) {
            return response.text();
          } else if (response.status === 404) {
            throw Error(
              `Could not find MarkUs API key file ${api_key_path} in home directory.`
            );
          } else {
            throw Error(
              `Encountered unexpected error (${response.statusText}) when loading MarkUs API key file ${api_key_path} from home directory.`
            );
          }
        });
      });
  }

  /**
   * Constructs the MarkUs URL to submit the notebook file to.
   * Raises an error if URL cannot be constructed from the metadata.
   *
   * @param {object} markusMetadata
   * @returns {URL} the URL to submit to
   */
  function getSubmitUrl(markusMetadata) {
    if (markusMetadata === undefined) {
      throw 'Notebook metadata is missing the "markus" key.';
    }

    let { url, course_id, assessment_id } = markusMetadata;

    if (!url || !course_id || !assessment_id) {
      throw 'Notebook metadata is missing one or more of the following keys under "markus": "url", "course_id", or "assessment_id".';
    }

    course_id = parseInt(course_id);
    assessment_id = parseInt(assessment_id);

    if (isNaN(course_id) || isNaN(assessment_id)) {
      throw 'Notebook metadata "course_id" and "assessment_id" values must be numbers.';
    }

    let submitUrl;
    try {
      submitUrl = new URL(
        url +
          "/api/courses/" +
          course_id +
          "/assignments/" +
          assessment_id +
          "/submit_file"
      );
    } catch {
      throw (
        "Notebook metatdata did not specify a valid MarkUs URL. Parameters: " +
        JSON.stringify({
          url: url,
          course_id: course_id,
          assessment_id: assessment_id,
        })
      );
    }

    return submitUrl;
  }

  /**
   * Submit the current file to MarkUs.
   * @param {URL} submitUrl The URL to submit to.
   * @param {string} key The MarkUs API key to use.
   */
  function submitFile(submitUrl, key) {
    key = key.trim();
    submitUrl = submitUrl.toString();

    const filename = Jupyter.notebook.notebook_name;
    const content = JSON.stringify(Jupyter.notebook.toJSON());
    const formData = new FormData();
    formData.append("filename", filename);
    formData.append("file_content", new Blob([content]));
    formData.append("mime_type", "application/x-ipynb+json");

    console.info(
      `markus-jupyter-extension: Submitting file ${filename} to ${submitUrl}`
    );
    fetch(submitUrl, {
      method: "POST",
      headers: {
        AUTHORIZATION: "MarkUsAuth " + key,
        Accept: "application/json",
      },
      body: formData,
    }).then(handleMarkUsResponse, (err) => handleNetworkError(submitUrl, err));
  }

  /**
   * Handle MarkUs response after submitting file.
   * @param {*} response
   * @returns
   */
  function handleMarkUsResponse(response) {
    if (!response.ok) {
      response.json().then((body) => {
        report_error(
          "Received the following error from the MarkUs server: " +
            body.description
        );
      });
      return;
    }

    // Success dialog
    dialog.modal({
      title: "Submit to MarkUs",
      body: "Your file was submitted!",
      default_button: "Close",
      buttons: {
        Close: {},
      },
    });
  }

  /**
   * Report a network error.
   * @param {URL} submitUrl The URL to submit to.
   * @param {*} err
   */
  function handleNetworkError(submitUrl, err) {
    let msg;
    if (err.message === "NetworkError when attempting to fetch resource.") {
      msg = "Could not connect to MarkUs at " + submitUrl;
    } else {
      msg = err;
    }
    report_error(msg);
  }

  /**
   * Display error message in a modal and on console.error.
   * @param {string} msg
   */
  function report_error(msg) {
    console.error(msg);
    dialog.modal({
      title: "Submit to MarkUs",
      body: "[ERROR] Could not submit file to MarkUs. Cause: " + msg,
      default_button: "Close",
      buttons: {
        Close: {},
      },
    });
  }

  /**
   * This is the entrypoint of this extension, exported as load_ipython_extension
   * and load_jupyter_extension by this module.
   */
  function load_jupyter_extension() {
    return Jupyter.notebook.config.loaded.then(initialize);
  }

  return {
    load_ipython_extension: load_jupyter_extension,
    load_jupyter_extension: load_jupyter_extension,
  };
});
