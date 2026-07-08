defmodule OpenBoard.Repo.Migrations.CreateBoardObjects do
  use Ecto.Migration

  def change do
    create table(:board_objects) do
      add :board_id, references(:boards, on_delete: :delete_all), null: false

      add :kind, :string, null: false
      add :text, :text
      add :x, :float, null: false, default: 0.0
      add :y, :float, null: false, default: 0.0
      add :width, :float, null: false, default: 240.0
      add :height, :float, null: false, default: 150.0
      add :color, :string, null: false, default: "yellow"
      add :z_index, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create index(:board_objects, [:board_id])
  end
end
