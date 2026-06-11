import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getProductionBundle } from '@/lib/data'
import { formatBytes } from '@/lib/utils'
import type { ProductionBundleDetail } from '@/lib/types'

interface PageProps {
  params: Promise<{ id: string }>
}

type ProductionSource = ProductionBundleDetail['manifest']['sources'][number]
type ProductionAsset = ProductionBundleDetail['manifest']['assets'][number]
type QualityCheck = ProductionBundleDetail['manifest']['quality']['checks'][number]

function formatDate(value: string | number): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function statusLabel(status: ProductionBundleDetail['status']): string {
  if (status === 'production-ready') return 'Ready'
  if (status === 'review-needed') return 'Review needed'
  return 'Draft'
}

function statusClass(status: ProductionBundleDetail['status']): string {
  if (status === 'production-ready') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
  if (status === 'review-needed') return 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  return 'border-zinc-700 bg-zinc-900 text-zinc-300'
}

function checkClass(level: QualityCheck['level']): string {
  if (level === 'pass') return 'text-emerald-300'
  if (level === 'warn') return 'text-amber-300'
  return 'text-rose-300'
}

function mediaHref(bundlePath: string, assetPath: string): string {
  const path = `${bundlePath}/${assetPath}`
  return `/api/media/${path.split('/').map(encodeURIComponent).join('/')}`
}

function metadataString(source: ProductionSource, key: string): string | undefined {
  const value = source.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function metadataList(source: ProductionSource, key: string): string[] {
  const value = source.metadata?.[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function videoFacts(source: ProductionSource): string[] {
  const value = source.metadata?.video
  if (!value || typeof value !== 'object') return []

  const video = value as {
    durationMs?: number
    width?: number
    height?: number
    fps?: number
    codec?: string
  }

  return [
    video.width && video.height ? `${video.width}x${video.height}` : undefined,
    typeof video.fps === 'number' ? `${video.fps} fps` : undefined,
    typeof video.durationMs === 'number' ? `${Math.round(video.durationMs / 1000)}s` : undefined,
    video.codec,
  ].filter((item): item is string => Boolean(item))
}

function transformFacts(source: ProductionSource): string[] {
  const crop = source.metadata?.crop as {
    x?: number
    y?: number
    width?: number
    height?: number
  } | undefined
  const highlights = source.metadata?.highlights
  const transformed = source.metadata?.transformed === true
  const template = metadataString(source, 'template')

  return [
    transformed ? 'transformed' : undefined,
    template ? `template ${template}` : undefined,
    crop && typeof crop.width === 'number' && typeof crop.height === 'number'
      ? `crop ${crop.width}x${crop.height} at ${crop.x ?? 0},${crop.y ?? 0}`
      : undefined,
    Array.isArray(highlights) && highlights.length > 0
      ? `${highlights.length} highlight${highlights.length === 1 ? '' : 's'}`
      : undefined,
  ].filter((item): item is string => Boolean(item))
}

function AssetPreview({ bundlePath, asset }: { bundlePath: string; asset: ProductionAsset }) {
  const src = mediaHref(bundlePath, asset.path)
  const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(asset.format)
  const isVideo = ['mp4', 'mov'].includes(asset.format)

  if (isImage) {
    return (
      <img
        src={src}
        alt={`${asset.kind} asset`}
        className="h-28 w-full rounded-md border border-zinc-800 object-cover sm:w-44"
      />
    )
  }

  if (isVideo) {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        className="h-28 w-full rounded-md border border-zinc-800 bg-black object-contain sm:w-44"
      />
    )
  }

  return (
    <div className="flex h-28 w-full items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-xs uppercase text-zinc-500 sm:w-44">
      {asset.format}
    </div>
  )
}

export default async function ProductionBundlePage({ params }: PageProps) {
  const { id } = await params
  const bundle = await getProductionBundle(id)

  if (!bundle) notFound()

  const sourceById = new Map(bundle.manifest.sources.map((source) => [source.id, source]))

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/export" className="text-zinc-500 transition-colors hover:text-zinc-300">
          Export
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="truncate text-zinc-300">{bundle.title}</span>
      </div>

      <section className="space-y-4 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-zinc-50">{bundle.title}</h1>
            <p className="mt-1 text-sm text-zinc-500">{formatDate(bundle.createdAt)}</p>
          </div>
          <span className={`rounded-md border px-2 py-1 text-xs ${statusClass(bundle.status)}`}>
            {statusLabel(bundle.status)} · {bundle.score}/100
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs md:grid-cols-5">
          <div>
            <dt className="mb-0.5 text-zinc-500">Sources</dt>
            <dd className="text-zinc-300">{bundle.sourceCount}</dd>
          </div>
          <div>
            <dt className="mb-0.5 text-zinc-500">Assets</dt>
            <dd className="text-zinc-300">{bundle.assetCount}</dd>
          </div>
          <div>
            <dt className="mb-0.5 text-zinc-500">Size</dt>
            <dd className="text-zinc-300">{formatBytes(bundle.totalSize)}</dd>
          </div>
          <div>
            <dt className="mb-0.5 text-zinc-500">Preset</dt>
            <dd className="text-zinc-300">{bundle.preset ?? 'None'}</dd>
          </div>
          <div>
            <dt className="mb-0.5 text-zinc-500">Manifest</dt>
            <dd className="truncate font-mono text-zinc-400">{bundle.manifestPath}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Assets</h2>
        <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {bundle.manifest.assets.map((asset) => {
            const source = sourceById.get(asset.sourceId)
            return (
              <article key={asset.id} className="flex flex-col gap-3 p-3 sm:flex-row">
                <AssetPreview bundlePath={bundle.path} asset={asset} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium capitalize text-zinc-100">{asset.kind}</h3>
                    <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs uppercase text-zinc-400">
                      {asset.format}
                    </span>
                    {asset.width && asset.height && (
                      <span className="text-xs text-zinc-500">{asset.width}x{asset.height}</span>
                    )}
                    <span className="text-xs text-zinc-500">{formatBytes(asset.sizeBytes)}</span>
                  </div>
                  <p className="truncate font-mono text-xs text-zinc-500">{asset.path}</p>
                  {source && (
                    <p className="truncate text-xs text-zinc-500">
                      Source: {source.filename ?? source.path}
                    </p>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Sources And Guide</h2>
        <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {bundle.manifest.sources.map((source) => {
            const guide = metadataString(source, 'guide')
            const details = metadataList(source, 'guideDetails')
            const video = videoFacts(source)
            const transforms = transformFacts(source)

            return (
              <article key={source.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-zinc-100">
                      {source.filename ?? source.path}
                    </h3>
                    <p className="truncate text-xs text-zinc-500">
                      {[source.projectName, source.sessionName, source.type].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {source.capturedAt && (
                    <span className="text-xs text-zinc-500">{formatDate(source.capturedAt)}</span>
                  )}
                </div>

                {source.caption && (
                  <p className="text-sm text-zinc-300">{source.caption}</p>
                )}

                {guide && (
                  <div>
                    <p className="mb-1 text-xs text-zinc-500">Instruction</p>
                    <p className="text-sm text-zinc-300">{guide}</p>
                  </div>
                )}

                {details.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs text-zinc-500">Rebuild Guide</p>
                    <div className="space-y-1">
                      {details.map((detail) => (
                        <p key={detail} className="break-words text-xs leading-5 text-zinc-400">
                          {detail}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {video.length > 0 && (
                  <p className="text-xs text-zinc-500">Video: {video.join(' · ')}</p>
                )}

                {transforms.length > 0 && (
                  <p className="text-xs text-zinc-500">Production: {transforms.join(' · ')}</p>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Quality Checks</h2>
        <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {bundle.manifest.quality.checks.map((check, index) => (
            <article key={`${check.sourceId}-${check.code}-${index}`} className="grid gap-2 p-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium uppercase ${checkClass(check.level)}`}>
                  {check.level}
                </span>
                <span className="truncate text-xs text-zinc-500">{check.code}</span>
              </div>
              <p className="text-sm text-zinc-300">{check.message}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
