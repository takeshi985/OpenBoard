defmodule OpenBoardWeb.BoardLive.IndexTest do
  use OpenBoardWeb.ConnCase, async: false

  import Phoenix.LiveViewTest

  alias OpenBoard.Boards

  test "does not expose the global board directory", %{conn: conn} do
    assert {:ok, board} = Boards.create_board_from_title("Hidden from index")
    assert {:ok, view, _html} = live(conn, ~p"/boards")

    assert has_element?(view, "#create-board-form")
    assert has_element?(view, "#board-access-notice")
    refute has_element?(view, "a[href='/boards/#{board.slug}']")
  end
end
