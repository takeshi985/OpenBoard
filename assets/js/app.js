// Include phoenix_html to handle method=PUT/DELETE in forms and buttons.
import "phoenix_html"

// Establish Phoenix Socket and LiveView configuration.
import { Socket } from "phoenix"
import { LiveSocket } from "phoenix_live_view"
import topbar from "../vendor/topbar"

const Hooks = {}

Hooks.DraggableBoardObject = {
  mounted() {
    this.handle = this.el.querySelector("[data-drag-handle]")
    this.canvas = document.getElementById("board-canvas")

    if (!this.handle || !this.canvas) {
      return
    }

    this.isDragging = false
    this.startPointerX = 0
    this.startPointerY = 0
    this.startObjectX = 0
    this.startObjectY = 0

    this.onPointerDown = (event) => {
      if (event.button !== 0) {
        return
      }

      if (event.target.closest("button")) {
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

    this.handle.addEventListener("pointerdown", this.onPointerDown)
  },

  destroyed() {
    if (this.handle && this.onPointerDown) {
      this.handle.removeEventListener("pointerdown", this.onPointerDown)
    }

    if (this.onPointerMove) {
      document.removeEventListener("pointermove", this.onPointerMove)
    }

    if (this.onPointerUp) {
      document.removeEventListener("pointerup", this.onPointerUp)
    }
  }
}

const csrfToken = document.querySelector("meta[name='csrf-token']").getAttribute("content")

const liveSocket = new LiveSocket("/live", Socket, {
  longPollFallbackMs: 2500,
  hooks: Hooks,
  params: {
    _csrf_token: csrfToken
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