import type { Progress } from './plan'

const TRACK = '#8a8a8a'
const RUNNING = '#d97757'
const COMPLETE = '#2e9e5b'

export function barLabel(progress: Progress): string {
  return progress.isComplete ? `All ${progress.total} done` : `${progress.done} of ${progress.total} done`
}

// A pill-shaped bar for surfaces that draw SVG; the faint grey track reads on light and dark themes alike.
export function svgBar(progress: Progress, width: number, height: number): string {
  const share = progress.total === 0 ? 0 : progress.done / progress.total
  const fill = Math.round(share * width)
  const radius = height / 2
  const color = progress.isComplete ? COMPLETE : RUNNING

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" rx="${radius}" fill="${TRACK}" fill-opacity="0.3"/>`,
    fill > 0 ? `<rect width="${fill}" height="${height}" rx="${radius}" fill="${color}"/>` : '',
    '</svg>',
  ].join('')
}
