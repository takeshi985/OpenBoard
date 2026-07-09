defmodule OpenBoardWeb.BoardLive.Show do
  use OpenBoardWeb, :live_view

  alias OpenBoard.Boards
  alias OpenBoardWeb.Presence

  @workspace_width 6000
  @workspace_height 4000

  @colors ["yellow", "blue", "green", "pink", "purple", "white"]

  @tools [
    "select",
    "sticky",
    "text",
    "line",
    "arrow",
    "rectangle",
    "rounded_rectangle",
    "ellipse",
    "triangle",
    "draw",
    "eraser"
  ]

  @shape_tools ["line", "arrow", "rectangle", "rounded_rectangle", "ellipse", "triangle"]

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
          |> assign(:selected_color, "yellow")
          |> assign(:selected_tool, "select")
          |> assign(:available_colors, @colors)
          |> assign(:workspace_width, @workspace_width)
          |> assign(:workspace_height, @workspace_height)

        {:ok, socket}
    end
  end

  @impl true
  def handle_event("select_tool", %{"tool" => tool}, socket) when tool in @tools do
    {:noreply, assign(socket, :selected_tool, tool)}
  end

  @impl true
  def handle_event("select_tool", _params, socket), do: {:noreply, socket}

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
        x: @workspace_width / 2 + count * 28,
        y: @workspace_height / 2 + count * 24,
        z_index: Boards.next_regular_z_index(board.id),
        is_pinned: false
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
  def handle_event("create_shape", %{"kind" => kind} = params, socket)
      when kind in @shape_tools do
    board = socket.assigns.board

    x = number_param(params, "x", 0.0)
    y = number_param(params, "y", 0.0)
    width = max(number_param(params, "width", 1.0), 1.0)
    height = max(number_param(params, "height", 1.0), 1.0)
    rotation = number_param(params, "rotation", 0.0)

    attrs =
      kind
      |> shape_defaults(socket.assigns.selected_color)
      |> Map.merge(%{
        board_id: board.id,
        x: x,
        y: y,
        width: width,
        height: height,
        rotation: rotation,
        z_index: Boards.next_regular_z_index(board.id),
        is_pinned: false
      })

    case Boards.create_board_object(attrs) do
      {:ok, _object} ->
        broadcast_board_objects_changed(socket)
        {:noreply, reload_board_objects(socket)}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Could not create shape")}
    end
  end

  @impl true
  def handle_event("create_shape", _params, socket), do: {:noreply, socket}

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
  def handle_event("bring_to_front", %{"id" => id}, socket) do
    object = Boards.get_board_object!(id)

    if object.board_id == socket.assigns.board.id do
      Boards.bring_board_object_to_front(object)
      broadcast_board_objects_changed(socket)

      {:noreply, reload_board_objects(socket)}
    else
      {:noreply, socket}
    end
  end

  @impl true
  def handle_event("toggle_pin", %{"id" => id}, socket) do
    object = Boards.get_board_object!(id)

    if object.board_id == socket.assigns.board.id do
      Boards.toggle_pin_board_object(object)
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
      attrs =
        if object.is_pinned do
          %{x: x, y: y, z_index: Boards.next_pinned_z_index(object.board_id)}
        else
          %{x: x, y: y, z_index: Boards.next_regular_z_index(object.board_id)}
        end

      Boards.update_board_object(object, attrs)
      broadcast_board_objects_changed(socket)

      {:noreply, reload_board_objects(socket)}
    else
      {:noreply, socket}
    end
  end

  @impl true
  def handle_event(
        "resize_object",
        %{"id" => id, "x" => x, "y" => y, "width" => width, "height" => height},
        socket
      ) do
    object = Boards.get_board_object!(id)

    if object.board_id == socket.assigns.board.id do
      attrs =
        if object.is_pinned do
          %{
            x: x,
            y: y,
            width: width,
            height: height,
            z_index: Boards.next_pinned_z_index(object.board_id)
          }
        else
          %{
            x: x,
            y: y,
            width: width,
            height: height,
            z_index: Boards.next_regular_z_index(object.board_id)
          }
        end

      Boards.update_board_object(object, attrs)
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
  def handle_event("drawing_start", params, socket) do
    user = socket.assigns.current_user

    Phoenix.PubSub.broadcast(
      OpenBoard.PubSub,
      socket.assigns.board_topic,
      {:drawing_started,
       %{
         user_id: user.id,
         stroke_id: Map.get(params, "stroke_id"),
         x: number_param(params, "x", 0.0),
         y: number_param(params, "y", 0.0),
         color: drawing_color_hex(socket.assigns.selected_color),
         width: 4,
         smoothing_epsilon: number_param(params, "smoothing_epsilon", 2.0)
       }}
    )

    {:noreply, socket}
  end

  @impl true
  def handle_event("drawing_point", %{"stroke_id" => stroke_id, "x" => x, "y" => y}, socket) do
    user = socket.assigns.current_user

    Phoenix.PubSub.broadcast(
      OpenBoard.PubSub,
      socket.assigns.board_topic,
      {:drawing_point_added,
       %{
         user_id: user.id,
         stroke_id: stroke_id,
         x: x,
         y: y
       }}
    )

    {:noreply, socket}
  end

  @impl true
  def handle_event("drawing_end", %{"stroke_id" => stroke_id}, socket) do
    user = socket.assigns.current_user

    Phoenix.PubSub.broadcast(
      OpenBoard.PubSub,
      socket.assigns.board_topic,
      {:drawing_finished,
       %{
         user_id: user.id,
         stroke_id: stroke_id
       }}
    )

    {:noreply, socket}
  end

  @impl true
  def handle_event("drawing_erase", %{"stroke_id" => stroke_id}, socket) do
    user = socket.assigns.current_user

    Phoenix.PubSub.broadcast(
      OpenBoard.PubSub,
      socket.assigns.board_topic,
      {:drawing_erased,
       %{
         user_id: user.id,
         stroke_id: stroke_id
       }}
    )

    {:noreply, socket}
  end

  @impl true
  def handle_info({:cursor_moved, cursor}, socket) do
    if cursor.user_id == socket.assigns.current_user.id do
      {:noreply, socket}
    else
      {:noreply, push_event(socket, "remote_cursor_moved", cursor)}
    end
  end

  @impl true
  def handle_info({:drawing_started, drawing}, socket) do
    if drawing.user_id == socket.assigns.current_user.id do
      {:noreply, socket}
    else
      {:noreply, push_event(socket, "remote_drawing_started", drawing)}
    end
  end

  @impl true
  def handle_info({:drawing_point_added, drawing}, socket) do
    if drawing.user_id == socket.assigns.current_user.id do
      {:noreply, socket}
    else
      {:noreply, push_event(socket, "remote_drawing_point_added", drawing)}
    end
  end

  @impl true
  def handle_info({:drawing_finished, drawing}, socket) do
    if drawing.user_id == socket.assigns.current_user.id do
      {:noreply, socket}
    else
      {:noreply, push_event(socket, "remote_drawing_finished", drawing)}
    end
  end

  @impl true
  def handle_info({:drawing_erased, drawing}, socket) do
    if drawing.user_id == socket.assigns.current_user.id do
      {:noreply, socket}
    else
      {:noreply, push_event(socket, "remote_drawing_erased", drawing)}
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
    online_user_ids = Enum.map(online_users, & &1.id)

    socket =
      socket
      |> assign(:online_users, online_users)
      |> push_event("presence_sync", %{user_ids: online_user_ids})

    {:noreply, socket}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="min-h-screen bg-[#f4f1ea] text-slate-900">
      <header class="flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-6 shadow-sm backdrop-blur">
        <div>
          <div class="text-lg font-bold tracking-tight text-slate-950">OpenBoard</div>
          
          <div class="text-xs text-slate-500">Collaborative whiteboard</div>
        </div>
        
        <div class="flex items-center gap-3">
          <.link
            navigate={~p"/boards"}
            class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Boards
          </.link>
          
          <div class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {Enum.count(@online_users)} online
          </div>
        </div>
      </header>
      
      <main class="flex h-[calc(100vh-4rem)]">
        <aside class="z-20 w-80 overflow-y-auto border-r border-slate-200 bg-white/95 p-5 shadow-sm">
          <div class="mb-6">
            <div class="text-xs font-bold uppercase tracking-wide text-slate-400">Board</div>
            
            <div class="mt-2 text-xl font-bold text-slate-950">{@board.title}</div>
            
            <div class="mt-1 text-sm text-slate-500">/boards/{@board.slug}</div>
          </div>
          
          <div class="space-y-4">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="text-sm font-bold text-slate-800">Mode</div>
              
              <div class="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  phx-click="select_tool"
                  phx-value-tool="select"
                  class={tool_button_class(@selected_tool == "select")}
                >
                  Select
                </button>
                
                <button
                  type="button"
                  phx-click="select_tool"
                  phx-value-tool="draw"
                  class={tool_button_class(@selected_tool == "draw")}
                >
                  Draw
                </button>
                
                <button
                  type="button"
                  phx-click="select_tool"
                  phx-value-tool="eraser"
                  class={tool_button_class(@selected_tool == "eraser")}
                >
                  Erase
                </button>
              </div>
              
              <div class="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-500">
                ПКМ + drag: двигать поле. Wheel: плавный zoom к курсору.
              </div>
            </div>
            
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="text-sm font-bold text-slate-800">Quick objects</div>
              
              <div class="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  phx-click="create_object"
                  phx-value-kind="sticky"
                  class="rounded-xl bg-amber-400 px-3 py-2 text-sm font-bold text-amber-950 shadow-sm hover:bg-amber-300"
                >
                  Sticky
                </button>
                
                <button
                  type="button"
                  phx-click="create_object"
                  phx-value-kind="text"
                  class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Text
                </button>
              </div>
            </div>
            
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="text-sm font-bold text-slate-800">Shape tools</div>
              
              <div class="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  phx-click="select_tool"
                  phx-value-tool="line"
                  class={tool_button_class(@selected_tool == "line")}
                >Line</button>
                <button
                  type="button"
                  phx-click="select_tool"
                  phx-value-tool="arrow"
                  class={tool_button_class(@selected_tool == "arrow")}
                >Arrow</button>
                <button
                  type="button"
                  phx-click="select_tool"
                  phx-value-tool="rectangle"
                  class={tool_button_class(@selected_tool == "rectangle")}
                >Rectangle</button>
                <button
                  type="button"
                  phx-click="select_tool"
                  phx-value-tool="rounded_rectangle"
                  class={tool_button_class(@selected_tool == "rounded_rectangle")}
                >Rounded</button>
                <button
                  type="button"
                  phx-click="select_tool"
                  phx-value-tool="ellipse"
                  class={tool_button_class(@selected_tool == "ellipse")}
                >Ellipse</button>
                <button
                  type="button"
                  phx-click="select_tool"
                  phx-value-tool="triangle"
                  class={tool_button_class(@selected_tool == "triangle")}
                >Triangle</button>
              </div>
              
              <div class="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-500">
                Выбери фигуру и протяни ЛКМ по полю.
              </div>
            </div>
            
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="flex items-center justify-between">
                <div class="text-sm font-bold text-slate-800">Color</div>
                
                <div class="text-xs font-medium text-slate-500">{@selected_color}</div>
              </div>
              
              <div class="mt-3 grid grid-cols-6 gap-2">
                <%= for color <- @available_colors do %>
                  <button
                    type="button"
                    phx-click="select_color"
                    phx-value-color={color}
                    class={[
                      "h-8 w-8 rounded-full border-2 shadow-sm transition hover:scale-110",
                      if(color == @selected_color, do: "border-slate-950", else: "border-slate-300"),
                      color_dot_class(color)
                    ]}
                    title={color}
                  ></button>
                <% end %>
              </div>
            </div>
            
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="text-sm font-bold text-slate-800">You</div>
              
              <div class="mt-3 flex items-center gap-3">
                <div class="h-3 w-3 rounded-full" style={"background-color: #{@current_user.color};"}>
                </div>
                
                <div>
                  <div class="text-sm font-bold text-slate-800">{@current_user.name}</div>
                  
                  <div class="text-xs text-slate-500">{short_guest_id(@current_user.id)}</div>
                </div>
              </div>
            </div>
            
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="flex items-center justify-between">
                <div class="text-sm font-bold text-slate-800">Online users</div>
                
                <div class="text-xs font-medium text-slate-500">{Enum.count(@online_users)}</div>
              </div>
              
              <div class="mt-3 space-y-3">
                <%= for user <- @online_users do %>
                  <div class="flex items-center gap-3">
                    <div class="h-3 w-3 rounded-full" style={"background-color: #{user.color};"}>
                    </div>
                    
                    <div class="min-w-0">
                      <div class="truncate text-sm font-semibold text-slate-700">
                        {user.name}
                        <%= if user.id == @current_user.id do %>
                          <span class="text-xs text-slate-400">(you)</span>
                        <% end %>
                      </div>
                    </div>
                  </div>
                <% end %>
              </div>
            </div>
            
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="text-sm font-bold text-slate-800">Board objects</div>
              
              <div class="mt-1 text-3xl font-black text-slate-950">{Enum.count(@board_objects)}</div>
            </div>
          </div>
        </aside>
        
        <section
          id="board-viewport"
          class="whiteboard-viewport relative flex-1 overflow-hidden bg-[#ebe7dc]"
        >
          <div
            id="board-canvas"
            phx-hook="BoardSurface"
            data-selected-tool={@selected_tool}
            data-selected-color={drawing_color_hex(@selected_color)}
            data-workspace-width={@workspace_width}
            data-workspace-height={@workspace_height}
            class="absolute inset-0 overflow-hidden"
          >
            <div
              id="viewport-grid"
              phx-update="ignore"
              class="pointer-events-none absolute inset-0 z-0"
            >
            </div>
            
            <svg
              id="drawing-layer"
              phx-update="ignore"
              class="pointer-events-none absolute inset-0 z-[1] h-full w-full"
            ></svg>
            <svg
              id="shape-preview-layer"
              phx-update="ignore"
              class="pointer-events-none absolute inset-0 z-[90000] h-full w-full"
            ></svg>
            <div
              id="remote-cursor-layer"
              phx-update="ignore"
              class="pointer-events-none absolute inset-0 z-[100000]"
            >
            </div>
            
            <div
              id="board-world"
              class="absolute left-0 top-0 origin-top-left"
              style={"width: #{@workspace_width}px; height: #{@workspace_height}px;"}
            >
              <div class="pointer-events-none absolute left-[700px] top-[360px] z-10 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-slate-700 shadow-sm backdrop-blur">
                <div class="text-sm font-bold">Canvas</div>
                
                <div class="text-xs text-slate-500">
                  Workspace 6000×4000. ПКМ — pan, колесо — zoom к курсору.
                </div>
              </div>
              
              <%= for object <- @board_objects do %>
                <%= if shape_object?(object) do %>
                  <.shape_object object={object} />
                <% else %>
                  <div
                    id={"board-object-#{object.id}"}
                    data-board-object
                    phx-hook="BoardObjectWindow"
                    data-object-id={object.id}
                    data-object-kind={object.kind}
                    class={[
                      "absolute border p-3 shadow-xl",
                      "select-none transition hover:scale-[1.002]",
                      object_container_class(object)
                    ]}
                    style={
                      "left: #{object.x}px; top: #{object.y}px; width: #{object.width}px; height: #{object.height}px; z-index: #{object.z_index};"
                    }
                  >
                    <div class="mb-2 flex items-center justify-between gap-2">
                      <div class="text-xs font-bold uppercase tracking-wide opacity-70">
                        {object_title(object.kind)}
                      </div>
                      
                      <div class="flex items-center gap-1">
                        <button
                          type="button"
                          phx-click="toggle_pin"
                          phx-value-id={object.id}
                          class={[
                            "rounded-md px-2 py-1 text-xs font-bold hover:bg-black/10",
                            if(object.is_pinned, do: "opacity-100", else: "opacity-50")
                          ]}
                          title={if object.is_pinned, do: "Unpin", else: "Pin"}
                        >
                          📌
                        </button>
                        
                        <button
                          type="button"
                          phx-click="delete_object"
                          phx-value-id={object.id}
                          class="rounded-md px-2 py-1 text-xs font-bold opacity-60 hover:bg-black/10 hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                     <textarea
                      phx-blur="update_text"
                      phx-value-id={object.id}
                      class={[
                        "w-full resize-none border-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-slate-500",
                        object_text_class(object)
                      ]}
                    ><%= object.text %></textarea>
                  </div>
                <% end %>
              <% end %>
            </div>
          </div>
        </section>
      </main>
    </div>
    """
  end

  defp shape_object(assigns) do
    ~H"""
    <div
      id={"board-object-#{@object.id}"}
      data-board-object
      phx-hook="BoardObjectWindow"
      data-object-id={@object.id}
      data-object-kind={@object.kind}
      class="absolute select-none overflow-visible"
      style={shape_style(@object)}
    >
      <svg
        class="h-full w-full overflow-visible"
        viewBox={"0 0 #{@object.width} #{@object.height}"}
        preserveAspectRatio="none"
      >
        <%= if @object.kind == "arrow" do %>
          <defs>
            <marker
              id={"arrowhead-#{@object.id}"}
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={@object.stroke_color} />
            </marker>
          </defs>
        <% end %>
        
        <%= if @object.kind in ["line", "arrow"] do %>
          <line
            x1="0"
            y1={line_y(@object)}
            x2={line_end_x(@object)}
            y2={line_y(@object)}
            stroke={@object.stroke_color}
            stroke-width={@object.stroke_width}
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
            marker-end={if @object.kind == "arrow", do: "url(#arrowhead-#{@object.id})", else: nil}
          />
        <% end %>
        
        <%= if @object.kind == "rectangle" do %>
          <rect
            x={shape_stroke_offset(@object)}
            y={shape_stroke_offset(@object)}
            width={shape_inner_width(@object)}
            height={shape_inner_height(@object)}
            fill={@object.fill_color}
            stroke={@object.stroke_color}
            stroke-width={@object.stroke_width}
            vector-effect="non-scaling-stroke"
          />
        <% end %>
        
        <%= if @object.kind == "rounded_rectangle" do %>
          <rect
            x={shape_stroke_offset(@object)}
            y={shape_stroke_offset(@object)}
            width={shape_inner_width(@object)}
            height={shape_inner_height(@object)}
            rx="18"
            ry="18"
            fill={@object.fill_color}
            stroke={@object.stroke_color}
            stroke-width={@object.stroke_width}
            vector-effect="non-scaling-stroke"
          />
        <% end %>
        
        <%= if @object.kind in ["ellipse", "circle"] do %>
          <ellipse
            cx={@object.width / 2}
            cy={@object.height / 2}
            rx={max(@object.width / 2 - @object.stroke_width, 1)}
            ry={max(@object.height / 2 - @object.stroke_width, 1)}
            fill={@object.fill_color}
            stroke={@object.stroke_color}
            stroke-width={@object.stroke_width}
            vector-effect="non-scaling-stroke"
          />
        <% end %>
        
        <%= if @object.kind == "triangle" do %>
          <polygon
            points={triangle_points(@object)}
            fill={@object.fill_color}
            stroke={@object.stroke_color}
            stroke-width={@object.stroke_width}
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        <% end %>
      </svg>
    </div>
    """
  end

  defp object_defaults("text") do
    %{
      kind: "text",
      text: "Text block",
      width: 260.0,
      height: 120.0,
      color: "white",
      rotation: 0.0,
      stroke_color: "#0f172a",
      fill_color: "transparent",
      stroke_width: 2
    }
  end

  defp object_defaults(_kind) do
    %{
      kind: "sticky",
      text: "New sticky note",
      width: 240.0,
      height: 150.0,
      rotation: 0.0,
      stroke_color: "#0f172a",
      fill_color: "transparent",
      stroke_width: 2
    }
  end

  defp shape_defaults(kind, selected_color) do
    stroke_color = drawing_color_hex(selected_color)

    %{
      kind: kind,
      text: nil,
      color: selected_color,
      fill_color: shape_fill_color(kind, selected_color),
      stroke_color: stroke_color,
      stroke_width: 3
    }
  end

  defp shape_fill_color(kind, selected_color)
       when kind in ["rectangle", "rounded_rectangle", "ellipse", "triangle"] do
    selected_color
    |> drawing_color_hex()
    |> transparent_fill()
  end

  defp shape_fill_color(_kind, _selected_color), do: "transparent"

  defp transparent_fill("#fde047"), do: "rgba(253, 224, 71, 0.18)"
  defp transparent_fill("#38bdf8"), do: "rgba(56, 189, 248, 0.16)"
  defp transparent_fill("#34d399"), do: "rgba(52, 211, 153, 0.16)"
  defp transparent_fill("#f9a8d4"), do: "rgba(249, 168, 212, 0.18)"
  defp transparent_fill("#c084fc"), do: "rgba(192, 132, 252, 0.16)"
  defp transparent_fill("#ffffff"), do: "rgba(255, 255, 255, 0.6)"
  defp transparent_fill(_color), do: "transparent"

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
            text: "OpenBoard MVP\n\n1. Большое поле\n2. Фигуры\n3. Zoom/Pan\n4. Realtime",
            x: @workspace_width / 2 - 260,
            y: @workspace_height / 2 - 120,
            color: "yellow",
            z_index: 1
          })

        {:ok, _second} =
          Boards.create_sticky_note(board, %{
            text: "ПКМ — движение поля.\nWheel — zoom к курсору.\nФигуры — протяжкой ЛКМ.",
            x: @workspace_width / 2 + 40,
            y: @workspace_height / 2 - 20,
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
  defp object_title(kind), do: kind

  defp object_container_class(%{kind: "text"}) do
    "rounded-xl border-slate-300 bg-white/95 text-slate-950"
  end

  defp object_container_class(%{color: color}) do
    "rounded-xl #{object_color_class(color)}"
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

  defp drawing_color_hex("blue"), do: "#38bdf8"
  defp drawing_color_hex("green"), do: "#34d399"
  defp drawing_color_hex("pink"), do: "#f9a8d4"
  defp drawing_color_hex("purple"), do: "#c084fc"
  defp drawing_color_hex("white"), do: "#ffffff"
  defp drawing_color_hex(_), do: "#fde047"

  defp tool_button_class(true) do
    "rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
  end

  defp tool_button_class(false) do
    "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
  end

  defp shape_object?(%{kind: kind}) do
    kind in ["line", "arrow", "rectangle", "rounded_rectangle", "ellipse", "circle", "triangle"]
  end

  defp shape_style(%{kind: kind} = object) when kind in ["line", "arrow"] do
    "left: #{object.x}px; top: #{object.y}px; width: #{object.width}px; height: #{object.height}px; z-index: #{object.z_index}; transform: rotate(#{object.rotation || 0}deg); transform-origin: 0px 50%;"
  end

  defp shape_style(object) do
    "left: #{object.x}px; top: #{object.y}px; width: #{object.width}px; height: #{object.height}px; z-index: #{object.z_index}; transform: rotate(#{object.rotation || 0}deg); transform-origin: center;"
  end

  defp shape_stroke_offset(object), do: max(object.stroke_width / 2, 1)
  defp shape_inner_width(object), do: max(object.width - object.stroke_width, 1)
  defp shape_inner_height(object), do: max(object.height - object.stroke_width, 1)

  defp triangle_points(object) do
    top_x = object.width / 2
    top_y = object.stroke_width
    left_x = object.stroke_width
    bottom_y = max(object.height - object.stroke_width, 1)
    right_x = max(object.width - object.stroke_width, 1)

    "#{top_x},#{top_y} #{right_x},#{bottom_y} #{left_x},#{bottom_y}"
  end

  defp line_y(object), do: object.height / 2
  defp line_end_x(object), do: max(object.width, 1)

  defp number_param(params, key, fallback) do
    case Map.get(params, key) do
      value when is_float(value) -> value
      value when is_integer(value) -> value * 1.0
      value when is_binary(value) -> parse_float(value, fallback)
      _value -> fallback
    end
  end

  defp parse_float(value, fallback) do
    case Float.parse(value) do
      {number, _rest} -> number
      :error -> fallback
    end
  end
end
