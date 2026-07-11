import "phoenix_html"

import { Socket } from "phoenix"
import { LiveSocket } from "phoenix_live_view"
import topbar from "../vendor/topbar"

const Hooks = {}

const EDGE_SIZE = 10
const MIN_WIDTH = 110
const MIN_HEIGHT = 80
const CIRCLE_MIN_SIZE = 90
const CURSOR_SEND_INTERVAL = 33
const DRAW_SEND_INTERVAL = 16
const ERASER_SEND_INTERVAL = 24
const ERASER_RADIUS = 18
const MAX_ERASER_SAMPLES = 96
const MIN_DRAW_POINT_DISTANCE = 0.5
const STAIR_SMOOTHING_SCREEN_EPSILON = 1.8
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2.5
const MARQUEE_MIN_SIZE = 4
const OBJECT_CLIPBOARD_KEY = "open_board_clipboard_object_ids"
const pathSampleCache = new WeakMap()

const SHAPE_TOOLS = new Set([
  "line",
  "arrow",
  "rectangle",
  "rounded_rectangle",
  "ellipse",
  "triangle"
])

function getOrCreateGuestSession() {
  const idKey = "open_board_guest_id"
  const nameKey = "open_board_guest_name"
  const colorKey = "open_board_guest_color"

  let id = sessionStorage.getItem(idKey)
  let name = sessionStorage.getItem(nameKey)
  let color = sessionStorage.getItem(colorKey)

  const colors = [
    "#f97316",
    "#22c55e",
    "#38bdf8",
    "#a855f7",
    "#ec4899",
    "#eab308",
    "#14b8a6"
  ]

  if (!id) {
    if (window.crypto && window.crypto.randomUUID) {
      id = `guest-${window.crypto.randomUUID()}`
    } else {
      id = `guest-${Date.now()}-${Math.floor(Math.random() * 100000)}`
    }

    sessionStorage.setItem(idKey, id)
  }

  if (!name) {
    name = `Guest ${Math.floor(Math.random() * 900) + 100}`
    sessionStorage.setItem(nameKey, name)
  }

  if (!color) {
    color = colors[Math.floor(Math.random() * colors.length)]
    sessionStorage.setItem(colorKey, color)
  }

  return { id, name, color }
}

function clamp(value, min) {
  return Math.max(min, Math.round(value))
}

function clampBetween(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function distanceBetween(pointA, pointB) {
  const dx = pointA.x - pointB.x
  const dy = pointA.y - pointB.y

  return Math.sqrt(dx * dx + dy * dy)
}

function formatNumber(value) {
  return Number(value).toFixed(2)
}

function createSvgPath(svg, strokeId, x, y, color, width, smoothingEpsilon = 2) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")

  path.dataset.strokeId = strokeId
  path.dataset.points = `${formatNumber(x)},${formatNumber(y)}`
  path.dataset.smoothingEpsilon = `${smoothingEpsilon}`
  path.setAttribute("d", `M ${formatNumber(x)} ${formatNumber(y)}`)
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", color)
  path.setAttribute("stroke-width", width)
  path.setAttribute("stroke-linecap", "round")
  path.setAttribute("stroke-linejoin", "round")

  path._rawPoints = [{ x, y }]
  path._renderQueued = false

  svg.appendChild(path)

  return path
}

function parseSvgPoints(path) {
  const points = path.dataset.points || ""

  return points
    .split(" ")
    .filter((point) => point.trim() !== "")
    .map((point) => {
      const [x, y] = point.split(",").map((value) => Number(value))

      return { x, y }
    })
    .filter((point) => !Number.isNaN(point.x) && !Number.isNaN(point.y))
}

function getPathRawPoints(path) {
  if (!path._rawPoints) {
    path._rawPoints = parseSvgPoints(path)
  }

  return path._rawPoints
}

function serializeSvgPoints(points) {
  return points.map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" ")
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y

  if (dx === 0 && dy === 0) {
    return distanceBetween(point, lineStart)
  }

  const numerator = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x)
  const denominator = Math.sqrt(dx * dx + dy * dy)

  return numerator / denominator
}

function simplifyDouglasPeucker(points, epsilon) {
  if (points.length <= 2) {
    return points
  }

  let maxDistance = 0
  let maxIndex = 0

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], points[0], points[points.length - 1])

    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = index
    }
  }

  if (maxDistance > epsilon) {
    const left = simplifyDouglasPeucker(points.slice(0, maxIndex + 1), epsilon)
    const right = simplifyDouglasPeucker(points.slice(maxIndex), epsilon)

    return left.slice(0, -1).concat(right)
  }

  return [points[0], points[points.length - 1]]
}

function buildCatmullRomPath(points) {
  if (points.length === 0) {
    return ""
  }

  if (points.length === 1) {
    return `M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`
  }

  if (points.length === 2) {
    return `M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)} L ${formatNumber(points[1].x)} ${formatNumber(points[1].y)}`
  }

  const commands = [`M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`]

  for (let index = 0; index < points.length - 1; index += 1) {
    const point0 = points[index - 1] || points[index]
    const point1 = points[index]
    const point2 = points[index + 1]
    const point3 = points[index + 2] || point2

    const controlPoint1 = {
      x: point1.x + (point2.x - point0.x) / 6,
      y: point1.y + (point2.y - point0.y) / 6
    }

    const controlPoint2 = {
      x: point2.x - (point3.x - point1.x) / 6,
      y: point2.y - (point3.y - point1.y) / 6
    }

    commands.push(
      `C ${formatNumber(controlPoint1.x)} ${formatNumber(controlPoint1.y)} ${formatNumber(controlPoint2.x)} ${formatNumber(controlPoint2.y)} ${formatNumber(point2.x)} ${formatNumber(point2.y)}`
    )
  }

  return commands.join(" ")
}

function renderSmoothedPath(path) {
  const rawPoints = getPathRawPoints(path)
  const epsilon = Number(path.dataset.smoothingEpsilon || 2)

  const simplifiedPoints = simplifyDouglasPeucker(rawPoints, epsilon)
  path.dataset.points = serializeSvgPoints(rawPoints)
  path.setAttribute("d", buildCatmullRomPath(simplifiedPoints))
}

function schedulePathRender(path) {
  if (path._renderQueued) {
    return
  }

  path._renderQueued = true

  requestAnimationFrame(() => {
    path._renderQueued = false
    renderSmoothedPath(path)
  })
}

function appendSvgPoint(path, x, y) {
  if (!path) {
    return false
  }

  const points = getPathRawPoints(path)
  const nextPoint = { x, y }
  const lastPoint = points[points.length - 1]

  if (lastPoint && distanceBetween(lastPoint, nextPoint) < MIN_DRAW_POINT_DISTANCE) {
    return false
  }

  points.push(nextPoint)
  schedulePathRender(path)

  return true
}

function isPointNearPath(point, path, radius) {
  try {
    const bounds = path.getBBox()

    if (
      point.x < bounds.x - radius ||
      point.x > bounds.x + bounds.width + radius ||
      point.y < bounds.y - radius ||
      point.y > bounds.y + bounds.height + radius
    ) {
      return false
    }

    const signature = path.getAttribute("d") || ""
    const cached = pathSampleCache.get(path)

    if (cached && cached.signature === signature) {
      const radiusSquared = radius * radius
      return cached.points.some((pathPoint) => {
        const dx = point.x - pathPoint.x
        const dy = point.y - pathPoint.y
        return dx * dx + dy * dy <= radiusSquared
      })
    }

    const length = path.getTotalLength()
    const samples = Math.min(MAX_ERASER_SAMPLES, Math.max(12, Math.ceil(length / 14)))
    const sampledPoints = []

    for (let index = 0; index <= samples; index += 1) {
      const pathPoint = path.getPointAtLength((length * index) / samples)
      sampledPoints.push({ x: pathPoint.x, y: pathPoint.y })
    }

    pathSampleCache.set(path, { signature, points: sampledPoints })
    const radiusSquared = radius * radius

    return sampledPoints.some((pathPoint) => {
      const dx = point.x - pathPoint.x
      const dy = point.y - pathPoint.y
      return dx * dx + dy * dy <= radiusSquared
    })
  } catch (_error) {
    return false
  }
}

function getResizeMode(element, event) {
  const rect = element.getBoundingClientRect()

  const offsetX = event.clientX - rect.left
  const offsetY = event.clientY - rect.top

  const nearLeft = offsetX <= EDGE_SIZE
  const nearRight = offsetX >= rect.width - EDGE_SIZE
  const nearTop = offsetY <= EDGE_SIZE
  const nearBottom = offsetY >= rect.height - EDGE_SIZE

  if (nearLeft && nearTop) return "nw"
  if (nearRight && nearTop) return "ne"
  if (nearLeft && nearBottom) return "sw"
  if (nearRight && nearBottom) return "se"
  if (nearLeft) return "w"
  if (nearRight) return "e"
  if (nearTop) return "n"
  if (nearBottom) return "s"

  return null
}

function cursorForResizeMode(mode) {
  switch (mode) {
    case "n":
    case "s":
      return "ns-resize"
    case "e":
    case "w":
      return "ew-resize"
    case "ne":
    case "sw":
      return "nesw-resize"
    case "nw":
    case "se":
      return "nwse-resize"
    default:
      return "move"
  }
}

function createPreviewShape(layer, kind, color) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "g")
  element.dataset.previewShape = "true"

  if (kind === "line" || kind === "arrow") {
    if (kind === "arrow") {
      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs")
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
      const markerPath = document.createElementNS("http://www.w3.org/2000/svg", "path")

      marker.setAttribute("id", "shape-preview-arrowhead")
      marker.setAttribute("markerWidth", "10")
      marker.setAttribute("markerHeight", "10")
      marker.setAttribute("refX", "8")
      marker.setAttribute("refY", "5")
      marker.setAttribute("orient", "auto")
      marker.setAttribute("markerUnits", "strokeWidth")

      markerPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z")
      markerPath.setAttribute("fill", color)

      marker.appendChild(markerPath)
      defs.appendChild(marker)
      element.appendChild(defs)
    }

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
    line.dataset.previewMain = "true"
    line.setAttribute("stroke", color)
    line.setAttribute("stroke-width", "3")
    line.setAttribute("stroke-linecap", "round")
    line.setAttribute("vector-effect", "non-scaling-stroke")

    if (kind === "arrow") {
      line.setAttribute("marker-end", "url(#shape-preview-arrowhead)")
    }

    element.appendChild(line)
  } else if (kind === "ellipse") {
    const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse")
    ellipse.dataset.previewMain = "true"
    ellipse.setAttribute("fill", "rgba(255, 255, 255, 0.25)")
    ellipse.setAttribute("stroke", color)
    ellipse.setAttribute("stroke-width", "3")
    ellipse.setAttribute("vector-effect", "non-scaling-stroke")
    element.appendChild(ellipse)
  } else if (kind === "triangle") {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon")
    polygon.dataset.previewMain = "true"
    polygon.setAttribute("fill", "rgba(255, 255, 255, 0.25)")
    polygon.setAttribute("stroke", color)
    polygon.setAttribute("stroke-width", "3")
    polygon.setAttribute("stroke-linejoin", "round")
    polygon.setAttribute("vector-effect", "non-scaling-stroke")
    element.appendChild(polygon)
  } else {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
    rect.dataset.previewMain = "true"
    rect.setAttribute("fill", "rgba(255, 255, 255, 0.25)")
    rect.setAttribute("stroke", color)
    rect.setAttribute("stroke-width", "3")
    rect.setAttribute("vector-effect", "non-scaling-stroke")

    if (kind === "rounded_rectangle") {
      rect.setAttribute("rx", "18")
      rect.setAttribute("ry", "18")
    }

    element.appendChild(rect)
  }

  layer.appendChild(element)

  return element
}

function updatePreviewShape(preview, kind, startPoint, currentPoint) {
  const main = preview.querySelector("[data-preview-main]")

  if (!main) {
    return
  }

  if (kind === "line" || kind === "arrow") {
    main.setAttribute("x1", startPoint.x)
    main.setAttribute("y1", startPoint.y)
    main.setAttribute("x2", currentPoint.x)
    main.setAttribute("y2", currentPoint.y)
    return
  }

  const x = Math.min(startPoint.x, currentPoint.x)
  const y = Math.min(startPoint.y, currentPoint.y)
  const width = Math.abs(currentPoint.x - startPoint.x)
  const height = Math.abs(currentPoint.y - startPoint.y)

  if (kind === "ellipse") {
    main.setAttribute("cx", x + width / 2)
    main.setAttribute("cy", y + height / 2)
    main.setAttribute("rx", Math.max(width / 2, 1))
    main.setAttribute("ry", Math.max(height / 2, 1))
    return
  }

  if (kind === "triangle") {
    const points = `${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}`
    main.setAttribute("points", points)
    return
  }

  main.setAttribute("x", x)
  main.setAttribute("y", y)
  main.setAttribute("width", width)
  main.setAttribute("height", height)
}

function buildShapePayload(kind, startPoint, currentPoint) {
  if (kind === "line" || kind === "arrow") {
    const dx = currentPoint.x - startPoint.x
    const dy = currentPoint.y - startPoint.y
    const length = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
    const rotation = (Math.atan2(dy, dx) * 180) / Math.PI

    return {
      kind: kind,
      x: startPoint.x,
      y: startPoint.y - 12,
      width: length,
      height: 24,
      rotation: rotation
    }
  }

  return {
    kind: kind,
    x: Math.min(startPoint.x, currentPoint.x),
    y: Math.min(startPoint.y, currentPoint.y),
    width: Math.max(Math.abs(currentPoint.x - startPoint.x), 8),
    height: Math.max(Math.abs(currentPoint.y - startPoint.y), 8),
    rotation: 0
  }
}

function buildFreehandObjectPayload(path, strokeId, color, strokeWidth) {
  if (!path) {
    return null
  }

  const rawPoints = getPathRawPoints(path)

  if (rawPoints.length < 2) {
    return null
  }

  const padding = Math.max(strokeWidth * 2, 8)
  const minX = Math.min(...rawPoints.map((point) => point.x))
  const minY = Math.min(...rawPoints.map((point) => point.y))
  const maxX = Math.max(...rawPoints.map((point) => point.x))
  const maxY = Math.max(...rawPoints.map((point) => point.y))

  const left = minX - padding
  const top = minY - padding
  const width = Math.max(maxX - minX + padding * 2, strokeWidth * 2, 1)
  const height = Math.max(maxY - minY + padding * 2, strokeWidth * 2, 1)

  const normalizedPoints = rawPoints.map((point) => ({
    x: point.x - left,
    y: point.y - top
  }))

  const epsilon = Number(path.dataset.smoothingEpsilon || 2)
  const simplifiedPoints = simplifyDouglasPeucker(normalizedPoints, epsilon)
  const d = buildCatmullRomPath(simplifiedPoints)

  if (!d || d.trim() === "") {
    return null
  }

  return {
    stroke_id: strokeId,
    x: left,
    y: top,
    width: width,
    height: height,
    d: d,
    color: color,
    stroke_width: strokeWidth,
    smoothing_epsilon: epsilon
  }
}

Hooks.BoardSurface = {
  mounted() {
    this.guest = getOrCreateGuestSession()
    this.viewportGrid = document.getElementById("viewport-grid")
    this.world = document.getElementById("board-world")
    this.cursorLayer = document.getElementById("remote-cursor-layer")
    this.drawingLayer = document.getElementById("drawing-layer")
    this.shapePreviewLayer = document.getElementById("shape-preview-layer")

    this.workspaceWidth = Number(this.el.dataset.workspaceWidth || 6000)
    this.workspaceHeight = Number(this.el.dataset.workspaceHeight || 4000)

    this.camera = {
      x: 0,
      y: 0,
      zoom: 1
    }

    this.remoteCursors = new Map()
    this.remoteStrokes = new Map()
    this.selectedObjectIds = new Set()
    this.clipboardObjectIds = []
    this.selectionBox = document.getElementById("selection-box")
    this.stickyGhost = null
    this.wholeEraseObjectIds = new Set()
    this.pixelEraseChanges = new Map()

    this.lastCursorSentAt = 0
    this.lastDrawSentAt = 0
    this.lastEraseSentAt = 0

    this.isDrawing = false
    this.isErasing = false
    this.isPanning = false
    this.isShapeDrawing = false
    this.isMarqueeSelecting = false

    this.currentStrokeId = null
    this.currentLocalPath = null
    this.currentShapeKind = null
    this.currentShapeStartPoint = null
    this.currentShapeEndPoint = null
    this.currentShapePreview = null
    this.marqueeStartBoardPoint = null
    this.marqueeCurrentBoardPoint = null
    this.marqueeStartScreenPoint = null
    this.marqueeCurrentScreenPoint = null

    this.startPointerX = 0
    this.startPointerY = 0
    this.startCameraX = 0
    this.startCameraY = 0

    window.OpenBoardSurface = this

    this.updateDatasetState()
    this.centerInitialCamera()
    this.applyCamera()

    this.onContextMenu = (event) => {
      event.preventDefault()
    }

    this.onWheel = (event) => {
      this.zoomAtPointer(event)
    }

    this.onKeyDown = (event) => {
      const tagName = (event.target && event.target.tagName ? event.target.tagName : "").toLowerCase()
      const isEditableTarget =
        tagName === "input" || tagName === "textarea" || Boolean(event.target && event.target.isContentEditable)
      const isCommandKey = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (event.key === "Escape") {
        if (this.stickyGhost || this.selectedTool === "sticky") {
          event.preventDefault()
          this.removeStickyGhost()
          this.pushEvent("cancel_placement", {})
        }

        return
      }

      if (isCommandKey && key === "a") {
        event.preventDefault()
        this.blurEditableTarget(isEditableTarget)
        this.selectAllObjects()
        return
      }

      if (isCommandKey && key === "c") {
        event.preventDefault()
        this.blurEditableTarget(isEditableTarget)
        this.copySelectedObjects()
        return
      }

      if (isCommandKey && key === "v") {
        event.preventDefault()
        this.blurEditableTarget(isEditableTarget)
        this.pasteCopiedObjects()
        return
      }

      if (isCommandKey && key === "z" && !event.shiftKey) {
        event.preventDefault()
        this.blurEditableTarget(isEditableTarget)
        this.clearSelectedObjects()
        this.pushEvent("undo", {})
        return
      }

      if (isEditableTarget) {
        return
      }

      const selectedIds = this.currentSelectedObjectIds()

      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0) {
        event.preventDefault()

        this.pushEvent("delete_objects", {
          ids: selectedIds
        })

        this.selectedObjectIds.clear()
        this.clearSelectionOutline()
      }
    }

    this.onPointerMove = (event) => {
      this.sendCursorMove(event)
      this.positionStickyGhost(event)

      if (this.isDrawing) {
        this.addLocalDrawingPoint(event)
      }

      if (this.isErasing) {
        this.eraseAtPointer(event)
      }
    }

    this.onPointerDown = (event) => {
      this.updateDatasetState()

      const isPrimaryButton = event.button === 0
      const isMiddleButton = event.button === 1
      const isRightButton = event.button === 2
      const isBoardObject = event.target.closest("[data-board-object]")

      if (isMiddleButton || isRightButton) {
        this.startPanning(event)
        return
      }

      if (!isPrimaryButton) {
        return
      }

      if (this.selectedTool === "cursor") {
        if (isBoardObject) {
          return
        }

        this.startMarqueeSelection(event)
        return
      }

      if (this.selectedTool === "draw") {
        this.clearSelectedObjects()
        this.startDrawing(event)
        return
      }

      if (this.selectedTool === "object_eraser" || this.selectedTool === "pixel_eraser") {
        this.clearSelectedObjects()
        this.startErasing(event)
        return
      }

      if (this.selectedTool === "sticky" && this.stickyGhost) {
        this.placeStickyAtPointer(event)
        return
      }

      if (SHAPE_TOOLS.has(this.selectedTool)) {
        this.clearSelectedObjects()
        this.startShapeDrawing(event)
        return
      }

      if (isBoardObject) {
        this.startPanning(event)
        return
      }

      this.clearSelectedObjects()
      this.startPanning(event)
    }

    this.onDocumentPointerMove = (event) => {
      if (this.isDrawing) {
        this.addLocalDrawingPoint(event)
      }

      if (this.isErasing) {
        this.eraseAtPointer(event)
      }

      if (this.isPanning) {
        this.panAtPointer(event)
      }

      if (this.isShapeDrawing) {
        this.updateShapeDrawing(event)
      }

      if (this.isMarqueeSelecting) {
        this.updateMarqueeSelection(event)
      }
    }

    this.onDocumentPointerUp = () => {
      if (this.isDrawing) {
        this.finishDrawing()
      }

      if (this.isErasing) {
        this.finishErasing()
      }

      if (this.isPanning) {
        this.finishPanning()
      }

      if (this.isShapeDrawing) {
        this.finishShapeDrawing()
      }

      if (this.isMarqueeSelecting) {
        this.finishMarqueeSelection()
      }
    }

    this.handleEvent("remote_cursor_moved", (cursor) => {
      this.renderRemoteCursor(cursor)
    })

    this.handleEvent("presence_sync", ({ user_ids }) => {
      this.cleanupRemoteCursors(user_ids)
    })

    this.handleEvent("objects_pasted", ({ ids }) => {
      const pastedIds = (ids || []).map((id) => `${id}`)

      window.setTimeout(() => {
        this.selectObjects(pastedIds)
      }, 0)
    })

    this.handleEvent("sticky_ghost_started", ({ color }) => {
      this.createStickyGhost(color)
    })

    this.handleEvent("sticky_ghost_finished", () => {
      this.removeStickyGhost()
    })

    this.handleEvent("remote_drawing_started", (drawing) => {
      if (drawing.user_id === this.guest.id) {
        return
      }

      this.ensureClientLayers()

      const path = createSvgPath(
        this.drawingLayer,
        drawing.stroke_id,
        drawing.x,
        drawing.y,
        drawing.color,
        drawing.width,
        drawing.smoothing_epsilon || this.strokeSmoothingEpsilon()
      )

      this.remoteStrokes.set(drawing.stroke_id, path)
    })

    this.handleEvent("remote_drawing_point_added", (drawing) => {
      if (drawing.user_id === this.guest.id) {
        return
      }

      const path = this.remoteStrokes.get(drawing.stroke_id) || this.findStrokePath(drawing.stroke_id)
      appendSvgPoint(path, drawing.x, drawing.y)
    })

    this.handleEvent("remote_drawing_finished", (drawing) => {
      this.removeStroke(drawing.stroke_id)
    })

    this.handleEvent("remote_drawing_erased", (drawing) => {
      this.removeStroke(drawing.stroke_id)
    })

    this.el.addEventListener("contextmenu", this.onContextMenu)
    this.el.addEventListener("wheel", this.onWheel, { passive: false })
    this.el.addEventListener("pointermove", this.onPointerMove)
    this.el.addEventListener("pointerdown", this.onPointerDown)
    document.addEventListener("keydown", this.onKeyDown, true)
  },

  updated() {
    this.updateDatasetState()
    this.ensureClientLayers()
    this.applyCamera()
    this.reconnectRemoteCursorElements()
    this.reapplySelectionOutline()
  },

  destroyed() {
    if (window.OpenBoardSurface === this) {
      window.OpenBoardSurface = null
    }

    if (this.onContextMenu) {
      this.el.removeEventListener("contextmenu", this.onContextMenu)
    }

    if (this.onWheel) {
      this.el.removeEventListener("wheel", this.onWheel)
    }

    if (this.onPointerMove) {
      this.el.removeEventListener("pointermove", this.onPointerMove)
    }

    if (this.onPointerDown) {
      this.el.removeEventListener("pointerdown", this.onPointerDown)
    }

    if (this.onKeyDown) {
      document.removeEventListener("keydown", this.onKeyDown, true)
    }

    if (this.onDocumentPointerMove) {
      document.removeEventListener("pointermove", this.onDocumentPointerMove)
    }

    if (this.onDocumentPointerUp) {
      document.removeEventListener("pointerup", this.onDocumentPointerUp)
    }

    this.removeStickyGhost()
  },

  updateDatasetState() {
    this.selectedTool = this.el.dataset.selectedTool || "pan"
    this.selectedColor = this.el.dataset.selectedColor || "#fde047"

    if (this.selectedTool === "cursor") {
      this.el.style.cursor = "default"
    } else if (this.selectedTool === "draw") {
      this.el.style.cursor = "crosshair"
    } else if (this.selectedTool === "object_eraser") {
      this.el.style.cursor = "cell"
    } else if (this.selectedTool === "pixel_eraser") {
      this.el.style.cursor = "crosshair"
    } else if (SHAPE_TOOLS.has(this.selectedTool)) {
      this.el.style.cursor = "crosshair"
    } else {
      this.el.style.cursor = "grab"
    }
  },

  createStickyGhost(color) {
    this.removeStickyGhost()

    const ghost = document.createElement("div")
    ghost.id = "sticky-note-ghost"
    ghost.className =
      "pointer-events-none absolute z-[110000] h-[150px] w-[240px] rounded-xl border-2 border-dashed border-slate-700/50 p-4 text-sm font-semibold text-slate-700 shadow-2xl opacity-75"
    ghost.style.backgroundColor = color
    ghost.textContent = "Click to place sticky note · Esc to cancel"
    ghost.style.left = `${Math.max((this.el.clientWidth - 240) / 2, 0)}px`
    ghost.style.top = `${Math.max((this.el.clientHeight - 150) / 2, 0)}px`

    this.el.appendChild(ghost)
    this.stickyGhost = ghost
    this.updateDatasetState()
  },

  positionStickyGhost(event) {
    if (!this.stickyGhost) {
      return
    }

    const rect = this.el.getBoundingClientRect()
    const left = clampBetween(event.clientX - rect.left + 18, 0, Math.max(this.el.clientWidth - 240, 0))
    const top = clampBetween(event.clientY - rect.top + 18, 0, Math.max(this.el.clientHeight - 150, 0))

    this.stickyGhost.style.left = `${left}px`
    this.stickyGhost.style.top = `${top}px`
  },

  placeStickyAtPointer(event) {
    event.preventDefault()

    const point = this.screenToBoardPoint(event)

    if (!this.isPointInside(point)) {
      return
    }

    this.pushEvent("create_sticky_at", {
      x: point.x - 120,
      y: point.y - 75
    })

    this.removeStickyGhost()
  },

  removeStickyGhost() {
    if (this.stickyGhost) {
      this.stickyGhost.remove()
      this.stickyGhost = null
    }
  },

  centerInitialCamera() {
    this.camera = {
      x: (this.el.clientWidth - this.workspaceWidth) / 2,
      y: (this.el.clientHeight - this.workspaceHeight) / 2,
      zoom: 1
    }
  },

  ensureClientLayers() {
    this.viewportGrid = document.getElementById("viewport-grid")
    this.world = document.getElementById("board-world")
    this.cursorLayer = document.getElementById("remote-cursor-layer")
    this.drawingLayer = document.getElementById("drawing-layer")
    this.shapePreviewLayer = document.getElementById("shape-preview-layer")
    this.selectionBox = document.getElementById("selection-box")
  },

  applyCamera() {
    this.ensureClientLayers()

    if (!this.world) {
      return
    }

    this.camera = this.clampedCamera(this.camera)
    this.world.style.transform = `translate3d(${this.camera.x}px, ${this.camera.y}px, 0) scale(${this.camera.zoom})`
    this.world.style.transformOrigin = "0 0"

    this.updateVectorLayerViewBoxes()
    this.updateViewportGrid()
    this.repositionRemoteCursors()
  },

  updateVectorLayerViewBoxes() {
    const left = -this.camera.x / this.camera.zoom
    const top = -this.camera.y / this.camera.zoom
    const width = this.el.clientWidth / this.camera.zoom
    const height = this.el.clientHeight / this.camera.zoom
    const viewBox = `${left} ${top} ${width} ${height}`

    for (const layer of [this.drawingLayer, this.shapePreviewLayer]) {
      if (!layer) {
        continue
      }

      layer.setAttribute("viewBox", viewBox)
      layer.setAttribute("width", this.el.clientWidth)
      layer.setAttribute("height", this.el.clientHeight)
    }
  },

  updateViewportGrid() {
    if (!this.viewportGrid) {
      return
    }

    const minor = 20 * this.camera.zoom
    const major = 80 * this.camera.zoom

    this.viewportGrid.style.backgroundSize = `
      ${major}px ${major}px,
      ${major}px ${major}px,
      ${minor}px ${minor}px,
      ${minor}px ${minor}px
    `

    this.viewportGrid.style.backgroundPosition = `
      ${this.camera.x % major}px ${this.camera.y % major}px,
      ${this.camera.x % major}px ${this.camera.y % major}px,
      ${this.camera.x % minor}px ${this.camera.y % minor}px,
      ${this.camera.x % minor}px ${this.camera.y % minor}px
    `
  },

  clampedCamera(camera) {
    const viewportWidth = this.el.clientWidth
    const viewportHeight = this.el.clientHeight
    const scaledWidth = this.workspaceWidth * camera.zoom
    const scaledHeight = this.workspaceHeight * camera.zoom

    const minX = Math.min(viewportWidth - scaledWidth, 0)
    const minY = Math.min(viewportHeight - scaledHeight, 0)
    const maxX = 0
    const maxY = 0

    return {
      x: clampBetween(camera.x, minX, maxX),
      y: clampBetween(camera.y, minY, maxY),
      zoom: clampBetween(camera.zoom, MIN_ZOOM, MAX_ZOOM)
    }
  },

  screenToBoardPoint(event) {
    const rect = this.el.getBoundingClientRect()

    return {
      x: (event.clientX - rect.left - this.camera.x) / this.camera.zoom,
      y: (event.clientY - rect.top - this.camera.y) / this.camera.zoom
    }
  },

  boardToScreenPoint(point) {
    return {
      x: point.x * this.camera.zoom + this.camera.x,
      y: point.y * this.camera.zoom + this.camera.y
    }
  },

  screenDeltaToBoardDelta(deltaX, deltaY) {
    return {
      x: deltaX / this.camera.zoom,
      y: deltaY / this.camera.zoom
    }
  },

  isPointInside(point) {
    return (
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= this.workspaceWidth &&
      point.y <= this.workspaceHeight
    )
  },

  strokeSmoothingEpsilon() {
    return STAIR_SMOOTHING_SCREEN_EPSILON / this.camera.zoom
  },

  zoomAtPointer(event) {
    event.preventDefault()

    const rect = this.el.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    const boardX = (mouseX - this.camera.x) / this.camera.zoom
    const boardY = (mouseY - this.camera.y) / this.camera.zoom

    const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92
    const nextZoom = clampBetween(this.camera.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM)

    this.camera = {
      x: mouseX - boardX * nextZoom,
      y: mouseY - boardY * nextZoom,
      zoom: nextZoom
    }

    this.applyCamera()
  },

  startPanning(event) {
    event.preventDefault()

    this.isPanning = true
    this.startPointerX = event.clientX
    this.startPointerY = event.clientY
    this.startCameraX = this.camera.x
    this.startCameraY = this.camera.y
    this.el.style.cursor = "grabbing"

    document.addEventListener("pointermove", this.onDocumentPointerMove)
    document.addEventListener("pointerup", this.onDocumentPointerUp)
  },

  panAtPointer(event) {
    const deltaX = event.clientX - this.startPointerX
    const deltaY = event.clientY - this.startPointerY

    this.camera = {
      ...this.camera,
      x: this.startCameraX + deltaX,
      y: this.startCameraY + deltaY
    }

    this.applyCamera()
  },

  finishPanning() {
    this.isPanning = false
    this.updateDatasetState()

    document.removeEventListener("pointermove", this.onDocumentPointerMove)
    document.removeEventListener("pointerup", this.onDocumentPointerUp)
  },

  selectObject(objectId, element, additive = false) {
    if (!additive) {
      this.selectedObjectIds.clear()
      this.clearSelectionOutline()
    }

    if (this.selectedObjectIds.has(objectId) && additive) {
      this.selectedObjectIds.delete(objectId)

      if (element) {
        element.classList.remove("ring-2", "ring-blue-500")
      }

      return
    }

    this.selectedObjectIds.add(objectId)

    if (element) {
      element.classList.add("ring-2", "ring-blue-500")
    }
  },

  selectObjects(objectIds) {
    this.selectedObjectIds = new Set((objectIds || []).map((objectId) => `${objectId}`))
    this.clearSelectionOutline()
    this.reapplySelectionOutline()
  },

  selectAllObjects() {
    const objectIds = Array.from(document.querySelectorAll("[data-board-object]"))
      .map((element) => element.dataset.objectId)
      .filter(Boolean)

    this.selectObjects(objectIds)
  },

  currentSelectedObjectIds() {
    const selectedIds = new Set()

    if (this.selectedObjectIds) {
      for (const objectId of this.selectedObjectIds) {
        if (objectId) {
          selectedIds.add(`${objectId}`)
        }
      }
    }

    document.querySelectorAll("[data-board-object].ring-blue-500").forEach((element) => {
      if (element.dataset.objectId) {
        selectedIds.add(`${element.dataset.objectId}`)
      }
    })

    return Array.from(selectedIds)
  },

  isObjectSelected(objectId) {
    return this.currentSelectedObjectIds().includes(`${objectId}`)
  },

  selectedObjectElements() {
    return this.currentSelectedObjectIds()
      .map((objectId) => document.getElementById(`board-object-${objectId}`))
      .filter(Boolean)
  },

  rememberClipboardObjectIds(objectIds) {
    this.clipboardObjectIds = (objectIds || []).map((objectId) => `${objectId}`)

    try {
      sessionStorage.setItem(OBJECT_CLIPBOARD_KEY, JSON.stringify(this.clipboardObjectIds))
    } catch (_error) {
      // Session storage can be unavailable in some privacy modes.
    }
  },

  readClipboardObjectIds() {
    if (this.clipboardObjectIds && this.clipboardObjectIds.length > 0) {
      return this.clipboardObjectIds
    }

    try {
      const storedValue = sessionStorage.getItem(OBJECT_CLIPBOARD_KEY)
      const parsedValue = JSON.parse(storedValue || "[]")

      if (Array.isArray(parsedValue)) {
        this.clipboardObjectIds = parsedValue.map((objectId) => `${objectId}`).filter(Boolean)
        return this.clipboardObjectIds
      }
    } catch (_error) {
      // Ignore invalid stored clipboard values.
    }

    return []
  },

  blurEditableTarget(isEditableTarget) {
    if (!isEditableTarget || !document.activeElement || document.activeElement === document.body) {
      return
    }

    document.activeElement.blur()
  },

  copySelectedObjects() {
    const objectIds = this.currentSelectedObjectIds()

    if (objectIds.length === 0) {
      this.rememberClipboardObjectIds([])
      return
    }

    this.rememberClipboardObjectIds(objectIds)
  },

  pasteCopiedObjects() {
    const objectIds = this.readClipboardObjectIds()

    if (objectIds.length === 0) {
      return
    }

    this.pushEvent("paste_objects", {
      ids: objectIds
    })
  },

  clearSelectedObjects() {
    this.selectedObjectIds.clear()
    this.clearSelectionOutline()
  },

  clearSelectionOutline() {
    document.querySelectorAll("[data-board-object]").forEach((element) => {
      element.classList.remove("ring-2", "ring-blue-500")
    })
  },

  reapplySelectionOutline() {
    if (!this.selectedObjectIds || this.selectedObjectIds.size === 0) {
      return
    }

    for (const objectId of this.selectedObjectIds) {
      const element = document.getElementById(`board-object-${objectId}`)

      if (element) {
        element.classList.add("ring-2", "ring-blue-500")
      }
    }
  },

  startMarqueeSelection(event) {
    event.preventDefault()

    this.isMarqueeSelecting = true
    this.marqueeStartBoardPoint = this.screenToBoardPoint(event)
    this.marqueeCurrentBoardPoint = this.marqueeStartBoardPoint

    const rect = this.el.getBoundingClientRect()
    this.marqueeStartScreenPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }
    this.marqueeCurrentScreenPoint = this.marqueeStartScreenPoint

    if (this.selectionBox) {
      this.selectionBox.style.display = "block"
      this.updateSelectionBoxElement()
    }

    document.addEventListener("pointermove", this.onDocumentPointerMove)
    document.addEventListener("pointerup", this.onDocumentPointerUp)
  },

  updateMarqueeSelection(event) {
    this.marqueeCurrentBoardPoint = this.screenToBoardPoint(event)

    const rect = this.el.getBoundingClientRect()
    this.marqueeCurrentScreenPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }

    this.updateSelectionBoxElement()
  },

  updateSelectionBoxElement() {
    if (!this.selectionBox || !this.marqueeStartScreenPoint || !this.marqueeCurrentScreenPoint) {
      return
    }

    const left = Math.min(this.marqueeStartScreenPoint.x, this.marqueeCurrentScreenPoint.x)
    const top = Math.min(this.marqueeStartScreenPoint.y, this.marqueeCurrentScreenPoint.y)
    const width = Math.abs(this.marqueeCurrentScreenPoint.x - this.marqueeStartScreenPoint.x)
    const height = Math.abs(this.marqueeCurrentScreenPoint.y - this.marqueeStartScreenPoint.y)

    this.selectionBox.style.left = `${left}px`
    this.selectionBox.style.top = `${top}px`
    this.selectionBox.style.width = `${width}px`
    this.selectionBox.style.height = `${height}px`
  },

  finishMarqueeSelection() {
    this.isMarqueeSelecting = false

    document.removeEventListener("pointermove", this.onDocumentPointerMove)
    document.removeEventListener("pointerup", this.onDocumentPointerUp)

    if (this.selectionBox) {
      this.selectionBox.style.display = "none"
    }

    const start = this.marqueeStartBoardPoint
    const end = this.marqueeCurrentBoardPoint || start

    this.marqueeStartBoardPoint = null
    this.marqueeCurrentBoardPoint = null
    this.marqueeStartScreenPoint = null
    this.marqueeCurrentScreenPoint = null

    if (!start || !end) {
      return
    }

    const rect = {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      right: Math.max(start.x, end.x),
      bottom: Math.max(start.y, end.y)
    }

    const width = Math.abs(end.x - start.x)
    const height = Math.abs(end.y - start.y)

    if (width < MARQUEE_MIN_SIZE && height < MARQUEE_MIN_SIZE) {
      this.clearSelectedObjects()
      return
    }

    const selectedIds = Array.from(document.querySelectorAll("[data-board-object]"))
      .filter((element) => this.objectIntersectsRect(element, rect))
      .map((element) => element.dataset.objectId)
      .filter(Boolean)

    this.selectObjects(selectedIds)
  },

  objectIntersectsRect(element, rect) {
    const left = parseFloat(element.style.left || "0")
    const top = parseFloat(element.style.top || "0")
    const width = parseFloat(element.style.width || "0")
    const height = parseFloat(element.style.height || "0")

    const objectRect = {
      left: left,
      top: top,
      right: left + width,
      bottom: top + height
    }

    return !(
      objectRect.right < rect.left ||
      objectRect.left > rect.right ||
      objectRect.bottom < rect.top ||
      objectRect.top > rect.bottom
    )
  },

  reconnectRemoteCursorElements() {
    for (const [userId, element] of this.remoteCursors.entries()) {
      if (!element.isConnected) {
        this.remoteCursors.delete(userId)
      }
    }
  },

  sendCursorMove(event) {
    const now = Date.now()

    if (now - this.lastCursorSentAt < CURSOR_SEND_INTERVAL) {
      return
    }

    this.lastCursorSentAt = now

    const point = this.screenToBoardPoint(event)

    if (!this.isPointInside(point)) {
      return
    }

    this.pushEvent("cursor_move", {
      x: point.x,
      y: point.y
    })
  },

  startShapeDrawing(event) {
    event.preventDefault()

    const point = this.screenToBoardPoint(event)

    if (!this.isPointInside(point)) {
      return
    }

    this.ensureClientLayers()

    this.isShapeDrawing = true
    this.currentShapeKind = this.selectedTool
    this.currentShapeStartPoint = point
    this.currentShapeEndPoint = point
    this.currentShapePreview = createPreviewShape(
      this.shapePreviewLayer,
      this.currentShapeKind,
      this.selectedColor
    )

    updatePreviewShape(this.currentShapePreview, this.currentShapeKind, point, point)

    document.addEventListener("pointermove", this.onDocumentPointerMove)
    document.addEventListener("pointerup", this.onDocumentPointerUp)
  },

  updateShapeDrawing(event) {
    const point = this.screenToBoardPoint(event)

    if (!this.isPointInside(point)) {
      return
    }

    this.currentShapeEndPoint = point

    updatePreviewShape(
      this.currentShapePreview,
      this.currentShapeKind,
      this.currentShapeStartPoint,
      point
    )
  },

  finishShapeDrawing() {
    const preview = this.currentShapePreview
    const kind = this.currentShapeKind
    const startPoint = this.currentShapeStartPoint
    const endPoint = this.currentShapeEndPoint || startPoint

    this.isShapeDrawing = false
    this.currentShapeKind = null
    this.currentShapeStartPoint = null
    this.currentShapeEndPoint = null
    this.currentShapePreview = null

    document.removeEventListener("pointermove", this.onDocumentPointerMove)
    document.removeEventListener("pointerup", this.onDocumentPointerUp)

    if (!preview || !kind || !startPoint || !endPoint) {
      return
    }

    preview.remove()

    const payload = buildShapePayload(kind, startPoint, endPoint)

    if (payload.width < 8 && payload.height < 8) {
      return
    }

    this.pushEvent("create_shape", payload)
  },

  startDrawing(event) {
    event.preventDefault()

    const point = this.screenToBoardPoint(event)

    if (!this.isPointInside(point)) {
      return
    }

    this.ensureClientLayers()

    this.isDrawing = true
    this.currentStrokeId = `stroke-${this.guest.id}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
    const smoothingEpsilon = this.strokeSmoothingEpsilon()

    this.currentLocalPath = createSvgPath(
      this.drawingLayer,
      this.currentStrokeId,
      point.x,
      point.y,
      this.selectedColor,
      4,
      smoothingEpsilon
    )

    this.pushEvent("drawing_start", {
      stroke_id: this.currentStrokeId,
      x: point.x,
      y: point.y,
      smoothing_epsilon: smoothingEpsilon
    })

    document.addEventListener("pointermove", this.onDocumentPointerMove)
    document.addEventListener("pointerup", this.onDocumentPointerUp)
  },

  addLocalDrawingPoint(event) {
    const now = Date.now()

    if (now - this.lastDrawSentAt < DRAW_SEND_INTERVAL) {
      return
    }

    this.lastDrawSentAt = now

    const point = this.screenToBoardPoint(event)

    if (!this.isPointInside(point)) {
      return
    }

    const didAppend = appendSvgPoint(this.currentLocalPath, point.x, point.y)

    if (!didAppend) {
      return
    }

    this.pushEvent("drawing_point", {
      stroke_id: this.currentStrokeId,
      x: point.x,
      y: point.y
    })
  },

  finishDrawing() {
    this.isDrawing = false

    document.removeEventListener("pointermove", this.onDocumentPointerMove)
    document.removeEventListener("pointerup", this.onDocumentPointerUp)

    const strokeId = this.currentStrokeId
    const freehandPayload = buildFreehandObjectPayload(
      this.currentLocalPath,
      strokeId,
      this.selectedColor,
      4
    )

    if (freehandPayload) {
      this.pushEvent("drawing_end", freehandPayload)
    } else {
      this.pushEvent("drawing_end", {
        stroke_id: strokeId
      })
    }

    this.removeStroke(strokeId)

    this.currentStrokeId = null
    this.currentLocalPath = null
  },

  startErasing(event) {
    event.preventDefault()

    this.isErasing = true
    this.wholeEraseObjectIds = new Set()
    this.pixelEraseChanges = new Map()
    this.eraseAtPointer(event)

    document.addEventListener("pointermove", this.onDocumentPointerMove)
    document.addEventListener("pointerup", this.onDocumentPointerUp)
  },

  eraseAtPointer(event) {
    const now = Date.now()

    if (now - this.lastEraseSentAt < ERASER_SEND_INTERVAL) {
      return
    }

    this.lastEraseSentAt = now

    this.ensureClientLayers()

    if (this.selectedTool === "object_eraser") {
      this.eraseWholeObjectAtPointer(event)
    } else if (this.selectedTool === "pixel_eraser") {
      this.erasePixelsAtPointer(event)
    }
  },

  drawingObjectElements() {
    return Array.from(
      document.querySelectorAll(
        '[data-board-object][data-object-kind="freehand"], [data-board-object][data-object-kind="line"], [data-board-object][data-object-kind="arrow"], [data-board-object][data-object-kind="rectangle"], [data-board-object][data-object-kind="rounded_rectangle"], [data-board-object][data-object-kind="ellipse"], [data-board-object][data-object-kind="circle"], [data-board-object][data-object-kind="triangle"]'
      )
    )
  },

  pointerNearElement(event, element, radius = ERASER_RADIUS) {
    const rect = element.getBoundingClientRect()

    return !(
      event.clientX < rect.left - radius ||
      event.clientX > rect.right + radius ||
      event.clientY < rect.top - radius ||
      event.clientY > rect.bottom + radius
    )
  },

  localSvgPoint(event, svg) {
    const matrix = svg.getScreenCTM()

    if (!matrix) {
      return null
    }

    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  },

  eraseWholeObjectAtPointer(event) {
    const candidates = this.drawingObjectElements()
      .filter((element) => !this.wholeEraseObjectIds.has(element.dataset.objectId))
      .filter((element) => this.pointerNearElement(event, element))
      .sort((left, right) => Number(right.style.zIndex || 0) - Number(left.style.zIndex || 0))

    const element = candidates[0]

    if (!element) {
      return
    }

    if (element.dataset.objectKind === "freehand") {
      const svg = element.querySelector("svg")
      const path = element.querySelector("path[data-freehand-path]")
      const localPoint = svg ? this.localSvgPoint(event, svg) : null

      if (!path || !localPoint || !isPointNearPath(localPoint, path, ERASER_RADIUS / this.camera.zoom)) {
        return
      }
    }

    this.wholeEraseObjectIds.add(element.dataset.objectId)
    element.style.opacity = "0.2"
  },

  erasePixelsAtPointer(event) {
    const radius = ERASER_RADIUS / this.camera.zoom

    for (const element of this.drawingObjectElements()) {
      if (!this.pointerNearElement(event, element)) {
        continue
      }

      const svg = element.querySelector("svg")
      const mask = element.querySelector("mask[data-eraser-mask]")
      const point = svg ? this.localSvgPoint(event, svg) : null

      if (!svg || !mask || !point) {
        continue
      }

      if (point.x < 0 || point.x > svg.viewBox.baseVal.width || point.y < 0 || point.y > svg.viewBox.baseVal.height) {
        continue
      }

      const objectId = element.dataset.objectId
      const marks = this.pixelEraseChanges.get(objectId) || []
      const previous = marks[marks.length - 1]

      if (previous && distanceBetween(previous, point) < Math.max(radius / 3, 2)) {
        continue
      }

      const mark = { x: point.x, y: point.y, radius }
      marks.push(mark)
      this.pixelEraseChanges.set(objectId, marks)

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
      circle.setAttribute("cx", point.x)
      circle.setAttribute("cy", point.y)
      circle.setAttribute("r", radius)
      circle.setAttribute("fill", "black")
      mask.appendChild(circle)
    }
  },

  finishErasing() {
    this.isErasing = false

    document.removeEventListener("pointermove", this.onDocumentPointerMove)
    document.removeEventListener("pointerup", this.onDocumentPointerUp)

    if (this.wholeEraseObjectIds.size > 0) {
      this.pushEvent("delete_objects", {
        ids: Array.from(this.wholeEraseObjectIds)
      })
    }

    if (this.pixelEraseChanges.size > 0) {
      const objects = Array.from(this.pixelEraseChanges.entries()).map(([id, marks]) => ({ id, marks }))
      this.pushEvent("erase_object_pixels", { objects })
    }

    this.wholeEraseObjectIds = new Set()
    this.pixelEraseChanges = new Map()
  },

  findStrokePath(strokeId) {
    this.ensureClientLayers()

    if (!this.drawingLayer) {
      return null
    }

    return this.remoteStrokes.get(strokeId) || null
  },

  removeStroke(strokeId) {
    const path = this.findStrokePath(strokeId)

    if (path) {
      path.remove()
    }

    this.remoteStrokes.delete(strokeId)
  },

  renderRemoteCursor(cursor) {
    this.ensureClientLayers()

    if (!this.cursorLayer || cursor.user_id === this.guest.id) {
      return
    }

    let cursorElement = this.remoteCursors.get(cursor.user_id)

    if (cursorElement && !cursorElement.isConnected) {
      this.remoteCursors.delete(cursor.user_id)
      cursorElement = null
    }

    if (!cursorElement) {
      cursorElement = document.createElement("div")
      cursorElement.className = "absolute pointer-events-none transition-transform duration-75 ease-linear"
      cursorElement.dataset.userId = cursor.user_id

      const pointer = document.createElement("div")
      pointer.className = "h-0 w-0 rotate-[-35deg] border-x-[8px] border-t-[14px] border-x-transparent"
      pointer.style.borderTopColor = cursor.color

      const label = document.createElement("div")
      label.className = "mt-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-bold text-white shadow-lg"
      label.style.backgroundColor = cursor.color
      label.textContent = cursor.name

      cursorElement.append(pointer, label)

      this.cursorLayer.appendChild(cursorElement)
      this.remoteCursors.set(cursor.user_id, cursorElement)
    }

    cursorElement.dataset.boardX = cursor.x
    cursorElement.dataset.boardY = cursor.y
    this.positionRemoteCursor(cursorElement)
  },

  positionRemoteCursor(cursorElement) {
    const boardX = Number(cursorElement.dataset.boardX || 0)
    const boardY = Number(cursorElement.dataset.boardY || 0)
    const screenPoint = this.boardToScreenPoint({ x: boardX, y: boardY })

    cursorElement.style.transform = `translate3d(${screenPoint.x}px, ${screenPoint.y}px, 0)`
  },

  repositionRemoteCursors() {
    for (const element of this.remoteCursors.values()) {
      this.positionRemoteCursor(element)
    }
  },

  cleanupRemoteCursors(activeUserIds) {
    const activeSet = new Set(activeUserIds)

    for (const [userId, element] of this.remoteCursors.entries()) {
      if (!activeSet.has(userId)) {
        element.remove()
        this.remoteCursors.delete(userId)
      }
    }
  }
}

Hooks.BoardObjectWindow = {
  mounted() {
    this.canvas = document.getElementById("board-canvas")

    if (!this.canvas) {
      return
    }

    this.mode = null
    this.resizeMode = null

    this.startPointerX = 0
    this.startPointerY = 0
    this.startX = 0
    this.startY = 0
    this.startWidth = 0
    this.startHeight = 0
    this.groupDragElements = []
    this.groupDragStartRects = new Map()
    this.isGroupDrag = false
    this.hasMoved = false

    this.onPointerMoveHover = (event) => {
      const surface = window.OpenBoardSurface

      if (this.mode || !surface) {
        return
      }

      const selectedTool = this.canvas.dataset.selectedTool || "pan"

      if (selectedTool !== "cursor") {
        if (selectedTool === "draw" || selectedTool === "pixel_eraser") {
          this.el.style.cursor = "crosshair"
        } else if (selectedTool === "object_eraser") {
          this.el.style.cursor = "cell"
        } else {
          this.el.style.cursor = "inherit"
        }

        return
      }

      if (event.target.closest("button") || event.target.closest("textarea")) {
        this.el.style.cursor = "auto"
        return
      }

      const resizeMode = getResizeMode(this.el, event)
      this.el.style.cursor = cursorForResizeMode(resizeMode)
    }

    this.onPointerDown = (event) => {
      const surface = window.OpenBoardSurface

      if (!surface || (this.canvas.dataset.selectedTool || "pan") !== "cursor") {
        return
      }

      if (event.button !== 0) {
        return
      }

      if (event.target.closest("button") || event.target.closest("textarea")) {
        return
      }

      this.startPointerX = event.clientX
      this.startPointerY = event.clientY
      this.startX = parseFloat(this.el.style.left || "0")
      this.startY = parseFloat(this.el.style.top || "0")
      this.startWidth = parseFloat(this.el.style.width || "0")
      this.startHeight = parseFloat(this.el.style.height || "0")
      this.resizeMode = getResizeMode(this.el, event)
      this.hasMoved = false

      if (this.resizeMode) {
        this.mode = "resize"
      } else {
        this.mode = "drag"
      }

      event.preventDefault()

      const objectId = this.el.dataset.objectId
      const selectedBeforePointerDown = surface.currentSelectedObjectIds()
      const shouldKeepGroupSelection =
        !event.shiftKey && selectedBeforePointerDown.length > 1 && selectedBeforePointerDown.includes(`${objectId}`)

      if (shouldKeepGroupSelection) {
        surface.reapplySelectionOutline()
      } else {
        surface.selectObject(objectId, this.el, event.shiftKey)
      }

      this.isGroupDrag = this.mode === "drag" && surface.currentSelectedObjectIds().length > 1
      this.groupDragElements = this.isGroupDrag ? surface.selectedObjectElements() : []
      this.groupDragStartRects = new Map()

      if (this.isGroupDrag) {
        for (const element of this.groupDragElements) {
          this.groupDragStartRects.set(element.dataset.objectId, {
            element: element,
            x: parseFloat(element.style.left || "0"),
            y: parseFloat(element.style.top || "0")
          })

          element.style.transition = "none"
        }
      } else {
        this.el.style.transition = "none"
      }

      this.pushEvent("bring_to_front", {
        id: objectId
      })

      document.addEventListener("pointermove", this.onDocumentPointerMove)
      document.addEventListener("pointerup", this.onDocumentPointerUp)
    }

    this.onDocumentPointerMove = (event) => {
      const surface = window.OpenBoardSurface

      if (!this.mode || !surface) {
        return
      }

      const deltaScreenX = event.clientX - this.startPointerX
      const deltaScreenY = event.clientY - this.startPointerY
      const delta = surface.screenDeltaToBoardDelta(deltaScreenX, deltaScreenY)

      if (Math.abs(delta.x) > 1 || Math.abs(delta.y) > 1) {
        this.hasMoved = true
      }

      if (this.mode === "drag") {
        if (this.isGroupDrag) {
          for (const startRect of this.groupDragStartRects.values()) {
            const nextX = clamp(startRect.x + delta.x, 0)
            const nextY = clamp(startRect.y + delta.y, 0)

            startRect.element.style.left = `${nextX}px`
            startRect.element.style.top = `${nextY}px`
          }

          return
        }

        const nextX = clamp(this.startX + delta.x, 0)
        const nextY = clamp(this.startY + delta.y, 0)

        this.el.style.left = `${nextX}px`
        this.el.style.top = `${nextY}px`

        return
      }

      if (this.mode === "resize") {
        let nextX = this.startX
        let nextY = this.startY
        let nextWidth = this.startWidth
        let nextHeight = this.startHeight

        if (this.resizeMode.includes("e")) {
          nextWidth = this.startWidth + delta.x
        }

        if (this.resizeMode.includes("s")) {
          nextHeight = this.startHeight + delta.y
        }

        if (this.resizeMode.includes("w")) {
          nextX = this.startX + delta.x
          nextWidth = this.startWidth - delta.x
        }

        if (this.resizeMode.includes("n")) {
          nextY = this.startY + delta.y
          nextHeight = this.startHeight - delta.y
        }

        if (nextWidth < MIN_WIDTH) {
          if (this.resizeMode.includes("w")) {
            nextX = this.startX + this.startWidth - MIN_WIDTH
          }

          nextWidth = MIN_WIDTH
        }

        if (nextHeight < MIN_HEIGHT) {
          if (this.resizeMode.includes("n")) {
            nextY = this.startY + this.startHeight - MIN_HEIGHT
          }

          nextHeight = MIN_HEIGHT
        }

        if (this.el.dataset.objectKind === "ellipse" || this.el.dataset.objectKind === "circle") {
          nextWidth = Math.max(nextWidth, CIRCLE_MIN_SIZE)
          nextHeight = Math.max(nextHeight, CIRCLE_MIN_SIZE)
        }

        nextX = clamp(nextX, 0)
        nextY = clamp(nextY, 0)
        nextWidth = clamp(nextWidth, MIN_WIDTH)
        nextHeight = clamp(nextHeight, MIN_HEIGHT)

        this.el.style.left = `${nextX}px`
        this.el.style.top = `${nextY}px`
        this.el.style.width = `${nextWidth}px`
        this.el.style.height = `${nextHeight}px`
      }
    }

    this.onDocumentPointerUp = () => {
      if (!this.mode) {
        return
      }

      const mode = this.mode

      this.mode = null
      this.resizeMode = null

      document.removeEventListener("pointermove", this.onDocumentPointerMove)
      document.removeEventListener("pointerup", this.onDocumentPointerUp)

      if (this.isGroupDrag) {
        for (const startRect of this.groupDragStartRects.values()) {
          startRect.element.style.transition = ""
        }
      } else {
        this.el.style.transition = ""
      }

      const x = parseFloat(this.el.style.left || "0")
      const y = parseFloat(this.el.style.top || "0")
      const width = parseFloat(this.el.style.width || "0")
      const height = parseFloat(this.el.style.height || "0")

      if (!this.hasMoved) {
        this.isGroupDrag = false
        this.groupDragElements = []
        this.groupDragStartRects = new Map()
        return
      }

      if (mode === "resize") {
        this.isGroupDrag = false
        this.groupDragElements = []
        this.groupDragStartRects = new Map()

        this.pushEvent("resize_object", {
          id: this.el.dataset.objectId,
          x: x,
          y: y,
          width: width,
          height: height
        })

        return
      }

      if (this.isGroupDrag) {
        const movedObjects = this.groupDragElements.map((element) => ({
          id: element.dataset.objectId,
          x: parseFloat(element.style.left || "0"),
          y: parseFloat(element.style.top || "0")
        }))

        this.isGroupDrag = false
        this.groupDragElements = []
        this.groupDragStartRects = new Map()

        this.pushEvent("move_objects", {
          objects: movedObjects
        })

        return
      }

      this.pushEvent("move_object", {
        id: this.el.dataset.objectId,
        x: x,
        y: y
      })
    }

    this.el.addEventListener("pointermove", this.onPointerMoveHover)
    this.el.addEventListener("pointerdown", this.onPointerDown)
  },

  destroyed() {
    if (this.onPointerMoveHover) {
      this.el.removeEventListener("pointermove", this.onPointerMoveHover)
    }

    if (this.onPointerDown) {
      this.el.removeEventListener("pointerdown", this.onPointerDown)
    }

    if (this.onDocumentPointerMove) {
      document.removeEventListener("pointermove", this.onDocumentPointerMove)
    }

    if (this.onDocumentPointerUp) {
      document.removeEventListener("pointerup", this.onDocumentPointerUp)
    }
  }
}

const csrfToken = document.querySelector("meta[name='csrf-token']").getAttribute("content")

const liveSocket = new LiveSocket("/live", Socket, {
  longPollFallbackMs: 2500,
  hooks: Hooks,
  params: () => {
    const guest = getOrCreateGuestSession()

    return {
      _csrf_token: csrfToken,
      guest_id: guest.id,
      guest_name: guest.name,
      guest_color: guest.color
    }
  }
})

topbar.config({
  barColors: {
    0: "#2563eb"
  },
  shadowColor: "rgba(0, 0, 0, .2)"
})

window.addEventListener("phx:page-loading-start", () => topbar.show(300))
window.addEventListener("phx:page-loading-stop", () => topbar.hide())

liveSocket.connect()

window.liveSocket = liveSocket
