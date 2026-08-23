// Import Jupyter Front End components
import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';

// Import Command components
import { ICommandPalette, showDialog, Dialog } from '@jupyterlab/apputils';

// Getting JupyterLab coreutils
import { PageConfig } from '@jupyterlab/coreutils';

// Getting notebook components
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';

// Import to get toolbar button
import { ToolbarButton } from '@jupyterlab/apputils';

// Import for the trusted-origins setting
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { Widget } from '@lumino/widgets';

// This code never actually runs under Node (tsconfig deliberately omits
// Node's ambient types to keep the global namespace browser-only) --
// `process.env.NODE_ENV` is a build-time string substituted in by the
// bundler based on --development/production mode, not a real runtime value.
declare const process: { env: { NODE_ENV?: string } };

// Declaring necessary variables
const ACTION_PREFIX = 'markus';
const ACTION_NAME = 'markus_submit';
const COMMAND_ID = `${ACTION_PREFIX}:${ACTION_NAME}`;
const SUBMIT_LABEL = 'Submit to MarkUs';
const PLUGIN_ID = 'jupyterlab-markus-extension:plugin';
const TRUSTED_ORIGINS_KEY = 'trustedOrigins';

// Creating the Metadata space
interface IMarkUsMetadata {
  url: string;

  // course_id refers to Course.id
  course_id?: number | string;

  // course refers to Course.name
  course?: string;

  // assignment_id refers to Assignment.id
  assignment_id?: number | string;

  // assignment refers to Assignment.short_identifier
  assignment?: string;

  destination_path?: string;
}

// Creating the Payload space
interface ISubmitPayload {
  notebook_path: string;
  notebook_name: string;
  destination_path?: string;

  course_id?: number | string;
  course?: string;
  assignment_id?: number | string;
  assignment?: string;

  jupyter: {
    base_url: string;
    origin: string;
    token: string;
  };
}

// Creating the submission response space
interface ISubmitResponse {
  status: string;
  message?: string;
  submitted_file?: string;
  markus_target?: {
    course_id?: number | string;
    assignment_id?: number | string;
    assignment?: string;
    repository_folder?: string;
    grouping_id?: number | string;
    group_id?: number | string;
    student_role_id?: number | string;
    markus_user_name?: string;
  };
  fetched_file?: {
    name?: string;
    path?: string;
    type?: string;
    format?: string;
  };
}

// Checking to see if a notebook is open
export function getCurrentNotebookPanel(tracker: INotebookTracker): NotebookPanel {
  const panel = tracker.currentWidget;

  if (!panel) {
    throw new Error('No active notebook is open.');
  }

  return panel;
}

// Normalize MarkUs URL so it can safely be used as a base URL.
export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('MarkUs URL cannot be blank.');
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Notebook metadata value "url" is not a valid URL: "${trimmed}".`);
  }

  // Ensure url.pathname ends in a '/'
  url.pathname = url.pathname.replace(/\/?$/, '/');

  return url.toString();
}

// Parse a MarkUs id field (course_id / assignment_id) as a positive integer.
// Deliberately stricter than `Number(...)`, which would also accept "",
// "1e3", "0x1F", "Infinity", leading/trailing whitespace, and non-integers
// like "1.5" -- none of which are valid database primary keys.
export function parseMarkusId(value: number | string, fieldName: string): number {
  const isValidNumber = typeof value === 'number' && Number.isInteger(value) && value > 0;
  const isValidString = typeof value === 'string' && /^[1-9]\d*$/.test(value);

  if (!isValidNumber && !isValidString) {
    throw new Error(`Notebook metadata value "${fieldName}" must be a positive integer.`);
  }

  return Number(value);
}

// Always-trusted origins, used in development for MarkUs URL validation.
const DEVELOPMENT_DEFAULT_TRUSTED_ORIGINS: string[] =
  process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : [];

// Read the trusted-origins setting, filtering out any malformed entries and
// always including the development-only origins (a no-op in production).
export function getTrustedOrigins(settings: ISettingRegistry.ISettings): string[] {
  const value = settings.get(TRUSTED_ORIGINS_KEY).composite;
  const configured = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

  return Array.from(new Set([...configured, ...DEVELOPMENT_DEFAULT_TRUSTED_ORIGINS]));
}

// Reject submission targets that are not explicitly trusted.
export function assertTrustedOrigin(url: string, trustedOrigins: string[]): void {
  const origin = new URL(url).origin;

  if (trustedOrigins.length === 0) {
    throw new Error(
      'No trusted MarkUs origins are configured. Ask a JupyterLab administrator to add this MarkUs URL to the "Submit to MarkUs" settings (Settings > Settings Editor > Submit to MarkUs) before submitting.'
    );
  }

  if (!trustedOrigins.includes(origin)) {
    throw new Error(
      `MarkUs origin "${origin}" is not trusted. Trusted origins: ${trustedOrigins.join(
        ', '
      )}. Ask a JupyterLab administrator to add it to the "Submit to MarkUs" settings if this is expected.`
    );
  }
}

// Get notebook name from JupyterLab context.
export function getNotebookName(panel: NotebookPanel): string {
  const notebookName = panel.context.contentsModel?.name || panel.context.path.split('/').pop();

  if (!notebookName) {
    throw new Error('Could not determine notebook name. Please ensure the notebook is saved.');
  }

  return notebookName;
}

// Extracting the MarkUs metadata from the notebook
export function getMarkusMetadata(panel: NotebookPanel): IMarkUsMetadata {
  const metadata = panel.content.model?.metadata as any;
  const rawMetadata = metadata?.get ? metadata.get('markus') : metadata?.markus;

  // Checking if MarkUs Metadata is in the notebook metadata
  if (!rawMetadata || typeof rawMetadata !== 'object') {
    throw new Error(
      'Notebook metadata is missing the "markus" key. Please add top-level notebook metadata named "markus".'
    );
  }

  const markusMetadata = rawMetadata as IMarkUsMetadata;
  const { url, course_id, course, assignment_id, assignment } = markusMetadata;

  if (!url) {
    throw new Error('Notebook metadata is missing required MarkUs key: "url".');
  }

  if (!course_id && !course) {
    throw new Error('Notebook metadata must include either "course_id" or "course".');
  }

  if (!assignment_id && !assignment) {
    throw new Error('Notebook metadata must include either "assignment_id" or "assignment".');
  }

  if (course_id && course) {
    throw new Error('Notebook metadata should include only one of "course_id" or "course", not both.');
  }

  if (assignment_id && assignment) {
    throw new Error('Notebook metadata should include only one of "assignment_id" or "assignment", not both.');
  }

  let normalizedCourseId: number | undefined;
  let normalizedAssignmentId: number | undefined;

  if (course_id) {
    normalizedCourseId = parseMarkusId(course_id, 'course_id');
  }

  if (assignment_id) {
    normalizedAssignmentId = parseMarkusId(assignment_id, 'assignment_id');
  }

  const normalizedUrl = normalizeBaseUrl(String(url));

  return {
    ...markusMetadata,
    url: normalizedUrl,
    course_id: normalizedCourseId ?? course_id,
    assignment_id: normalizedAssignmentId ?? assignment_id
  };
}

// Compiling the submission payload
export function buildSubmitPayload(panel: NotebookPanel, markus: IMarkUsMetadata): ISubmitPayload {
  const notebookPath = panel.context.path;

  if (!notebookPath) {
    throw new Error('Could not determine notebook path.');
  }

  const notebookName = getNotebookName(panel);
  const jupyterBaseUrl = PageConfig.getBaseUrl();
  const jupyterOrigin = window.location.origin;
  const jupyterToken = PageConfig.getToken();

  if (!jupyterToken) {
    throw new Error(
      'No Jupyter token available. This environment may be using cookie/OAuth authentication. Token-based pull may not work.'
    );
  }

  return {
    notebook_path: notebookPath,
    notebook_name: notebookName,
    destination_path: markus.destination_path,

    course_id: markus.course_id,
    course: markus.course,
    assignment_id: markus.assignment_id,
    assignment: markus.assignment,

    jupyter: {
      base_url: jupyterBaseUrl,
      origin: jupyterOrigin,
      token: jupyterToken
    }
  };
}

// Sending the submission request to the MarkUs server
async function submitToServer(payload: ISubmitPayload, markus: IMarkUsMetadata): Promise<ISubmitResponse> {
  const submitUrl = new URL('jupyter/submit', markus.url).toString();

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

  if (result.submitted_file) {
    body += `\n\nSubmitted file: ${result.submitted_file}`;
  }

  if (result.markus_target?.assignment) {
    body += `\n\nAssignment: ${result.markus_target.assignment}`;
  }

  if (result.markus_target?.markus_user_name) {
    body += `\n\nSubmitted as: ${result.markus_target.markus_user_name}`;
  }

  await showDialog({
    title: SUBMIT_LABEL,
    body,
    buttons: [Dialog.okButton({ label: 'Close' })]
  });
}

function createConfirmationBody(notebookName: string, markus: IMarkUsMetadata): Widget {
  const courseLabel = markus.course ?? String(markus.course_id);
  const assignmentLabel = markus.assignment ?? String(markus.assignment_id);

  const node = document.createElement('div');

  const intro = document.createElement('p');
  intro.textContent = 'Submit this notebook to MarkUs?';
  node.appendChild(intro);

  const list = document.createElement('ul');
  const items: Array<[string, string]> = [
    ['Notebook', notebookName],
    ['MarkUs URL', markus.url],
    ['Course', courseLabel],
    ['Assignment', assignmentLabel]
  ];

  for (const [label, value] of items) {
    const item = document.createElement('li');

    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    item.appendChild(strong);
    item.appendChild(document.createTextNode(value));

    list.appendChild(item);
  }

  node.appendChild(list);

  return new Widget({ node });
}

async function confirmSubmission(notebookName: string, markus: IMarkUsMetadata): Promise<boolean> {
  const result = await showDialog({
    title: SUBMIT_LABEL,
    body: createConfirmationBody(notebookName, markus),
    buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Submit' })]
  });

  return result.button.accept;
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
async function submitToMarkUs(tracker: INotebookTracker, settings: ISettingRegistry.ISettings): Promise<void> {
  try {
    const panel = getCurrentNotebookPanel(tracker);

    await panel.context.save();

    const markus = getMarkusMetadata(panel);
    assertTrustedOrigin(markus.url, getTrustedOrigins(settings));

    if (!(await confirmSubmission(getNotebookName(panel), markus))) {
      return;
    }

    const payload = buildSubmitPayload(panel, markus);

    const result = await submitToServer(payload, markus);

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
  id: PLUGIN_ID,
  description: 'Submit the current notebook to MarkUs by asking MarkUs to fetch it from JupyterHub/Jupyter Server.',
  autoStart: true,
  requires: [INotebookTracker, ISettingRegistry],
  optional: [ICommandPalette],
  activate: async (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    settingRegistry: ISettingRegistry,
    palette: ICommandPalette | null
  ) => {
    console.log('JupyterLab extension jupyterlab-markus-extension is activated.');

    const settings = await settingRegistry.load(PLUGIN_ID);

    app.commands.addCommand(COMMAND_ID, {
      label: SUBMIT_LABEL,
      caption: SUBMIT_LABEL,
      execute: async () => {
        await submitToMarkUs(tracker, settings);
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
