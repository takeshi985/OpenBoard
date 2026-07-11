defmodule OpenBoard.Boards do
  @moduledoc """
  Boards context for OpenBoard.

  It manages boards and all objects placed on a board.
  """

  import Ecto.Query, warn: false

  alias OpenBoard.Repo
  alias OpenBoard.Boards.Board
  alias OpenBoard.Boards.BoardObject

  @regular_z_min 1
  @regular_z_max 9_999
  @pinned_z_min 10_000

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

  def create_board_from_title(title) do
    clean_title =
      title
      |> to_string()
      |> String.trim()

    title =
      case clean_title do
        "" -> "Untitled Board"
        value -> value
      end

    create_board(%{
      title: title,
      slug: generate_unique_slug(),
      is_public: true
    })
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
    board_id = Map.get(attrs, :board_id) || Map.get(attrs, "board_id")

    attrs =
      if Map.has_key?(attrs, :z_index) or Map.has_key?(attrs, "z_index") or is_nil(board_id) do
        attrs
      else
        Map.put(attrs, :z_index, next_regular_z_index(board_id))
      end

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
      z_index: next_regular_z_index(board.id),
      is_pinned: false,
      rotation: 0.0,
      stroke_color: "#0f172a",
      fill_color: "transparent",
      stroke_width: 2
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

  def bring_board_object_to_front(%BoardObject{} = board_object) do
    if board_object.is_pinned do
      update_board_object(board_object, %{z_index: next_pinned_z_index(board_object.board_id)})
    else
      update_board_object(board_object, %{z_index: next_regular_z_index(board_object.board_id)})
    end
  end

  def toggle_pin_board_object(%BoardObject{} = board_object) do
    if board_object.is_pinned do
      update_board_object(board_object, %{
        is_pinned: false,
        z_index: next_regular_z_index(board_object.board_id)
      })
    else
      update_board_object(board_object, %{
        is_pinned: true,
        z_index: next_pinned_z_index(board_object.board_id)
      })
    end
  end

  def next_regular_z_index(board_id) do
    max_z =
      BoardObject
      |> where([object], object.board_id == ^board_id)
      |> where([object], object.is_pinned == false)
      |> where([object], object.z_index < @regular_z_max)
      |> select([object], max(object.z_index))
      |> Repo.one()

    max((max_z || @regular_z_min) + 1, @regular_z_min)
  end

  def next_pinned_z_index(board_id) do
    max_z =
      BoardObject
      |> where([object], object.board_id == ^board_id)
      |> where([object], object.is_pinned == true)
      |> where([object], object.z_index >= @pinned_z_min)
      |> select([object], max(object.z_index))
      |> Repo.one()

    max((max_z || @pinned_z_min) + 1, @pinned_z_min)
  end

  defp generate_unique_slug do
    slug =
      16
      |> :crypto.strong_rand_bytes()
      |> Base.url_encode64(padding: false)
      |> String.downcase()
      |> then(&"board-#{&1}")

    case get_board_by_slug(slug) do
      nil -> slug
      _board -> generate_unique_slug()
    end
  end
end
