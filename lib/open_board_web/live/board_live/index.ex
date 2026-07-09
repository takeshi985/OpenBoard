defmodule OpenBoardWeb.BoardLive.Index do
  use OpenBoardWeb, :live_view

  alias OpenBoard.Boards

  @impl true
  def mount(_params, _session, socket) do
    socket =
      socket
      |> assign(:page_title, "OpenBoard Boards")
      |> assign(:boards, Boards.list_boards())

    {:ok, socket}
  end

  @impl true
  def handle_event("create_board", %{"board" => %{"title" => title}}, socket) do
    case Boards.create_board_from_title(title) do
      {:ok, board} ->
        {:noreply, push_navigate(socket, to: ~p"/boards/#{board.slug}")}

      {:error, _changeset} ->
        socket =
          socket
          |> put_flash(:error, "Could not create board")
          |> assign(:boards, Boards.list_boards())

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
          <div class="text-xs text-slate-400">Boards dashboard</div>
        </div>

        <.link
          navigate={~p"/boards/demo"}
          class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
        >
          Open demo
        </.link>
      </header>

      <main class="mx-auto max-w-6xl px-6 py-8">
        <section class="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div class="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 class="text-3xl font-bold tracking-tight">Your boards</h1>
              <p class="mt-2 max-w-2xl text-sm text-slate-400">
                Create interactive boards for lessons, brainstorming, diagrams and shared work.
              </p>
            </div>

            <form phx-submit="create_board" class="flex w-full gap-3 md:w-auto">
              <input
                type="text"
                name="board[title]"
                placeholder="New board title"
                class="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-orange-500 md:w-72"
              />

              <button
                type="submit"
                class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-400"
              >
                Create
              </button>
            </form>
          </div>
        </section>

        <section>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg font-semibold">All boards</h2>
            <div class="text-sm text-slate-500">{Enum.count(@boards)} total</div>
          </div>

          <%= if Enum.empty?(@boards) do %>
            <div class="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-10 text-center">
              <div class="text-lg font-semibold">No boards yet</div>
              <div class="mt-2 text-sm text-slate-400">
                Create your first board using the form above.
              </div>
            </div>
          <% else %>
            <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <%= for board <- @boards do %>
                <.link
                  navigate={~p"/boards/#{board.slug}"}
                  class="group rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl transition hover:-translate-y-0.5 hover:border-orange-500/60 hover:bg-slate-800"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <div class="text-lg font-bold text-slate-100 group-hover:text-orange-300">
                        {board.title}
                      </div>

                      <div class="mt-1 text-sm text-slate-500">
                        /boards/{board.slug}
                      </div>
                    </div>

                    <div class="rounded-full bg-slate-950 px-3 py-1 text-xs text-slate-400">
                      Public
                    </div>
                  </div>

                  <div class="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div class="board-card-grid h-32 rounded-lg border border-slate-800 bg-slate-950">
                      <div class="ml-5 mt-5 h-16 w-28 rounded-lg border border-yellow-300 bg-yellow-200 shadow">
                      </div>

                      <div class="ml-28 mt-[-22px] h-16 w-28 rounded-lg border border-sky-300 bg-sky-200 shadow">
                      </div>
                    </div>
                  </div>

                  <div class="mt-4 text-xs text-slate-500">
                    Created {Calendar.strftime(board.inserted_at, "%Y-%m-%d %H:%M")}
                  </div>
                </.link>
              <% end %>
            </div>
          <% end %>
        </section>
      </main>
    </div>
    """
  end
end
