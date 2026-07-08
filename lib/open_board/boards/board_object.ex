defmodule OpenBoard.Boards.BoardObject do
  use Ecto.Schema

  import Ecto.Changeset

  alias OpenBoard.Boards.Board

  @allowed_kinds ["sticky", "text", "rectangle", "circle", "line", "arrow"]

  schema "board_objects" do
    field :kind, :string
    field :text, :string
    field :x, :float, default: 0.0
    field :y, :float, default: 0.0
    field :width, :float, default: 240.0
    field :height, :float, default: 150.0
    field :color, :string, default: "yellow"
    field :z_index, :integer, default: 0

    belongs_to :board, Board

    timestamps(type: :utc_datetime)
  end

  def changeset(board_object, attrs) do
    board_object
    |> cast(attrs, [:board_id, :kind, :text, :x, :y, :width, :height, :color, :z_index])
    |> validate_required([:board_id, :kind, :x, :y, :width, :height])
    |> validate_inclusion(:kind, @allowed_kinds)
    |> validate_number(:width, greater_than: 0)
    |> validate_number(:height, greater_than: 0)
    |> assoc_constraint(:board)
  end
end
