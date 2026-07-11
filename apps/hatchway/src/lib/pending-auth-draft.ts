const DATABASE_NAME = 'hatchway-browser-drafts';
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'pending-auth-submit';
const DATABASE_VERSION = 1;
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

export interface PendingAuthDraftImage {
  type: 'image';
  image: string;
  mimeType?: string;
  fileName?: string;
}

export interface PendingAuthDraft {
  version: 1;
  savedAt: number;
  text: string;
  images: PendingAuthDraftImage[];
  project: { id: string; slug: string } | null;
  buildConfig: {
    appliedTags: Array<{
      key: string;
      value: string;
      expandedValues?: Record<string, string>;
      appliedAt: string;
    }>;
    selectedAgentId: string;
    selectedClaudeModelId: string;
    selectedRunnerId: string;
    executionMode: 'local' | 'sandbox';
  };
}

export type PendingAuthDraftInput = Omit<PendingAuthDraft, 'version' | 'savedAt'>;

export function createPendingAuthDraft(
  draft: PendingAuthDraftInput,
  savedAt = Date.now(),
): PendingAuthDraft {
  return { ...draft, version: 1, savedAt };
}

export function parsePendingAuthDraft(
  value: unknown,
  now = Date.now(),
): PendingAuthDraft | null {
  if (!value || typeof value !== 'object') return null;

  const draft = value as Partial<PendingAuthDraft>;
  if (
    draft.version !== 1 ||
    typeof draft.savedAt !== 'number' ||
    now - draft.savedAt > MAX_DRAFT_AGE_MS ||
    typeof draft.text !== 'string' ||
    !Array.isArray(draft.images) ||
    !draft.buildConfig
  ) {
    return null;
  }

  const imagesAreValid = draft.images.every(
    (image) =>
      image?.type === 'image' &&
      typeof image.image === 'string' &&
      image.image.startsWith('data:image/'),
  );
  const config = draft.buildConfig;
  const configIsValid =
    Array.isArray(config.appliedTags) &&
    typeof config.selectedAgentId === 'string' &&
    typeof config.selectedClaudeModelId === 'string' &&
    typeof config.selectedRunnerId === 'string' &&
    (config.executionMode === 'local' || config.executionMode === 'sandbox');

  return imagesAreValid && configIsValid ? (draft as PendingAuthDraft) : null;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open draft storage'));
    request.onblocked = () => reject(new Error('Draft storage is blocked by another tab'));
  });
}

function browserIndexedDB(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new Error('Browser draft storage is unavailable');
  }
  return indexedDB;
}

export async function savePendingAuthDraft(draft: PendingAuthDraft): Promise<void> {
  const database = await openDatabase(browserIndexedDB());
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(draft, DRAFT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save draft'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Draft save was cancelled'));
    });
  } finally {
    database.close();
  }
}

export async function loadPendingAuthDraft(): Promise<PendingAuthDraft | null> {
  if (typeof indexedDB === 'undefined') return null;

  const database = await openDatabase(indexedDB);
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(DRAFT_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not read draft'));
    });
    return parsePendingAuthDraft(value);
  } finally {
    database.close();
  }
}

export async function clearPendingAuthDraft(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  const database = await openDatabase(indexedDB);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(DRAFT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear draft'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Draft clear was cancelled'));
    });
  } finally {
    database.close();
  }
}
