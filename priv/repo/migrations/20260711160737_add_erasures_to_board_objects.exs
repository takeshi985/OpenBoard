defmodule OpenBoard.Repo.Migrations.AddErasuresToBoardObjects do
  use Ecto.Migration

  def change do
    alter table(:board_objects) do
      add :erasures, :map
    end
  end
end
