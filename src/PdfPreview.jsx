import { useEffect, useRef, useState } from 'react'

function PdfPage({ document, pageNumber }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!width || !canvasRef.current) return undefined

    let cancelled = false
    let renderTask
    setError('')
    const render = async () => {
      try {
        const page = await document.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
        const outputScale = window.devicePixelRatio || 1
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        canvas.width = Math.ceil(viewport.width * outputScale)
        canvas.height = Math.ceil(viewport.height * outputScale)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        })
        await renderTask.promise
      } catch (renderError) {
        if (!cancelled && renderError.name !== 'RenderingCancelledException') {
          setError('No se pudo mostrar esta página del informe.')
        }
      }
    }
    render()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [document, pageNumber, width])

  return (
    <div className="pdf-preview-page-container" ref={containerRef}>
      {error
        ? <p className="pdf-preview-error" role="alert">{error}</p>
        : <canvas ref={canvasRef} className="pdf-preview-page" aria-label={`Página ${pageNumber} del informe`} />}
    </div>
  )
}

export default function PdfPreview({ data }) {
  const [document, setDocument] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let task
    setDocument(null)
    setError('')
    setLoading(true)
    const load = async () => {
      try {
        const [pdfjs, worker] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ])
        if (cancelled) return
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        task = pdfjs.getDocument({ data })
        const pdf = await task.promise
        if (cancelled) {
          pdf.destroy()
          return
        }
        setDocument(pdf)
        setLoading(false)
      } catch {
        if (cancelled) return
        setError('No se pudo interpretar el PDF. Podés descargarlo o abrirlo en otra pestaña.')
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      task?.destroy()
    }
  }, [data])

  if (loading) return <p className="pdf-preview-status" role="status">Preparando previsualización…</p>
  if (error) return <p className="pdf-preview-error" role="alert">{error}</p>
  if (!document) return null

  return (
    <div className="pdf-preview-pages">
      {Array.from({ length: document.numPages }, (_, index) => (
        <PdfPage key={index + 1} document={document} pageNumber={index + 1} />
      ))}
    </div>
  )
}
