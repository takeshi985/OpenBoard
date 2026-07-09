defmodule OpenBoard.Repo.Migrations.AddShapeStyleFieldsToBoardObjects do
  use Ecto.Migration

  def change do
    alter table(:board_objects) do
      add :rotation, :float, null: false, default: 0.0
      add :stroke_color, :string, null: false, default: "#0f172a"
      add :fill_color, :string, null: false, default: "transparent"
      add :stroke_width, :integer, null: false, default: 2
    end
  end
end
