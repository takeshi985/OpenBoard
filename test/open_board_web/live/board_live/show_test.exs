defmodule OpenBoardWeb.BoardLive.ShowTest do
  use OpenBoardWeb.ConnCase, async: false

  import Phoenix.LiveViewTest

  alias OpenBoard.Boards

  setup do
    {:ok, board} = Boards.create_board_from_title("Drawing board")
    %{board: board}
  end

  test "opens the pencil palette and selects a color", %{conn: conn, board: board} do
    assert {:ok, view, _html} = live(conn, ~p"/boards/#{board.slug}")

    view
    |> element("button[phx-value-tool='draw']")
    |> render_click()

    assert has_element?(view, "#pencil-color-palette")

    view
    |> element("#pencil-color-blue")
    |> render_click()

    assert has_element?(view, "#board-canvas[data-selected-color='#38bdf8']")
  end

  test "renders the live drawing layer above board objects", %{conn: conn, board: board} do
    assert {:ok, view, _html} = live(conn, ~p"/boards/#{board.slug}")

    assert has_element?(view, "#drawing-layer.z-\\[90000\\]")
  end
end
