// Import Jupyter Front End components
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

// Import Command components
import {
  ICommandPalette,
  showDialog,
  Dialog
} from '@jupyterlab/apputils';

// Getting JupyterLab coreutils
import { PageConfig } from '@jupyterlab/coreutils';

// Getting notebook components
import {
  INotebookTracker,
  NotebookPanel
} from '@jupyterlab/notebook';

// Import to get toolbar button
import { ToolbarButton } from '@jupyterlab/apputils';

// Declaring necessary variables
const ACTION_PREFIX = 'markus';
const ACTION_NAME = 'markus_submit';
const COMMAND_ID = `${ACTION_PREFIX}:${ACTION_NAME}`;
const SUBMIT_LABEL = 'Submit to MarkUs';

// Creating the Metadata space
interface IMarkUsMetadata {
  url: string;
  course_id: number | string;
  assessment_id: number | string;
  destination_path?: string;
}

// Creating the Payload space
interface ISubmitPayload {
  notebook_path: string;
  notebook_name: string;
  jupyter_base_url: string;
  jupyter_origin: string;
  jupyter_token: string;
  markus: IMarkUsMetadata;
}

// Creating the submission response space
interface ISubmitResponse {
  status: string;
  message?: string;
  saved_file?: string;
  assessment_url?: string;
}

// Checking to see if a notebook is open
function getCurrentNotebookPanel(tracker: INotebookTracker): NotebookPanel {
  const panel = tracker.currentWidget;

  if (!panel) {
    throw new Error('No active notebook is open.');
  }

  return panel;
}

// Extracting the MarkUs metadata from the notebook
function getMarkusMetadata(panel: NotebookPanel): IMarkUsMetadata {
  const metadata = panel.content.model?.metadata as any;
  const rawMetadata = metadata?.get ? metadata.get('markus') : metadata?.markus;

  // Checking if MarkUs Metadata is in the notebook metadata
  if (!rawMetadata || typeof rawMetadata !== 'object') {
    throw new Error(
      'Notebook metadata is missing the "markus" key. Please add top-level notebook metadata named "markus".'
    );
  }

  
  const markusMetadata = rawMetadata as IMarkUsMetadata;
  const { url, course_id, assessment_id } = markusMetadata;

  // Checking if all three components of MarkUs metadata is present
  if (!url || !course_id || !assessment_id) {
    throw new Error(
      'Notebook metadata is missing one or more required MarkUs keys: "url", "course_id", or "assessment_id".'
    );
  }

  const courseIdNumber = Number(course_id);
  const assessmentIdNumber = Number(assessment_id);

  // Checking to see if the courseid and assessmentid are valid
  if (Number.isNaN(courseIdNumber) || Number.isNaN(assessmentIdNumber)) {
    throw new Error(
      'Notebook metadata values "course_id" and "assessment_id" must be numbers.'
    );
  }

  // Creating the submission url
  try {
    new URL(String(url));
  } catch {
    throw new Error(
      'Notebook metadata value "url" must be a valid URL, for example "http://localhost:8000".'
    );
  }

  return {
    ...markusMetadata,
    course_id: courseIdNumber,
    assessment_id: assessmentIdNumber
  };
}

// Compiling the submission payload
function buildSubmitPayload(panel: NotebookPanel, markus: IMarkUsMetadata): ISubmitPayload {
  const notebookPath = panel.context.path;
  const notebookName =
    panel.context.contentsModel?.name ||
    notebookPath.split('/').pop() ||
    'notebook.ipynb';

  const jupyterBaseUrl = PageConfig.getBaseUrl();
  const jupyterOrigin = window.location.origin;
  const jupyterToken = PageConfig.getToken() || '';

  return {
    notebook_path: notebookPath,
    notebook_name: notebookName,
    jupyter_base_url: jupyterBaseUrl,
    jupyter_origin: jupyterOrigin,
    jupyter_token: jupyterToken,
    markus
  };
}

// Sending the pull request to the server
async function submitPullRequest(payload: ISubmitPayload): Promise<ISubmitResponse> {
  const markusBaseUrl = String(payload.markus.url).replace(/\/+$/, '');
  const submitUrl = `${markusBaseUrl}/api/submit`;

  const response = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`MarkUs server error ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text) as ISubmitResponse;
  } catch {
    return {
      status: 'ok',
      message: text
    };
  }
}

// Confirming the submission is successful
async function reportSuccess(result: ISubmitResponse): Promise<void> {
  let body = result.message || 'Your file has been submitted successfully.';

  if (result.saved_file) {
    body += `\n\nSaved file: ${result.saved_file}`;
  }

  if (result.assessment_url) {
    body += `\n\nAssessment URL: ${result.assessment_url}`;
  }

  await showDialog({
    title: SUBMIT_LABEL,
    body,
    buttons: [Dialog.okButton({ label: 'Close' })]
  });
}

// Report any errors
async function reportError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`[${SUBMIT_LABEL}]`, error);

  await showDialog({
    title: SUBMIT_LABEL,
    body: `[ERROR] Could not submit file to MarkUs. Cause: ${message}`,
    buttons: [Dialog.okButton({ label: 'Close' })]
  });
}

// Submitting the file to server
async function submitToMarkUs(tracker: INotebookTracker): Promise<void> {
  try {
    const panel = getCurrentNotebookPanel(tracker);

    await panel.context.save();

    const markus = getMarkusMetadata(panel);
    const payload = buildSubmitPayload(panel, markus);

    console.info('submit_btn: Sending MarkUs pull request payload:', payload);

    const result = await submitPullRequest(payload);

    await reportSuccess(result);
  } catch (error) {
    await reportError(error);
  }
}

// Adding the function as a toolbar button
function addToolbarButton(panel: NotebookPanel, app: JupyterFrontEnd): void {
  if (Array.from(panel.toolbar.names()).includes(COMMAND_ID)) {
    return;
  }

  const button = new ToolbarButton({
    label: SUBMIT_LABEL,
    tooltip: SUBMIT_LABEL,
    onClick: () => {
      void app.commands.execute(COMMAND_ID);
    }
  });

  panel.toolbar.insertItem(10, COMMAND_ID, button);
}

// Creating the Jupyter Frontend Plugin
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'submit_btn:plugin',
  description: 'Submit the current notebook to a MarkUs test server by asking the server to pull it from JupyterHub/Jupyter Server.',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    palette: ICommandPalette | null
  ) => {
    console.log('JupyterLab extension submit_btn is activated.');

    app.commands.addCommand(COMMAND_ID, {
      label: SUBMIT_LABEL,
      caption: SUBMIT_LABEL,
      execute: async () => {
        await submitToMarkUs(tracker);
      }
    });

    if (palette) {
      palette.addItem({
        command: COMMAND_ID,
        category: 'MarkUs'
      });
    }

    tracker.widgetAdded.connect((_sender, panel) => {
      addToolbarButton(panel, app);
    });

    if (tracker.currentWidget) {
      addToolbarButton(tracker.currentWidget, app);
    }
  }
};

export default plugin;
