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
    refute has_element?(view, "#pencil-color-palette")
  end

  test "accepts a custom pencil color and closes the palette", %{conn: conn, board: board} do
    assert {:ok, view, _html} = live(conn, ~p"/boards/#{board.slug}")

    view |> element("button[phx-value-tool='draw']") |> render_click()
    view |> form("#custom-pencil-color-form", %{"color" => "#123abc"}) |> render_change()

    assert has_element?(view, "#board-canvas[data-selected-color='#123abc']")
    refute has_element?(view, "#pencil-color-palette")
  end

  test "offers separate whole-object and pixel erasers", %{conn: conn, board: board} do
    assert {:ok, view, _html} = live(conn, ~p"/boards/#{board.slug}")

    assert has_element?(view, "button[phx-value-tool='object_eraser']")
    assert has_element?(view, "button[phx-value-tool='pixel_eraser']")
  end

  test "places a sticky only after a canvas position is confirmed", %{conn: conn, board: board} do
    assert {:ok, view, _html} = live(conn, ~p"/boards/#{board.slug}")

    view |> element("button[phx-value-tool='sticky']") |> render_click()
    assert has_element?(view, "#sticky-color-blue")

    view |> element("#sticky-color-blue") |> render_click()
    assert Boards.list_board_objects(board) == []

    render_hook(view, "create_sticky_at", %{"x" => 320, "y" => 240})

    assert [sticky] = Boards.list_board_objects(board)
    assert sticky.kind == "sticky"
    assert sticky.color == "blue"
    assert sticky.x == 320.0
    assert sticky.y == 240.0
  end

  test "persists pixel eraser marks on drawing objects", %{conn: conn, board: board} do
    assert {:ok, object} =
             Boards.create_board_object(%{
               board_id: board.id,
               kind: "rectangle",
               x: 10.0,
               y: 20.0,
               width: 200.0,
               height: 120.0
             })

    assert {:ok, view, _html} = live(conn, ~p"/boards/#{board.slug}")

    render_hook(view, "erase_object_pixels", %{
      "objects" => [
        %{
          "id" => object.id,
          "marks" => [%{"x" => 40, "y" => 50, "radius" => 18}]
        }
      ]
    })

    updated = Boards.get_board_object!(object.id)
    assert updated.erasures == %{"marks" => [%{"x" => 40.0, "y" => 50.0, "radius" => 18.0}]}
  end

  test "renders the live drawing layer above board objects", %{conn: conn, board: board} do
    assert {:ok, view, _html} = live(conn, ~p"/boards/#{board.slug}")

    assert has_element?(view, "#drawing-layer.z-\\[90000\\]")
  end
end
