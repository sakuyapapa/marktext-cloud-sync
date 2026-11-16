export interface NoteBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface NoteRecord {
  id: string
  name: string
  /** Bound tag, e.g. `#会议`; inserted before the content when sent to the doc. */
  tag: string
  content: string
  pinned: boolean
  bounds?: NoteBounds
  updatedAt: number
}

export interface NoteSummary {
  id: string
  name: string
  tag: string
  updatedAt: number
}
