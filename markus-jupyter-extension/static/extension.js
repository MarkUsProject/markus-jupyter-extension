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
    const metadata = Jupyter.notebook.metadata;
    try {
      validateMetadata(metadata);
    } catch (e) {
      report_error(e);
      return;
    }

    const markusMetadata = metadata.markus;
    const submitUrl = getSubmitUrl(markusMetadata);

    // Get API key from file
    const api_key_path = markusMetadata.api_key_path || DEFAULT_API_KEY_PATH;

    fetchApiKey(api_key_path)
      .then((apiKey) => {
        return submitFile(submitUrl, apiKey);
      }, report_error)
      .then(
        (response) => handleMarkUsResponse(response, markusMetadata),
        (err) => handleNetworkError(submitUrl, err)
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
   * This assumes the metadata has already been validated.
   *
   * @param {object} markusMetadata
   * @returns {URL} the URL to submit to
   */
  function getSubmitUrl(markusMetadata) {
    let { url, course_id, assessment_id } = markusMetadata;
    return new URL(
      url +
        "/api/courses/" +
        course_id +
        "/assignments/" +
        assessment_id +
        "/submit_file"
    );
  }

  /**
   * Constructs the MarkUs URL to view an assessment (as a student).
   * This assumes the metadata has already been validated.
   *
   * @param {object} markusMetadata
   * @returns {URL} the assessment URL
   */
  function getAssessmentUrl(markusMetadata) {
    let { url, course_id, assessment_id } = markusMetadata;
    return new URL(
      url + "/courses/" + course_id + "/assignments/" + assessment_id
    );
  }

  /**
   * Validate whether the given notebook metadata has a valid MarkUs configuration.
   * A successful return means the notebook metadata has a valid configuration.
   * An error is raised if the configuration is invalid.
   *
   * @param {object} metadata
   * @returns {null}
   */
  function validateMetadata(metadata) {
    if (metadata["markus"] === undefined) {
      throw 'Notebook metadata is missing the "markus" key. Please check the metadata under Edit -> Edit Notebook Metadata.';
    }

    let { url, course_id, assessment_id } = metadata["markus"];

    if (!url || !course_id || !assessment_id) {
      throw 'Notebook metadata is missing one or more of the following keys under "markus": "url", "course_id", or "assessment_id". Please check the metadata under Edit -> Edit Notebook Metadata.';
    }

    course_id = parseInt(course_id);
    assessment_id = parseInt(assessment_id);

    if (isNaN(course_id) || isNaN(assessment_id)) {
      throw 'Notebook metadata "course_id" and "assessment_id" values must be numbers. Please check the metadata under Edit -> Edit Notebook Metadata.';
    }

    try {
      new URL(url);
    } catch {
      throw 'Notebook metatdata "url" value did not specify a valid URL. Please check the metadata under Edit -> Edit Notebook Metadata.';
    }
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

    return fetch(submitUrl, {
      method: "POST",
      headers: {
        AUTHORIZATION: "MarkUsAuth " + key,
        Accept: "application/json",
      },
      body: formData,
    });
  }

  /**
   * Handle MarkUs response after submitting file.
   * @param {*} response
   * @param {object} MarkUs metadata
   * @returns
   */
  function handleMarkUsResponse(response, metadata) {
    if (!response.ok) {
      response.json().then((body) => {
        report_error(
          "Received the following error from the MarkUs server: " +
            body.description
        );
      });
      return;
    }

    const assessmentUrl = getAssessmentUrl(metadata);
    const assessmentLink = document.createElement("a");
    assessmentLink.setAttribute("href", assessmentUrl);
    assessmentLink.setAttribute("target", "_blank");
    assessmentLink.setAttribute("rel", "noopener noreferrer");
    assessmentLink.innerText = assessmentUrl;
    const body = document.createElement("p");
    body.appendChild(
      document.createTextNode("Your file has been submitted! Go to ")
    );
    body.appendChild(assessmentLink);
    body.appendChild(
      document.createTextNode(
        " to view your submission. Please check your assessment due date carefully, as only files submitted before the due date will be graded."
      )
    );

    // Success dialog
    dialog.modal({
      title: SUBMIT_LABEL,
      body: body,
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
      title: SUBMIT_LABEL,
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
