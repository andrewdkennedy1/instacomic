import { useEffect, useRef, useState } from 'react'
import { ActionIcon } from './ui'
import './photo-export.css'

type PreparedPhotos<T> = { snapshot: T; files: File[]; urls: string[] }

function supportsPhotoShare(files: File[]) {
  try {
    return typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' && navigator.canShare({ files })
  } catch { return false }
}

export function PhotoExportPanel<T>({ snapshot, count, width, height, emptyPanels, processing, onPrepare, onBusy }: {
  snapshot: T
  count: number
  width: number
  height: number
  emptyPanels: number
  processing: boolean
  onPrepare: (snapshot: T, onProgress: (completed: number) => void, signal: AbortSignal) => Promise<File[]>
  onBusy: (busy: boolean) => void
}) {
  const [ready, setReady] = useState<PreparedPhotos<T> | null>(null)
  const [completed, setCompleted] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [retry, setRetry] = useState(0)
  const [sharing, setSharing] = useState(false)
  const [showIndividual, setShowIndividual] = useState(false)
  const callbacks = useRef({ onPrepare, onBusy })
  callbacks.current = { onPrepare, onBusy }
  const shareAttempt = useRef(0)
  const sharePending = useRef(false)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const urls: string[] = []
    setReady(null)
    setError('')
    setMessage('')
    setCompleted(0)
    setShowIndividual(false)
    shareAttempt.current++
    sharePending.current = false
    setSharing(false)
    if (processing) return
    callbacks.current.onBusy(true)
    void callbacks.current.onPrepare(snapshot, value => { if (!cancelled) setCompleted(value) }, controller.signal).then(files => {
      if (cancelled) return
      urls.push(...files.map(file => URL.createObjectURL(file)))
      setReady({ snapshot, files, urls })
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not prepare your photos. Try again.')
    }).finally(() => { if (!cancelled) callbacks.current.onBusy(false) })
    return () => {
      cancelled = true
      controller.abort()
      shareAttempt.current++
      urls.forEach(url => URL.revokeObjectURL(url))
      callbacks.current.onBusy(false)
    }
  }, [snapshot, processing, retry])

  // Some iOS share destinations leave the promise pending. Returning to the app
  // must still unlock it; a resolved promise never proves images were saved.
  useEffect(() => {
    let leftApp = false
    const release = () => {
      if (!leftApp) return
      leftApp = false
      sharePending.current = false
      setSharing(false)
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') leftApp = true
      else release()
    }
    const blur = () => { leftApp = true }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', blur)
    window.addEventListener('focus', release)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', blur)
      window.removeEventListener('focus', release)
    }
  }, [])

  const current = ready?.snapshot === snapshot && !processing ? ready : null
  const canShareAll = !!current && supportsPhotoShare(current.files)

  function sharePhotos(files: File[]) {
    if (!current || sharePending.current) return
    const attempt = ++shareAttempt.current
    sharePending.current = true
    setSharing(true)
    setMessage(`Choose Save ${files.length === 1 ? 'Image' : 'Images'} in the share sheet to add ${files.length === 1 ? 'the photo' : 'the photos'} to your library.`)
    try {
      // Keep this call directly in the tap handler: rendering here would let
      // Safari's transient user activation expire, especially for many slides.
      const result = navigator.share({ files })
      void result.then(() => {
        if (shareAttempt.current === attempt) setMessage('Share sheet closed. Your photos are ready to share again.')
      }).catch(reason => {
        if (shareAttempt.current !== attempt) return
        if (reason?.name === 'AbortError') setMessage('Sharing canceled. Your photos are ready whenever you are.')
        else {
          setMessage('Sharing did not finish. Try again, or share the photos individually below.')
          setShowIndividual(true)
        }
      }).finally(() => {
        if (shareAttempt.current === attempt) { sharePending.current = false; setSharing(false) }
      })
    } catch {
      sharePending.current = false
      setSharing(false)
      setMessage('Sharing did not open. Try again, or use the individual photos below.')
      setShowIndividual(true)
    }
  }

  return <section className="export-card photo-share-card" aria-label="Share photos">
    <div className="export-card-heading">
      <span className="export-card-icon" aria-hidden="true"><ActionIcon name="image" /></span>
      <div><strong>{count === 1 ? 'Your finished photo' : `All ${count} slides, together`}</strong>
        <span>{width} × {height} · Full resolution</span></div>
    </div>
    {emptyPanels > 0 && <p>{emptyPanels} empty {emptyPanels === 1 ? 'panel will' : 'panels will'} stay blank.</p>}
    {processing ? <p role="status">Finishing the latest photo…</p> : !current && !error ?
      <div className="photo-prepare" role="status"><span>Preparing photo {Math.min(completed + 1, count)} of {count}…</span>
        <progress aria-label="Preparing photos" value={completed} max={count} /></div> : null}
    {error && <div className="export-warning" role="alert"><span>{error}</span>
      <button className="export-secondary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {current && <>
      <div className="share-photo-strip" aria-label="Photos in slide order">
        {current.urls.map((url, index) => <figure key={url}>
          <img src={url} alt={`Slide ${index + 1}`} draggable={false} />
          <figcaption>{String(index + 1).padStart(2, '0')}</figcaption>
        </figure>)}
      </div>
      {canShareAll ? <>
        <button className="primary export-primary share-all-photos" type="button" disabled={sharing} onClick={() => sharePhotos(current.files)}>
          <ActionIcon name="share" />{sharing ? 'Share sheet open…' : `Share ${count} ${count === 1 ? 'photo' : 'photos'}`}
        </button>
        <p>On iPhone, choose <strong>Save {count === 1 ? 'Image' : 'Images'}</strong> in the share sheet. {count === 1 ? 'Your full photo is' : `All ${count} photos are`} included.</p>
        {sharing && <button className="export-secondary" type="button" onClick={() => {
          shareAttempt.current++; sharePending.current = false; setSharing(false); setMessage('Your photos are ready to share again.')
        }}>Back from sharing</button>}
      </> : <p>This browser cannot share {count > 1 ? 'all these photos together' : 'photo files'}. {count > 1 ? 'Use the individual photos below.' : 'Touch and hold the photo below to save it, or right-click on a computer.'}</p>}
      {message && <p role="status">{message}</p>}
      {canShareAll && count > 1 && !showIndividual && <button className="photo-share-alternative" type="button" onClick={() => setShowIndividual(true)}>Share photos individually</button>}
      {(!canShareAll || showIndividual) && <div className="individual-share-photos">
        {current.files.map((file, index) => <figure key={file.name}>
          <img loading="lazy" src={current.urls[index]} alt={`Full resolution slide ${index + 1}`} />
          <figcaption>{supportsPhotoShare([file]) ? <button className="export-secondary" type="button" disabled={sharing} onClick={() => sharePhotos([file])}>Share photo {index + 1}</button> : <span>Photo {index + 1} · Touch and hold to save</span>}</figcaption>
        </figure>)}
      </div>}
    </>}
  </section>
}
