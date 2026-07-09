// Include phoenix_html to handle method=PUT/DELETE in forms and buttons.
import "phoenix_html"

// Establish Phoenix Socket and LiveView configuration.
import { Socket } from "phoenix"
import { LiveSocket } from "phoenix_live_view"
import topbar from "../vendor/topbar"

const Hooks = {}

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

Hooks.DraggableBoardObject = {
  mounted() {
    this.handle = this.el.querySelector("[data-drag-handle]")
    this.resizeHandle = this.el.querySelector("[data-resize-handle]")
    this.canvas = document.getElementById("board-canvas")

    if (!this.canvas) {
      return
    }

    this.isDragging = false
    this.isResizing = false

    this.startPointerX = 0
    this.startPointerY = 0
    this.startObjectX = 0
    this.startObjectY = 0
    this.startWidth = 0
    this.startHeight = 0

    this.onPointerDown = (event) => {
      if (event.button !== 0 || this.isResizing) {
        return
      }

      if (event.target.closest("button") || event.target.closest("[data-resize-handle]")) {
        return
      }

      event.preventDefault()

      const objectRect = this.el.getBoundingClientRect()
      const canvasRect = this.canvas.getBoundingClientRect()

      this.isDragging = true
      this.startPointerX = event.clientX
      this.startPointerY = event.clientY
      this.startObjectX = objectRect.left - canvasRect.left
      this.startObjectY = objectRect.top - canvasRect.top

      this.el.style.transition = "none"
      this.el.style.zIndex = "999"
      this.el.classList.add("ring-2", "ring-orange-400")

      document.addEventListener("pointermove", this.onPointerMove)
      document.addEventListener("pointerup", this.onPointerUp)
    }

    this.onPointerMove = (event) => {
      if (!this.isDragging) {
        return
      }

      const deltaX = event.clientX - this.startPointerX
      const deltaY = event.clientY - this.startPointerY

      const nextX = Math.max(0, Math.round(this.startObjectX + deltaX))
      const nextY = Math.max(0, Math.round(this.startObjectY + deltaY))

      this.el.style.left = `${nextX}px`
      this.el.style.top = `${nextY}px`
    }

    this.onPointerUp = () => {
      if (!this.isDragging) {
        return
      }

      this.isDragging = false

      document.removeEventListener("pointermove", this.onPointerMove)
      document.removeEventListener("pointerup", this.onPointerUp)

      this.el.classList.remove("ring-2", "ring-orange-400")
      this.el.style.transition = ""

      const x = parseFloat(this.el.style.left || "0")
      const y = parseFloat(this.el.style.top || "0")

      this.pushEvent("move_object", {
        id: this.el.dataset.objectId,
        x: x,
        y: y
      })
    }

    this.onResizePointerDown = (event) => {
      if (event.button !== 0 || this.isDragging) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const objectRect = this.el.getBoundingClientRect()

      this.isResizing = true
      this.startPointerX = event.clientX
      this.startPointerY = event.clientY
      this.startWidth = objectRect.width
      this.startHeight = objectRect.height

      this.el.style.transition = "none"
      this.el.style.zIndex = "999"
      this.el.classList.add("ring-2", "ring-sky-400")

      document.addEventListener("pointermove", this.onResizePointerMove)
      document.addEventListener("pointerup", this.onResizePointerUp)
    }

    this.onResizePointerMove = (event) => {
      if (!this.isResizing) {
        return
      }

      const deltaX = event.clientX - this.startPointerX
      const deltaY = event.clientY - this.startPointerY

      let nextWidth = Math.max(110, Math.round(this.startWidth + deltaX))
      let nextHeight = Math.max(80, Math.round(this.startHeight + deltaY))

      if (this.el.dataset.objectKind === "circle") {
        const size = Math.max(90, nextWidth, nextHeight)
        nextWidth = size
        nextHeight = size
      }

      this.el.style.width = `${nextWidth}px`
      this.el.style.height = `${nextHeight}px`
    }

    this.onResizePointerUp = () => {
      if (!this.isResizing) {
        return
      }

      this.isResizing = false

      document.removeEventListener("pointermove", this.onResizePointerMove)
      document.removeEventListener("pointerup", this.onResizePointerUp)

      this.el.classList.remove("ring-2", "ring-sky-400")
      this.el.style.transition = ""

      const width = parseFloat(this.el.style.width || "0")
      const height = parseFloat(this.el.style.height || "0")

      this.pushEvent("resize_object", {
        id: this.el.dataset.objectId,
        width: width,
        height: height
      })
    }

    if (this.handle) {
      this.handle.addEventListener("pointerdown", this.onPointerDown)
    }

    if (this.resizeHandle) {
      this.resizeHandle.addEventListener("pointerdown", this.onResizePointerDown)
    }
  },

  destroyed() {
    if (this.handle && this.onPointerDown) {
      this.handle.removeEventListener("pointerdown", this.onPointerDown)
    }

    if (this.resizeHandle && this.onResizePointerDown) {
      this.resizeHandle.removeEventListener("pointerdown", this.onResizePointerDown)
    }

    if (this.onPointerMove) {
      document.removeEventListener("pointermove", this.onPointerMove)
    }

    if (this.onPointerUp) {
      document.removeEventListener("pointerup", this.onPointerUp)
    }

    if (this.onResizePointerMove) {
      document.removeEventListener("pointermove", this.onResizePointerMove)
    }

    if (this.onResizePointerUp) {
      document.removeEventListener("pointerup", this.onResizePointerUp)
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