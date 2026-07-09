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
const MIN_DRAW_POINT_DISTANCE = 0.5
const STAIR_SMOOTHING_SCREEN_EPSILON = 1.8
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2.5

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
    const length = path.getTotalLength()
    const samples = Math.max(12, Math.ceil(length / 10))

    for (let index = 0; index <= samples; index += 1) {
      const pathPoint = path.getPointAtLength((length * index) / samples)

      if (distanceBetween(point, { x: pathPoint.x, y: pathPoint.y }) <= radius) {
        return true
      }
    }

    return false
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
    this.selectedObjectId = null

    this.lastCursorSentAt = 0
    this.lastDrawSentAt = 0
    this.lastEraseSentAt = 0

    this.isDrawing = false
    this.isErasing = false
    this.isPanning = false
    this.isShapeDrawing = false

    this.currentStrokeId = null
    this.currentLocalPath = null
    this.currentShapeKind = null
    this.currentShapeStartPoint = null
    this.currentShapeEndPoint = null
    this.currentShapePreview = null

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
      const tagName = event.target.tagName.toLowerCase()

      if (tagName === "input" || tagName === "textarea" || event.target.isContentEditable) {
        return
      }

      if ((event.key === "Delete" || event.key === "Backspace") && this.selectedObjectId) {
        event.preventDefault()

        this.pushEvent("delete_object", {
          id: this.selectedObjectId
        })

        this.selectedObjectId = null
        this.clearSelectionOutline()
      }
    }

    this.onPointerMove = (event) => {
      this.sendCursorMove(event)

      if (this.isDrawing) {
        this.addLocalDrawingPoint(event)
      }

      if (this.isErasing) {
        this.eraseAtPointer(event)
      }
    }

    this.onPointerDown = (event) => {
      this.updateDatasetState()

      if (event.button === 2) {
        this.startPanning(event)
        return
      }

      if (event.button !== 0) {
        return
      }

      if (event.target.closest("[data-board-object]")) {
        return
      }

      this.selectedObjectId = null
      this.clearSelectionOutline()

      if (this.selectedTool === "draw") {
        this.startDrawing(event)
        return
      }

      if (this.selectedTool === "eraser") {
        this.startErasing(event)
        return
      }

      if (SHAPE_TOOLS.has(this.selectedTool)) {
        this.startShapeDrawing(event)
      }
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
    }

    this.handleEvent("remote_cursor_moved", (cursor) => {
      this.renderRemoteCursor(cursor)
    })

    this.handleEvent("presence_sync", ({ user_ids }) => {
      this.cleanupRemoteCursors(user_ids)
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
      this.remoteStrokes.delete(drawing.stroke_id)
    })

    this.handleEvent("remote_drawing_erased", (drawing) => {
      this.removeStroke(drawing.stroke_id)
    })

    this.el.addEventListener("contextmenu", this.onContextMenu)
    this.el.addEventListener("wheel", this.onWheel, { passive: false })
    this.el.addEventListener("pointermove", this.onPointerMove)
    this.el.addEventListener("pointerdown", this.onPointerDown)
    document.addEventListener("keydown", this.onKeyDown)
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
      document.removeEventListener("keydown", this.onKeyDown)
    }

    if (this.onDocumentPointerMove) {
      document.removeEventListener("pointermove", this.onDocumentPointerMove)
    }

    if (this.onDocumentPointerUp) {
      document.removeEventListener("pointerup", this.onDocumentPointerUp)
    }
  },

  updateDatasetState() {
    this.selectedTool = this.el.dataset.selectedTool || "select"
    this.selectedColor = this.el.dataset.selectedColor || "#fde047"

    if (this.selectedTool === "draw") {
      this.el.style.cursor = "crosshair"
    } else if (this.selectedTool === "eraser") {
      this.el.style.cursor = "cell"
    } else if (SHAPE_TOOLS.has(this.selectedTool)) {
      this.el.style.cursor = "crosshair"
    } else {
      this.el.style.cursor = "default"
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

  selectObject(objectId, element) {
    this.selectedObjectId = objectId
    this.clearSelectionOutline()

    if (element) {
      element.classList.add("ring-2", "ring-blue-500")
    }
  },

  clearSelectionOutline() {
    document.querySelectorAll("[data-board-object]").forEach((element) => {
      element.classList.remove("ring-2", "ring-blue-500")
    })
  },

  reapplySelectionOutline() {
    if (!this.selectedObjectId) {
      return
    }

    const element = document.getElementById(`board-object-${this.selectedObjectId}`)

    if (element) {
      element.classList.add("ring-2", "ring-blue-500")
    }
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

    this.pushEvent("drawing_end", {
      stroke_id: this.currentStrokeId
    })

    this.currentStrokeId = null
    this.currentLocalPath = null
  },

  startErasing(event) {
    event.preventDefault()

    this.isErasing = true
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

    const point = this.screenToBoardPoint(event)

    if (!this.isPointInside(point)) {
      return
    }

    this.ensureClientLayers()

    const paths = Array.from(this.drawingLayer.querySelectorAll("path[data-stroke-id]"))

    for (const path of paths) {
      if (isPointNearPath(point, path, ERASER_RADIUS)) {
        const strokeId = path.dataset.strokeId

        this.removeStroke(strokeId)

        this.pushEvent("drawing_erase", {
          stroke_id: strokeId
        })
      }
    }
  },

  finishErasing() {
    this.isErasing = false

    document.removeEventListener("pointermove", this.onDocumentPointerMove)
    document.removeEventListener("pointerup", this.onDocumentPointerUp)
  },

  findStrokePath(strokeId) {
    this.ensureClientLayers()

    if (!this.drawingLayer) {
      return null
    }

    return this.drawingLayer.querySelector(`path[data-stroke-id="${strokeId}"]`)
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

      cursorElement.innerHTML = `
        <div style="
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 14px solid ${cursor.color};
          transform: rotate(-35deg);
        "></div>
        <div style="
          margin-top: 4px;
          border-radius: 6px;
          padding: 4px 8px;
          background: ${cursor.color};
          color: white;
          font-size: 12px;
          font-weight: 700;
          box-shadow: 0 10px 15px rgba(0, 0, 0, 0.25);
          white-space: nowrap;
        ">${cursor.name}</div>
      `

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
    this.hasMoved = false

    this.onPointerMoveHover = (event) => {
      const surface = window.OpenBoardSurface

      if (this.mode || !surface) {
        return
      }

      if ((this.canvas.dataset.selectedTool || "select") !== "select") {
        this.el.style.cursor = "auto"
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

      if (!surface || (this.canvas.dataset.selectedTool || "select") !== "select") {
        return
      }

      if (event.button !== 0) {
        return
      }

      if (event.target.closest("button")) {
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

      surface.selectObject(this.el.dataset.objectId, this.el)

      this.el.style.transition = "none"

      this.pushEvent("bring_to_front", {
        id: this.el.dataset.objectId
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

      this.el.style.transition = ""

      const x = parseFloat(this.el.style.left || "0")
      const y = parseFloat(this.el.style.top || "0")
      const width = parseFloat(this.el.style.width || "0")
      const height = parseFloat(this.el.style.height || "0")

      if (!this.hasMoved) {
        return
      }

      if (mode === "resize") {
        this.pushEvent("resize_object", {
          id: this.el.dataset.objectId,
          x: x,
          y: y,
          width: width,
          height: height
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
