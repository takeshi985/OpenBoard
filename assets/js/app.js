// Include phoenix_html to handle method=PUT/DELETE in forms and buttons.
import "phoenix_html"

// Establish Phoenix Socket and LiveView configuration.
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

function getCanvasPoint(element, event) {
  const rect = element.getBoundingClientRect()

  return {
    x: Math.round(event.clientX - rect.left),
    y: Math.round(event.clientY - rect.top)
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

function createSvgPath(svg, strokeId, x, y, color, width) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")

  path.dataset.strokeId = strokeId
  path.dataset.points = `${x},${y}`
  path.setAttribute("d", `M ${x} ${y}`)
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", color)
  path.setAttribute("stroke-width", width)
  path.setAttribute("stroke-linecap", "round")
  path.setAttribute("stroke-linejoin", "round")

  svg.appendChild(path)

  return path
}

function appendSvgPoint(path, x, y) {
  if (!path) {
    return
  }

  const points = path.dataset.points || ""
  path.dataset.points = `${points} ${x},${y}`.trim()

  const commands = path.dataset.points
    .split(" ")
    .map((point, index) => {
      const [pointX, pointY] = point.split(",")

      if (index === 0) {
        return `M ${pointX} ${pointY}`
      }

      return `L ${pointX} ${pointY}`
    })
    .join(" ")

  path.setAttribute("d", commands)
}

function distanceBetween(pointA, pointB) {
  const dx = pointA.x - pointB.x
  const dy = pointA.y - pointB.y

  return Math.sqrt(dx * dx + dy * dy)
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

Hooks.BoardSurface = {
  mounted() {
    this.guest = getOrCreateGuestSession()
    this.cursorLayer = document.getElementById("remote-cursor-layer")
    this.drawingLayer = document.getElementById("drawing-layer")

    this.remoteCursors = new Map()
    this.remoteStrokes = new Map()

    this.lastCursorSentAt = 0
    this.lastDrawSentAt = 0
    this.lastEraseSentAt = 0

    this.isDrawing = false
    this.isErasing = false
    this.currentStrokeId = null
    this.currentLocalPath = null

    this.updateDatasetState()

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

      if (event.button !== 0) {
        return
      }

      if (event.target.closest("[data-board-object]")) {
        return
      }

      if (this.selectedTool === "draw") {
        this.startDrawing(event)
        return
      }

      if (this.selectedTool === "eraser") {
        this.startErasing(event)
      }
    }

    this.onDocumentPointerMove = (event) => {
      if (this.isDrawing) {
        this.addLocalDrawingPoint(event)
      }

      if (this.isErasing) {
        this.eraseAtPointer(event)
      }
    }

    this.onDocumentPointerUp = () => {
      if (this.isDrawing) {
        this.finishDrawing()
      }

      if (this.isErasing) {
        this.finishErasing()
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
        drawing.width
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

    this.el.addEventListener("pointermove", this.onPointerMove)
    this.el.addEventListener("pointerdown", this.onPointerDown)
  },

  updated() {
    this.updateDatasetState()
    this.ensureClientLayers()
    this.reconnectRemoteCursorElements()
  },

  destroyed() {
    if (this.onPointerMove) {
      this.el.removeEventListener("pointermove", this.onPointerMove)
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
  },

  updateDatasetState() {
    this.selectedTool = this.el.dataset.selectedTool || "select"
    this.selectedColor = this.el.dataset.selectedColor || "#fde047"

    if (this.selectedTool === "draw") {
      this.el.style.cursor = "crosshair"
    } else if (this.selectedTool === "eraser") {
      this.el.style.cursor = "cell"
    } else {
      this.el.style.cursor = "default"
    }
  },

  ensureClientLayers() {
    this.cursorLayer = document.getElementById("remote-cursor-layer")
    this.drawingLayer = document.getElementById("drawing-layer")
  },

  reconnectRemoteCursorElements() {
    for (const [userId, element] of this.remoteCursors.entries()) {
      if (!element.isConnected) {
        this.remoteCursors.delete(userId)
      }
    }
  },

  isPointInside(point) {
    return (
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= this.el.clientWidth &&
      point.y <= this.el.clientHeight
    )
  },

  sendCursorMove(event) {
    const now = Date.now()

    if (now - this.lastCursorSentAt < CURSOR_SEND_INTERVAL) {
      return
    }

    this.lastCursorSentAt = now

    const point = getCanvasPoint(this.el, event)

    if (!this.isPointInside(point)) {
      return
    }

    this.pushEvent("cursor_move", {
      x: point.x,
      y: point.y
    })
  },

  startDrawing(event) {
    event.preventDefault()

    const point = getCanvasPoint(this.el, event)

    if (!this.isPointInside(point)) {
      return
    }

    this.ensureClientLayers()

    this.isDrawing = true
    this.currentStrokeId = `stroke-${this.guest.id}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
    this.currentLocalPath = createSvgPath(
      this.drawingLayer,
      this.currentStrokeId,
      point.x,
      point.y,
      this.selectedColor,
      4
    )

    this.pushEvent("drawing_start", {
      stroke_id: this.currentStrokeId,
      x: point.x,
      y: point.y
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

    const point = getCanvasPoint(this.el, event)

    if (!this.isPointInside(point)) {
      return
    }

    appendSvgPoint(this.currentLocalPath, point.x, point.y)

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

    const point = getCanvasPoint(this.el, event)

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

    cursorElement.style.transform = `translate3d(${cursor.x}px, ${cursor.y}px, 0)`
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

    this.onPointerMoveHover = (event) => {
      if (this.mode) {
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
      if ((this.canvas.dataset.selectedTool || "select") !== "select") {
        return
      }

      if (event.button !== 0) {
        return
      }

      if (event.target.closest("button")) {
        return
      }

      const objectRect = this.el.getBoundingClientRect()
      const canvasRect = this.canvas.getBoundingClientRect()

      this.startPointerX = event.clientX
      this.startPointerY = event.clientY
      this.startX = objectRect.left - canvasRect.left
      this.startY = objectRect.top - canvasRect.top
      this.startWidth = objectRect.width
      this.startHeight = objectRect.height

      this.resizeMode = getResizeMode(this.el, event)

      if (this.resizeMode) {
        this.mode = "resize"
      } else {
        this.mode = "drag"
      }

      event.preventDefault()

      this.el.style.transition = "none"
      this.el.style.zIndex = "9999"
      this.el.classList.add("ring-2", "ring-orange-400")

      this.pushEvent("bring_to_front", {
        id: this.el.dataset.objectId
      })

      document.addEventListener("pointermove", this.onDocumentPointerMove)
      document.addEventListener("pointerup", this.onDocumentPointerUp)
    }

    this.onDocumentPointerMove = (event) => {
      if (!this.mode) {
        return
      }

      const deltaX = event.clientX - this.startPointerX
      const deltaY = event.clientY - this.startPointerY

      if (this.mode === "drag") {
        const nextX = clamp(this.startX + deltaX, 0)
        const nextY = clamp(this.startY + deltaY, 0)

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
          nextWidth = this.startWidth + deltaX
        }

        if (this.resizeMode.includes("s")) {
          nextHeight = this.startHeight + deltaY
        }

        if (this.resizeMode.includes("w")) {
          nextX = this.startX + deltaX
          nextWidth = this.startWidth - deltaX
        }

        if (this.resizeMode.includes("n")) {
          nextY = this.startY + deltaY
          nextHeight = this.startHeight - deltaY
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

        if (this.el.dataset.objectKind === "circle") {
          const size = Math.max(CIRCLE_MIN_SIZE, nextWidth, nextHeight)

          if (this.resizeMode.includes("w")) {
            nextX = this.startX + this.startWidth - size
          }

          if (this.resizeMode.includes("n")) {
            nextY = this.startY + this.startHeight - size
          }

          nextWidth = size
          nextHeight = size
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

      this.el.classList.remove("ring-2", "ring-orange-400")
      this.el.style.transition = ""

      const x = parseFloat(this.el.style.left || "0")
      const y = parseFloat(this.el.style.top || "0")
      const width = parseFloat(this.el.style.width || "0")
      const height = parseFloat(this.el.style.height || "0")

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

// Show progress bar on live navigation and form submits.
topbar.config({
  barColors: {
    0: "#f97316"
  },
  shadowColor: "rgba(0, 0, 0, .3)"
})

window.addEventListener("phx:page-loading-start", () => topbar.show(300))
window.addEventListener("phx:page-loading-stop", () => topbar.hide())

// Connect if there are any LiveViews on the page.
liveSocket.connect()

// Expose liveSocket on window for web console debug logs and latency simulation.
window.liveSocket = liveSocket