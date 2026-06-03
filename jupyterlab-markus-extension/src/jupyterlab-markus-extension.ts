// JupyterLab frontend imports
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  ICommandPalette,
  showDialog,
  Dialog,
  ToolbarButton
} from '@jupyterlab/apputils';

import { PageConfig } from '@jupyterlab/coreutils';

import {
  INotebookTracker,
  NotebookPanel
} from '@jupyterlab/notebook';

const ACTION_PREFIX = 'markus';
const ACTION_NAME = 'submit';
const COMMAND_ID = `${ACTION_PREFIX}:${ACTION_NAME}`;
const SUBMIT_LABEL = 'Submit to MarkUs';
const TOOLBAR_ITEM_NAME = 'markus-submit-button';

// Normalize MarkUs metadata
interface INormalizedMarkUsMetadata {
  url: string;
  course?: string;
  assignment?: string;
  course_id?: number;
  assessment_id?: number;
  submit_endpoint: string;
}

// Getting Jupyter information
interface IJupyterInfo {
  base_url: string;
  origin: string;
  full_url: string;
  token: string;
}

// Creating the payload
interface ISubmitPayload {
  course?: string;
  assignment?: string;
  course_id?: number;
  assessment_id?: number;
  notebook_path: string;
  notebook_name: string;
  destination_path: string;
  jupyter: IJupyterInfo;
}

// Submission response
interface ISubmitResponse {
  status?: string;
  message?: string;
  submitted_file?: string;
  saved_file?: string;
  commit_revision?: string;
  assessment_url?: string;
  repository_path?: string;
}

// Creating metadata object
function metadataValueToObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

// Get the open notebook data
function getCurrentNotebookPanel(tracker: INotebookTracker): NotebookPanel {
  const panel = tracker.currentWidget;

  if (!panel) {
    throw new Error('No active notebook is open. Please open the notebook you want to submit.');
  }

  if (!panel.context.path) {
    throw new Error('The current notebook does not have a valid file path. Please save it first.');
  }

  return panel;
}

// Grabbing the notebook metadata
function getRawNotebookMetadata(panel: NotebookPanel, key: string): unknown {
  const model = panel.content.model;

  if (!model) {
    return undefined;
  }

  const sharedModel = model.sharedModel as unknown;

  if (
    sharedModel &&
    typeof (sharedModel as { getMetadata?: unknown }).getMetadata === 'function'
  ) {
    return (sharedModel as { getMetadata: (metadataKey: string) => unknown }).getMetadata(key);
  }

  const metadata = model.metadata as unknown;

  if (!metadata) {
    return undefined;
  }

  if (typeof (metadata as { get?: unknown }).get === 'function') {
    return (metadata as { get: (metadataKey: string) => unknown }).get(key);
  }

  return (metadata as Record<string, unknown>)[key];
}

function parseOptionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Notebook metadata value "${fieldName}" must be a number when provided.`);
  }

  return parsed;
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`Notebook metadata value "${fieldName}" must be a string when provided.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

// Creating MarkUs URL
function normalizeMarkUsUrl(value: unknown): string {
  if (!value || typeof value !== 'string') {
    throw new Error(
      'Notebook metadata is missing required MarkUs key "url". Example: "http://localhost:3000/csc108".'
    );
  }

  const url = value.trim().replace(/\/+$/, '');

  try {
    const parsed = new URL(url);

    if (!parsed.protocol || !parsed.host) {
      throw new Error('Invalid URL.');
    }
  } catch {
    throw new Error(
      'Notebook metadata value "url" must be a full valid MarkUs URL, for example "http://localhost:3000/csc108".'
    );
  }

  return url;
}

// Normalize the Submission endpoint
function normalizeSubmitEndpoint(value: unknown): string {
  // Important:
  // Do not force a leading slash here.
  // If MarkUs is mounted under /csc108, then:
  //   url = http://localhost:3000/csc108
  //   submit_endpoint = api/jupyter_submissions
  // should become:
  //   http://localhost:3000/csc108/api/jupyter_submissions
  return parseOptionalString(value, 'submit_endpoint') || 'api/jupyter_submissions';
}

// Getting the MarkUs info from metadata
function getMarkUsMetadata(panel: NotebookPanel): INormalizedMarkUsMetadata {
  const rawValue = getRawNotebookMetadata(panel, 'markus');

  console.info(`[${SUBMIT_LABEL}] Raw MarkUs notebook metadata:`, rawValue);

  const rawMetadata = metadataValueToObject(rawValue);

  if (!rawMetadata) {
    throw new Error(
      'Notebook metadata is missing the top-level "markus" object. Please add metadata.markus with url, course/assignment or course_id/assessment_id.'
    );
  }

  const url = normalizeMarkUsUrl(rawMetadata.url);
  const course = parseOptionalString(rawMetadata.course, 'course');
  const assignment = parseOptionalString(rawMetadata.assignment, 'assignment');
  const courseId = parseOptionalNumber(rawMetadata.course_id, 'course_id');
  const assessmentId = parseOptionalNumber(rawMetadata.assessment_id, 'assessment_id');
  const submitEndpoint = normalizeSubmitEndpoint(rawMetadata.submit_endpoint);

  const hasHumanReadableTarget = Boolean(course && assignment);
  const hasNumericTarget = courseId !== undefined && assessmentId !== undefined;

  if (!hasHumanReadableTarget && !hasNumericTarget) {
    throw new Error(
      'Notebook metadata must include either "course" and "assignment", or "course_id" and "assessment_id".'
    );
  }

  return {
    url,
    course,
    assignment,
    course_id: courseId,
    assessment_id: assessmentId,
    submit_endpoint: submitEndpoint
  };
}

// Getting the notebook name for submission
function getNotebookName(panel: NotebookPanel): string {
  return (
    panel.context.contentsModel?.name ||
    panel.context.path.split('/').pop() ||
    'notebook.ipynb'
  );
}

function joinUrlParts(origin: string, baseUrl: string): string {
  const normalizedOrigin = origin.replace(/\/+$/, '');
  const normalizedBase = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;

  return `${normalizedOrigin}${normalizedBase}`;
}

function getJupyterFullUrl(notebookPath: string): string {
  const baseUrl = PageConfig.getBaseUrl() || '/';
  const jupyterRoot = joinUrlParts(window.location.origin, baseUrl);
  const encodedPath = notebookPath.split('/').map(encodeURIComponent).join('/');
  const treePath = `lab/tree/${encodedPath}`;

  return new URL(treePath, jupyterRoot).toString();
}

// Getting the Jupyter Token
function getJupyterToken(): string {
  const pageConfigToken = PageConfig.getToken();

  if (pageConfigToken && pageConfigToken.trim().length > 0) {
    return pageConfigToken.trim();
  }

  const urlToken = new URLSearchParams(window.location.search).get('token');

  if (urlToken && urlToken.trim().length > 0) {
    return urlToken.trim();
  }

  const bodyToken = document.body.dataset.jupyterApiToken;

  if (bodyToken && bodyToken.trim().length > 0) {
    return bodyToken.trim();
  }

  return '';
}

// Creating the Payload object
function buildSubmitPayload(panel: NotebookPanel, markus: INormalizedMarkUsMetadata): ISubmitPayload {
  const notebookPath = panel.context.path;
  const notebookName = getNotebookName(panel);

  // This is the requested change:
  // always submit using the actual current notebook file name.
  const destinationPath = notebookName;

  return {
    course: markus.course,
    assignment: markus.assignment,
    course_id: markus.course_id,
    assessment_id: markus.assessment_id,
    notebook_path: notebookPath,
    notebook_name: notebookName,
    destination_path: destinationPath,
    jupyter: {
      base_url: PageConfig.getBaseUrl() || '/',
      origin: window.location.origin,
      full_url: getJupyterFullUrl(notebookPath),
      token: getJupyterToken()
    }
  };
}

// Creating the Submission URL
function buildSubmitUrl(markus: INormalizedMarkUsMetadata): string {
  const baseUrl = markus.url.endsWith('/') ? markus.url : `${markus.url}/`;
  return new URL(markus.submit_endpoint, baseUrl).toString();
}

// Awaiting for responses from MarkUS server
async function postSubmission(
  markus: INormalizedMarkUsMetadata,
  payload: ISubmitPayload
): Promise<ISubmitResponse> {
  const submitUrl = buildSubmitUrl(markus);

  console.info(`[${SUBMIT_LABEL}] POST ${submitUrl}`);
  console.info(`[${SUBMIT_LABEL}] Payload:`, payload);

  const response = await fetch(submitUrl, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`MarkUs returned HTTP ${response.status}: ${responseText}`);
  }

  if (!responseText) {
    return { status: 'success', message: 'Submission completed.' };
  }

  try {
    return JSON.parse(responseText) as ISubmitResponse;
  } catch {
    return { status: 'success', message: responseText };
  }
}

async function reportSuccess(result: ISubmitResponse): Promise<void> {
  const lines: string[] = [result.message || 'Your file has been submitted to MarkUs.'];

  if (result.submitted_file) {
    lines.push(`Submitted file: ${result.submitted_file}`);
  }

  if (result.saved_file) {
    lines.push(`Saved file: ${result.saved_file}`);
  }

  if (result.commit_revision) {
    lines.push(`Commit: ${result.commit_revision}`);
  }

  if (result.assessment_url) {
    lines.push(`Assessment URL: ${result.assessment_url}`);
  }

  await showDialog({
    title: SUBMIT_LABEL,
    body: lines.join('\n\n'),
    buttons: [Dialog.okButton({ label: 'Close' })]
  });
}

async function reportError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`[${SUBMIT_LABEL}]`, error);

  await showDialog({
    title: SUBMIT_LABEL,
    body: `Could not submit the file to MarkUs.\n\n${message}`,
    buttons: [Dialog.okButton({ label: 'Close' })]
  });
}

// Submitting the notebook to MarkUs
async function submitToMarkUs(tracker: INotebookTracker): Promise<void> {
  try {
    const panel = getCurrentNotebookPanel(tracker);

    await panel.context.save();

    const markus = getMarkUsMetadata(panel);
    const payload = buildSubmitPayload(panel, markus);

    const result = await postSubmission(markus, payload);

    await reportSuccess(result);
  } catch (error) {
    await reportError(error);
  }
}

// Adding the toolbar button in Jupyter environment
function addToolbarButton(panel: NotebookPanel, app: JupyterFrontEnd): void {
  if (Array.from(panel.toolbar.names()).includes(TOOLBAR_ITEM_NAME)) {
    return;
  }

  const button = new ToolbarButton({
    label: 'Submit',
    tooltip: SUBMIT_LABEL,
    onClick: () => {
      void app.commands.execute(COMMAND_ID);
    }
  });

  panel.toolbar.insertItem(10, TOOLBAR_ITEM_NAME, button);
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'submit_btn:plugin',
  description:
    'Submit the current notebook to MarkUs by sending notebook metadata and Jupyter access information to a MarkUs submission endpoint.',
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