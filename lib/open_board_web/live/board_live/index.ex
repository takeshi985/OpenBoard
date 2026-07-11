defmodule OpenBoardWeb.BoardLive.Index do
  use OpenBoardWeb, :live_view

  alias OpenBoard.Boards

  @impl true
  def mount(_params, _session, socket) do
    socket =
      socket
      |> assign(:page_title, "OpenBoard Boards")
      |> assign(:form, to_form(%{"title" => ""}, as: :board))

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
          |> assign(:form, to_form(%{"title" => title}, as: :board))

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
              <h1 class="text-3xl font-bold tracking-tight">Create a private-link board</h1>

              <p class="mt-2 max-w-2xl text-sm text-slate-400">
                Every new board gets a long, unguessable collaboration link. Share that link only with people who may edit the board.
              </p>
            </div>

            <.form
              for={@form}
              id="create-board-form"
              phx-submit="create_board"
              class="flex w-full gap-3 md:w-auto"
            >
              <.input
                field={@form[:title]}
                id="board-title"
                type="text"
                label="Board title"
                placeholder="New board title"
                class="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-orange-500 md:w-72"
              />
              <button
                id="create-board-button"
                type="submit"
                class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-400"
              >
                Create
              </button>
            </.form>
          </div>
        </section>

        <section
          id="board-access-notice"
          class="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
        >
          <div class="flex items-start gap-3">
            <.icon name="hero-shield-check" class="mt-0.5 size-6 text-emerald-400" />
            <div>
              <h2 class="font-semibold text-slate-100">Boards are no longer publicly indexed</h2>
              <p class="mt-1 text-sm text-slate-400">
                Save the board URL after creating it. Anyone with that URL can collaborate, similar to an editable Miro share link.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
    """
  end
end
