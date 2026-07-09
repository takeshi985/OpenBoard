defmodule OpenBoard.Repo.Migrations.AddPinningToBoardObjects do
  use Ecto.Migration

  def change do
    alter table(:board_objects) do
      add :is_pinned, :boolean, null: false, default: false
    end

    create index(:board_objects, [:board_id, :is_pinned])
  end
end
