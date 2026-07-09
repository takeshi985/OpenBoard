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

Hooks.BoardCursor = {
  mounted() {
    this.lastSentAt = 0

    this.onPointerMove = (event) => {
      const now = Date.now()

      if (now - this.lastSentAt < 50) {
        return
      }

      this.lastSentAt = now

      const rect = this.el.getBoundingClientRect()
      const x = Math.round(event.clientX - rect.left)
      const y = Math.round(event.clientY - rect.top)

      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        return
      }

      this.pushEvent("cursor_move", {
        x: x,
        y: y
      })
    }

    this.el.addEventListener("pointermove", this.onPointerMove)
  },

  destroyed() {
    if (this.onPointerMove) {
      this.el.removeEventListener("pointermove", this.onPointerMove)
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

      if (event.target.closest("button") || event.target.closest("textarea")) {
        this.el.style.cursor = "auto"
        return
      }

      const resizeMode = getResizeMode(this.el, event)
      this.el.style.cursor = cursorForResizeMode(resizeMode)
    }

    this.onPointerDown = (event) => {
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