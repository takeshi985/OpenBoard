defmodule OpenBoard.BoardsTest do
  use OpenBoard.DataCase, async: false

  alias OpenBoard.Boards

  test "new boards receive long capability slugs" do
    assert {:ok, board} = Boards.create_board_from_title("Planning")

    assert String.starts_with?(board.slug, "board-")
    assert byte_size(board.slug) >= 28
    assert board.is_public
  end

  test "generated board slugs are unique" do
    assert {:ok, first} = Boards.create_board_from_title("First")
    assert {:ok, second} = Boards.create_board_from_title("Second")

    refute first.slug == second.slug
  end
end
