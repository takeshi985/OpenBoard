defmodule OpenBoardWeb.BoardLive.Show do
  use OpenBoardWeb, :live_view

  alias OpenBoard.Boards
  alias OpenBoardWeb.Presence

  @colors ["yellow", "blue", "green", "pink", "purple", "white"]

  @impl true
  def mount(%{"slug" => slug}, _session, socket) do
    case load_board(slug) do
      nil ->
        socket =
          socket
          |> put_flash(:error, "Board not found")
          |> push_navigate(to: ~p"/boards")

        {:ok, socket}

      board ->
        board_objects = load_or_seed_demo_objects(board)
        user = build_guest_user(socket)
        topic = board_topic(board)

        if connected?(socket) do
          Phoenix.PubSub.subscribe(OpenBoard.PubSub, topic)

          Presence.track(self(), topic, user.id, %{
            id: user.id,
            name: user.name,
            color: user.color,
            joined_at: DateTime.utc_now()
          })
        end

        socket =
          socket
          |> assign(:page_title, board.title)
          |> assign(:board, board)
          |> assign(:board_topic, topic)
          |> assign(:current_user, user)
          |> assign(:board_objects, board_objects)
          |> assign(:online_users, list_online_users(topic))
          |> assign(:remote_cursors, %{})
          |> assign(:selected_color, "yellow")
          |> assign(:available_colors, @colors)

        {:ok, socket}
    end
  end

  @impl true
  def handle_event("select_color", %{"color" => color}, socket) when color in @colors do
    {:noreply, assign(socket, :selected_color, color)}
  end

  @impl true
  def handle_event("select_color", _params, socket), do: {:noreply, socket}

  @impl true
  def handle_event("create_object", %{"kind" => kind}, socket) do
    board = socket.assigns.board
    count = Enum.count(socket.assigns.board_objects)
    color = socket.assigns.selected_color

    attrs =
      kind
      |> object_defaults()
      |> Map.merge(%{
        board_id: board.id,
        color: color,
        x: 180.0 + count * 28,
        y: 150.0 + count * 24,
        z_index: count + 1
      })

    case Boards.create_board_object(attrs) do
      {:ok, _object} ->
        broadcast_board_objects_changed(socket)
        {:noreply, reload_board_objects(socket)}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Could not create object")}
    end
  end

  @impl true
  def handle_event("delete_object", %{"id" => id}, socket) do
    object = Boards.get_board_object!(id)

    if object.board_id == socket.assigns.board.id do
      Boards.delete_board_object(object)
      broadcast_board_objects_changed(socket)

      {:noreply, reload_board_objects(socket)}
    else
      {:noreply, socket}
    end
  end

  @impl true
  def handle_event("update_text", %{"id" => id, "value" => text}, socket) do
    object = Boards.get_board_object!(id)

    if object.board_id == socket.assigns.board.id do
      Boards.update_board_object(object, %{text: text})
      broadcast_board_objects_changed(socket)

      {:noreply, reload_board_objects(socket)}
    else
      {:noreply, socket}
    end
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

      broadcast_board_objects_changed(socket)

      {:noreply, reload_board_objects(socket)}
    else
      {:noreply, socket}
    end
  end

  @impl true
  def handle_event("resize_object", %{"id" => id, "width" => width, "height" => height}, socket) do
    object = Boards.get_board_object!(id)

    if object.board_id == socket.assigns.board.id do
      {:ok, _object} =
        Boards.update_board_object(object, %{
          width: width,
          height: height
        })

      broadcast_board_objects_changed(socket)

      {:noreply, reload_board_objects(socket)}
    else
      {:noreply, socket}
    end
  end

  @impl true
  def handle_event("cursor_move", %{"x" => x, "y" => y}, socket) do
    user = socket.assigns.current_user

    Phoenix.PubSub.broadcast(
      OpenBoard.PubSub,
      socket.assigns.board_topic,
      {:cursor_moved,
       %{
         user_id: user.id,
         name: user.name,
         color: user.color,
         x: x,
         y: y
       }}
    )

    {:noreply, socket}
  end

  @impl true
  def handle_info({:cursor_moved, cursor}, socket) do
    current_user = socket.assigns.current_user

    if cursor.user_id == current_user.id do
      {:noreply, socket}
    else
      remote_cursors =
        Map.put(socket.assigns.remote_cursors, cursor.user_id, %{
          name: cursor.name,
          color: cursor.color,
          x: cursor.x,
          y: cursor.y
        })

      {:noreply, assign(socket, :remote_cursors, remote_cursors)}
    end
  end

  @impl true
  def handle_info(:board_objects_changed, socket) do
    {:noreply, reload_board_objects(socket)}
  end

  @impl true
  def handle_info(%Phoenix.Socket.Broadcast{event: "presence_diff"}, socket) do
    topic = socket.assigns.board_topic
    online_users = list_online_users(topic)
    online_user_ids = MapSet.new(Enum.map(online_users, & &1.id))

    remote_cursors =
      socket.assigns.remote_cursors
      |> Enum.reject(fn {user_id, _cursor} -> not MapSet.member?(online_user_ids, user_id) end)
      |> Map.new()

    socket =
      socket
      |> assign(:online_users, online_users)
      |> assign(:remote_cursors, remote_cursors)

    {:noreply, socket}
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
          <.link
            navigate={~p"/boards"}
            class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Boards
          </.link>

          <div class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            {Enum.count(@online_users)} online
          </div>
        </div>
      </header>

      <main class="flex h-[calc(100vh-4rem)]">
        <aside class="w-72 overflow-y-auto border-r border-slate-800 bg-slate-900/80 p-5">
          <div class="mb-6">
            <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">Board</div>
            <div class="mt-2 text-xl font-semibold">{@board.title}</div>
            <div class="mt-1 text-sm text-slate-400">/boards/{@board.slug}</div>
          </div>

          <div class="space-y-3">
            <div class="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div class="text-sm font-semibold">Tools</div>

              <div class="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  phx-click="create_object"
                  phx-value-kind="sticky"
                  class="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-400"
                >
                  Sticky
                </button>

                <button
                  type="button"
                  phx-click="create_object"
                  phx-value-kind="text"
                  class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Text
                </button>

                <button
                  type="button"
                  phx-click="create_object"
                  phx-value-kind="rectangle"
                  class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Rectangle
                </button>

                <button
                  type="button"
                  phx-click="create_object"
                  phx-value-kind="circle"
                  class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Circle
                </button>
              </div>
            </div>

            <div class="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div class="flex items-center justify-between">
                <div class="text-sm font-semibold">Color</div>
                <div class="text-xs text-slate-500">{@selected_color}</div>
              </div>

              <div class="mt-3 grid grid-cols-6 gap-2">
                <%= for color <- @available_colors do %>
                  <button
                    type="button"
                    phx-click="select_color"
                    phx-value-color={color}
                    class={[
                      "h-7 w-7 rounded-full border-2 transition hover:scale-110",
                      if(color == @selected_color, do: "border-orange-400", else: "border-slate-700"),
                      color_dot_class(color)
                    ]}
                    title={color}
                  ></button>
                <% end %>
              </div>
            </div>

            <div class="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div class="text-sm font-semibold">You</div>

              <div class="mt-3 flex items-center gap-3">
                <div
                  class="h-3 w-3 rounded-full"
                  style={"background-color: #{@current_user.color};"}
                >
                </div>

                <div>
                  <div class="text-sm font-semibold">{@current_user.name}</div>
                  <div class="text-xs text-slate-500">{short_guest_id(@current_user.id)}</div>
                </div>
              </div>
            </div>

            <div class="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div class="flex items-center justify-between">
                <div class="text-sm font-semibold">Online users</div>
                <div class="text-xs text-slate-500">{Enum.count(@online_users)}</div>
              </div>

              <div class="mt-3 space-y-3">
                <%= for user <- @online_users do %>
                  <div class="flex items-center gap-3">
                    <div class="h-3 w-3 rounded-full" style={"background-color: #{user.color};"}>
                    </div>

                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium">
                        {user.name}
                        <%= if user.id == @current_user.id do %>
                          <span class="text-xs text-slate-500">(you)</span>
                        <% end %>
                      </div>
                    </div>
                  </div>
                <% end %>
              </div>
            </div>

            <div class="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div class="text-sm font-semibold">Objects</div>
              <div class="mt-1 text-2xl font-bold">{Enum.count(@board_objects)}</div>
            </div>
          </div>
        </aside>

        <section class="relative flex-1 overflow-hidden bg-slate-950">
          <div class="absolute inset-0 opacity-40 board-grid"></div>

          <div class="absolute left-6 top-6 z-10 rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-3 shadow-xl">
            <div class="text-sm font-semibold">Canvas</div>
            <div class="text-xs text-slate-400">
              Objects can be dragged and resized. Use the bottom-right handle.
            </div>
          </div>

          <div
            id="board-canvas"
            phx-hook="BoardCursor"
            class="relative h-full w-full overflow-hidden"
          >
            <%= for {_user_id, cursor} <- @remote_cursors do %>
              <div
                class="pointer-events-none absolute z-[1000]"
                style={"left: #{cursor.x}px; top: #{cursor.y}px;"}
              >
                <div
                  class="h-0 w-0 border-l-[8px] border-r-[8px] border-t-[14px] border-l-transparent border-r-transparent"
                  style={"border-top-color: #{cursor.color}; transform: rotate(-35deg);"}
                >
                </div>

                <div
                  class="mt-1 rounded-md px-2 py-1 text-xs font-semibold text-white shadow"
                  style={"background-color: #{cursor.color};"}
                >
                  {cursor.name}
                </div>
              </div>
            <% end %>

            <%= for object <- @board_objects do %>
              <div
                id={"board-object-#{object.id}"}
                phx-hook="DraggableBoardObject"
                data-object-id={object.id}
                data-object-kind={object.kind}
                class={[
                  "absolute relative border p-3 shadow-xl",
                  "select-none transition hover:scale-[1.01]",
                  object_container_class(object)
                ]}
                style={
                  "left: #{object.x}px; top: #{object.y}px; width: #{object.width}px; height: #{object.height}px; z-index: #{object.z_index};"
                }
              >
                <div
                  data-drag-handle
                  class="mb-2 flex cursor-grab items-center justify-between gap-2 active:cursor-grabbing"
                  title="Drag object"
                >
                  <div class="text-xs font-bold uppercase tracking-wide opacity-70">
                    {object_title(object.kind)}
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

                <%= if object.kind in ["sticky", "text", "rectangle", "circle"] do %>
                  <textarea
                    phx-blur="update_text"
                    phx-value-id={object.id}
                    class={[
                      "w-full resize-none border-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-slate-500",
                      object_text_class(object)
                    ]}
                  ><%= object.text %></textarea>
                <% end %>

                <div
                  data-resize-handle
                  class="absolute bottom-1 right-1 z-20 h-4 w-4 cursor-se-resize rounded-sm border border-slate-600 bg-white/70 shadow hover:bg-orange-300"
                  title="Resize object"
                >
                </div>
              </div>
            <% end %>
          </div>
        </section>
      </main>
    </div>
    """
  end

  defp object_defaults("text") do
    %{
      kind: "text",
      text: "Text block",
      width: 260.0,
      height: 120.0,
      color: "white"
    }
  end

  defp object_defaults("rectangle") do
    %{
      kind: "rectangle",
      text: "Rectangle",
      width: 260.0,
      height: 150.0
    }
  end

  defp object_defaults("circle") do
    %{
      kind: "circle",
      text: "Circle",
      width: 170.0,
      height: 170.0
    }
  end

  defp object_defaults(_kind) do
    %{
      kind: "sticky",
      text: "New sticky note",
      width: 240.0,
      height: 150.0
    }
  end

  defp load_board("demo"), do: Boards.get_or_create_demo_board()
  defp load_board(slug), do: Boards.get_board_by_slug(slug)

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
            text: "Теперь есть:\n- online presence\n- live cursors\n- multi-tab sync",
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

  defp broadcast_board_objects_changed(socket) do
    Phoenix.PubSub.broadcast(
      OpenBoard.PubSub,
      socket.assigns.board_topic,
      :board_objects_changed
    )
  end

  defp list_online_users(topic) do
    topic
    |> Presence.list()
    |> Enum.map(fn {_user_id, %{metas: metas}} ->
      meta =
        metas
        |> Enum.sort_by(& &1.joined_at, {:desc, DateTime})
        |> List.first()

      %{
        id: meta.id,
        name: meta.name,
        color: meta.color
      }
    end)
    |> Enum.sort_by(& &1.name)
  end

  defp build_guest_user(socket) do
    if connected?(socket) do
      params = get_connect_params(socket)

      %{
        id: clean_connect_param(params["guest_id"], fallback_guest_id()),
        name: clean_connect_param(params["guest_name"], "Guest"),
        color: clean_color(params["guest_color"])
      }
    else
      %{
        id: "guest-connecting",
        name: "Connecting...",
        color: "#64748b"
      }
    end
  end

  defp clean_connect_param(value, fallback) when is_binary(value) do
    value
    |> String.trim()
    |> case do
      "" -> fallback
      clean_value -> String.slice(clean_value, 0, 80)
    end
  end

  defp clean_connect_param(_value, fallback), do: fallback

  defp clean_color("#" <> hex = color) when byte_size(hex) == 6, do: color
  defp clean_color(_value), do: "#f97316"

  defp fallback_guest_id do
    "guest-#{System.unique_integer([:positive])}"
  end

  defp short_guest_id("guest-" <> rest), do: "guest-" <> String.slice(rest, 0, 8)
  defp short_guest_id(id), do: id

  defp board_topic(board), do: "board:#{board.id}"

  defp object_title("sticky"), do: "Sticky note"
  defp object_title("text"), do: "Text block"
  defp object_title("rectangle"), do: "Rectangle"
  defp object_title("circle"), do: "Circle"
  defp object_title(kind), do: kind

  defp object_container_class(%{kind: "text"}) do
    "rounded-xl border-slate-500 bg-white/95 text-slate-950"
  end

  defp object_container_class(%{kind: "rectangle", color: color}) do
    "rounded-xl #{object_color_class(color)}"
  end

  defp object_container_class(%{kind: "circle", color: color}) do
    "rounded-full #{object_color_class(color)}"
  end

  defp object_container_class(%{color: color}) do
    "rounded-xl #{object_color_class(color)}"
  end

  defp object_text_class(%{kind: "circle"}) do
    "h-[calc(100%-2rem)] text-center text-slate-950"
  end

  defp object_text_class(%{kind: "text"}) do
    "h-[calc(100%-2rem)] text-slate-950"
  end

  defp object_text_class(_object) do
    "h-[calc(100%-2rem)] text-slate-950"
  end

  defp object_color_class("blue"), do: "border-sky-300 bg-sky-200 text-slate-950"
  defp object_color_class("green"), do: "border-emerald-300 bg-emerald-200 text-slate-950"
  defp object_color_class("pink"), do: "border-pink-300 bg-pink-200 text-slate-950"
  defp object_color_class("purple"), do: "border-purple-300 bg-purple-200 text-slate-950"
  defp object_color_class("white"), do: "border-slate-300 bg-white text-slate-950"
  defp object_color_class(_), do: "border-yellow-300 bg-yellow-200 text-slate-950"

  defp color_dot_class("blue"), do: "bg-sky-300"
  defp color_dot_class("green"), do: "bg-emerald-300"
  defp color_dot_class("pink"), do: "bg-pink-300"
  defp color_dot_class("purple"), do: "bg-purple-300"
  defp color_dot_class("white"), do: "bg-white"
  defp color_dot_class(_), do: "bg-yellow-300"
end
