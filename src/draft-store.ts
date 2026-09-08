const DATABASE_NAME = 'instacomic'
const DATABASE_VERSION = 2
const DRAFT_STORE = 'drafts'
const ASSET_STORE = 'assets'
const PROJECT_STORE = 'projects'

export const CURRENT_DRAFT_ID = 'current'

export type DraftRecord<TDocument> = {
  id: typeof CURRENT_DRAFT_ID
  schemaVersion: 1
  revision: number
  updatedAt: number
  document: TDocument
}

export type SavedProject<TDocument> = {
  id: string
  name: string
  updatedAt: number
  document: TDocument
  assetIds: string[]
}

export type DraftAssetRecord = {
  id: string
  blob: Blob
  width: number
  height: number
  createdAt: number
}

function openDatabase() {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('Draft storage is unavailable.'))
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    let settled = false
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        database.createObjectStore(DRAFT_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        database.createObjectStore(ASSET_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (settled) {
        database.close()
        return
      }
      settled = true
      resolve(database)
    }
    request.onerror = () => {
      if (!settled) {
        settled = true
        reject(request.error ?? new Error('Draft storage could not open.'))
      }
    }
    request.onblocked = () => {
      if (!settled) {
        settled = true
        reject(new Error('Draft storage is blocked by another app window.'))
      }
    }
  })
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Draft storage request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Draft storage transaction was cancelled.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Draft storage transaction failed.'))
  })
}

export async function loadDraftRecord<TDocument>() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(DRAFT_STORE, 'readonly')
    const completion = transactionDone(transaction)
    const request = transaction.objectStore(DRAFT_STORE).get(CURRENT_DRAFT_ID)
    const result = await requestResult(request)
    await completion
    return (result as DraftRecord<TDocument> | undefined) ?? null
  } finally {
    database.close()
  }
}

export async function loadDraftAssets(assetIds: string[]) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(ASSET_STORE, 'readonly')
    const completion = transactionDone(transaction)
    const store = transaction.objectStore(ASSET_STORE)
    const uniqueIds = [...new Set(assetIds)]
    const assets = await Promise.all(uniqueIds.map((assetId) => requestResult(store.get(assetId))))
    await completion
    return new Map(
      assets
        .filter((asset): asset is DraftAssetRecord => !!asset)
        .map((asset) => {
          const stored = asset as DraftAssetRecord & { data?: ArrayBuffer; mimeType?: string }
          return [asset.id, { ...asset, blob: stored.data ? new Blob([stored.data], { type: stored.mimeType ?? 'image/png' }) : asset.blob }] as const
        }),
    )
  } finally {
    database.close()
  }
}

export async function listProjects<TDocument>() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(PROJECT_STORE, 'readonly')
    const completion = transactionDone(transaction)
    const projects = await requestResult(transaction.objectStore(PROJECT_STORE).getAll()) as SavedProject<TDocument>[]
    await completion
    return projects.sort((a, b) => b.updatedAt - a.updatedAt)
  } finally { database.close() }
}

export async function saveDraftRecord<TDocument>(record: DraftRecord<TDocument>, assets: DraftAssetRecord[], project?: { id: string; name: string }) {
  const database = await openDatabase()
  try {
    // Photo IDs are immutable. Only encode and write assets that are not saved yet.
    const read = database.transaction(ASSET_STORE, 'readonly')
    const readDone = transactionDone(read)
    const knownIds = new Set(await requestResult(read.objectStore(ASSET_STORE).getAllKeys()))
    await readDone
    const freshAssets = await Promise.all(assets.filter(asset => !knownIds.has(asset.id)).map(async ({ blob, ...asset }) =>
      ({ ...asset, data: await blob.arrayBuffer(), mimeType: blob.type })))
    const transaction = database.transaction([DRAFT_STORE, ASSET_STORE, PROJECT_STORE], 'readwrite')
    const completion = transactionDone(transaction)
    const assetStore = transaction.objectStore(ASSET_STORE)
    const keys = assetStore.getAllKeys()
    keys.onsuccess = () => {
      const available = new Set([...keys.result, ...freshAssets.map(asset => asset.id)])
      // A second tab may have deleted a project during encoding. Never save missing references.
      if (assets.some(asset => !available.has(asset.id))) { transaction.abort(); return }
      freshAssets.forEach(asset => assetStore.put(asset))
      transaction.objectStore(DRAFT_STORE).put(record)
      if (project) transaction.objectStore(PROJECT_STORE).put({ ...project, document: record.document,
        updatedAt: record.updatedAt, assetIds: assets.map(asset => asset.id) })
      pruneUnusedAssets(transaction, assets.map(asset => asset.id))
    }
    await completion
  } finally { database.close() }
}

function pruneUnusedAssets(transaction: IDBTransaction, draftAssetIds: string[]) {
  const projects = transaction.objectStore(PROJECT_STORE).getAll()
  projects.onsuccess = () => {
    const referenced = new Set([...draftAssetIds, ...projects.result.flatMap((project: SavedProject<unknown>) => project.assetIds)])
    const assets = transaction.objectStore(ASSET_STORE)
    const keys = assets.getAllKeys()
    keys.onsuccess = () => keys.result.forEach(key => { if (!referenced.has(String(key))) assets.delete(key) })
  }
}

export async function deleteProject(id: string) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction([PROJECT_STORE, DRAFT_STORE, ASSET_STORE], 'readwrite')
    const completion = transactionDone(transaction)
    transaction.objectStore(PROJECT_STORE).delete(id)
    const draft = transaction.objectStore(DRAFT_STORE).get(CURRENT_DRAFT_ID)
    draft.onsuccess = () => {
      const document = draft.result?.document
      if (document?.projectId === id) {
        transaction.objectStore(DRAFT_STORE).delete(CURRENT_DRAFT_ID)
        pruneUnusedAssets(transaction, [])
      } else {
        const slides = document?.carousel?.slides ?? (document ? [document] : [])
        pruneUnusedAssets(transaction, slides.flatMap((slide: { shotCache: Array<{ assetId: string } | null> }) => slide.shotCache.flatMap(shot => shot ? [shot.assetId] : [])))
      }
    }
    await completion
  } finally { database.close() }
}

export async function clearDraftData() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction([DRAFT_STORE, ASSET_STORE, PROJECT_STORE], 'readwrite')
    const completion = transactionDone(transaction)
    transaction.objectStore(DRAFT_STORE).clear()
    pruneUnusedAssets(transaction, [])
    await completion
  } finally { database.close() }
}
