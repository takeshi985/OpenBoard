defmodule OpenBoardWeb.BoardLive.Show do
  use OpenBoardWeb, :live_view

  alias OpenBoard.Boards

  @impl true
  def mount(_params, _session, socket) do
    board = Boards.get_or_create_demo_board()
    board_objects = load_or_seed_demo_objects(board)

    socket =
      socket
      |> assign(:page_title, "OpenBoard Demo")
      |> assign(:board, board)
      |> assign(:board_objects, board_objects)

    {:ok, socket}
  end

  @impl true
  def handle_event("create_sticky", _params, socket) do
    board = socket.assigns.board
    count = Enum.count(socket.assigns.board_objects)

    {:ok, _object} =
      Boards.create_sticky_note(board, %{
        text: "Новая заметка",
        x: 160.0 + count * 28,
        y: 140.0 + count * 24,
        z_index: count + 1
      })

    {:noreply, reload_board_objects(socket)}
  end

  @impl true
  def handle_event("delete_object", %{"id" => id}, socket) do
    id
    |> Boards.get_board_object!()
    |> Boards.delete_board_object()

    {:noreply, reload_board_objects(socket)}
  end

  @impl true
  def handle_event("update_text", %{"id" => id, "value" => text}, socket) do
    id
    |> Boards.get_board_object!()
    |> Boards.update_board_object(%{text: text})

    {:noreply, reload_board_objects(socket)}
  end

  @impl true
  def handle_event("move_object", %{"id" => id, "x" => x, "y" => y}, socket) do
    object = Boards.get_board_object!(id)

    if object.board_id == socket.assigns.board.id do
      {:ok, _object} =
        Boards.update_board_object(object, %{
          x: x,
          y: y
        })

      {:noreply, reload_board_objects(socket)}
    else
      {:noreply, socket}
    end
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="min-h-screen bg-slate-950 text-slate-100">
      <header class="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900 px-6">
        <div>
          <div class="text-lg font-semibold tracking-tight">OpenBoard</div>
          <div class="text-xs text-slate-400">Interactive board prototype</div>
        </div>

        <div class="flex items-center gap-3">
          <div class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            Demo board
          </div>

          <button
            type="button"
            phx-click="create_sticky"
            class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-400"
          >
            + Sticky
          </button>
        </div>
      </header>

      <main class="flex h-[calc(100vh-4rem)]">
        <aside class="w-72 border-r border-slate-800 bg-slate-900/80 p-5">
          <div class="mb-6">
            <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">Board</div>
            <div class="mt-2 text-xl font-semibold">{@board.title}</div>
            <div class="mt-1 text-sm text-slate-400">/boards/demo</div>
          </div>

          <div class="space-y-3">
            <div class="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div class="text-sm font-semibold">Objects</div>
              <div class="mt-1 text-2xl font-bold">{Enum.count(@board_objects)}</div>
            </div>

            <div class="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div class="text-sm font-semibold">Current features</div>
              <ul class="mt-3 space-y-2 text-sm text-slate-400">
                <li>• Create sticky notes</li>
                <li>• Edit text</li>
                <li>• Drag and drop</li>
                <li>• Save position</li>
              </ul>
            </div>

            <div class="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div class="text-sm font-semibold">Next steps</div>
              <ul class="mt-3 space-y-2 text-sm text-slate-400">
                <li>• Live cursors</li>
                <li>• Multi-user sync</li>
                <li>• Board tools</li>
                <li>• Presence</li>
              </ul>
            </div>
          </div>
        </aside>

        <section class="relative flex-1 overflow-hidden bg-slate-950">
          <div class="absolute inset-0 opacity-40 board-grid"></div>

          <div class="absolute left-6 top-6 z-10 rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-3 shadow-xl">
            <div class="text-sm font-semibold">Canvas</div>
            <div class="text-xs text-slate-400">
              Зажми верхнюю панель стикера и перетащи его по доске.
            </div>
          </div>

          <div id="board-canvas" class="relative h-full w-full overflow-hidden">
            <%= for object <- @board_objects do %>
              <div
                id={"board-object-#{object.id}"}
                phx-hook="DraggableBoardObject"
                data-object-id={object.id}
                class={[
                  "absolute rounded-xl border p-3 shadow-xl",
                  "select-none transition hover:scale-[1.01]",
                  sticky_color_class(object.color)
                ]}
                style={
                  "left: #{object.x}px; top: #{object.y}px; width: #{object.width}px; height: #{object.height}px; z-index: #{object.z_index};"
                }
              >
                <div
                  data-drag-handle
                  class="mb-2 flex cursor-grab items-center justify-between gap-2 active:cursor-grabbing"
                  title="Drag sticky note"
                >
                  <div class="text-xs font-bold uppercase tracking-wide opacity-70">
                    Sticky note
                  </div>

                  <button
                    type="button"
                    phx-click="delete_object"
                    phx-value-id={object.id}
                    class="rounded-md px-2 py-1 text-xs font-bold opacity-60 hover:bg-black/10 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>

                <textarea
                  phx-blur="update_text"
                  phx-value-id={object.id}
                  class="h-[calc(100%-2rem)] w-full resize-none border-none bg-transparent text-sm leading-relaxed text-slate-950 outline-none placeholder:text-slate-500"
                ><%= object.text %></textarea>
              </div>
            <% end %>
          </div>
        </section>
      </main>
    </div>
    """
  end

  defp reload_board_objects(socket) do
    assign(socket, :board_objects, Boards.list_board_objects(socket.assigns.board))
  end

  defp load_or_seed_demo_objects(board) do
    case Boards.list_board_objects(board) do
      [] ->
        {:ok, _first} =
          Boards.create_sticky_note(board, %{
            text: "OpenBoard MVP\n\n1. Доска\n2. Стикеры\n3. Перетаскивание\n4. Realtime",
            x: 380.0,
            y: 160.0,
            color: "yellow",
            z_index: 1
          })

        {:ok, _second} =
          Boards.create_sticky_note(board, %{
            text: "Следующий этап:\nсделать live-курсоры и синхронизацию.",
            x: 680.0,
            y: 260.0,
            color: "blue",
            z_index: 2
          })

        Boards.list_board_objects(board)

      objects ->
        objects
    end
  end

  defp sticky_color_class("blue"), do: "border-sky-300 bg-sky-200 text-slate-950"
  defp sticky_color_class("green"), do: "border-emerald-300 bg-emerald-200 text-slate-950"
  defp sticky_color_class("pink"), do: "border-pink-300 bg-pink-200 text-slate-950"
  defp sticky_color_class(_), do: "border-yellow-300 bg-yellow-200 text-slate-950"
end
