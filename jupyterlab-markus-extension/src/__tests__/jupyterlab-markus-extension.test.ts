// These modules are heavy JupyterLab framework packages that the module
// under test only needs a handful of runtime values from (mostly Token
// objects used for dependency injection); mocking them keeps these tests
// fast, dependency-free unit tests of the pure(ish) validation/formatting
// logic, rather than integration tests against real JupyterLab internals.
jest.mock('@jupyterlab/application', () => ({}));
jest.mock('@jupyterlab/apputils', () => ({
  ICommandPalette: {},
  Dialog: { okButton: jest.fn(), cancelButton: jest.fn() },
  showDialog: jest.fn(),
  ToolbarButton: jest.fn()
}));
jest.mock('@jupyterlab/coreutils', () => ({
  PageConfig: {
    getBaseUrl: jest.fn(),
    getToken: jest.fn()
  }
}));
jest.mock('@jupyterlab/notebook', () => ({
  INotebookTracker: {}
}));
jest.mock('@jupyterlab/settingregistry', () => ({
  ISettingRegistry: {}
}));
// Real @lumino/widgets pulls in @lumino/dragdrop, which references the
// browser's `DragEvent` global -- unavailable in this jsdom version. Not
// used by anything under test (only by the confirmation dialog's body,
// which isn't exported/unit-tested), so a bare stand-in is enough.
jest.mock('@lumino/widgets', () => ({
  Widget: jest.fn()
}));

import { PageConfig } from '@jupyterlab/coreutils';
import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import type { ISettingRegistry } from '@jupyterlab/settingregistry';

import {
  assertTrustedOrigin,
  buildSubmitPayload,
  getCurrentNotebookPanel,
  getMarkusMetadata,
  getNotebookName,
  getTrustedOrigins,
  normalizeBaseUrl,
  parseMarkusId
} from '../jupyterlab-markus-extension';

const mockGetBaseUrl = PageConfig.getBaseUrl as jest.Mock;
const mockGetToken = PageConfig.getToken as jest.Mock;

function makeSettings(trustedOrigins: unknown): ISettingRegistry.ISettings {
  return {
    get: (key: string) => {
      if (key !== 'trustedOrigins') {
        throw new Error(`Unexpected settings key requested in test: "${key}"`);
      }
      return { composite: trustedOrigins };
    }
  } as unknown as ISettingRegistry.ISettings;
}

function makePanel(
  options: {
    path?: string | null;
    contentsModelName?: string;
    metadata?: unknown;
  } = {}
): NotebookPanel {
  const path = options.path === undefined ? 'notebooks/demo.ipynb' : options.path;

  return {
    context: {
      path,
      contentsModel: options.contentsModelName ? { name: options.contentsModelName } : null
    },
    content: {
      model: {
        metadata: options.metadata
      }
    }
  } as unknown as NotebookPanel;
}

describe('normalizeBaseUrl', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  http://localhost:3000/  ')).toBe('http://localhost:3000/');
  });

  it('throws on a blank value', () => {
    expect(() => normalizeBaseUrl('   ')).toThrow('MarkUs URL cannot be blank.');
  });

  it('throws a friendly error on an invalid URL', () => {
    expect(() => normalizeBaseUrl('not-a-url')).toThrow(/is not a valid URL/);
  });

  it('appends a trailing slash when missing', () => {
    expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000/');
  });

  it('leaves an existing trailing slash alone', () => {
    expect(normalizeBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000/');
  });

  it('preserves a sub-path while adding the trailing slash', () => {
    expect(normalizeBaseUrl('http://localhost:3000/csc108')).toBe('http://localhost:3000/csc108/');
  });
});

describe('parseMarkusId', () => {
  it.each([
    ['42', 42],
    [42, 42],
    ['1', 1]
  ])('accepts %p as a valid id', (value, expected) => {
    expect(parseMarkusId(value as number | string, 'course_id')).toBe(expected);
  });

  it.each([[''], ['1e3'], ['0x1F'], ['Infinity'], ['1.5'], ['0'], ['007'], [' 42 '], ['-1'], [-1], [1.5], [0]])(
    'rejects %p as an invalid id',
    (value) => {
      expect(() => parseMarkusId(value as number | string, 'course_id')).toThrow(
        'Notebook metadata value "course_id" must be a positive integer.'
      );
    }
  );

  it('includes the field name in the error message', () => {
    expect(() => parseMarkusId('bad', 'assignment_id')).toThrow(/"assignment_id"/);
  });
});

describe('assertTrustedOrigin', () => {
  it('does not throw when the origin is trusted', () => {
    expect(() =>
      assertTrustedOrigin('https://markus.example.com/csc108/', ['https://markus.example.com'])
    ).not.toThrow();
  });

  it('matches on origin only, ignoring path differences', () => {
    expect(() =>
      assertTrustedOrigin('https://markus.example.com/some/deep/path', ['https://markus.example.com'])
    ).not.toThrow();
  });

  it('throws a specific message when no origins are trusted at all', () => {
    expect(() => assertTrustedOrigin('https://markus.example.com/', [])).toThrow(
      'No trusted MarkUs origins are configured.'
    );
  });

  it('throws naming the untrusted origin when the list is non-empty', () => {
    expect(() => assertTrustedOrigin('https://evil.example.com/', ['https://markus.example.com'])).toThrow(
      /MarkUs origin "https:\/\/evil\.example\.com" is not trusted/
    );
  });
});

describe('getTrustedOrigins', () => {
  it('returns the configured origins, filtering out non-string entries', () => {
    const settings = makeSettings(['https://markus.example.com', 42, null]);
    expect(getTrustedOrigins(settings)).toEqual(expect.arrayContaining(['https://markus.example.com']));
  });

  it('treats a non-array composite value as no configured origins', () => {
    const settings = makeSettings(undefined);
    // Jest's own runtime is not a production build, so the development-only
    // origin is still present -- see the "in a production build" suite below
    // for the security-relevant case where it must NOT be.
    expect(getTrustedOrigins(settings)).toContain('http://localhost:3000');
  });

  it('always includes the development-only origin alongside whatever is configured', () => {
    const settings = makeSettings(['https://markus.example.com']);
    expect(getTrustedOrigins(settings)).toEqual(
      expect.arrayContaining(['https://markus.example.com', 'http://localhost:3000'])
    );
  });

  describe('in a production build', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      jest.resetModules();
    });

    it('never trusts the development-only origin', () => {
      // Re-required with NODE_ENV already set to "production" so the
      // module's build-time DEVELOPMENT_DEFAULT_TRUSTED_ORIGINS constant
      // evaluates the way a real production bundle's would.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const prod = require('../jupyterlab-markus-extension');
      const settings = makeSettings([]);

      expect(prod.getTrustedOrigins(settings)).toEqual([]);
    });
  });
});

describe('getCurrentNotebookPanel', () => {
  it('returns the current widget when a notebook is open', () => {
    const panel = makePanel();
    const tracker = { currentWidget: panel } as unknown as INotebookTracker;

    expect(getCurrentNotebookPanel(tracker)).toBe(panel);
  });

  it('throws when no notebook is open', () => {
    const tracker = { currentWidget: null } as unknown as INotebookTracker;

    expect(() => getCurrentNotebookPanel(tracker)).toThrow('No active notebook is open.');
  });
});

describe('getNotebookName', () => {
  it('prefers the contents model name', () => {
    const panel = makePanel({ path: 'nested/demo.ipynb', contentsModelName: 'demo.ipynb' });
    expect(getNotebookName(panel)).toBe('demo.ipynb');
  });

  it('falls back to the last path segment', () => {
    const panel = makePanel({ path: 'nested/demo.ipynb' });
    expect(getNotebookName(panel)).toBe('demo.ipynb');
  });

  it('throws when neither is available', () => {
    const panel = makePanel({ path: '' });
    expect(() => getNotebookName(panel)).toThrow('Could not determine notebook name.');
  });
});

describe('getMarkusMetadata', () => {
  const validMarkus = {
    url: 'http://localhost:3000',
    course_id: 1,
    assignment_id: 2
  };

  it('throws when the "markus" key is missing', () => {
    const panel = makePanel({ metadata: {} });
    expect(() => getMarkusMetadata(panel)).toThrow('missing the "markus" key');
  });

  it('throws when "url" is missing', () => {
    const panel = makePanel({ metadata: { markus: { course_id: 1, assignment_id: 2 } } });
    expect(() => getMarkusMetadata(panel)).toThrow('missing required MarkUs key: "url"');
  });

  it('throws when neither course_id nor course is present', () => {
    const panel = makePanel({
      metadata: { markus: { url: 'http://localhost:3000', assignment_id: 2 } }
    });
    expect(() => getMarkusMetadata(panel)).toThrow('must include either "course_id" or "course"');
  });

  it('throws when both course_id and course are present', () => {
    const panel = makePanel({
      metadata: {
        markus: { url: 'http://localhost:3000', course_id: 1, course: 'csc108', assignment_id: 2 }
      }
    });
    expect(() => getMarkusMetadata(panel)).toThrow('only one of "course_id" or "course"');
  });

  it('throws when neither assignment_id nor assignment is present', () => {
    const panel = makePanel({
      metadata: { markus: { url: 'http://localhost:3000', course_id: 1 } }
    });
    expect(() => getMarkusMetadata(panel)).toThrow('must include either "assignment_id" or "assignment"');
  });

  it('throws when both assignment_id and assignment are present', () => {
    const panel = makePanel({
      metadata: {
        markus: { url: 'http://localhost:3000', course_id: 1, assignment_id: 2, assignment: 'a1' }
      }
    });
    expect(() => getMarkusMetadata(panel)).toThrow('only one of "assignment_id" or "assignment"');
  });

  it('propagates an invalid course_id from parseMarkusId', () => {
    const panel = makePanel({
      metadata: { markus: { ...validMarkus, course_id: '1e3' } }
    });
    expect(() => getMarkusMetadata(panel)).toThrow('"course_id" must be a positive integer');
  });

  it('propagates an invalid url from normalizeBaseUrl', () => {
    const panel = makePanel({
      metadata: { markus: { ...validMarkus, url: 'not-a-url' } }
    });
    expect(() => getMarkusMetadata(panel)).toThrow(/is not a valid URL/);
  });

  it('returns normalized url and numeric ids on valid metadata', () => {
    const panel = makePanel({ metadata: { markus: validMarkus } });

    expect(getMarkusMetadata(panel)).toEqual({
      url: 'http://localhost:3000/',
      course_id: 1,
      assignment_id: 2
    });
  });

  it('supports an IObservableJSON-style metadata object with .get()', () => {
    const panel = makePanel({
      metadata: {
        get: (key: string) => (key === 'markus' ? validMarkus : undefined)
      }
    });

    expect(getMarkusMetadata(panel).url).toBe('http://localhost:3000/');
  });
});

describe('buildSubmitPayload', () => {
  const markus = {
    url: 'http://localhost:3000/',
    course_id: 1,
    assignment_id: 2
  };

  beforeEach(() => {
    mockGetBaseUrl.mockReset().mockReturnValue('http://localhost:8888/');
    mockGetToken.mockReset().mockReturnValue('test-token');
  });

  it('throws when the notebook path is unavailable', () => {
    const panel = makePanel({ path: '' });
    expect(() => buildSubmitPayload(panel, markus)).toThrow('Could not determine notebook path.');
  });

  it('throws when no Jupyter token is available', () => {
    mockGetToken.mockReturnValue('');
    const panel = makePanel({ path: 'demo.ipynb', contentsModelName: 'demo.ipynb' });

    expect(() => buildSubmitPayload(panel, markus)).toThrow('No Jupyter token available.');
  });

  it('assembles the full payload from the panel, markus metadata, and PageConfig', () => {
    const panel = makePanel({ path: 'nested/demo.ipynb', contentsModelName: 'demo.ipynb' });

    expect(buildSubmitPayload(panel, markus)).toEqual({
      notebook_path: 'nested/demo.ipynb',
      course_id: 1,
      course: undefined,
      assignment_id: 2,
      assignment: undefined,
      jupyter: {
        base_url: 'http://localhost:8888/',
        token: 'test-token'
      }
    });
  });
});
