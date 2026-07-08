defmodule OpenBoard.Repo.Migrations.CreateBoards do
  use Ecto.Migration

  def change do
    create table(:boards) do
      add :title, :string, null: false
      add :slug, :string, null: false
      add :is_public, :boolean, null: false, default: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:boards, [:slug])
  end
end
