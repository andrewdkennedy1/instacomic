const DATABASE_NAME = 'instacomic'
const DATABASE_VERSION = 1
const DRAFT_STORE = 'drafts'
const ASSET_STORE = 'assets'

export const CURRENT_DRAFT_ID = 'current'

export type DraftRecord<TDocument> = {
  id: typeof CURRENT_DRAFT_ID
  schemaVersion: 1
  revision: number
  updatedAt: number
  document: TDocument
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
        .map((asset) => [asset.id, asset] as const),
    )
  } finally {
    database.close()
  }
}

export async function saveDraftRecord<TDocument>(record: DraftRecord<TDocument>, assets: DraftAssetRecord[]) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction([DRAFT_STORE, ASSET_STORE], 'readwrite')
    const completion = transactionDone(transaction)
    const assetStore = transaction.objectStore(ASSET_STORE)
    const referencedIds = new Set(assets.map((asset) => asset.id))
    const keyRequest = assetStore.getAllKeys()

    keyRequest.onsuccess = () => {
      const storedIds = new Set(keyRequest.result.filter((key): key is string => typeof key === 'string'))
      storedIds.forEach((assetId) => {
        if (!referencedIds.has(assetId)) {
          assetStore.delete(assetId)
        }
      })
      assets.forEach((asset) => {
        if (!storedIds.has(asset.id)) {
          assetStore.put(asset)
        }
      })
      transaction.objectStore(DRAFT_STORE).put(record)
    }

    await completion
  } finally {
    database.close()
  }
}

export async function clearDraftData() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction([DRAFT_STORE, ASSET_STORE], 'readwrite')
    const completion = transactionDone(transaction)
    transaction.objectStore(DRAFT_STORE).clear()
    transaction.objectStore(ASSET_STORE).clear()
    await completion
  } finally {
    database.close()
  }
}
