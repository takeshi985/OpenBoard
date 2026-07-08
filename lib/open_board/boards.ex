defmodule OpenBoard.Boards do
  @moduledoc """
  Boards context for OpenBoard.

  It manages boards and all objects placed on a board.
  """

  import Ecto.Query, warn: false

  alias OpenBoard.Repo
  alias OpenBoard.Boards.Board
  alias OpenBoard.Boards.BoardObject

  def list_boards do
    Board
    |> order_by([board], desc: board.inserted_at)
    |> Repo.all()
  end

  def get_board!(id), do: Repo.get!(Board, id)

  def get_board_by_slug(slug) when is_binary(slug) do
    Repo.get_by(Board, slug: slug)
  end

  def get_or_create_demo_board do
    case get_board_by_slug("demo") do
      nil ->
        {:ok, board} =
          create_board(%{
            title: "Demo Board",
            slug: "demo",
            is_public: true
          })

        board

      board ->
        board
    end
  end

  def create_board(attrs \\ %{}) do
    %Board{}
    |> Board.changeset(attrs)
    |> Repo.insert()
  end

  def update_board(%Board{} = board, attrs) do
    board
    |> Board.changeset(attrs)
    |> Repo.update()
  end

  def delete_board(%Board{} = board), do: Repo.delete(board)

  def change_board(%Board{} = board, attrs \\ %{}) do
    Board.changeset(board, attrs)
  end

  def list_board_objects(%Board{id: board_id}), do: list_board_objects(board_id)

  def list_board_objects(board_id) do
    BoardObject
    |> where([object], object.board_id == ^board_id)
    |> order_by([object], asc: object.z_index, asc: object.inserted_at)
    |> Repo.all()
  end

  def get_board_object!(id), do: Repo.get!(BoardObject, id)

  def create_board_object(attrs \\ %{}) do
    %BoardObject{}
    |> BoardObject.changeset(attrs)
    |> Repo.insert()
  end

  def create_sticky_note(%Board{} = board, attrs \\ %{}) do
    defaults = %{
      board_id: board.id,
      kind: "sticky",
      text: "New sticky note",
      x: 160.0,
      y: 120.0,
      width: 240.0,
      height: 150.0,
      color: "yellow",
      z_index: 1
    }

    defaults
    |> Map.merge(attrs)
    |> create_board_object()
  end

  def update_board_object(%BoardObject{} = board_object, attrs) do
    board_object
    |> BoardObject.changeset(attrs)
    |> Repo.update()
  end

  def delete_board_object(%BoardObject{} = board_object), do: Repo.delete(board_object)

  def change_board_object(%BoardObject{} = board_object, attrs \\ %{}) do
    BoardObject.changeset(board_object, attrs)
  end
end
