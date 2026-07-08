defmodule OpenBoard.Boards.Board do
  use Ecto.Schema

  import Ecto.Changeset

  alias OpenBoard.Boards.BoardObject

  schema "boards" do
    field :title, :string
    field :slug, :string
    field :is_public, :boolean, default: false

    has_many :board_objects, BoardObject

    timestamps(type: :utc_datetime)
  end

  def changeset(board, attrs) do
    board
    |> cast(attrs, [:title, :slug, :is_public])
    |> validate_required([:title, :slug])
    |> validate_length(:title, min: 1, max: 120)
    |> validate_length(:slug, min: 1, max: 80)
    |> unique_constraint(:slug)
  end
end
